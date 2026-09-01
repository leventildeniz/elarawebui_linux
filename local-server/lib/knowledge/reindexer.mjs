// Reindexer + Sync Job system extracted from server.mjs (2026-05-30).
// Owns: reindexRoot, ragJobs map, startSyncJob/cancelSyncJob,
// runSyncJob (global), runSourceSyncJob (per-source), hardResetRagDatabase,
// createSyncOptions, deriveStartedBy. All behavior identical to inline version.
//
// Heavy DI — accepts every collaborator explicitly so server.mjs stays the
// single source of truth for those primitives.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function initReindexer(deps) {
  const {
    pool,
    // root + access
    canonicalizeKnowledgeRoot, purgeKnowledgeRoot, inspectDirectoryAccess,
    walkDir, normalizeAccessLevel,
    // schema
    ensureKnowledgeFilesTable, ensureKnowledgeChunksTable,
    // constants
    INDEXABLE_EXT, MAX_FILE_BYTES, FTS_INPUT_CHAR_LIMIT,
    getDefaultLibraryRoot, DEEP_SYNC_TARGET_CHUNKS,
    // extraction + chunking
    extractFileContent, sanitizeContent, chunkTextDetailed,
    isTsVectorOverflowError, rebuildChunksForFile,
    // URL / crawl / ingest
    htmlToText, deriveBrandFromUrl, ingestSource,
    recrawlUrlSource, withCrawlMutex,
    // watcher + audit
    startWatchingRoot, enqueueWrite, triggerSyncAutoReenrich,
  } = deps;

  // ----- reindexRoot -----
  async function reindexRoot(root, opts = {}) {
    const canonical = canonicalizeKnowledgeRoot(root);
    if (canonical.nested) {
      const purged = await purgeKnowledgeRoot(canonical.requested).catch((e) => ({ error: String(e?.message || e) }));
      return { scanned: 0, indexed: 0, skipped: 0, hashSkipped: 0, removed: 0, root: canonical.root, requestedRoot: canonical.requested, skippedNestedRoot: true, purged };
    }
    root = canonical.root;
    const recursive = opts.recursive !== false;
    const forceChunks = opts.forceChunks === true;
    const forcePdfChunks = forceChunks || opts.forcePdfChunks === true;
    const allFileTypes = opts.allFileTypes === true;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const defaultAccessLevel = normalizeAccessLevel(opts.accessLevel ?? "Viewer");
    await ensureKnowledgeFilesTable();
    let scanned=0, indexed=0, skipped=0, hashSkipped=0, removed=0;
    const walkStats = { root, recursive, visitedDirs: 0, filesSeen: 0, indexableSeen: 0, permissionErrors: [], errors: [] };
    const extractionErrors = [];
    const skippedSamples = [];
    let currentFile = null;
    const emitProgress = (stage = "scanning") => {
      if (!onProgress) return;
      try { onProgress({ root, stage, scanned, indexed, skipped, hashSkipped, removed, currentFile, walk: walkStats }); } catch {}
    };
    const rootAccess = await inspectDirectoryAccess(root, { recursive: false, sampleLimit: 10 });
    if (!rootAccess.exists || !rootAccess.isDirectory || !rootAccess.readable) {
      return { scanned, indexed, skipped, hashSkipped, removed, rootAccess, walk: walkStats, error: "library root is not readable" };
    }
    const seen = new Set();
    const shouldCancel = typeof opts.shouldCancel === "function" ? opts.shouldCancel : () => false;
    const cancelSignal = opts.signal && typeof opts.signal === "object" ? opts.signal : null;
    const isCancelled = () => shouldCancel() || !!cancelSignal?.aborted;
    for await (const file of walkDir(root, recursive, walkStats)) {
      if (isCancelled()) { walkStats.cancelled = true; break; }
      currentFile = file;
      scanned++;
      emitProgress("scanning");
      const ext = path.extname(file).toLowerCase();
      const knownType = INDEXABLE_EXT.has(ext);
      if (!knownType && !allFileTypes) { skipped++; if (skippedSamples.length < 50) skippedSamples.push({ path: file, reason: "unsupported_ext", ext }); continue; }
      if (knownType) walkStats.indexableSeen++;
      let s; try { s = await fs.promises.stat(file); } catch (e) { skipped++; if (skippedSamples.length < 50) skippedSamples.push({ path: file, reason: "stat_failed", error: String(e.message || e) }); continue; }
      if (s.size > MAX_FILE_BYTES) { skipped++; if (skippedSamples.length < 50) skippedSamples.push({ path: file, reason: "too_large", size: s.size }); continue; }
      seen.add(file);
      const mustRebuildChunks = forceChunks || (forcePdfChunks && ext === ".pdf");
      const id = createHash("sha1").update(`${root}:${file}`).digest("hex");
      const prev = await pool.query(
        "SELECT size_bytes,last_modified,mtime,checksum FROM knowledge_files WHERE id=$1",[id]);
      const prevRow = prev.rows[0];
      const prevMtime = prevRow ? new Date(prevRow.last_modified ?? prevRow.mtime).getTime() : null;
      if (prevRow && Number(prevRow.size_bytes)===s.size && prevMtime===s.mtime.getTime() && !mustRebuildChunks) { skipped++; continue; }
      if (isCancelled()) { walkStats.cancelled = true; break; }
      const extracted = await extractFileContent(file, ext);
      if (isCancelled()) { walkStats.cancelled = true; break; }
      if (!extracted.ok) {
        const item = { path: file, ext, error: extracted.error || "extract failed" };
        extractionErrors.push(item);
        if (/\.pdf$/i.test(file) || /CP_R82_SecurityManagement_AdminGuide\.pdf$/i.test(file)) console.error(`[rag:extract] ${file} -> ${item.error}`);
        skipped++; continue;
      }
      const content = sanitizeContent(extracted.content);
      const checksum = createHash("sha256").update(content).digest("hex");
      if (prevRow && prevRow.checksum === checksum) {
        if (mustRebuildChunks) {
          const accessLevel = defaultAccessLevel;
          const chunks = chunkTextDetailed(content).length;
          try {
            await pool.query(
              `UPDATE knowledge_files SET last_modified=$2,mtime=$2,chunks=$3,content=$4,tsv=to_tsvector('simple',LEFT($4,${FTS_INPUT_CHAR_LIMIT})),access_level=$5,indexed_at=now() WHERE id=$1`,
              [id, s.mtime, chunks, content, accessLevel]
            );
          } catch (e) {
            if (!isTsVectorOverflowError(e)) throw e;
            console.warn(`[rag:fts-overflow] ${file} -> file-level tsv disabled, chunks continue`);
            await pool.query(
              `UPDATE knowledge_files SET last_modified=$2,mtime=$2,chunks=$3,content=$4,tsv=NULL,access_level=$5,indexed_at=now() WHERE id=$1`,
              [id, s.mtime, chunks, content, accessLevel]
            );
          }
          try { await rebuildChunksForFile({ fileId:id, root, filePath:file, content, accessLevel, signal: cancelSignal }); } catch (e) { console.error("[rag] forced chunk rebuild failed:", file, String(e.message||e)); }
          hashSkipped++; indexed++; emitProgress("indexed"); continue;
        }
        await pool.query("UPDATE knowledge_files SET last_modified=$2,mtime=$2 WHERE id=$1",[id,s.mtime]);
        hashSkipped++; skipped++; continue;
      }
      const accessLevel = defaultAccessLevel;
      const chunks = chunkTextDetailed(content).length;
      const fileParams = [id, root, file, path.basename(file), ext, s.size, s.mtime, checksum, chunks, content, accessLevel];
      try {
        await pool.query(
          `INSERT INTO knowledge_files(id,root,path,name,ext,size_bytes,mtime,last_modified,checksum,sha,chunks,content,tsv,allowed_roles,require_role,access_level,indexed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$8,$9,$10,to_tsvector('simple',LEFT($10,${FTS_INPUT_CHAR_LIMIT})),'[]'::jsonb,NULL,$11,now())
           ON CONFLICT (root,path) DO UPDATE SET
             size_bytes=EXCLUDED.size_bytes, mtime=EXCLUDED.mtime, last_modified=EXCLUDED.last_modified,
             checksum=EXCLUDED.checksum, sha=EXCLUDED.sha, chunks=EXCLUDED.chunks,
             content=EXCLUDED.content, tsv=EXCLUDED.tsv, access_level=EXCLUDED.access_level,
             indexed_at=now()`,
          fileParams
        );
      } catch (e) {
        if (!isTsVectorOverflowError(e)) throw e;
        console.warn(`[rag:fts-overflow] ${file} -> file-level tsv disabled, chunks continue`);
        await pool.query(
          `INSERT INTO knowledge_files(id,root,path,name,ext,size_bytes,mtime,last_modified,checksum,sha,chunks,content,tsv,allowed_roles,require_role,access_level,indexed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$8,$9,$10,NULL,'[]'::jsonb,NULL,$11,now())
           ON CONFLICT (root,path) DO UPDATE SET
             size_bytes=EXCLUDED.size_bytes, mtime=EXCLUDED.mtime, last_modified=EXCLUDED.last_modified,
             checksum=EXCLUDED.checksum, sha=EXCLUDED.sha, chunks=EXCLUDED.chunks,
             content=EXCLUDED.content, tsv=NULL, access_level=EXCLUDED.access_level,
             indexed_at=now()`,
          fileParams
        );
      }
      if (isCancelled()) { walkStats.cancelled = true; break; }
      try { await rebuildChunksForFile({ fileId:id, root, filePath:file, content, accessLevel, signal: cancelSignal }); }
      catch (e) {
        const item = { path: file, ext, error: `chunk rebuild failed: ${String(e.message || e)}` };
        extractionErrors.push(item);
        console.error("[rag] chunk rebuild failed:", file, String(e.message || e));
      }
      indexed++;
      emitProgress("indexed");
    }
    const existing = await pool.query("SELECT path FROM knowledge_files WHERE root=$1",[root]);
    for (const r of existing.rows) {
      if (!seen.has(r.path)) {
        await pool.query("DELETE FROM knowledge_files WHERE root=$1 AND path=$2",[root, r.path]);
        await pool.query("DELETE FROM knowledge_chunks WHERE root=$1 AND path=$2",[root, r.path]);
        removed++;
      }
    }
    const chunkTotal = await pool.query("SELECT COUNT(*)::int AS chunks FROM knowledge_chunks WHERE root=$1", [root]).catch(() => ({ rows: [{ chunks: 0 }] }));
    currentFile = null;
    emitProgress("complete");
    return { scanned, indexed, skipped, hashSkipped, removed, rootAccess, walk: walkStats, extractionErrors: extractionErrors.slice(0, 100), skippedSamples, chunkTotal: chunkTotal.rows[0]?.chunks ?? 0 };
  }

  // ----- Job tracker -----
  const ragJobs = new Map();
  function newJobId() { return `job-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
  function pushRagJobEvent(job, event) {
    if (!job) return;
    const seq = Number(job.eventSeq || 0) + 1;
    job.eventSeq = seq;
    const item = { seq, ts: Date.now(), ...event };
    job.lastEvent = item;
    if (!Array.isArray(job.events)) job.events = [];
    job.events.push(item);
    if (job.events.length > 200) job.events.splice(0, job.events.length - 200);
  }
  function createSyncOptions(input = {}) {
    const boolOpt = (value, fallback) => {
      if (value === undefined || value === null || value === "") return fallback;
      if (typeof value === "boolean") return value;
      const v = String(value).trim().toLowerCase();
      if (["false", "0", "no", "hayir", "hayır"].includes(v)) return false;
      if (["true", "1", "yes", "evet"].includes(v)) return true;
      return fallback;
    };
    return {
      recursive: boolOpt(input?.recursive, true),
      forcePdfChunks: boolOpt(input?.forcePdfChunks, true),
      forceChunks: boolOpt(input?.forceChunks, true),
      allFileTypes: boolOpt(input?.allFileTypes, true),
      accessLevel: input?.accessLevel,
    };
  }
  let lastSyncJobId = null;

  function deriveStartedBy(req) {
    if (!req) return { host: null, ip: null, ua: null, label: "unknown" };
    const explicit = req.headers?.["x-actor-host"] || req.headers?.["x-actor"] || null;
    const fwd = req.headers?.["x-forwarded-for"];
    const ip = (typeof fwd === "string" ? fwd.split(",")[0].trim() : null) || req.ip || req.socket?.remoteAddress || null;
    const ua = String(req.headers?.["user-agent"] || "").slice(0, 120) || null;
    let label = explicit ? String(explicit).slice(0, 64) : null;
    if (!label && ua) {
      const m = ua.match(/\((Macintosh|Windows[^;)]*|X11[^;)]*|iPhone|iPad|Android[^;)]*)/i);
      if (m) label = m[1].replace(/\s+/g, " ").slice(0, 32);
    }
    if (!label && ip) label = String(ip).replace(/^::ffff:/, "");
    return { host: explicit || null, ip, ua, label: label || "unknown" };
  }

  function startSyncJob({ root = null, opts = {}, target = null, startedBy = null, mode = "global", sourcePayload = null } = {}) {
    const onlyRoot = root ? String(root).trim() : null;
    const jobId = newJobId();
    const cancelController = new AbortController();
    const job = {
      status: "queued", started: Date.now(), progress: 0, total: 0,
      opts, root: onlyRoot, events: [], cancelRequested: false,
      cancelController,
      target: target || (onlyRoot
        ? { type: "dir", id: `dir:${onlyRoot}`, label: onlyRoot }
        : { type: "global", id: "global", label: "Tüm kütüphane" }),
      startedBy: startedBy || { label: "unknown" },
      mode,
    };
    ragJobs.set(jobId, job);
    lastSyncJobId = jobId;
    pushRagJobEvent(job, { status: "queued", stage: "queued", message: "Deep-Sync kuyruğa alındı", progress: 0, total: 0 });
    setImmediate(() => {
      const runner = mode === "source"
        ? runSourceSyncJob(jobId, sourcePayload, opts)
        : runSyncJob(jobId, onlyRoot, opts);
      runner.catch(() => {});
    });
    return { jobId, job };
  }

  function cancelSyncJob(jobId, opts = {}) {
    const job = ragJobs.get(jobId);
    if (!job) return { ok: false, error: "job not found" };
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return { ok: false, error: `job already ${job.status}` };
    }
    const force = !!opts.force;
    if (!job.cancelRequested) {
      job.cancelRequested = true;
      try { job.cancelController?.abort(new Error("operator cancel")); } catch {}
      pushRagJobEvent(job, { status: job.status, stage: "cancel-requested", message: "Stop sinyali alındı, in-flight istekler abort ediliyor", progress: job.progress || 0, total: job.total || 0 });
      setTimeout(() => {
        const j = ragJobs.get(jobId);
        if (!j) return;
        if (j.status !== "completed" && j.status !== "failed" && j.status !== "cancelled") {
          j.status = "cancelled";
          j.finished = Date.now();
          pushRagJobEvent(j, { status: "cancelled", stage: "forced-cancel", message: "Force-stop devreye girdi (10 sn timeout)", progress: j.progress || 0, total: j.total || 0 });
        }
      }, 10_000);
    }
    if (force) {
      setTimeout(() => {
        const j = ragJobs.get(jobId);
        if (!j) return;
        if (j.status !== "completed" && j.status !== "failed" && j.status !== "cancelled") {
          j.status = "cancelled";
          j.finished = Date.now();
          pushRagJobEvent(j, { status: "cancelled", stage: "forced-cancel", message: "Force-stop operatör tarafından tetiklendi", progress: j.progress || 0, total: j.total || 0 });
        }
      }, 100);
    }
    return { ok: true, force };
  }

  async function runSyncJob(jobId, onlyRoot, opts = {}) {
    const job = ragJobs.get(jobId);
    job.status = "running";
    pushRagJobEvent(job, { status: "running", stage: "starting", message: "Deep-Sync başladı", progress: job.progress || 0, total: job.total || 0 });
    const cancelSignal = job.cancelController?.signal || null;
    try {
      await ensureKnowledgeFilesTable();
      const results = [];
      const dbRoots = onlyRoot ? [{ root: path.resolve(onlyRoot) }] : (await pool.query("SELECT DISTINCT root FROM knowledge_files")).rows;
      const rootMap = new Map();
      for (const r of dbRoots) {
        const canonical = canonicalizeKnowledgeRoot(r.root);
        if (canonical.nested) {
          await purgeKnowledgeRoot(canonical.requested).catch((e) => console.warn("[rag:sync:nested-purge]", canonical.requested, e?.message || e));
          continue;
        }
        rootMap.set(canonical.root, { root: canonical.root, source: "database" });
      }
      const DEFAULT_LIBRARY_ROOT = getDefaultLibraryRoot();
      if (!onlyRoot) {
        const defaultAccess = await inspectDirectoryAccess(DEFAULT_LIBRARY_ROOT, { recursive: false, sampleLimit: 10 });
        if (defaultAccess.exists && defaultAccess.isDirectory && defaultAccess.readable) {
          rootMap.set(DEFAULT_LIBRARY_ROOT, { root: DEFAULT_LIBRARY_ROOT, source: "default-library" });
        } else {
          results.push({ root: DEFAULT_LIBRARY_ROOT, source: "default-library", skipped: true, reason: "default library path is not readable", rootAccess: defaultAccess });
        }
      }
      const roots = [...rootMap.values()];
      job.total = roots.length;
      for (const r of roots) {
        if (job.cancelRequested) break;
        pushRagJobEvent(job, { status: job.status, stage: "root-start", root: r.root, message: `Kök taranıyor: ${r.root}`, progress: job.progress || 0, total: job.total || 0 });
        try {
          results.push({ root: r.root, source: r.source, recursive: opts.recursive !== false, forceChunks: opts.forceChunks === true, forcePdfChunks: opts.forcePdfChunks === true, allFileTypes: opts.allFileTypes === true, ...(await reindexRoot(r.root, {
            ...opts,
            shouldCancel: () => job.cancelRequested === true,
            signal: cancelSignal,
            onProgress: (p) => pushRagJobEvent(job, { status: job.status, ...p, progress: job.progress || 0, total: job.total || 0 }),
          })) });
        }
        catch (e) { results.push({ root: r.root, source: r.source, error: String(e.message||e) }); }
        startWatchingRoot(r.root);
        job.progress = (job.progress || 0) + 1;
        pushRagJobEvent(job, { status: job.status, stage: "root-complete", root: r.root, message: `Kök tamamlandı: ${r.root}`, progress: job.progress, total: job.total });
      }
      let sourcesRefreshed = 0, urlsRefetched = 0;
      const affectedBrands = new Set();

      try {
        const src = await pool.query(`SELECT id, name, type, tag, url, content, crawl_config FROM knowledge_sources WHERE parent_id IS NULL`);
        job.total += src.rows.length;
        for (const s of src.rows) {
          if (job.cancelRequested) break;
          try {
            const cc = s.crawl_config || null;
            const recursive = !!(s.type === "url" && s.url && cc?.recursive);
            if (recursive) {
              try {
                const result = await withCrawlMutex(() => recrawlUrlSource(
                  s,
                  {
                    signal: cancelSignal,
                    onProgress: (p) => pushRagJobEvent(job, { status: job.status, stage: "crawl-progress", sourceId: s.id, name: s.name, message: `crawl · ${s.name} · ${p.visited}/${p.visited + p.queued} · ${p.pageCount} sayfa`, progress: job.progress, total: job.total }),
                  }
                ));
                sourcesRefreshed++;
                urlsRefetched += (result?.pageCount || 0);
                { const cb = (s.brand && String(s.brand).trim()) || (s.url ? deriveBrandFromUrl(s.url) : null); if (cb) affectedBrands.add(String(cb).toLowerCase()); }
                pushRagJobEvent(job, { status: job.status, stage: "crawl-complete", sourceId: s.id, name: s.name, message: `crawl tamam · ${s.name} · ${result.pageCount} sayfa · ${result.written} chunk · ${result.stoppedReason}`, progress: job.progress, total: job.total });

              } catch (e) {
                pushRagJobEvent(job, { status: job.status, stage: "crawl-error", sourceId: s.id, name: s.name, message: String(e.message || e), progress: job.progress, total: job.total });
              }
            } else {
              let content = String(s.content || "");
              if (s.type === "url" && s.url) {
                try {
                  const signals = [AbortSignal.timeout(15_000)];
                  if (cancelSignal) signals.push(cancelSignal);
                  const r = await fetch(s.url, { redirect: "follow",
                    headers: { "User-Agent": "Mozilla/5.0 (compatible; SovereignAI-RAG/1.0)" },
                    signal: AbortSignal.any(signals) });
                  if (r.ok) {
                    const html = await r.text();
                    const { text } = await htmlToText(html);
                    if (text) { content = text; urlsRefetched++; }
                  }
                } catch {}
              }
              if (job.cancelRequested) break;
              let brand = null;
              if (s.type === "url" && s.url) brand = deriveBrandFromUrl(s.url);
              await ingestSource({ id: s.id, name: s.name, type: s.type, content, url: s.url, tag: s.tag, brand, signal: cancelSignal });
              sourcesRefreshed++;
              { const cb = brand || (s.brand && String(s.brand).trim()) || null; if (cb) affectedBrands.add(String(cb).toLowerCase()); }
            }

          } catch {}
          job.progress += 1;
          pushRagJobEvent(job, { status: job.status, stage: "source-refresh", sourceId: s.id, name: s.name, progress: job.progress, total: job.total });
        }
      } catch {}
      await ensureKnowledgeChunksTable();
      const chunkHealth = await pool.query(
        `SELECT COUNT(*)::int AS total_chunks,
                COUNT(*) FILTER (WHERE root=$1)::int AS default_root_chunks,
                COUNT(DISTINCT path)::int AS files_with_chunks
           FROM knowledge_chunks`, [DEFAULT_LIBRARY_ROOT]
      ).catch(() => ({ rows: [{ total_chunks: 0, default_root_chunks: 0, files_with_chunks: 0 }] }));
      const cpR82 = await pool.query(
        `SELECT COUNT(*)::int AS chunks, COUNT(DISTINCT path)::int AS files,
                array_agg(DISTINCT path) FILTER (WHERE path IS NOT NULL) AS paths
           FROM knowledge_chunks
          WHERE path ILIKE '%CP_R82_SecurityManagement_AdminGuide.pdf%' OR content ILIKE '%R82%'`
      ).catch(() => ({ rows: [{ chunks: 0, files: 0, paths: [] }] }));
      const chunkReport = {
        ...chunkHealth.rows[0],
        target: DEEP_SYNC_TARGET_CHUNKS,
        targetMet: Number(chunkHealth.rows[0]?.total_chunks || 0) >= DEEP_SYNC_TARGET_CHUNKS,
        cpR82: cpR82.rows[0],
      };
      console.log(`[rag:sync] completed total_chunks=${chunkReport.total_chunks} default_root_chunks=${chunkReport.default_root_chunks} target=${DEEP_SYNC_TARGET_CHUNKS} targetMet=${chunkReport.targetMet} cpR82_chunks=${chunkReport.cpR82?.chunks ?? 0}`);
      enqueueWrite(`INSERT INTO agent_logs(agent,level,message,meta) VALUES ('rag','info','sync',$1)`,
        [{ results, sourcesRefreshed, urlsRefetched, chunkReport }]);
      job.results = { results, sourcesRefreshed, urlsRefetched, chunkReport };
      if (job.status === "cancelled") {
        // watch-tower already finalized
      } else if (job.cancelRequested) {
        job.status = "cancelled";
        pushRagJobEvent(job, { status: "cancelled", stage: "cancelled", message: "Deep-Sync operatör tarafından durduruldu", progress: job.progress || 0, total: job.total || 0, chunkReport });
      } else {
        job.status = "completed";
        pushRagJobEvent(job, { status: "completed", stage: "complete", message: "Deep-Sync tamamlandı", progress: job.progress || job.total || 0, total: job.total || 0, chunkReport });
        try { await triggerSyncAutoReenrich(affectedBrands, job.id || "rag-sync"); } catch (e) { console.warn(`[sync:auto-reenrich] ${e?.message || e}`); }
      }

    } catch (e) {
      if (job.status === "cancelled") return;
      job.status = "failed";
      job.error = String(e.message || e);
      pushRagJobEvent(job, { status: "failed", stage: "failed", message: job.error, progress: job.progress || 0, total: job.total || 0 });
    } finally {
      if (!job.finished) job.finished = Date.now();
    }
  }

  async function runSourceSyncJob(jobId, payload, opts = {}) {
    const job = ragJobs.get(jobId);
    job.status = "running";
    const cancelSignal = job.cancelController?.signal || null;
    const target = job.target || { type: "source", id: payload?.id || "?", label: payload?.id || "?" };
    pushRagJobEvent(job, { status: "running", stage: "starting", message: `Tek obje sync: ${target.label}`, progress: 0, total: 1 });
    job.total = 1;
    try {
      if (target.type === "dir") {
        const root = String(target.id).replace(/^dir:/, "");
        const result = await reindexRoot(root, {
          ...opts,
          shouldCancel: () => job.cancelRequested === true,
          signal: cancelSignal,
          onProgress: (p) => pushRagJobEvent(job, { status: job.status, ...p, progress: 0, total: 1 }),
        });
        job.results = { results: [{ root, source: "operator", ...result }] };
        try { startWatchingRoot(root); } catch {}
      } else {
        const r = await pool.query(
          `SELECT id, name, type, tag, url, content, crawl_config FROM knowledge_sources WHERE id=$1`,
          [target.id]
        );
        const s = r.rows[0];
        if (!s) throw new Error(`source ${target.id} not found`);
        const effectiveCrawl = (payload && payload.crawl_config) || s.crawl_config || null;
        const recursive = !!(s.type === "url" && s.url && effectiveCrawl?.recursive);

        if (recursive) {
          pushRagJobEvent(job, { status: job.status, stage: "crawl-start", message: `Recursive crawl başladı: ${s.url}`, progress: 0, total: 1 });
          try {
            if (payload?.crawl_config) {
              try { await pool.query(`UPDATE knowledge_sources SET crawl_config=$2 WHERE id=$1`, [s.id, JSON.stringify(payload.crawl_config)]); } catch {}
            }
            const result = await withCrawlMutex(() => recrawlUrlSource(
              { ...s, crawl_config: effectiveCrawl },
              {
                signal: cancelSignal,
                onProgress: (p) => pushRagJobEvent(job, { status: job.status, stage: "crawl-progress", message: `crawl · ${p.visited}/${p.visited + p.queued} · ${p.pageCount} sayfa · ${(p.bytes/1024/1024).toFixed(1)}MB`, progress: 0, total: 1, ...p }),
              }
            ));
            job.results = { results: [{ sourceId: s.id, type: s.type, recursive: true, ...result }] };
            pushRagJobEvent(job, { status: job.status, stage: "crawl-complete", message: `crawl tamam · ${result.pageCount} sayfa · ${result.written} chunk · ${result.stoppedReason}`, progress: 1, total: 1 });
          } catch (e) {
            pushRagJobEvent(job, { status: job.status, stage: "crawl-error", message: String(e.message || e), progress: 0, total: 1 });
            throw e;
          }
        } else {
          let content = String(s.content || "");
          let urlRefetched = false;
          if (s.type === "url" && s.url) {
            try {
              const signals = [AbortSignal.timeout(15_000)];
              if (cancelSignal) signals.push(cancelSignal);
              const resp = await fetch(s.url, { redirect: "follow",
                headers: { "User-Agent": "Mozilla/5.0 (compatible; SovereignAI-RAG/1.0)" },
                signal: AbortSignal.any(signals) });
              if (resp.ok) {
                const html = await resp.text();
                const { text } = await htmlToText(html);
                if (text) { content = text; urlRefetched = true; }
              }
            } catch (e) { pushRagJobEvent(job, { status: job.status, stage: "url-fetch-error", message: String(e.message || e), progress: 0, total: 1 }); }
          }
          if (!job.cancelRequested) {
            let brand = null;
            if (s.type === "url" && s.url) brand = deriveBrandFromUrl(s.url);
            await ingestSource({ id: s.id, name: s.name, type: s.type, content, url: s.url, tag: s.tag, brand });
            job.results = { results: [{ sourceId: s.id, type: s.type, urlRefetched }] };
          }
        }
      }
      job.progress = 1;
      if (job.status === "cancelled") {
        // watch-tower already finalized
      } else if (job.cancelRequested) {
        job.status = "cancelled";
        pushRagJobEvent(job, { status: "cancelled", stage: "cancelled", message: "Sync operatör tarafından durduruldu", progress: 1, total: 1 });
      } else {
        job.status = "completed";
        pushRagJobEvent(job, { status: "completed", stage: "complete", message: `Tek obje sync tamamlandı: ${target.label}`, progress: 1, total: 1 });
        try {
          const set = new Set();
          if (target.type !== "dir") {
            const sr = await pool.query(`SELECT brand, url, type FROM knowledge_sources WHERE id=$1`, [target.id]).catch(() => null);
            const row = sr?.rows?.[0];
            if (row) {
              const cb = (row.brand && String(row.brand).trim()) || (row.type === "url" && row.url ? deriveBrandFromUrl(row.url) : null);
              if (cb) set.add(String(cb).toLowerCase());
            }
          }
          await triggerSyncAutoReenrich(set, jobId);
        } catch (e) { console.warn(`[sync:auto-reenrich] source-sync ${e?.message || e}`); }
      }

    } catch (e) {
      if (job.status === "cancelled") return;
      job.status = "failed";
      job.error = String(e.message || e);
      pushRagJobEvent(job, { status: "failed", stage: "failed", message: job.error, progress: job.progress || 0, total: job.total || 1 });
    } finally {
      if (!job.finished) job.finished = Date.now();
    }
  }

  async function hardResetRagDatabase({ reindex = false } = {}) {
    await ensureKnowledgeFilesTable();
    await ensureKnowledgeChunksTable();
    const DEFAULT_LIBRARY_ROOT = getDefaultLibraryRoot();
    const report = { removedEdges: 0, removedEntities: 0, removedChunks: 0, removedFiles: 0, removedSources: 0, removedDocuments: 0, removedEmbeddings: 0, root: DEFAULT_LIBRARY_ROOT };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = 0").catch(() => {});
      report.removedChunks = (await client.query("DELETE FROM knowledge_chunks").catch(() => ({ rowCount: 0 }))).rowCount || 0;
      report.removedFiles = (await client.query("DELETE FROM knowledge_files").catch(() => ({ rowCount: 0 }))).rowCount || 0;
      report.removedSources = (await client.query("DELETE FROM knowledge_sources").catch(() => ({ rowCount: 0 }))).rowCount || 0;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const job = reindex ? startSyncJob({ root: DEFAULT_LIBRARY_ROOT, opts: { recursive: true, forcePdfChunks: true, forceChunks: true, allFileTypes: true } }) : null;
    console.log(`[rag:nuke] reset complete root=${DEFAULT_LIBRARY_ROOT} chunks=${report.removedChunks} files=${report.removedFiles} documents=${report.removedDocuments} embeddings=${report.removedEmbeddings} job=${job?.jobId || "none"}`);
    return { ...report, reindexStarted: !!job, jobId: job?.jobId || null };
  }

  return {
    reindexRoot,
    ragJobs,
    createSyncOptions,
    deriveStartedBy,
    startSyncJob,
    cancelSyncJob,
    runSyncJob,
    runSourceSyncJob,
    hardResetRagDatabase,
    getLastSyncJobId: () => lastSyncJobId,
  };
}
