// /rag/status — extracted from server.mjs 2026-05-30.
// sendRagStatus is also re-used as a DI symbol for rag-readops.

export function createSendRagStatus({ pool, getEmbeddingHealth, sjActive, sjHost }) {
  return async function sendRagStatus(res) {
    const health = await getEmbeddingHealth();
    let worker = {
      state: "idle", ownerHost: null, isLocal: true,
      startedAt: null, heartbeatAt: null,
      scanned: 0, written: 0, errors: 0, stopRequested: false,
    };
    try {
      const row = await sjActive(pool, "backfill");
      if (row) {
        worker = {
          state: row.status === "stopping" ? "stopping" : "running",
          ownerHost: row.owner_host,
          ownerPid: row.owner_pid,
          isLocal: row.owner_host === sjHost(),
          startedAt: row.started_at,
          heartbeatAt: row.heartbeat_at,
          scanned: row.scanned || 0,
          written: row.written || 0,
          errors: row.errors || 0,
          stopRequested: !!row.stop_requested,
        };
      }
    } catch { /* worker info is best-effort */ }
    res.json({ ...health, worker, host: sjHost(), source: "GET /rag/status" });
  };
}

export function mountRagStatusRoute(app, sendRagStatus) {
  app.get("/rag/status", async (_req, res) => {
    try { await sendRagStatus(res); }
    catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
