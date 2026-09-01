// lib/capability/manifest-embed.mjs
// Capability manifest embedding cache.
//
// Design: at boot (and after capability CRUD) we embed a short "manifest
// line" per capability — kind + name + description + tags. The vectors are
// persisted to ~/.elara/state/capability-manifest-embed.json so restarts do
// not re-pay embed cost. The gap-detector cosines the user query against
// this table to decide HAVE / GAP / LLM_ONLY.
//
// Contract: this module owns ONLY the cache. It does not decide, log, or
// touch chat pipelines. gap-detector.mjs is the sole reader.

import fs from "node:fs";
import { getCapabilityManifestEmbedPath } from "../state-paths.mjs";
import { listCapabilities } from "../capability-registry.mjs";
import { embed } from "../embed-provider.mjs";

const CACHE_VERSION = 1;

let _cache = null;   // in-memory copy of the on-disk JSON
let _building = null; // singleflight promise while rebuilding

export function normalizeEmbeddingVectors(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return null;
  if (Array.isArray(result.embeddings)) return result.embeddings;
  if (Array.isArray(result.vectors)) return result.vectors;
  if (Array.isArray(result.data)) return result.data.map((d) => d?.embedding).filter(Array.isArray);
  return null;
}

function _embedReturnLabel(v, expected) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return `${v.length}/${expected}`;
  if (v && typeof v === "object" && Array.isArray(v.data)) return `object.data=${v.data.length}/${expected}`;
  return typeof v;
}

function _capabilityText(cap) {
  const parts = [
    cap.kind || "",
    cap.name || cap.slug || "",
    cap.description || "",
    Array.isArray(cap.tags) ? cap.tags.join(" ") : "",
  ].map((s) => String(s || "").trim()).filter(Boolean);
  return parts.join(" · ").slice(0, 800);
}

function _readCache() {
  try {
    const p = getCapabilityManifestEmbedPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    const obj = JSON.parse(raw);
    if (!obj || obj.version !== CACHE_VERSION || !Array.isArray(obj.capabilities)) return null;
    return obj;
  } catch { return null; }
}

function _writeCache(obj) {
  try {
    const p = getCapabilityManifestEmbedPath();
    fs.writeFileSync(p, JSON.stringify(obj), "utf8");
    return true;
  } catch { return false; }
}

export function getCachedManifest() {
  if (_cache) return _cache;
  const disk = _readCache();
  if (disk) { _cache = disk; return _cache; }
  return null;
}

export function invalidateManifest() {
  _cache = null;
  try { fs.unlinkSync(getCapabilityManifestEmbedPath()); } catch { /* ignore */ }
}

// Build the manifest embedding cache. Safe to call multiple times —
// concurrent callers share a single build. Returns the cache object or null
// on failure (embed worker down, no capabilities, etc).
export async function buildCapabilityManifest({ force = false } = {}) {
  if (!force) {
    const existing = getCachedManifest();
    if (existing) return existing;
  }
  if (_building) return _building;

  _building = (async () => {
    try {
      const caps = await listCapabilities({ enabledOnly: true });
      console.log(`[capability-manifest] listCapabilities → ${Array.isArray(caps) ? caps.length : "n/a"}`);
      if (!Array.isArray(caps) || caps.length === 0) {
        const empty = { version: CACHE_VERSION, model: null, dims: 0, builtAt: Date.now(), capabilities: [] };
        _cache = empty;
        _writeCache(empty);
        return empty;
      }
      const texts = caps.map(_capabilityText);
      const t0 = Date.now();
      let vecs;
      try {
        vecs = normalizeEmbeddingVectors(await embed(texts, { timeoutMs: 90_000, attempts: 2 }));
      } catch (err) {
        console.warn(`[capability-manifest] mlxEmbed threw: ${err?.message || err}`);
        return null;
      }
      if (!Array.isArray(vecs) || vecs.length !== texts.length) {
        console.warn(`[capability-manifest] embed returned ${_embedReturnLabel(vecs, texts.length)} — not caching`);
        return null;
      }
      const dims = Array.isArray(vecs[0]) ? vecs[0].length : 0;
      const built = {
        version: CACHE_VERSION,
        model: process.env.EMBED_MODEL || null,
        dims,
        builtAt: Date.now(),
        buildMs: Date.now() - t0,
        capabilities: caps.map((cap, i) => ({
          id: cap.id,
          slug: cap.slug,
          kind: cap.kind,
          name: cap.name,
          text: texts[i],
          embedding: vecs[i],
        })),
      };
      _cache = built;
      _writeCache(built);
      return built;
    } catch (err) {
      console.warn(`[capability-manifest] build failed: ${err?.message || err}`);
      return null;
    } finally {
      _building = null;
    }
  })();

  return _building;
}

// Cosine similarity — assumes both vectors are non-empty and same length.
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
