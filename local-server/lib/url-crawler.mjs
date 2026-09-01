// lib/url-crawler.mjs
// Same-origin BFS crawler with sitemap priority, robots.txt support,
// page/byte/time caps, per-host concurrency and jitter.
//
// Public surface:
//   crawlUrl(rootUrl, opts) -> { visited, skipped, errors, bytes, durationMs, stoppedReason }
//   opts.onPage(url, html, depth) -> awaited per page
//   opts.onProgress({ visited, queued, bytes, elapsed, lastUrl })
//   opts.signal (AbortSignal) -> cooperative cancel
//
// Defaults (callers may override):
//   maxDepth=5, maxPages=2000, concurrency=6, perPageTimeoutMs=15000,
//   maxTotalBytes=500MB, timeBudgetMs=30min, respectRobots=true,
//   skipNoindex=true, includeSubdomains=false

import * as cheerio from "cheerio";

const DEFAULTS = {
  maxDepth: 5,
  maxPages: 2000,
  concurrency: 6,
  perPageTimeoutMs: 15_000,
  maxTotalBytes: 500 * 1024 * 1024,
  timeBudgetMs: 30 * 60 * 1000,
  respectRobots: true,
  skipNoindex: true,
  includeSubdomains: false,
  includePattern: null,         // RegExp | null
  excludePattern: /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|tar|gz|mp3|mp4|webm|mov|css|js|woff2?|ttf|otf|map)(\?|$)/i,
  jitterMs: 250,
  userAgent: "Mozilla/5.0 (compatible; SovereignAI-RAG/1.0; +https://elara.local)",
};

const PRESETS = {
  single:   { recursive: false },
  standard: { recursive: true,  maxDepth: 5, maxPages: 2000,  concurrency: 6 },
  deep:     { recursive: true,  maxDepth: 8, maxPages: 10000, concurrency: 8 },
};

export function presetConfig(preset) {
  return PRESETS[preset] || PRESETS.standard;
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    // strip common tracking/junk query keys
    const drop = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","fbclid","ref","ref_src"];
    for (const k of drop) url.searchParams.delete(k);
    // sort params for dedupe stability
    const params = [...url.searchParams.entries()].sort(([a],[b]) => a.localeCompare(b));
    url.search = "";
    for (const [k,v] of params) url.searchParams.append(k,v);
    // collapse trailing slash on path (but keep '/')
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0,-1);
    return url.toString();
  } catch { return null; }
}

function sameOrigin(a, b, includeSubdomains) {
  try {
    const ua = new URL(a), ub = new URL(b);
    if (ua.protocol !== ub.protocol) return false;
    if (ua.hostname === ub.hostname) return true;
    if (!includeSubdomains) return false;
    // crude eTLD+1 match: last two labels
    const tail = (h) => h.split(".").slice(-2).join(".");
    return tail(ua.hostname) === tail(ub.hostname);
  } catch { return false; }
}

function isCrawlable(url, opts) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  } catch { return false; }
  if (opts.excludePattern && opts.excludePattern.test(url)) return false;
  if (opts.includePattern && !opts.includePattern.test(url)) return false;
  return true;
}

// ---- robots.txt -----------------------------------------------------------
async function fetchRobots(origin, opts) {
  if (!opts.respectRobots) return { disallow: [], allow: [] };
  try {
    const r = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": opts.userAgent },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { disallow: [], allow: [] };
    const txt = await r.text();
    return parseRobots(txt);
  } catch { return { disallow: [], allow: [] }; }
}

function parseRobots(txt) {
  const lines = txt.split(/\r?\n/);
  let inStar = false;
  const disallow = [], allow = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.+)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") inStar = (val === "*");
    else if (inStar && key === "disallow" && val) disallow.push(val);
    else if (inStar && key === "allow" && val) allow.push(val);
  }
  return { disallow, allow };
}

function robotsAllows(robots, url) {
  if (!robots) return true;
  let path;
  try { path = new URL(url).pathname; } catch { return true; }
  let allowed = true;
  for (const d of robots.disallow) if (d && path.startsWith(d)) allowed = false;
  for (const a of robots.allow)    if (a && path.startsWith(a)) allowed = true;
  return allowed;
}

// ---- sitemap -------------------------------------------------------------
async function discoverSitemaps(origin, opts) {
  const out = [];
  for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
    try {
      const r = await fetch(`${origin}${path}`, {
        headers: { "user-agent": opts.userAgent },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) continue;
      const xml = await r.text();
      const urls = parseSitemap(xml);
      if (urls.length) out.push(...urls);
    } catch {}
  }
  return out;
}

function parseSitemap(xml) {
  const urls = [];
  // recursive: handle sitemapindex by collecting <loc> entries flat
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) urls.push(m[1].trim());
  return urls;
}

async function expandSitemapIndex(urls, opts, seenSm) {
  const out = [];
  for (const u of urls) {
    if (/\.xml(\.gz)?(\?|$)/i.test(u) && !seenSm.has(u)) {
      seenSm.add(u);
      try {
        const r = await fetch(u, { headers: { "user-agent": opts.userAgent }, signal: AbortSignal.timeout(10_000) });
        if (!r.ok) continue;
        const xml = await r.text();
        const sub = parseSitemap(xml);
        const expanded = await expandSitemapIndex(sub, opts, seenSm);
        out.push(...expanded);
      } catch {}
    } else {
      out.push(u);
    }
  }
  return out;
}

// ---- page fetch ----------------------------------------------------------
async function fetchPage(url, opts) {
  const signals = [AbortSignal.timeout(opts.perPageTimeoutMs)];
  if (opts.signal) signals.push(opts.signal);
  const r = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": opts.userAgent, accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.any(signals),
  });
  if (!r.ok) {
    return { ok: false, status: r.status, bytes: 0 };
  }
  const ct = String(r.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("html") && !ct.includes("xml") && ct) {
    return { ok: false, status: r.status, bytes: 0, reason: "non-html" };
  }
  const html = await r.text();
  return { ok: true, status: r.status, html, bytes: Buffer.byteLength(html, "utf8") };
}

function extractLinksAndMeta(html, baseUrl) {
  const $ = cheerio.load(html);
  // noindex
  let noindex = false;
  $('meta[name="robots"], meta[name="googlebot"]').each((_, el) => {
    const content = String($(el).attr("content") || "").toLowerCase();
    if (content.includes("noindex")) noindex = true;
  });
  const links = [];
  $("a[href]").each((_, el) => {
    const raw = String($(el).attr("href") || "").trim();
    if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:") || raw.toLowerCase().startsWith("mailto:")) return;
    try {
      const abs = new URL(raw, baseUrl).toString();
      links.push(abs);
    } catch {}
  });
  const title = ($("title").first().text() || "").trim().slice(0, 200);
  return { links, noindex, title };
}

// ---- main ----------------------------------------------------------------
export async function crawlUrl(rootUrl, userOpts = {}) {
  const opts = { ...DEFAULTS, ...userOpts };
  const start = Date.now();
  const root = normalizeUrl(rootUrl);
  if (!root) throw new Error(`invalid root url: ${rootUrl}`);
  const origin = new URL(root).origin;

  const visited = new Set();
  const queued = new Set();
  const errors = [];
  let bytes = 0;
  let stoppedReason = null;

  // robots
  const robots = await fetchRobots(origin, opts);

  // sitemap seeds
  let seeds = [];
  try {
    const sm = await discoverSitemaps(origin, opts);
    if (sm.length) {
      const expanded = await expandSitemapIndex(sm, opts, new Set());
      seeds = expanded
        .map(normalizeUrl)
        .filter(Boolean)
        .filter((u) => sameOrigin(root, u, opts.includeSubdomains))
        .filter((u) => isCrawlable(u, opts))
        .filter((u) => robotsAllows(robots, u));
      if (seeds.length > opts.maxPages) seeds = seeds.slice(0, opts.maxPages);
    }
  } catch {}

  // queue: [{url, depth}]
  let queue = [];
  const enqueue = (url, depth) => {
    const u = normalizeUrl(url);
    if (!u) return;
    if (visited.has(u) || queued.has(u)) return;
    if (!sameOrigin(root, u, opts.includeSubdomains)) return;
    if (!isCrawlable(u, opts)) return;
    if (!robotsAllows(robots, u)) return;
    if (depth > opts.maxDepth) return;
    queued.add(u);
    queue.push({ url: u, depth });
  };

  enqueue(root, 0);
  if (seeds.length) for (const s of seeds) enqueue(s, 1);

  const shouldStop = () => {
    if (opts.signal?.aborted) { stoppedReason = "cancelled"; return true; }
    if (visited.size >= opts.maxPages) { stoppedReason = "max_pages"; return true; }
    if (bytes >= opts.maxTotalBytes)   { stoppedReason = "max_bytes"; return true; }
    if (Date.now() - start >= opts.timeBudgetMs) { stoppedReason = "time_budget"; return true; }
    return false;
  };

  while (queue.length && !shouldStop()) {
    const batch = queue.splice(0, opts.concurrency);
    await Promise.all(batch.map(async ({ url, depth }) => {
      if (shouldStop()) return;
      try {
        const res = await fetchPage(url, opts);
        visited.add(url);
        queued.delete(url);
        if (!res.ok) { errors.push({ url, status: res.status, reason: res.reason }); return; }
        bytes += res.bytes || 0;
        const { links, noindex, title } = extractLinksAndMeta(res.html, url);
        if (opts.skipNoindex && noindex) {
          // still don't index, but its links can be followed
        } else {
          try { await opts.onPage?.(url, res.html, depth, { title, bytes: res.bytes }); }
          catch (e) { errors.push({ url, error: String(e.message || e), phase: "onPage" }); }
        }
        if (depth < opts.maxDepth) {
          for (const l of links) enqueue(l, depth + 1);
        }
      } catch (e) {
        errors.push({ url, error: String(e.message || e) });
        visited.add(url); queued.delete(url);
      }
    }));
    opts.onProgress?.({ visited: visited.size, queued: queue.length, bytes, elapsed: Date.now() - start, lastUrl: batch[batch.length - 1]?.url || null });
    // jitter between batches
    if (opts.jitterMs > 0 && queue.length && !shouldStop()) {
      await new Promise((r) => setTimeout(r, opts.jitterMs + Math.random() * opts.jitterMs));
    }
  }

  return {
    visited: visited.size,
    queued: queue.length,
    errors,
    bytes,
    durationMs: Date.now() - start,
    stoppedReason: stoppedReason || (queue.length ? "queue_drained_or_stopped" : "queue_empty"),
    sitemapSeeds: seeds.length,
  };
}
