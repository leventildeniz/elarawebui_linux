// lib/embed-worker/store.mjs — Tur 3a
// embedAndStoreChunks + getEmbeddingHealth (server.mjs:5974-6177)
// Pure DI: pool + mlxEmbed + worker probes + RAG_SETTINGS getter.

import { createHash } from "node:crypto";

let DEPS = null;

export function initEmbedWorkerStore(deps) {
  const required = [
    "pool", "embed", "ensureWorker", "pushLog",
    "tableHasColumn", "ensureKnowledgeChunksTable",
    "cleanupKnowledgeGhosts", "inspectDirectoryAccess",
    "getLibraryRoot", "getRagSettings", "EMBED_DIM_TARGET",
  ];
  for (const k of required) {
    if (deps[k] === undefined || deps[k] === null) {
      throw new Error(`[embed-worker/store] missing dep: ${k}`);
    }
  }
  DEPS = deps;
}

export async function embedAndStoreChunks(ids, texts, opts = {}) {
  if (!DEPS) throw new Error("[embed-worker/store] not initialized");
  const { pool, embed, ensureWorker, pushLog, getRagSettings, EMBED_DIM_TARGET } = DEPS;
  if (!ids?.length || !texts?.length) return 0;
  
  await ensureWorker().catch((e) => pushLog("worker", `[ensure-error] ${e?.message || e}`));
  const signal = opts.signal && typeof opts.signal === "object" ? opts.signal : null;
  const BATCH = Math.max(8, Math.min(128, Number(process.env.EMBED_STORE_BATCH) || 32));
  const embModel = process.env.EMBED_MODEL || process.env.MLX_EMBED_MODEL || "BAAI/bge-m3";
  let written = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    if (signal?.aborted) break;
    const idSlice = ids.slice(i, i + BATCH);
    const txSlice = texts.slice(i, i + BATCH);
    const embs = await embed(txSlice, { signal }).catch(() => null);
    if (signal?.aborted) break;
    if (!embs || embs.length !== idSlice.length) {
      continue;
    }
    for (let j = 0; j < idSlice.length; j++) {
      if (signal?.aborted) break;
      const v = embs[j];
      if (!Array.isArray(v) || v.length < 128) {
        if (process.env.DEBUG_RAG) console.error(`[embed] dim mismatch got=${v?.length}`);
        continue;
      }
      try {
        const r = await pool.query(
          `UPDATE knowledge_chunks
              SET embedding = $1::jsonb,
                  metadata = jsonb_set(
                    jsonb_set(
                      jsonb_set(COALESCE(metadata, '{}'::jsonb), '{embedded_at}', to_jsonb(now())),
                      '{embedding_model}', to_jsonb($3::text)
                    ),
                    '{embedding_status}', '"ok"'
                  )
            WHERE id = $2`,
          [JSON.stringify(v), idSlice[j], embModel]
        );
        if (r.rowCount > 0) written++;
      } catch (writeErr) {
        if (process.env.DEBUG_RAG) console.error("[embed:write]", writeErr.message);
      }
    }
  }
  return written;
}

export async function getEmbeddingHealth() {
  if (!DEPS) throw new Error("[embed-worker/store] not initialized");
  const { pool, ensureKnowledgeChunksTable, cleanupKnowledgeGhosts, inspectDirectoryAccess, getLibraryRoot, EMBED_DIM_TARGET } = DEPS;
  await ensureKnowledgeChunksTable();
  const DEFAULT_LIBRARY_ROOT = getLibraryRoot();
  if (!global.__lastCoverageGhostCleanup || Date.now() - global.__lastCoverageGhostCleanup > 300_000) {
    global.__lastCoverageGhostCleanup = Date.now();
    setImmediate(() => {
      cleanupKnowledgeGhosts({ staleOnly: false })
        .then((cleanup) => { global.__lastCoverageGhostCleanupReport = { ...cleanup, ts: Date.now() }; })
        .catch((e) => { global.__lastCoverageGhostCleanupReport = { error: String(e?.message || e), ts: Date.now() }; });
    });
  }
  const libCacheKey = String(DEFAULT_LIBRARY_ROOT);
  const libCache = global.__libraryAccessCache;
  let libraryAccessPromise;
  if (libCache && libCache.root === libCacheKey && Date.now() - libCache.ts < 60_000) {
    libraryAccessPromise = Promise.resolve(libCache.value);
  } else {
    libraryAccessPromise = inspectDirectoryAccess(DEFAULT_LIBRARY_ROOT, { recursive: false, sampleLimit: 0 })
      .catch((e) => ({ root: DEFAULT_LIBRARY_ROOT, exists: false, isDirectory: false, readable: false, executable: false, filesSeen: 0, indexableSeen: 0, errors: [{ message: String(e.message || e) }], permissionErrors: [] }))
      .then((value) => { global.__libraryAccessCache = { root: libCacheKey, ts: Date.now(), value }; return value; });
  }
  const [counts, roots, indexes, db, files, rootChunks, libraryAccess, sources] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE embedding IS NULL)::int AS missing,
        COUNT(*) FILTER (WHERE embedding IS NULL OR COALESCE(embedding_status,'pending')='pending')::int AS pending,
        COUNT(*) FILTER (WHERE embedding_status='ok' AND embedding IS NOT NULL)::int AS done,
        COUNT(*) FILTER (WHERE embedding_status='error')::int AS errored,
        COUNT(DISTINCT root)::int AS roots,
        COUNT(DISTINCT path)::int AS files
      FROM knowledge_chunks
    `),
    pool.query(`
      SELECT root, COUNT(*)::int AS chunks, COUNT(DISTINCT path)::int AS files,
             COUNT(*) FILTER (WHERE embedding IS NULL OR COALESCE(embedding_status,'pending')='pending')::int AS pending
        FROM knowledge_chunks
       GROUP BY root
       ORDER BY chunks DESC
       LIMIT 10
    `).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT c.relname AS name, am.amname AS method, pg_get_indexdef(i.indexrelid) AS def
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_am am ON am.oid = c.relam
       WHERE t.relname = 'knowledge_chunks'
         AND c.relname IN ('idx_kchunks_embedding_hnsw','idx_kchunks_embed_status','idx_kchunks_file_ord')
       ORDER BY c.relname
    `).catch(() => ({ rows: [] })),
    pool.query(`SELECT current_database() AS database, current_setting('app.embed_dim', true) AS app_embed_dim`).catch(() => ({ rows: [{}] })),
    pool.query(`SELECT COUNT(*)::int AS files FROM knowledge_files`).catch(() => ({ rows: [{ files: 0 }] })),
    pool.query(`SELECT COUNT(*)::int AS chunks, COUNT(*) FILTER (WHERE embedding IS NULL OR COALESCE(embedding_status,'pending')='pending')::int AS pending FROM knowledge_chunks WHERE root=$1`, [DEFAULT_LIBRARY_ROOT]).catch(() => ({ rows: [{ chunks: 0, pending: 0 }] })),
    libraryAccessPromise,
    pool.query(`
      SELECT id, name, type, tag, url, chunks, version,
             EXTRACT(EPOCH FROM created_at)*1000 AS created_ms
        FROM knowledge_sources
       WHERE superseded_by IS NULL
       ORDER BY created_at DESC
       LIMIT 200
    `).catch(() => ({ rows: [] })),
  ]);
  const c = counts.rows[0] || {};
  return {
    ok: true,
    dim: EMBED_DIM_TARGET,
    configured: !!process.env.EMBED_MODEL,
    model: process.env.EMBED_MODEL || null,
    database: db.rows[0]?.database || null,
    appEmbedDim: Number(db.rows[0]?.app_embed_dim || EMBED_DIM_TARGET),
    defaultRoot: DEFAULT_LIBRARY_ROOT,
    library: {
      path: DEFAULT_LIBRARY_ROOT,
      exists: !!libraryAccess.exists,
      isDirectory: !!libraryAccess.isDirectory,
      readable: !!libraryAccess.readable,
      executable: !!libraryAccess.executable,
      filesSeen: Number(libraryAccess.filesSeen || 0),
      indexableSeen: Number(libraryAccess.indexableSeen || 0),
      chunks: Number(rootChunks.rows[0]?.chunks || 0),
      pending: Number(rootChunks.rows[0]?.pending || 0),
      lastPathSync: global.__lastLibraryPathSync || null,
      lastGhostCleanup: global.__lastCoverageGhostCleanupReport || null,
      errors: [...(libraryAccess.permissionErrors || []), ...(libraryAccess.errors || [])].slice(0, 5),
    },
    totals: {
      chunks: Number(c.total || 0),
      missing: Number(c.missing || 0),
      pending: Number(c.pending || 0),
      done: Number(c.done || 0),
      errored: Number(c.errored || 0),
      roots: Number(c.roots || 0),
      files: Math.max(Number(c.files || 0), Number(files.rows[0]?.files || 0)),
    },
    roots: roots.rows.map((r) => ({ root: r.root, chunks: Number(r.chunks || 0), files: Number(r.files || 0), pending: Number(r.pending || 0) })),
    indexes: indexes.rows.map((r) => ({ name: r.name, method: r.method, ready: true })),
    indexedObjects: sources.rows.map((r) => ({
      id: r.id, name: r.name, type: r.type, tag: r.tag, url: r.url,
      chunks: Number(r.chunks || 0), version: Number(r.version || 1),
      createdAt: r.created_ms ? new Date(Number(r.created_ms)).toISOString() : null,
    })),
    indexedTotals: sources.rows.reduce((acc, r) => {
      const t = String(r.type || "other").toLowerCase();
      acc[t] = (acc[t] || 0) + 1; acc.total = (acc.total || 0) + 1; return acc;
    }, { total: 0 }),
  };
}
