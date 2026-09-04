// ===========================================================================
// lib/ingest/pipeline.mjs
// ---------------------------------------------------------------------------
// Ingest pipeline cluster moved out of server.mjs:
//   - rebuildChunksForFile  (re-chunk + re-embed for a single file)
//   - ingestSource          (universal upsert: URL/Text/File/Directory/Media)
//   - ingestMediaUrl        (yt-dlp → wav → whisper → ingestSource)
//   - recrawlUrlSource      (sitemap/BFS crawl → per-page ingestSource)
//   - withCrawlMutex        (global single-flight for crawls)
//   - deriveChildSourceId   (deterministic uuid-shaped child id)
//
// All collaborators (pool, embed worker, crawler, helpers) are injected via
// createIngestPipeline({...}). RAG settings are read through a getter so live
// reassignments in server.mjs propagate.
//
// Public exports:
//   createIngestPipeline({ deps }) →
//     { rebuildChunksForFile, ingestSource, ingestMediaUrl,
//       recrawlUrlSource, withCrawlMutex, deriveChildSourceId }
// ===========================================================================

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { extractProduct } from "../product-extract.mjs";

export function createIngestPipeline(deps) {
  const {
    pool,
    getRagSettings,
    ensureKnowledgeChunksTable,
    tableHasColumn,
    sanitizeContent,
    chunkText,
    enrichChunkContent,
    linkEntitiesForChunk,
    embedAndStoreChunks,
    deriveBrand,
    deriveBrandFromUrl,
    htmlToText,
    createLocalId,
    MAX_INDEXED_CHARS,
    crawlUrl,
    crawlPresetConfig,
  } = deps;

  // ---- Single-file chunk rebuild + immediate/lazy embedding --------------
  async function rebuildChunksForFile({ fileId, spaceId, root, filePath, content, accessLevel, brand, sourceType = null, version = 1, sourceTimestamp = null, awaitEmbeddings = false, signal = null }) {
    await ensureKnowledgeChunksTable();
    const finalBrand = brand ?? deriveBrand(root, filePath);
    const cleanContent = sanitizeContent(content);
    const chunks = chunkText(cleanContent);
    await pool.query("DELETE FROM knowledge_chunks WHERE source_id=$1", [fileId]);
    if (!chunks.length) return 0;
    
    let n = 0;
    const newIds = [];
    const newTexts = [];
    const RAG_SETTINGS = getRagSettings();
    for (let idx = 0; idx < chunks.length; idx++) {
      if (signal?.aborted) break;
      const chunk = chunks[idx];
      const enriched = enrichChunkContent({ brand: finalBrand, path: filePath, content: chunk.content });
      const { product, category, version: docVersion } = extractProduct({ brand: finalBrand, path: filePath, filename: null });
      
      const metadata = {
        root, path: filePath, access_level: accessLevel, brand: finalBrand,
        source_type: sourceType, version, source_timestamp: sourceTimestamp,
        page_start: 1, page_end: 1,
        product, product_category: category, doc_version: docVersion,
        content_enriched: enriched, enriched_at: new Date().toISOString()
      };

      const r = await pool.query(
        `INSERT INTO knowledge_chunks(source_id, space_id, seq, content, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
        [fileId, spaceId || null, idx, chunk, JSON.stringify(metadata)]
      );

      await linkEntitiesForChunk(r.rows[0].id, chunk).catch(() => {});
      newIds.push(r.rows[0].id);

      const embText = RAG_SETTINGS?.useEnrichedContent ? enriched : chunk;
      newTexts.push(String(embText).slice(0, 1500));
      n++;
    }

    if (awaitEmbeddings) {
      const embeddingReady = await tableHasColumn("knowledge_chunks", "embedding").catch(() => false);
      if (!embeddingReady) return n;
      const written = await embedAndStoreChunks(newIds, newTexts, { signal });
    } else {
      embedAndStoreChunks(newIds, newTexts, { signal }).catch((e) => {
        if (process.env.DEBUG_RAG) console.error("[embed:rebuild]", String(e.message||e));
      });
    }
    return n;
  }

  // ---- Universal Ingestion ------------------------------------------------
  async function ingestSource({ id, name, type, content, url = null, tag = null, brand = null, accessLevel = "Viewer", sourceTimestamp = null, awaitEmbeddings = false, parentId = null, crawlConfig = null, parserUsed = null, parseQuality = null, title = null, spaceId = null, ownerId = null, ownerName = null, sizeMb = 0, folderId = null, userTags = [] }) {
    const sourceId = id || createLocalId();
    const safeContent = sanitizeContent(content).slice(0, MAX_INDEXED_CHARS);
    const chunkCount = Math.max(1, Math.ceil(safeContent.length / 800));
    const contentHash = createHash("sha256").update(safeContent).digest("hex");
    const charCount = safeContent.length;
    const resolvedQuality = parseQuality || (charCount >= 80 ? "ok" : "low");

    const meta = {
      url, tag, version: 1, source_timestamp: sourceTimestamp, content_hash: contentHash,
      parent_id: parentId, crawl_config: crawlConfig, parser_used: parserUsed, parse_quality: resolvedQuality,
      title, char_count: charCount
    };

    const finalTags = Array.isArray(userTags) ? userTags : [];
    if (tag && !finalTags.includes(tag)) finalTags.push(tag);

    await pool.query(
      `INSERT INTO knowledge_sources(id, name, kind, brand, space_id, folder_id, owner_id, owner_name, chunks, size_mb, tags, metadata, status, stage, queued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, 'pending', 'queued', now())
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, kind=EXCLUDED.kind, brand=EXCLUDED.brand, chunks=EXCLUDED.chunks, tags=EXCLUDED.tags, metadata=EXCLUDED.metadata`,
      [sourceId, name || "Unnamed", type || "file", brand || null, spaceId || null, folderId || null, ownerId || null, ownerName || null, chunkCount, sizeMb, JSON.stringify(finalTags), JSON.stringify(meta)]
    );

    const root = `source:${type}`;
    const written = await rebuildChunksForFile({
      fileId: sourceId, spaceId, root, filePath: name, content: safeContent, accessLevel, brand,
      sourceType: type, version: 1, sourceTimestamp, awaitEmbeddings,
    });

    let finalQuality = resolvedQuality;
    if (written === 0) finalQuality = "broken";
    else if (charCount < 500) finalQuality = "thin";
    else finalQuality = "ok";

    await pool.query(
      `UPDATE knowledge_sources SET status='indexed', stage=NULL, chunks=$2, indexed_at=now() WHERE id=$1`,
      [sourceId, written]
    ).catch(() => {});

    return { sourceId, chunks: written, chunksWritten: written, version: 1, parseQuality: finalQuality, parserUsed };
  }

  // ---- yt-dlp + whisper media ingestion -----------------------------------
  async function ingestMediaUrl(url, { cookie } = {}) {
    const { spawnSync } = await import("node:child_process");
    const ytdlp = process.env.YTDLP_BIN || "yt-dlp";
    // probe yt-dlp availability
    const probe = spawnSync(ytdlp, ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) {
      return { ok: false, error: "yt-dlp not installed on host. brew install yt-dlp (or set YTDLP_BIN)." };
    }
    // metadata first
    const metaArgs = ["-J", "--no-warnings", "--no-playlist", url];
    if (cookie) metaArgs.push("--add-header", `Cookie:${cookie}`);
    const m = spawnSync(ytdlp, metaArgs, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    let title = url, uploader = "", duration = 0, brand = null;
    try {
      const j = JSON.parse(m.stdout || "{}");
      title = j.title || j.fulltitle || url;
      uploader = j.uploader || j.channel || "";
      duration = j.duration || 0;
      brand = deriveBrandFromUrl(url);
    } catch { }

    // download bestaudio → temp file
    const tmpBase = path.join(os.tmpdir(), `elara-media-${Date.now()}`);
    const dlArgs = [
      "-f", "bestaudio/best",
      "--no-playlist", "--no-warnings", "--quiet",
      "-x", "--audio-format", "wav", "--audio-quality", "0",
      "--postprocessor-args", "-ac 1 -ar 16000",
      "-o", `${tmpBase}.%(ext)s`,
      url,
    ];
    if (cookie) dlArgs.push("--add-header", `Cookie:${cookie}`);
    const d = spawnSync(ytdlp, dlArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const wavPath = `${tmpBase}.wav`;
    if (!fs.existsSync(wavPath)) {
      return { ok: false, error: `yt-dlp download failed: ${(d.stderr||"").slice(0,400) || "no audio file"}` };
    }

    // whisper transcription
    let transcript = "";
    const whisperBin = process.env.WHISPER_BIN;
    const whisperModel = process.env.WHISPER_MODEL;
    if (whisperBin && whisperModel) {
      try {
        spawnSync(whisperBin, ["-m", whisperModel, "-f", wavPath, "-otxt", "-of", wavPath], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
        try { transcript = await fs.promises.readFile(wavPath + ".txt", "utf8"); } catch { }
      } catch (e) { transcript = `[whisper error] ${String(e?.message||e)}`; }
    } else {
      transcript = "[whisper not configured: set WHISPER_BIN and WHISPER_MODEL env vars on the local server to enable on-device transcription]";
    }

    // cleanup
    try { await fs.promises.unlink(wavPath); } catch { }
    try { await fs.promises.unlink(wavPath + ".txt"); } catch { }

    const content = `# ${title}\nSource URL: ${url}\nUploader: ${uploader}\nDuration: ${duration}s\n\n# Transcript\n${transcript}`;
    const result = await ingestSource({
      name: title, type: "video", content, url,
      tag: "Media (yt-dlp+Whisper)", brand,
    });
    return {
      ok: true, id: result.sourceId, url, title,
      tag: "Media (yt-dlp+Whisper)", chunks: result.chunks, brand,
      preview: transcript.slice(0, 600),
    };
  }

  // ---- Crawl single-flight + child-id derivation --------------------------
  let __crawlMutex = Promise.resolve();
  function withCrawlMutex(fn) {
    // Single global crawl at a time — MPS embed queue stays responsive for chat.
    const next = __crawlMutex.then(() => fn(), () => fn());
    __crawlMutex = next.catch(() => {});
    return next;
  }

  function deriveChildSourceId(parentId, pageUrl) {
    // Deterministic, UUID-shaped, so re-crawl upserts the same row.
    const h = createHash("sha1").update(`${parentId}|${pageUrl}`).digest("hex");
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
  }

  // ---- Recursive URL re-crawl helper --------------------------------------
  async function recrawlUrlSource(source, { signal = null, onProgress = null, awaitEmbeddings = false } = {}) {
    const cfg = source.crawl_config || {};
    const preset = cfg.preset || (cfg.recursive ? "standard" : "single");
    const base = crawlPresetConfig(preset);
    const opts = {
      maxDepth:           Math.min(8,  Math.max(1, Number(cfg.maxDepth)        || base.maxDepth        || 5)),
      maxPages:           Math.min(10000, Math.max(1, Number(cfg.maxPages)     || base.maxPages       || 2000)),
      concurrency:        Math.min(10, Math.max(1, Number(cfg.concurrency)     || base.concurrency    || 6)),
      includeSubdomains:  !!cfg.includeSubdomains,
      respectRobots:      cfg.respectRobots !== false,
      skipNoindex:        cfg.skipNoindex   !== false,
      includePattern:     cfg.includePattern ? new RegExp(cfg.includePattern) : null,
      signal,
    };

    // Wipe old child rows for this parent (and their chunks via cascading sync).
    // We delete children only — the parent row stays so the user's listing
    // entry persists and the configured policy survives.
    try {
      const old = await pool.query(`SELECT id FROM knowledge_sources WHERE parent_id=$1`, [source.id]);
      for (const c of old.rows) {
        try { await pool.query(`DELETE FROM knowledge_chunks WHERE file_id=$1`, [c.id]); } catch { }
      }
      await pool.query(`DELETE FROM knowledge_sources WHERE parent_id=$1`, [source.id]);
    } catch (e) {
      console.warn(`[crawl] cleanup failed for parent ${source.id}: ${e.message || e}`);
    }

    let pageCount = 0;
    let written = 0;
    const brand = deriveBrandFromUrl(source.url);
    const rootName = source.name || source.url;
    const parentTag = source.tag || null;

    opts.onPage = async (url, html, depth, meta) => {
      try {
        const { text, title } = await htmlToText(html);
        if (!text || text.trim().length < 50) return;
        const childId = deriveChildSourceId(source.id, url);
        const childName = (meta?.title || title || url).slice(0, 220);
        // Stash parent_id+crawl context into tag so it's searchable; primary parent link is parent_id col.
        const childTag = parentTag ? `${parentTag}` : (rootName ? `${rootName}` : null);
        const res = await ingestSource({
          id: childId,
          name: childName,
          type: "url",
          content: text,
          url,
          tag: childTag,
          brand,
          accessLevel: "Viewer",
          awaitEmbeddings,
          parentId: source.id,
        });
        pageCount++;
        written += Number(res.chunksWritten || 0);
      } catch (e) {
        console.warn(`[crawl] ingest fail ${url}: ${e.message || e}`);
      }
    };

    opts.onProgress = (p) => { try { onProgress?.({ ...p, pageCount, written }); } catch {} };

    const result = await crawlUrl(source.url, opts);

    // Refresh parent row metadata: aggregate chunk count + last-crawl marker.
    try {
      await pool.query(
        `UPDATE knowledge_sources
            SET chunks = $2,
                created_at = now()
          WHERE id = $1`,
        [source.id, written]
      );
    } catch { }

    return {
      visited: result.visited,
      pageCount,
      written,
      errors: result.errors?.length || 0,
      bytes: result.bytes,
      durationMs: result.durationMs,
      stoppedReason: result.stoppedReason,
      sitemapSeeds: result.sitemapSeeds,
    };
  }

  return {
    rebuildChunksForFile,
    ingestSource,
    ingestMediaUrl,
    recrawlUrlSource,
    withCrawlMutex,
    deriveChildSourceId,
  };
}
