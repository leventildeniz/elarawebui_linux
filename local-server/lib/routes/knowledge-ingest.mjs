// knowledge-ingest.mjs — knowledge ingest endpoints (K-4b).
// Extracted verbatim from server.mjs to keep the monolith shrinking.
//
// Endpoints:
//   POST /api/knowledge/fetch             — URL/YouTube/Reddit/Discord/file scrape
//   POST /api/knowledge/text              — inline text ingest
//   POST /api/knowledge/file              — multipart file upload
//   POST /api/knowledge/index-directory   — local-disk directory indexer

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import multer from "multer";

const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".log", ".json", ".yaml", ".yml",
  ".csv", ".html", ".htm", ".xml", ".py", ".js", ".ts", ".tsx", ".jsx",
  ".sql", ".sh", ".bash", ".zsh", ".env", ".ini", ".conf", ".cfg",
  ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".cs", ".php",
  ".swift", ".kt", ".scala", ".lua", ".pl", ".r", ".m", ".vue", ".svelte",
  ".toml", ".dockerfile", ".gitignore", ".tf", ".hcl",
]);
const BINARY_DOC_EXT = new Set([
  ".pdf", ".docx", ".doc", ".xlsx", ".xls",
  ".pptx", ".ppt", ".odt", ".odp", ".ods", ".rtf",
]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".wmv", ".flv", ".m4v", ".mpeg", ".mpg", ".3gp"]);
const AV_EXT = new Set([...AUDIO_EXT, ...VIDEO_EXT]);
const VISIO_EXT = new Set([".vsdx", ".vsdm", ".vstx", ".vstm", ".vsd", ".vss", ".vst"]);
const INDEXABLE_EXT = new Set([...TEXT_EXT, ...BINARY_DOC_EXT, ...IMAGE_EXT, ...AV_EXT, ...VISIO_EXT]);

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_INDEXED_CHARS = 2000000;
const FTS_INPUT_CHAR_LIMIT = 500000;

export function mountKnowledgeIngestRoutes(app, deps) {
  const {
    pool,
    // ingest / helpers
    ingestSource, ingestMediaUrl, maybeAutoReenrich, _coerceBool,
    deriveBrandFromUrl,
    // extractors / sanitizers
    extractFileContent, htmlToText, sanitizeContent,
    UPLOAD_DIR,
    // directory indexer
    resolveLibraryRoot, canonicalizeKnowledgeRoot, purgeKnowledgeRoot,
    ensureKnowledgeFilesTable, walkDir, normalizeAccessLevel,
    resolveFileAccessLevel, isTsVectorOverflowError, rebuildChunksForFile,
    enqueueWrite, startWatchingRoot,
  } = deps;

  const knowledgeFileUpload = multer({ limits: { fileSize: 500 * 1024 * 1024 } });

  app.post("/api/knowledge/fetch", async (req, res) => {
    const { url, username, password, cookie, token } = req.body ?? {};
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "invalid url" });

    // ---- YouTube branch: pull transcript instead of HTML ----------------------
    const ytMatch = url.match(/(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
    if (ytMatch) {
      try {
        const videoId = ytMatch[1];
        const { YoutubeTranscript } = await import("youtube-transcript");
        const segs = await YoutubeTranscript.fetchTranscript(videoId).catch(async () => {
          return YoutubeTranscript.fetchTranscript(videoId, { lang: "tr" })
            .catch(() => YoutubeTranscript.fetchTranscript(videoId, { lang: "en" }));
        });
        const transcript = (segs || []).map(s => s.text).join(" ").replace(/\s+/g, " ").trim();
        let title = `YouTube ${videoId}`;
        try {
          const oe = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
          if (oe.ok) { const j = await oe.json(); title = j.title || title; }
        } catch {}
        const content = `# ${title}\nVideo URL: ${url}\n\n# Transcript\n${transcript}`;
        const result = await ingestSource({
          name: title, type: "video", content, url, tag: "YouTube Video", brand: "youtube", awaitEmbeddings: true,
        });
        const autoReenrich = maybeAutoReenrich({ brand: "youtube", perRequestFlag: _coerceBool(req.body?.autoReEnrich), source: "fetch:youtube" });
        return res.json({
          ok: true, id: result.sourceId, url, title, tag: "YouTube Video",
          chunks: result.chunks, brand: "youtube", preview: transcript.slice(0, 600), autoReenrich,
        });
      } catch (e) {
        const fallback = await ingestMediaUrl(url, { cookie }).catch(err => ({ ok:false, error:String(err?.message||err) }));
        if (fallback.ok) return res.json(fallback);
        return res.status(200).json({ ok: false, error: `YouTube transcript failed: ${String(e?.message || e)}. yt-dlp fallback: ${fallback.error}` });
      }
    }

    // ---- Reddit branch ------------------------------------------------------
    const redditMatch = url.match(/^https?:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\/([^\/]+)\/comments\/([a-z0-9]+)/i);
    if (redditMatch) {
      try {
        const jsonUrl = url.split("?")[0].replace(/\/$/, "") + ".json?limit=200&raw_json=1";
        const r = await fetch(jsonUrl, { headers: { "User-Agent": "SovereignAI-RAG/1.0" } });
        if (r.ok) {
          const j = await r.json();
          const post = j?.[0]?.data?.children?.[0]?.data || {};
          const comments = (j?.[1]?.data?.children || [])
            .map(c => c?.data)
            .filter(c => c && c.body)
            .map(c => `**u/${c.author}** (${c.score}↑): ${c.body}`);
          const title = post.title || `Reddit r/${redditMatch[1]}`;
          const content = `# ${title}\nSubreddit: r/${redditMatch[1]} · u/${post.author||"?"} · ${post.score||0}↑\nURL: ${url}\n\n# Post\n${post.selftext || "(link post)"}\n\n# Comments (${comments.length})\n${comments.join("\n\n")}`;
          const result = await ingestSource({ name: title, type: "url", content, url, tag: "Reddit Thread", brand: "reddit", awaitEmbeddings: true ,
        spaceId: req.body?.spaceId || null, ownerId: req.body?.ownerId || null, ownerName: req.body?.ownerName || null,
      });
          const autoReenrich = maybeAutoReenrich({ brand: "reddit", perRequestFlag: _coerceBool(req.body?.autoReEnrich), source: "fetch:reddit" });
          return res.json({ ok: true, id: result.sourceId, url, title, tag: "Reddit Thread", chunks: result.chunks, brand: "reddit", preview: (post.selftext||title).slice(0,600), autoReenrich });
        }
      } catch (e) { /* fall through */ }
    }

    const liPost = /^https?:\/\/(?:www\.)?linkedin\.com\/(?:posts|pulse|feed\/update)\//i.test(url);

    // ---- Discord branch -----------------------------------------------------
    const discordMatch = url.match(/^https?:\/\/(?:canary\.|ptb\.)?discord\.com\/channels\/(\d+)\/(\d+)(?:\/(\d+))?/i);
    if (discordMatch) {
      const botToken = process.env.DISCORD_BOT_TOKEN;
      if (!botToken) {
        return res.status(200).json({ ok: false, error: "DISCORD_BOT_TOKEN env missing — bot must be in the guild and have read permission. Set it in local-server/.env." });
      }
      try {
        const [, , channelId, messageId] = discordMatch;
        const apiBase = "https://discord.com/api/v10";
        const auth = { "Authorization": `Bot ${botToken}`, "User-Agent": "SovereignAI-RAG/1.0" };
        let messages = [];
        if (messageId) {
          const r = await fetch(`${apiBase}/channels/${channelId}/messages/${messageId}`, { headers: auth });
          if (r.ok) messages = [await r.json()];
        } else {
          const r = await fetch(`${apiBase}/channels/${channelId}/messages?limit=100`, { headers: auth });
          if (r.ok) messages = await r.json();
        }
        if (Array.isArray(messages) && messages.length) {
          const lines = messages.reverse().map(m => `**${m.author?.username || "?"}** [${m.timestamp || ""}]: ${m.content || ""}${(m.attachments||[]).map(a=>`\n  ↪ ${a.url}`).join("")}`);
          const title = `Discord channel ${channelId}`;
          const content = `# ${title}\n${url}\n\n${lines.join("\n\n")}`;
          const result = await ingestSource({ name: title, type: "messaging", content, url, tag: "Discord Export", brand: "discord", awaitEmbeddings: true });
          const autoReenrich = maybeAutoReenrich({ brand: "discord", perRequestFlag: _coerceBool(req.body?.autoReEnrich), source: "fetch:discord" });
          return res.json({ ok: true, id: result.sourceId, url, title, tag: "Discord Export", chunks: result.chunks, brand: "discord", preview: lines.slice(0,3).join("\n").slice(0,600), autoReenrich });
        }
        return res.status(200).json({ ok: false, error: "Discord API returned no messages (bot lacks access?)" });
      } catch (e) { return res.status(200).json({ ok: false, error: `Discord fetch failed: ${String(e?.message || e)}` }); }
    }

    // ---- Smart media detector ------------------------------------------------
    const MEDIA_HOSTS = /(?:youtube\.com|youtu\.be|vimeo\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|twitch\.tv|dailymotion\.com|soundcloud\.com|spotify\.com|udemy\.com|coursera\.org|linkedin\.com\/learning|linkedin\.com\/video)/i;
    const MEDIA_EXT_RE = /\.(mp4|mov|mkv|avi|webm|flv|m4v|mpeg|mpg|mp3|wav|m4a|aac|flac|ogg|opus)(\?|#|$)/i;
    if (MEDIA_HOSTS.test(url) || MEDIA_EXT_RE.test(url)) {
      const r = await ingestMediaUrl(url, { cookie }).catch(err => ({ ok:false, error:String(err?.message||err) }));
      if (r.ok) return res.json(r);
    }

    if (liPost && !cookie) {
      return res.status(200).json({ ok: false, error: "LinkedIn posts/articles are login-walled. Paste your `li_at` session cookie in the Advanced section, or download the page and use File → Upload." });
    }

    // ---- Default HTML scrape branch -----------------------------------------
    const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    const baseHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    const authHeaders = {};
    if (cookie) authHeaders["Cookie"] = cookie;
    if (token)  authHeaders["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    if (username && password && !token) {
      authHeaders["Authorization"] = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
    }
    const hasCreds = Object.keys(authHeaders).length > 0;
    try {
      let r = await fetch(url, { headers: { ...baseHeaders, ...authHeaders }, redirect: "follow" });
      if ((r.status === 401 || r.status === 403) && !hasCreds) {
        const alt = await fetch(url, {
          headers: { ...baseHeaders, "User-Agent": "Mozilla/5.0 (compatible; SovereignAI-RAG/1.0)" },
          redirect: "follow",
        }).catch(() => null);
        if (alt && alt.ok) r = alt;
      }
      if ((r.status === 401 || r.status === 403) && !hasCreds) {
        let referer = null;
        try { const u = new URL(url); referer = `${u.protocol}//${u.hostname}/`; } catch {}
        const alt2 = await fetch(url, {
          headers: {
            ...baseHeaders,
            "User-Agent": "curl/8.4.0",
            ...(referer ? { Referer: referer } : {}),
          },
          redirect: "follow",
        }).catch(() => null);
        if (alt2 && alt2.ok) r = alt2;
      }
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) {
          return res.status(200).json({
            ok: false, status: r.status, code: "auth_required",
            error: hasCreds
              ? `Authentication failed (HTTP ${r.status}). Check the credentials in Advanced.`
              : `This URL requires authentication (HTTP ${r.status}). Open Advanced and add credentials (cookie / token / basic auth), then retry.`,
          });
        }
        return res.status(200).json({ ok: false, status: r.status, error: `Upstream ${r.status}` });
      }

      const ctype = String(r.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
      const buf = Buffer.from(await r.arrayBuffer());
      const head8 = buf.slice(0, 8);
      const headStr = buf.slice(0, 512).toString("utf8").trimStart().toLowerCase();
      let extGuess = null;
      const urlPath = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
      const urlExt = path.extname(urlPath);
      if (head8.slice(0,4).toString("ascii") === "%PDF")          extGuess = ".pdf";
      else if (head8.slice(0,2).toString("hex") === "504b")       extGuess = urlExt === ".xlsx" || urlExt === ".docx" || urlExt === ".pptx" ? urlExt : (urlExt || ".zip");
      else if (head8.slice(0,8).toString("hex").startsWith("d0cf11e0a1b11ae1")) extGuess = urlExt === ".xls" || urlExt === ".doc" || urlExt === ".ppt" ? urlExt : ".doc";
      else if (ctype.includes("pdf"))                              extGuess = ".pdf";
      else if (ctype.includes("json") && !headStr.startsWith("<")) extGuess = ".json";
      else if (ctype.includes("csv"))                              extGuess = ".csv";
      else if (ctype.includes("xml"))                              extGuess = ".xml";
      else if (ctype.includes("markdown"))                         extGuess = ".md";
      else if (ctype.includes("plain") || ctype.startsWith("text/"))
        extGuess = ctype.includes("html") ? null : ".txt";
      else if (ctype.includes("spreadsheetml")) extGuess = ".xlsx";
      else if (ctype.includes("wordprocessingml")) extGuess = ".docx";
      else if (ctype.includes("presentationml")) extGuess = ".pptx";
      if (ctype.includes("html") || headStr.startsWith("<!doctype html") || headStr.startsWith("<html")) extGuess = null;

      const brand = deriveBrandFromUrl(url);
      if (extGuess) {
        const tmpName = `urlfetch-${Date.now()}${extGuess}`;
        const tmpPath = path.join(UPLOAD_DIR, tmpName);
        try {
          await fs.promises.writeFile(tmpPath, buf);
          const extracted = await extractFileContent(tmpPath, extGuess);
          if (!extracted.ok || !extracted.content || extracted.content.length < 80) {
            return res.status(200).json({ ok: false, error: `URL produced binary/${extGuess.slice(1)} content but parse failed (parser=${extracted.parser || "?"}, quality=${extracted.parseQuality || "low"}).` });
          }
          const result = await ingestSource({
            name: extracted.title || path.basename(urlPath) || url,
            type: "url", content: extracted.content, url, tag: `URL ${extGuess.slice(1).toUpperCase()}`,
            brand, awaitEmbeddings: true,
            parserUsed: extracted.parser || `url-${extGuess.slice(1)}`,
            parseQuality: extracted.parseQuality || "ok",
            title: extracted.title || null,
          });
          const autoReenrich = maybeAutoReenrich({ brand, perRequestFlag: _coerceBool(req.body?.autoReEnrich), source: "fetch:url-file" });
          return res.json({
            ok: true, id: result.sourceId, url, title: extracted.title || url, tag: `URL ${extGuess.slice(1).toUpperCase()}`,
            chunks: result.chunks, brand, preview: extracted.content.slice(0, 600),
            parser: extracted.parser || `url-${extGuess.slice(1)}`, parseQuality: extracted.parseQuality || "ok", autoReenrich,
          });
        } finally {
          fs.promises.unlink(tmpPath).catch(() => {});
        }
      }

      const html = buf.toString("utf8");
      const { title, text, parser: htmlParser, quality } = await htmlToText(html);
      if (!text || text.length < 80) {
        return res.status(200).json({ ok: false, error: `Page produced too little usable text (parser=${htmlParser}, quality=${quality}). The page may be a JS-rendered SPA — try a sitemap URL or a static mirror.` });
      }
      const result = await ingestSource({
        name: title || url, type: "url", content: text, url, tag: "Web Source", brand, awaitEmbeddings: true,
        parserUsed: htmlParser, parseQuality: quality, title: title || null,
        spaceId: req.body?.spaceId || null, ownerId: req.body?.ownerId || null, ownerName: req.body?.ownerName || null,
      });
      const autoReenrich = maybeAutoReenrich({ brand, perRequestFlag: _coerceBool(req.body?.autoReEnrich), source: "fetch:url-html" });
      res.json({
        ok: true, id: result.sourceId, url, title: title || url, tag: "Web Source",
        chunks: result.chunks, brand, preview: text.slice(0, 600), parser: htmlParser, parseQuality: quality, autoReenrich,
      });
    } catch (e) {
      res.status(200).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // POST /api/knowledge/text — embed inline text
  app.post("/api/knowledge/text", async (req, res) => {
    const { name, content, tag, brand, url } = req.body ?? {};
    const text = String(content || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "content required" });
    try {
      const resolvedBrand = (url ? deriveBrandFromUrl(url) : null) || brand || null;
      const result = await ingestSource({
        name: name || `inline-${new Date().toISOString().slice(0,10)}.txt`,
        type: "text", content: text, tag: tag || "Inline Text", brand: resolvedBrand, awaitEmbeddings: true,
      });
      const autoReenrich = maybeAutoReenrich({ brand: resolvedBrand, perRequestFlag: _coerceBool(req.body?.autoReEnrich), source: "text" });
      res.json({ ok: true, id: result.sourceId, chunks: result.chunks, autoReenrich });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  // POST /api/knowledge/file — embed an uploaded file (multipart 'file')
  app.post("/api/knowledge/file", knowledgeFileUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: "file required" });
    const tmpName = `upload-${Date.now()}-${req.file.originalname}`;
    const tmpPath = path.join(UPLOAD_DIR, tmpName);
    try {
      await fs.promises.writeFile(tmpPath, req.file.buffer);
      const ext = path.extname(req.file.originalname).toLowerCase();
      let extracted = { ok: true, content: "" };
      if (TEXT_EXT.has(ext) || BINARY_DOC_EXT.has(ext) || IMAGE_EXT.has(ext) || AV_EXT.has(ext) || VISIO_EXT.has(ext)) {
        extracted = await extractFileContent(tmpPath, ext);
      } else {
        extracted = { ok: true, content: req.file.buffer.toString("utf8").slice(0, MAX_INDEXED_CHARS) };
      }
      if (!extracted.ok) return res.status(415).json({ ok: false, error: extracted.error || "extract failed" });
      const brand = deriveBrandFromUrl(req.body?.url) || req.body?.brand || null;
      const sourceType = AV_EXT.has(ext) ? (VIDEO_EXT.has(ext) ? "video" : "audio")
                       : IMAGE_EXT.has(ext) ? "image"
                       : VISIO_EXT.has(ext) ? "visio"
                       : "file";
      const defaultTag = sourceType === "video" ? "Video Source"
                       : sourceType === "audio" ? "Audio Source"
                       : sourceType === "visio" ? "Visio Diagram"
                       : sourceType === "image" ? "Image (OCR)"
                       : "Uploaded File";
      const result = await ingestSource({
        name: req.file.originalname, type: sourceType,
        content: extracted.content, tag: req.body?.tag !== undefined ? req.body.tag : defaultTag, brand, awaitEmbeddings: true,
        parserUsed: extracted.parser || null, parseQuality: extracted.parseQuality || null, title: extracted.title || null,
        spaceId: req.body?.spaceId || null, ownerId: req.body?.ownerId || null, ownerName: req.body?.ownerName || null,
        sizeMb: req.file.size ? req.file.size / (1024 * 1024) : 0,
        folderId: req.body?.folderId || null,
        userTags: req.body?.tags ? JSON.parse(req.body.tags) : []
      });
      const autoReenrich = maybeAutoReenrich({ brand, perRequestFlag: _coerceBool(req.body?.autoReEnrich), source: "file" });
      res.json({ ok: true, id: result.sourceId, name: req.file.originalname, chunks: result.chunks, type: sourceType, parser: extracted.parser || null, parseQuality: extracted.parseQuality || null, autoReenrich });
    } catch (e) {
      console.error("[knowledge/file] INGEST FAILED:", e);
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    } finally {
      fs.promises.unlink(tmpPath).catch(() => {});
    }
  });

  // POST /api/knowledge/index-directory
  app.post("/api/knowledge/index-directory", async (req, res) => {
    const t0 = Date.now();
    const requestedRoot = resolveLibraryRoot(req.body?.path);
    const canonical = canonicalizeKnowledgeRoot(requestedRoot);
    const root = canonical.root;
    const recursive = req.body?.recursive !== false;
    const allFileTypes = req.body?.allFileTypes !== false;
    const allowedRoles = Array.isArray(req.body?.allowedRoles) ? req.body.allowedRoles : [];
    const requireRole = req.body?.requireRole ?? null;
    const defaultAccessLevel = normalizeAccessLevel(req.body?.accessLevel ?? "Viewer");
    const folderAccessLevels = (req.body?.folderAccessLevels && typeof req.body.folderAccessLevels === "object")
      ? req.body.folderAccessLevels : null;
    if (!root) return res.status(400).json({ ok: false, error: "path required" });
    if (canonical.nested) {
      const purged = await purgeKnowledgeRoot(canonical.requested).catch((e) => ({ error: String(e?.message || e) }));
      return res.json({ ok: true, root, requestedRoot: canonical.requested, skipped: true, reason: "nested_root_already_covered_by_parent", purged, durationMs: Date.now() - t0 });
    }
    let st;
    try { st = await fs.promises.stat(root); } catch (e) {
      return res.status(400).json({ ok: false, error: `cannot stat path: ${String(e.message || e)}` });
    }
    if (!st.isDirectory()) return res.status(400).json({ ok: false, error: "path is not a directory" });

    await ensureKnowledgeFilesTable();
    let scanned = 0, indexed = 0, skipped = 0, hashSkipped = 0;
    const walkStats = { root, recursive, visitedDirs: 0, filesSeen: 0, indexableSeen: 0, permissionErrors: [], errors: [] };
    const seen = new Set();
    try {
      for await (const file of walkDir(root, recursive, walkStats)) {
        scanned++;
        const ext = path.extname(file).toLowerCase();
        const knownType = INDEXABLE_EXT.has(ext);
        if (!knownType && !allFileTypes) { skipped++; continue; }
        if (knownType) walkStats.indexableSeen++;
        let s; try { s = await fs.promises.stat(file); } catch { skipped++; continue; }
        if (s.size > MAX_FILE_BYTES) { skipped++; continue; }
        seen.add(file);
        const id = createHash("sha1").update(`${root}:${file}`).digest("hex");

        const prev = await pool.query(
          "SELECT size_bytes, last_modified, mtime, checksum FROM knowledge_files WHERE id=$1", [id]
        );
        const prevRow = prev.rows[0];
        const prevMtime = prevRow ? new Date(prevRow.last_modified ?? prevRow.mtime).getTime() : null;
        if (prevRow
          && Number(prevRow.size_bytes) === s.size
          && prevMtime === s.mtime.getTime()) {
          skipped++; continue;
        }

        const extracted = await extractFileContent(file, ext);
        if (!extracted.ok) { console.error(`[rag:extract] ${file} -> ${extracted.error || "extract failed"}`); skipped++; continue; }
        const content = sanitizeContent(extracted.content);
        const checksum = createHash("sha256").update(content).digest("hex");
        if (prevRow && prevRow.checksum && prevRow.checksum === checksum) {
          await pool.query(
            "UPDATE knowledge_files SET last_modified=$2, mtime=$2 WHERE id=$1",
            [id, s.mtime]
          );
          hashSkipped++; skipped++; continue;
        }

        const accessLevel = resolveFileAccessLevel(file, defaultAccessLevel, folderAccessLevels);
        const chunks = Math.max(1, Math.ceil(content.length / 800));
        const fileParams = [id, root, file, path.basename(file), ext, s.size, s.mtime, checksum, chunks,
          content, JSON.stringify(allowedRoles), requireRole, accessLevel];
        try {
          await pool.query(
            `INSERT INTO knowledge_files(id, root, path, name, ext, size_bytes, mtime, last_modified, checksum, sha, chunks, content, tsv, allowed_roles, require_role, access_level, indexed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$8,$9,$10, to_tsvector('simple', LEFT($10, ${FTS_INPUT_CHAR_LIMIT})), $11::jsonb, $12, $13, now())
             ON CONFLICT (root, path) DO UPDATE SET
               size_bytes=EXCLUDED.size_bytes, mtime=EXCLUDED.mtime, last_modified=EXCLUDED.last_modified,
               checksum=EXCLUDED.checksum, sha=EXCLUDED.sha,
               chunks=EXCLUDED.chunks, content=EXCLUDED.content, tsv=EXCLUDED.tsv,
               allowed_roles=EXCLUDED.allowed_roles, require_role=EXCLUDED.require_role,
               access_level=EXCLUDED.access_level,
               indexed_at=now()`,
            fileParams
          );
        } catch (e) {
          if (!isTsVectorOverflowError(e)) throw e;
          console.warn(`[rag:fts-overflow] ${file} -> file-level tsv disabled, chunks continue`);
          await pool.query(
            `INSERT INTO knowledge_files(id, root, path, name, ext, size_bytes, mtime, last_modified, checksum, sha, chunks, content, tsv, allowed_roles, require_role, access_level, indexed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$8,$9,$10, NULL, $11::jsonb, $12, $13, now())
             ON CONFLICT (root, path) DO UPDATE SET
               size_bytes=EXCLUDED.size_bytes, mtime=EXCLUDED.mtime, last_modified=EXCLUDED.last_modified,
               checksum=EXCLUDED.checksum, sha=EXCLUDED.sha,
               chunks=EXCLUDED.chunks, content=EXCLUDED.content, tsv=NULL,
               allowed_roles=EXCLUDED.allowed_roles, require_role=EXCLUDED.require_role,
               access_level=EXCLUDED.access_level,
               indexed_at=now()`,
            fileParams
          );
        }
        try {
          await rebuildChunksForFile({ fileId: id, root, filePath: file, content, accessLevel });
        } catch (e) { console.error("[rag] chunk failed:", file, String(e.message||e)); }
        indexed++;
      }
      const existing = await pool.query("SELECT path FROM knowledge_files WHERE root=$1", [root]);
      let removed = 0;
      for (const r of existing.rows) {
        if (!seen.has(r.path)) {
          await pool.query("DELETE FROM knowledge_files WHERE root=$1 AND path=$2", [root, r.path]);
          await pool.query("DELETE FROM knowledge_chunks WHERE root=$1 AND path=$2", [root, r.path]);
          removed++;
        }
      }
      enqueueWrite(
        `INSERT INTO agent_logs(agent,level,message,meta) VALUES ('rag','info',$1,$2)`,
        [`indexed:${root}`, { scanned, indexed, skipped, hashSkipped, removed, defaultAccessLevel }]
      );
      try { startWatchingRoot(root); } catch { }
      res.json({ ok: true, root, recursive, allFileTypes, scanned, indexed, skipped, hashSkipped, removed, walk: walkStats, durationMs: Date.now() - t0 });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
