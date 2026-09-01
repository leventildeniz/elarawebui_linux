// /api/messages/* — chat-message persist / delete / feedback.
// Extracted from server.mjs (2026-05-30, ~57 lines).
//
// Hot-path safety: feedback uses the async write queue so the assistant row
// can land AFTER the user clicks 👍/👎 without blocking the request.
export function mountMessagesRoutes({ app, pool, isUuid, enqueueWrite }) {
  app.post("/api/messages", (req, res) => {
    const { id = null, thread_id, role, content, model = null, tokens = null } = req.body ?? {};
    if (!thread_id || !role || !content) return res.status(400).json({ error: "missing fields" });
    if (!isUuid(thread_id)) return res.status(400).json({ error: "invalid thread_id (expected UUID)", thread_id });
    // Honour client-supplied UUID so the browser and DB share the same primary
    // key — required for per-message DELETE/EDIT to round-trip.
    if (id && isUuid(id)) {
      enqueueWrite(
        `INSERT INTO chat_messages(id, thread_id, role, content, model, tokens)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [id, thread_id, role, content, model, tokens]
      );
    } else {
      enqueueWrite(
        `INSERT INTO chat_messages(thread_id, role, content, model, tokens)
         VALUES ($1,$2,$3,$4,$5)`,
        [thread_id, role, content, model, tokens]
      );
    }
    enqueueWrite(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [thread_id]);
    res.status(202).json({ queued: true, id });
  });

  // Single-message hard delete — frontend trash button now hits PostgreSQL,
  // not just local React state. Refresh-zombie messages can no longer return.
  app.delete("/api/messages/:id", async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "invalid message id (expected UUID)" });
    try {
      const r = await pool.query("DELETE FROM chat_messages WHERE id=$1", [req.params.id]);
      res.json({ ok: true, deleted: r.rowCount });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Per-message feedback (thumbs up / down). Accepts -1, 0, 1, or null (clear).
  app.post("/api/messages/:id/feedback", (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: "invalid message id (expected UUID)" });
    const raw = req.body?.score;
    let score = null;
    if (raw === 1 || raw === -1 || raw === 0) score = raw;
    else if (raw === null || raw === undefined) score = null;
    else return res.status(400).json({ error: "score must be -1, 0, 1, or null" });
    // Fire-and-forget: the write queue serialises against chat inserts so the
    // UPDATE will land safely whether the assistant row exists yet or not.
    enqueueWrite(
      "UPDATE chat_messages SET feedback=$2 WHERE id=$1",
      [req.params.id, score]
    );
    res.json({ ok: true, id: req.params.id, feedback: score, queued: true });
  });
}
