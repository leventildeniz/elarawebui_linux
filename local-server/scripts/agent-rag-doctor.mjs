#!/usr/bin/env node
// agent-rag-doctor.mjs — one-shot CLI diagnostic for per-agent RAG scope.
// Usage:
//   node local-server/scripts/agent-rag-doctor.mjs firewall_oracle "checkpointte nat nasıl yapılır?"

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_SERVER = path.resolve(HERE, "..");
const require = createRequire(path.join(LOCAL_SERVER, "package.json"));
const { config: loadDotenv } = require("dotenv");
const pg = require("pg");
loadDotenv({ path: path.join(LOCAL_SERVER, ".env"), override: false });

const { buildRagDefaults, loadRagSettingsFromDisk } = await import("../lib/rag/defaults.mjs");
const { initBrandCache, getLibraryBrands, detectLibraryMatch, getAgentRagBrands } = await import("../lib/rag/brand-cache.mjs");
const { initAgentRag, buildAgentRagContext } = await import("../lib/agent-rag.mjs");
const { initRagRetrieval } = await import("../lib/rag/retrieval.mjs");
const { initEmbedProvider, embed, getLastEmbedError } = await import("../lib/embed-provider.mjs");
const { initRerankProvider, rerank, getLastRerankError } = await import("../lib/rerank-provider.mjs");

const agentArg = process.argv[2];
const query = process.argv.slice(3).join(" ").trim();
if (!agentArg || !query) {
  console.error('usage: node local-server/scripts/agent-rag-doctor.mjs <agent-id|script|name> "<query>"');
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.PG_URL;
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL missing (local-server/.env)");
  process.exit(2);
}

function envNumber(k, d) {
  const n = Number(process.env[k]);
  return Number.isFinite(n) ? n : d;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a?.length || 0, b?.length || 0);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function expandQueryTerms(q) {
  return Array.from(new Set(String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_.]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)))
    .slice(0, 20);
}

function hist(rows, key = "brand") {
  return (rows || []).reduce((m, r) => {
    const k = String(r?.[key] || "?");
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
}

function fmtJson(v) { return JSON.stringify(v, null, 2); }

const RAG_SETTINGS = buildRagDefaults({ envNumber, TIMEOUT_BUDGETS: { HTTP_SOCKET_MS: 120000, MLX_STREAM_TOTAL_MS: 120000, MLX_QUEUE_WAIT_MS: 120000 } });
const RAG_SETTINGS_FILE = path.join(LOCAL_SERVER, "data", "rag-settings.json");
loadRagSettingsFromDisk({ fs, file: fs.existsSync(RAG_SETTINGS_FILE) ? RAG_SETTINGS_FILE : path.join(LOCAL_SERVER, ".rag-settings.json"), target: RAG_SETTINGS });

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const qembCache = new Map();

initBrandCache({ pool, getRagSettings: () => RAG_SETTINGS });
initAgentRag({ getRagSettings: () => RAG_SETTINGS });
initEmbedProvider({
  getRagSettings: () => RAG_SETTINGS,
  getWorkerStatus: () => "online-external",
  kickWorkerStart: () => {},
  ensureWorker: async () => {},
  embedWorkerPort: Number(process.env.EMBED_WORKER_PORT || process.env.EMBED_WORKER_PORT || 8082),
  embedWorkerHost: process.env.EMBED_WORKER_HOST || "127.0.0.1",
});
initRerankProvider({
  getRagSettings: () => RAG_SETTINGS,
  getWorkerStatus: () => "online-external",
  kickWorkerStart: () => {},
  ensureWorker: async () => {},
  embedWorkerPort: Number(process.env.EMBED_WORKER_PORT || process.env.EMBED_WORKER_PORT || 8082),
  embedWorkerHost: process.env.EMBED_WORKER_HOST || "127.0.0.1",
});
initRagRetrieval({
  pool,
  getRagSettings: () => RAG_SETTINGS,
  ROLE_RANK: { Viewer: 1, Security: 2, Operator: 3, Admin: 4 },
  getActivePackBrandFilter: async () => [],
  getAgentRagBrands,
  extractTechnicalCore: async (raw) => ({ text: String(raw || "").trim(), cacheHit: false, ms: 0, reject: "doctor_raw" }),
  isExtBreakerOpen: () => false,
  getLibraryBrands,
  detectLibraryMatch,
  generateHydePassage: async () => ({ text: "", ms: 0, reject: "doctor_disabled" }),
  qembGet: (k) => qembCache.get(k),
  qembSet: (k, v) => { qembCache.set(k, v); },
  embed,
  rerank,
  getLastRerankError,
  getLastEmbedError,
  expandQueryTerms,
  cosine,
  DEFAULT_RAG_TRGM_THRESHOLD: envNumber("RAG_TRGM_THRESHOLD", 0.04),
  DEFAULT_RAG_TRGM_MIN_SCORE: envNumber("RAG_TRGM_MIN_SCORE", 0.005),
});

try {
  const agentRes = await pool.query(
    `SELECT id, name, agent_path, meta
       FROM agents
      WHERE id::text = $1
         OR lower(name) = lower($1)
         OR lower(coalesce(meta->>'script','')) = lower($1)
         OR lower(coalesce(agent_path,'')) LIKE '%' || lower($1)
         OR lower(coalesce(meta->>'script','')) LIKE '%' || lower($1)
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [agentArg],
  );
  const agent = agentRes.rows[0];
  if (!agent) throw new Error(`agent not found: ${agentArg}`);

  const bindings = await pool.query(
    `SELECT collection_id, enabled FROM agent_rag_bindings WHERE agent_id=$1 ORDER BY collection_id`,
    [agent.id],
  ).catch(() => ({ rows: [] }));
  const libBrands = await getLibraryBrands();
  const agentBrands = await getAgentRagBrands(agent.id);
  const rawMatch = detectLibraryMatch(query, libBrands);

  console.log("━━━ agent-rag doctor ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`agent: ${agent.id} · ${agent.name || "-"} · ${agent.agent_path || agent.meta?.script || "-"}`);
  console.log(`query: ${query}`);
  console.log(`meta.rag.brands: ${fmtJson(agent.meta?.rag?.brands || [])}`);
  console.log(`agentBrandsResolved: ${fmtJson(agentBrands)}`);
  console.log(`legacyBindings: ${bindings.rows.length}`);
  if (bindings.rows.length) console.log(`legacyBindingCollectionIds: ${fmtJson(bindings.rows.map((r) => r.collection_id))}`);
  console.log(`libraryBrands.head: ${fmtJson(libBrands.slice(0, 12))}`);
  console.log(`detectLibraryMatch(raw): ${fmtJson({ matched: rawMatch.matched, matchedDisplay: rawMatch.matchedDisplay })}`);

  const rag = await buildAgentRagContext(pool, agent.id, query);
  const ctx = rag?.env?.ELARA_AGENT_RAG_CONTEXT ? JSON.parse(rag.env.ELARA_AGENT_RAG_CONTEXT) : { hits: [] };
  const diag = rag?.meta?.diag || {};
  console.log("\n━━━ applied rag context ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`mode: ${rag?.meta?.mode || "-"}`);
  console.log(`decision: ${rag?.meta?.decision || "-"} · reason: ${rag?.meta?.reason || "-"}`);
  console.log(`hits: ${rag?.meta?.hits ?? 0} · top1: ${rag?.meta?.top1 ?? "-"} · tau: ${rag?.meta?.tau ?? "-"}`);
  console.log(`diag.libraryMatch: ${diag.libraryMatch || "-"}`);
  console.log(`diag.explicitBrandLock: ${diag.explicitBrandLock || "-"}`);
  console.log(`diag.effectiveBrandsArg(mirror): ${fmtJson(diag.effectiveBrandsArg || null)}`);
  console.log(`diag.appliedEffectiveBrandsArg: ${fmtJson(diag.appliedEffectiveBrandsArg || null)}`);
  console.log(`sourceBrandHistogram: ${fmtJson(hist(ctx.hits || []))}`);
  for (const [i, h] of (ctx.hits || []).slice(0, 8).entries()) {
    console.log(`#${i + 1} ${h.brand || "-"} · ${h.path || "-"} · score=${h.score ?? "-"}`);
  }

  // ── DB ground-truth probe: prove whether the brand filter is honored ────
  console.log("\n━━━ DB ground-truth (brand filter sanity) ━━━━━━━━━━━━━━━━━━━━━━━━━");
  const applied = Array.isArray(diag.appliedEffectiveBrandsArg) ? diag.appliedEffectiveBrandsArg : [];
  if (!applied.length) {
    console.log("(no appliedEffectiveBrandsArg → skipping ground-truth probe)");
  } else {
    // 1) What raw brand strings exist on the returned chunk ids?
    const chunkIds = (ctx.hits || []).map((h) => h.chunk_id).filter(Boolean);
    if (chunkIds.length) {
      const dbRows = await pool.query(
        `SELECT id, brand, lower(regexp_replace(coalesce(brand,''), '[_\\-].*$', '')) AS norm, path
           FROM knowledge_chunks WHERE id = ANY($1::uuid[])`,
        [chunkIds],
      ).catch((e) => ({ rows: [], err: e?.message }));
      console.log(`returned-chunks raw brand check (${dbRows.rows.length}):`);
      for (const r of dbRows.rows) {
        const matchesFilter = applied.includes(r.norm);
        console.log(`  ${matchesFilter ? "✓" : "✗"} brand="${r.brand}" norm="${r.norm}" path=${r.path}`);
      }
    }
    // 2) Distinct raw brand labels matching the filter at all
    const distinctBrands = await pool.query(
      `SELECT DISTINCT brand,
              lower(regexp_replace(coalesce(brand,''), '[_\\-].*$', '')) AS norm,
              count(*) AS n
         FROM knowledge_chunks
        WHERE lower(regexp_replace(coalesce(brand,''), '[_\\-].*$', '')) = ANY($1::text[])
        GROUP BY brand
        ORDER BY n DESC LIMIT 20`,
      [applied],
    ).catch((e) => ({ rows: [], err: e?.message }));
    console.log(`distinct DB brand labels matching filter ${fmtJson(applied)} (top 20):`);
    for (const r of distinctBrands.rows) {
      console.log(`  brand="${r.brand}" norm="${r.norm}" rows=${r.n}`);
    }
    if (!distinctBrands.rows.length) {
      console.log(`  (NONE — DB has zero chunks whose normalized brand matches ${fmtJson(applied)})`);
    }
  }
} catch (e) {
  console.error("FATAL:", e?.stack || e?.message || e);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}