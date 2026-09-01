// ===========================================================================
// lib/ingest/extract.mjs
// ---------------------------------------------------------------------------
// File/text/json/html/image/A-V/visio extractor cluster + chunkText splitter +
// extractTechnicalCore (MLX denoise) + localVisionCaption. Pure-ish — all
// runtime collaborators (pool, RAG settings, MLX endpoint resolver, html
// pipeline cache, breaker state, helpers) come in via dependency injection.
//
// Public exports:
//   createIngestExtract({ deps })  →
//     { htmlToText, jsonToSearchableText, extractTechnicalCore,
//       localVisionCaption, extractFileContent, chunkText,
//       isTableLine, isListLine, packAtomic,
//       CHUNK_SIZE, CHUNK_OVERLAP, ATOMIC_MAX, MIN_CHUNK_CHARS }
// ===========================================================================

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolvePrompt } from "../system-prompts.mjs";


// ---- Chunking constants (kept here, re-exported for external mounts) -------
export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 150;
export const ATOMIC_MAX = 8000;
export const MIN_CHUNK_CHARS = 32;

export function isTableLine(l) {
  const s = l.trimStart();
  return s.startsWith("|") || /^[-+|: ]{4,}$/.test(s);
}
export function isListLine(l) {
  const s = l.trimStart();
  return /^([-*•]\s|\d+[.)]\s)/.test(s);
}

// Pack lines of an atomic (table/list) block into <= ATOMIC_MAX pieces.
// Falls back to char-boundary slicing for a single overly-long line.
export function packAtomic(blockText, push) {
  if (blockText.length <= ATOMIC_MAX) { push(blockText); return; }
  const lines = blockText.split("\n");
  let buf = "";
  for (const ln of lines) {
    if (ln.length > ATOMIC_MAX) {
      if (buf) { push(buf); buf = ""; }
      for (let i = 0; i < ln.length; i += 1500) push(ln.slice(i, i + 1500));
      continue;
    }
    if (buf.length + ln.length + 1 > ATOMIC_MAX) { push(buf); buf = ln; }
    else { buf = buf ? buf + "\n" + ln : ln; }
  }
  if (buf) push(buf);
}

export function createIngestExtract(deps = {}) {
  const {
    // helpers / state from server.mjs
    _getHtmlPipeline = async () => ({ JSDOM: () => {}, Readability: () => {}, td: { turndown: () => "" } }),
    _htmlStripFallback = (txt) => txt,
    _JSON_HIGH_WEIGHT_KEYS = new Set(),
    _extGet = (k) => null,
    _extSet = () => {},
    _extBreakerIsOpen = () => false,
    _extBreakerRecordFailure = () => {},
    _extBreakerRecordSuccess = () => {},
    _resolveMlxEndpoint = async () => null,
    toCompletionBody = (b) => b,
    _sterilizeWithRagStop = (t) => t,
    execCapture = async () => ({ ok: false, stdout: "", stderr: "" }),
    isLikelyBinaryBuffer = (b) => false,
    printableBinarySummary = (p, e, b) => "",
    sanitizeContent = (t) => t,
    // constants
    MAX_INDEXED_CHARS = 100000,
    TEXT_EXT = new Set([".txt", ".md"]),
    IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]),
    AV_EXT = new Set([".mp3", ".wav", ".mp4", ".mkv"]),
    VISIO_EXT = new Set([".vsdx", ".vsd"]),
    // runtime getters
    getRagSettings = () => ({}),
  } = deps;

  // ---- HTML → text ---------------------------------------------------------
  async function htmlToText(html) {
    const raw = String(html || "");
    if (!raw) return { title: "", text: "", parser: "html-empty", quality: "low" };
    try {
      const { JSDOM, Readability, td } = await _getHtmlPipeline();
      const dom = new JSDOM(raw, { url: "https://local.invalid/" });
      const doc = dom.window.document;
      const title = String(doc.title || "").trim();

      // Strip noise at DOM level (no regex).
      for (const sel of ["script", "style", "noscript", "nav", "footer", "aside", "iframe", "svg"]) {
        doc.querySelectorAll(sel).forEach((el) => el.remove());
      }

      let parser = "readability";
      let bodyEl = null;
      // Try Readability first — handles articles, Citrix Nitro docs, etc.
      try {
        const article = new Readability(doc.cloneNode(true)).parse();
        if (article && article.content && article.textContent && article.textContent.trim().length >= 200) {
          const md = td.turndown(article.content);
          const clean = md.trim();
          if (clean.length >= 80) {
            return { title: article.title || title, text: clean, parser, quality: "ok" };
          }
        }
      } catch { /* fall through */ }

      // Fallback: main → article → body
      parser = "dom-main";
      bodyEl = doc.querySelector("main") || (parser = "dom-article", doc.querySelector("article")) || (parser = "dom-body", doc.body);
      if (bodyEl) {
        const md = td.turndown(bodyEl.innerHTML || "");
        const clean = md.trim();
        if (clean.length >= 80) return { title, text: clean, parser, quality: "ok" };
        // textContent last resort
        const txt = (bodyEl.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length >= 80) return { title, text: txt, parser: parser + "-text", quality: "ok" };
      }
      // TOC shell detector (Sphinx/MkDocs/Docusaurus): page contains a sizeable
      // <ul> of links but no real prose. Vendor-agnostic — pattern only.
      try {
        const links = doc.querySelectorAll("a[href]");
        const toctreeHits = doc.querySelectorAll("[class*='toctree'], [class*='toc-'], nav ul, .sidebar ul").length;
        if (links.length >= 5 && toctreeHits >= 1) {
          const linkLines = Array.from(links).slice(0, 100)
            .map(a => `- ${(a.textContent || "").trim()} → ${a.getAttribute("href") || ""}`)
            .filter(s => s.length > 6);
          const summary = `# ${title || "Table of Contents"}\n\n${linkLines.join("\n")}`.trim();
          return { title, text: summary, parser: "dom-toc-only", quality: "low" };
        }
      } catch { /* ignore */ }
      return { title, text: "", parser: "html-low-quality", quality: "low" };
    } catch (e) {
      // Last-resort scanner — still no regex on raw HTML.
      const stripped = _htmlStripFallback(raw);
      return { title: "", text: stripped.length >= 80 ? stripped : "", parser: "html-fallback-scan", quality: stripped.length >= 80 ? "ok" : "low" };
    }
  }

  // ---- JSON → searchable text ---------------------------------------------
  function jsonToSearchableText(raw) {
    let doc;
    try { doc = JSON.parse(raw); } catch { return ""; }
    if (doc == null) return "";
    const lines = [];
    const HARD_CAP = 50000;
    const VALUE_CAP = 1200;

    const isPrimitive = (v) => v === null || (typeof v !== "object");
    const fmtVal = (v) => {
      if (v === null) return "null";
      if (typeof v === "string") return v.length > VALUE_CAP ? v.slice(0, VALUE_CAP) + "…" : v;
      return String(v);
    };

    const pushKV = (key, val, depth) => {
      if (lines.length >= HARD_CAP) return;
      const prefix = key ? `${key}: ` : "";
      const text = fmtVal(val).trim();
      if (!text) return;
      lines.push(prefix + text);
    };

    // OpenAPI/Swagger fast path — preserved.
    if (typeof doc === "object" && !Array.isArray(doc) && (doc.openapi || doc.swagger)) {
      const info = doc.info || {};
      if (info.title) lines.push(`# ${info.title}`);
      if (info.version) lines.push(`Version: ${info.version}`);
      if (info.description) lines.push(String(info.description).slice(0, 2000));
      if (doc.paths && typeof doc.paths === "object") {
        lines.push("", "## Endpoints");
        for (const [p, ops] of Object.entries(doc.paths)) {
          if (!ops || typeof ops !== "object") continue;
          for (const [method, op] of Object.entries(ops)) {
            if (!op || typeof op !== "object") continue;
            const summary = op.summary || op.operationId || "";
            const desc = op.description || "";
            lines.push(`### ${method.toUpperCase()} ${p}${summary ? " — " + summary : ""}`);
            if (desc) lines.push(String(desc).slice(0, 1500));
          }
        }
      }
    }

    const walk = (node, keyPath, depth) => {
      if (lines.length >= HARD_CAP) return;
      if (node == null) return;

      if (Array.isArray(node)) {
        // Root-level array → emit headed items so embeddings see structure.
        const headed = depth === 0;
        for (let i = 0; i < node.length; i++) {
          if (lines.length >= HARD_CAP) return;
          const item = node[i];
          if (headed) lines.push("", `# Item ${i + 1}`);
          if (isPrimitive(item)) {
            pushKV(keyPath ? `${keyPath}[${i}]` : `[${i}]`, item, depth);
          } else {
            walk(item, headed ? "" : `${keyPath}[${i}]`, depth + 1);
          }
        }
        return;
      }

      if (typeof node === "object") {
        // Two passes — high-weight keys first so embedding head sees them.
        const entries = Object.entries(node);
        const hi = [], lo = [];
        for (const [k, v] of entries) {
          (_JSON_HIGH_WEIGHT_KEYS.has(String(k).toLowerCase()) ? hi : lo).push([k, v]);
        }
        for (const [k, v] of hi.concat(lo)) {
          if (lines.length >= HARD_CAP) return;
          const kp = keyPath ? `${keyPath}.${k}` : k;
          if (isPrimitive(v)) pushKV(kp, v, depth);
          else walk(v, kp, depth + 1);
        }
        return;
      }
      pushKV(keyPath, node, depth);
    };

    walk(doc, "", 0);
    const out = lines.join("\n").trim();
    return out.length >= 80 ? out : "";
  }

  // ---- MLX denoise rewriter (technical-core extraction) -------------------
  async function extractTechnicalCore(rawInput) {
    const raw = String(rawInput || "").trim();
    const RAG_SETTINGS = getRagSettings();
    if (!raw) return { text: "", cacheHit: false, ms: 0, reject: "empty_input" };
    if (!RAG_SETTINGS.queryExtractorEnabled) return { text: raw, cacheHit: false, ms: 0, reject: "disabled" };

    const cached = _extGet(raw);
    if (cached) return { text: cached, cacheHit: true, ms: 0 };

    // Circuit breaker — cold MLX shouldn't block every subsequent query.
    if (_extBreakerIsOpen()) return { text: raw, cacheHit: false, ms: 0, reject: "breaker_open" };

    const t0 = Date.now();
    const timeoutMs = Math.max(200, Math.min(3000, Number(RAG_SETTINGS.extractorTimeoutMs) || 700));
    try {
      const ep = await _resolveMlxEndpoint();
      if (!ep) return { text: raw, cacheHit: false, ms: 0, reject: "no_runtime" };
      // 2026-06-03 (Tur 2) — thinkOffPrefix UI knob (Qwen "/no_think"); ailesi qwen değilse boş.
      const _extFamily = String(ep.render?.template ?? "").toLowerCase();
      const _extThinkOff = false;
      const _extPrefix = _extThinkOff ? String(RAG_SETTINGS?.thinkOffPrefix ?? "") : "";
      const sysMsg = _extPrefix + resolvePrompt(RAG_SETTINGS, "extractorSystemPrompt");
      const prompt = `Extract only the technical question from this message. Remove greetings, polite fillers, addressed names. Fix obvious typos in vendor/product names. Keep version numbers and proper product names exactly. Preserve language. One line, no quotes, no explanation.\n\nMessage: ${raw}\nExtracted:`;
      const body = ep.isMlx
        ? toCompletionBody({ model: ep.mdl, messages: [{ role: "system", content: sysMsg }, { role: "user", content: prompt }], stream: false, max_tokens: 60, temperature: 0.1, stop: ["\n"], chat_template_kwargs: { enable_thinking: false } }, ep.render)
        : { model: ep.mdl, prompt: `${sysMsg}\n\n${prompt}`, stream: false, options: { temperature: 0.1, num_predict: 60, stop: ["\n"] } };
      const r = await fetch(ep.target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      }).catch((e) => ({ __err: String(e?.name || e) }));
      if (!r || r.__err || !r.ok) {
        _extBreakerRecordFailure();
        return { text: raw, cacheHit: false, ms: Date.now() - t0, reject: r?.__err ? `fetch:${r.__err}` : `http_${r?.status || "x"}` };
      }
      const j = await r.json().catch(() => null);
      let out = String(ep.isMlx ? (j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || "") : (j?.response || ""));
      out = out.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
      out = out.trim().replace(/^["'`]+|["'`]+$/g, "");
      out = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || "";
      out = out.replace(/^(Extracted|Clean|Query|Core)\s*[:\-–]\s*/i, "").replace(/^["'`]+|["'`]+$/g, "").trim();
      if (!out || out.length > 240) {
        // HTTP succeeded but output unusable — don't trip breaker (MLX is alive).
        return { text: raw, cacheHit: false, ms: Date.now() - t0, reject: out ? "too_long" : "empty_output" };
      }

      let clean = out.slice(0, 240);
      if (RAG_SETTINGS.denoiseLowercase) clean = clean.toLowerCase();
      // Defense-in-depth: strip residual greeting/filler tokens.
      clean = _sterilizeWithRagStop(clean);
      if (!clean || clean.length < 2) return { text: raw, cacheHit: false, ms: Date.now() - t0, reject: "sterilized_empty" };

      _extSet(raw, clean);
      _extBreakerRecordSuccess();
      return { text: clean, cacheHit: false, ms: Date.now() - t0 };
    } catch (e) {
      _extBreakerRecordFailure();
      return { text: raw, cacheHit: false, ms: Date.now() - t0, reject: `exception:${String(e?.message || e).slice(0, 80)}` };
    }
  }

  // ---- MLX Vision caption (Apple Silicon native VLM) ----------------------
  async function localVisionCaption(filePath, ext) {
    if (process.env.MLX_VISION_DISABLED === "1") return "";
    const base = (process.env.MLX_VISION_BASE_URL || `http://127.0.0.1:${process.env.MLX_VISION_PORT || 8011}`).replace(/\/$/, "");
    const model = process.env.MLX_VISION_MODEL || "mlx-community/Qwen2-VL-7B-Instruct-4bit";

    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
               : ext === ".webp" ? "image/webp"
               : ext === ".gif"  ? "image/gif"
               : ext === ".bmp"  ? "image/bmp"
               : ext === ".tiff" ? "image/tiff"
               : "image/png";
    const b64 = (await fs.promises.readFile(filePath)).toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;
    const prompt = "Describe this image in detail. Extract any UI text, error codes, IPs, hostnames, version numbers, vendor names, and identifiable network/security concepts.";
    // Try OpenAI-compatible /v1/chat/completions with image_url first (MLX-VLM supports this).
    try {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model, stream: false, max_tokens: 800,
          messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ]}],
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const text = j?.choices?.[0]?.message?.content;
        if (typeof text === "string") return text.trim();
        if (Array.isArray(text)) return text.map(p => p?.text || "").join("").trim();
      }
    } catch { /* fallback below */ }
    // Fallback: legacy /generate (mlx-vlm CLI server style)
    try {
      const r = await fetch(`${base}/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, image: dataUrl, max_tokens: 800, stream: false }),
      });
      if (r.ok) {
        const j = await r.json();
        return String(j.text || j.response || j.output || "").trim();
      }
    } catch { /* offline */ }
    return "";
  }

  // ---- File-format dispatcher (PDF/DOCX/HTML/JSON/XLSX/PPT/IMG/AV/Visio) --
  async function extractFileContent(filePath, ext) {
    // Returns { content, ok, error? }. Never throws.
    try {
      const normalizedExt = String(ext || path.extname(filePath) || "").toLowerCase();
      // ── Format sniff (magic-byte/prefix), vendor-agnostic ──────────────────
      // Many files arrive with wrong extensions (e.g. Fortinet Swagger UI shell
      // pages saved as `*.json`). Detect actual format from first 4KB so the
      // right parser runs regardless of extension.
      let sniffedExt = normalizedExt;
      let sniffedFrom = null;
      if (ext === ".html" || ext === ".htm" || ext === ".json" || ext === ".txt" || ext === ".md" || ext === "") {
        try {
          const fd = await fs.promises.open(filePath, "r");
          const head = Buffer.alloc(4096);
          const { bytesRead } = await fd.read(head, 0, 4096, 0);
          await fd.close();
          const headStr = head.slice(0, bytesRead).toString("utf8").trimStart();
          const lower = headStr.slice(0, 64).toLowerCase();
          if (lower.startsWith("<!doctype html") || lower.startsWith("<html") || lower.startsWith("<?xml") && lower.includes("html")) {
            if (ext !== ".html" && ext !== ".htm") { sniffedExt = ".html"; sniffedFrom = ext || "unknown"; }
          } else if ((headStr.startsWith("{") || headStr.startsWith("[")) && ext !== ".json") {
            // tentative — JSON.parse will confirm in the .json branch below
            try { JSON.parse(headStr.length === bytesRead ? headStr : headStr + (headStr.startsWith("{") ? "}" : "]")); sniffedExt = ".json"; sniffedFrom = ext || "unknown"; } catch { /* not JSON, leave */ }
          }
        } catch { /* sniff is best-effort */ }
      }

      if (sniffedExt === ".html" || sniffedExt === ".htm") {
        const buf = await fs.promises.readFile(filePath);
        const raw = buf.toString("utf8");
        const { title, text, parser: htmlParser, quality } = await htmlToText(raw);
        const tagged = sniffedFrom ? `${htmlParser}-from-${sniffedFrom.replace(".", "") || "unknown"}` : htmlParser;
        const header = title ? `# ${title}\n\n` : "";
        const content = (header + (text || "")).trim();
        if (content.length < 80) {
          // No raw HTML embedding — return clean failure so the source is flagged.
          return { ok: false, error: "html-low-quality", parser: tagged, parseQuality: "low", title };
        }
        return { ok: true, content: content.slice(0, MAX_INDEXED_CHARS), parser: tagged, parseQuality: quality, title };
      }
      if (sniffedExt === ".json") {
        const buf = await fs.promises.readFile(filePath);
        const raw = buf.toString("utf8");
        const flat = jsonToSearchableText(raw);
        const tagged = sniffedFrom ? `json-walker-from-${sniffedFrom.replace(".", "") || "unknown"}` : "json-walker";
        if (!flat || flat.length < 80) {
          return { ok: false, error: "json-low-quality", parser: tagged, parseQuality: "low" };
        }
        return { ok: true, content: flat.slice(0, MAX_INDEXED_CHARS), parser: tagged, parseQuality: "ok" };
      }
      if (TEXT_EXT.has(ext)) {
        const buf = await fs.promises.readFile(filePath);
        return { ok: true, content: buf.toString("utf8").slice(0, MAX_INDEXED_CHARS) };
      }
      if (ext === ".pdf") {
        const buf = await fs.promises.readFile(filePath);
        const targetPdf = /CP_R82_SecurityManagement_AdminGuide\.pdf$/i.test(path.basename(filePath));
        const pages = [];
        let pdfPageCounter = 0;
        try {
          const pdfMod = await import("pdf-parse");
          let content = "";
          let pageCount = null;
          if (typeof pdfMod.default === "function") {
            const data = await pdfMod.default(buf, {
              pagerender: async (pageData) => {
                const pageNo = ++pdfPageCounter;
                const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
                let lastY = null;
                let out = `\n\n[PDF_PAGE ${pageNo}]\n`;
                for (const item of textContent.items || []) {
                  const y = Array.isArray(item.transform) ? item.transform[5] : null;
                  if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) out += "\n";
                  else if (out && !out.endsWith("\n")) out += " ";
                  out += String(item.str || "");
                  if (y !== null) lastY = y;
                }
                pages[pageNo - 1] = out;
                return out;
              },
            });
            content = pages.length ? pages.join("\n") : String(data.text || "");
            pageCount = pages.length || data.numpages || null;
          } else if (typeof pdfMod.PDFParse === "function") {
            const parser = new pdfMod.PDFParse({ data: buf });
            try {
              const data = await parser.getText();
              content = String(data?.text || "");
              pageCount = data?.total || data?.pages?.length || null;
              if (Array.isArray(data?.pages) && data.pages.length) {
                content = data.pages.map((p, i) => `\n\n[PDF_PAGE ${i + 1}]\n${p?.text || p || ""}`).join("\n");
              }
            } finally {
              if (typeof parser.destroy === "function") {
                try { await parser.destroy(); } catch {}
              }
            }
          } else {
            throw new Error(`pdf-parse export shape unsupported: ${Object.keys(pdfMod).join(",")}`);
          }
          if (targetPdf) console.log(`[pdf-parser] CP_R82 parsed by pdf-parse pages=${pageCount || "?"} chars=${content.length} path=${filePath}`);
          return { ok: true, content: content.slice(0, MAX_INDEXED_CHARS), parser: "pdf-parse", pages: pageCount };
        } catch (e) {
          const err = String(e?.stack || e?.message || e);
          console.error(`[pdf-parser] pdf-parse failed path=${filePath}\n${err}`);
          const pdftotext = await execCapture("pdftotext", ["-layout", filePath, "-"], 120_000, 256 * 1024 * 1024).catch((ex) => ({ ok: false, error: String(ex), stdout: "", stderr: "" }));
          if (pdftotext.ok && pdftotext.stdout.trim()) {
            const content = `\n\n[PDF_PAGE 1]\n${pdftotext.stdout}`;
            console.warn(`[pdf-parser] fallback pdftotext ok chars=${content.length} path=${filePath}`);
            return { ok: true, content: content.slice(0, MAX_INDEXED_CHARS), parser: "pdftotext", parserError: err };
          }
          const detail = [err, pdftotext.stderr, pdftotext.error].filter(Boolean).join("\n").slice(0, 4000);
          console.error(`[pdf-parser] fallback pdftotext failed path=${filePath}\n${detail}`);
          return { ok: false, error: `pdf parse failed: ${detail}` };
        }
      }
      if (ext === ".docx") {
        const { default: mammoth } = await import("mammoth");
        const r = await mammoth.extractRawText({ path: filePath });
        return { ok: true, content: String(r.value || "").slice(0, MAX_INDEXED_CHARS) };
      }
      if (ext === ".xlsx" || ext === ".xls") {
        const xlsx = await import("xlsx");
        const wb = xlsx.readFile(filePath, { cellDates: true });
        const parts = wb.SheetNames.map((n) => {
          const csv = xlsx.utils.sheet_to_csv(wb.Sheets[n]);
          return `# Sheet: ${n}\n${csv}`;
        });
        return { ok: true, content: parts.join("\n\n").slice(0, MAX_INDEXED_CHARS) };
      }
      if ([".pptx", ".ppt", ".odt", ".odp", ".ods", ".doc", ".rtf"].includes(ext)) {
        const officeparser = await import("officeparser");
        const text = await officeparser.parseOfficeAsync(filePath);
        return { ok: true, content: String(text || "").slice(0, MAX_INDEXED_CHARS) };
      }
      if (IMAGE_EXT.has(ext)) {
        // Vision RAG: OCR (Tesseract) + optional MLX VLM caption (Apple Silicon native)
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker(["eng", "tur"]);
        let ocr = "";
        try {
          const { data } = await worker.recognize(filePath);
          ocr = String(data?.text || "").trim();
        } finally {
          await worker.terminate();
        }
        const caption = await localVisionCaption(filePath, ext).catch((e) => `[mlx vision error] ${String(e?.message || e)}`);
        const merged = [
          ocr && `# OCR\n${ocr}`,
          caption && `# MLX Vision Caption\n${caption}`,
        ].filter(Boolean).join("\n\n") || "[empty image — no OCR text, MLX VLM unreachable]";
        return { ok: true, content: merged.slice(0, MAX_INDEXED_CHARS) };
      }
      if (AV_EXT.has(ext)) {
        // Audio/Video → ffmpeg ile 16kHz mono WAV'a çevir, whisper.cpp varsa transcribe et.
        // Yoksa ffprobe metadata'sını metin olarak indeksle (en azından dosya bilgisi RAG'a girer).
        const { spawnSync } = await import("node:child_process");
        const probe = spawnSync("ffprobe", [
          "-v", "error", "-show_format", "-show_streams", "-of", "json", filePath,
        ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
        let meta = "";
        try {
          const j = JSON.parse(probe.stdout || "{}");
          const fmt = j.format || {};
          const streams = (j.streams || []).map(s => `${s.codec_type}:${s.codec_name} ${s.width||""}x${s.height||""} ${s.sample_rate||""}Hz`).join("; ");
          meta = `# Media: ${path.basename(filePath)}\nDuration: ${fmt.duration||"?"}s\nBitrate: ${fmt.bit_rate||"?"}\nStreams: ${streams}\nTags: ${JSON.stringify(fmt.tags||{})}`;
        } catch { meta = `# Media: ${path.basename(filePath)}`; }

        // Whisper transcription (opsiyonel — WHISPER_BIN + WHISPER_MODEL env varsa kullan).
        const whisperBin = process.env.WHISPER_BIN;
        const whisperModel = process.env.WHISPER_MODEL;
        let transcript = "";
        if (whisperBin && whisperModel) {
          try {
            const tmpWav = path.join(os.tmpdir(), `elara-${Date.now()}.wav`);
            spawnSync("ffmpeg", ["-y", "-i", filePath, "-ac", "1", "-ar", "16000", "-vn", tmpWav], { stdio: "ignore" });
            const w = spawnSync(whisperBin, ["-m", whisperModel, "-f", tmpWav, "-otxt", "-of", tmpWav], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
            try { transcript = await fs.promises.readFile(tmpWav + ".txt", "utf8"); } catch {}
            try { await fs.promises.unlink(tmpWav); } catch {}
            try { await fs.promises.unlink(tmpWav + ".txt"); } catch {}
            if (!transcript) transcript = String(w.stdout || "");
          } catch (e) { transcript = `[whisper error] ${String(e?.message||e)}`; }
        }
        const content = [meta, transcript && `\n# Transcript\n${transcript}`].filter(Boolean).join("\n").slice(0, MAX_INDEXED_CHARS);
        return { ok: true, content };
      }
      if (VISIO_EXT.has(ext)) {
        // Modern Visio (.vsdx/.vsdm/.vstx/.vstm) = ZIP of XML pages.
        // Legacy (.vsd/.vss/.vst) = OLE binary; best-effort regex sweep.
        const yauzl = await import("yauzl");
        const isZip = [".vsdx", ".vsdm", ".vstx", ".vstm"].includes(ext);
        if (isZip) {
          const text = await new Promise((resolve, reject) => {
            yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
              if (err) return reject(err);
              const parts = [];
              zip.readEntry();
              zip.on("entry", (entry) => {
                if (/^visio\/(pages|masters)\/.*\.xml$/i.test(entry.fileName)) {
                  zip.openReadStream(entry, (err2, rs) => {
                    if (err2) { zip.readEntry(); return; }
                    const bufs = [];
                    rs.on("data", b => bufs.push(b));
                    rs.on("end", () => {
                      const xml = Buffer.concat(bufs).toString("utf8");
                      const txt = xml.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
                      if (txt) parts.push(`# ${entry.fileName}\n${txt}`);
                      zip.readEntry();
                    });
                  });
                } else { zip.readEntry(); }
              });
              zip.on("end", () => resolve(parts.join("\n\n")));
              zip.on("error", reject);
            });
          });
          return { ok: true, content: String(text || "").slice(0, MAX_INDEXED_CHARS) };
        }
        // legacy .vsd: pull printable ASCII strings (≥4 chars) — at least surfaces shape labels.
        const buf = await fs.promises.readFile(filePath);
        const strings = buf.toString("latin1").match(/[\x20-\x7E]{4,}/g) || [];
        const content = `# Visio (legacy ${ext})\n` + strings.join("\n");
        return { ok: true, content: content.slice(0, MAX_INDEXED_CHARS) };
      }
      const buf = await fs.promises.readFile(filePath);
      if (!isLikelyBinaryBuffer(buf)) {
        return { ok: true, content: buf.toString("utf8").slice(0, MAX_INDEXED_CHARS) };
      }
      return { ok: true, content: printableBinarySummary(filePath, normalizedExt, buf).slice(0, MAX_INDEXED_CHARS), degraded: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  // ---- Structure-aware text splitter --------------------------------------
  function chunkText(text) {
    const out = [];
    // Sanitize FIRST — strip HTML/CSS/control junk before chunk math sees it.
    const t = sanitizeContent(text).replace(/\r\n/g, "\n");
    if (!t.trim()) return out;
    // 1) Group lines into logical blocks; tables/lists are atomic.
    const lines = t.split("\n");
    const blocks = [];
    let cur = [];
    let curKind = "prose";
    const flush = () => { if (cur.length) { blocks.push({ kind: curKind, text: cur.join("\n") }); cur = []; } };
    for (const ln of lines) {
      const kind = isTableLine(ln) ? "table" : isListLine(ln) ? "list" : "prose";
      if (kind !== curKind && cur.length) { flush(); }
      curKind = kind;
      cur.push(ln);
    }
    flush();
    // 2) Pack blocks into chunks. Atomic blocks (table/list) are packed up to ATOMIC_MAX.
    let buf = "";
    const push = (s) => { const v = s.trim(); if (v) out.push(v); };
    for (const b of blocks) {
      if (b.kind !== "prose") {
        if (buf) { push(buf); buf = ""; }
        packAtomic(b.text, push);
        continue;
      }
      // Prose: split into smaller chunks with sentence-aware boundary
      let i = 0;
      const text = (buf ? buf + "\n\n" : "") + b.text;
      buf = "";
      while (i < text.length) {
        let end = Math.min(i + CHUNK_SIZE, text.length);
        if (end < text.length) {
          const slice = text.slice(i, end);
          const para = slice.lastIndexOf("\n\n");
          const sent = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
          if (para > CHUNK_SIZE * 0.5) end = i + para + 2;
          else if (sent > CHUNK_SIZE * 0.5) end = i + sent + 2;
        }
        const piece = text.slice(i, end);
        if (end >= text.length) { buf = piece; break; }
        push(piece);
        i = Math.max(end - CHUNK_OVERLAP, i + 1);
      }
    }
    if (buf) push(buf);
    // Drop tiny fragments (empty HTML skeletons, "—" residue, etc.).
    return out.filter((s) => s && s.length >= MIN_CHUNK_CHARS);
  }

  return {
    htmlToText,
    jsonToSearchableText,
    extractTechnicalCore,
    isExtBreakerOpen: _extBreakerIsOpen,
    localVisionCaption,
    extractFileContent,
    chunkText,
  };
}
