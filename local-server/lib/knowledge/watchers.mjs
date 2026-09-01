// watchers.mjs — fs.watch ingestion pipeline (live mühürleme).
// Extracted from server.mjs 2026-05-30 (Batch B turn 3).
// Deps via initWatchers: pool, getRagSettings, reindexRoot, enqueueWrite,
// ensureKnowledgeFilesTable, migrateReady.

import fs from "node:fs";

const knowledgeWatchers = new Map(); // root -> {watcher, timer}
let _deps = null;

export function initWatchers(deps) {
  _deps = deps || {};
  const { migrateReady } = _deps;
  if (migrateReady && typeof migrateReady.then === "function") {
    void migrateReady.then(bootstrapWatchers).catch(() => {});
  }
}

export function scheduleRootReindex(root) {
  if (!_deps) return;
  const { reindexRoot, enqueueWrite } = _deps;
  const cur = knowledgeWatchers.get(root);
  if (cur?.timer) clearTimeout(cur.timer);
  const timer = setTimeout(() => {
    reindexRoot(root).then((r) => {
      enqueueWrite(
        `INSERT INTO agent_logs(agent,level,message,meta) VALUES ('rag','info','watch:reindex',$1)`,
        [{ root, ...r }]
      );
    }).catch(() => {});
  }, 4000); // debounce 4s — collapse bursts
  knowledgeWatchers.set(root, { ...(cur||{}), timer });
}

export function startWatchingRoot(root) {
  if (!_deps) return;
  const { getRagSettings } = _deps;
  const RAG_SETTINGS = getRagSettings?.() || {};
  if (!RAG_SETTINGS.autoIngestion) return; // v12 — disk watch only when explicitly enabled
  if (knowledgeWatchers.get(root)?.watcher) return;
  try {
    const w = fs.watch(root, { recursive: true }, () => scheduleRootReindex(root));
    w.on("error", () => {});
    knowledgeWatchers.set(root, { watcher: w, timer: null });
  } catch (e) { console.error("[rag] watch failed:", root, String(e.message||e)); }
}

export function stopWatchingRoot(root) {
  const cur = knowledgeWatchers.get(root);
  if (!cur) return;
  try { cur.timer && clearTimeout(cur.timer); } catch {}
  try { cur.watcher && cur.watcher.close(); } catch {}
  knowledgeWatchers.delete(root);
}

export function stopAllWatchers() {
  for (const root of Array.from(knowledgeWatchers.keys())) stopWatchingRoot(root);
}

export async function bootstrapWatchers() {
  if (!_deps) return;
  const { getRagSettings, ensureKnowledgeFilesTable, pool } = _deps;
  const RAG_SETTINGS = getRagSettings?.() || {};
  if (!RAG_SETTINGS.autoIngestion) {
    console.log("[rag] autoIngestion=false — bootstrapWatchers skipped (manual sync only)");
    return;
  }
  try {
    await ensureKnowledgeFilesTable();
    const { rows } = await pool.query("SELECT DISTINCT root FROM knowledge_files");
    for (const r of rows) startWatchingRoot(r.root);
  } catch {}
}
