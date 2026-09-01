import { requireSession } from "../session-gate.mjs";

export async function mountApprovalRoutes(app, { pool }) {
  const admin = requireSession();

  // --- GET APPROVAL STATE ---
  app.get("/api/approvals", admin, async (req, res) => {
    try {
      const [reqRes, configRes] = await Promise.all([
        pool.query(`
          SELECT 
            id, title, requester, requester_group, agent_id as agent, 
            tool, target, policy, risk, args, origin, status, note, 
            assigned_to, ttl_ms, expires_at, decided_at, decided_by, created_at 
          FROM approval_requests 
          ORDER BY created_at DESC 
          LIMIT 200
        `),
        pool.query("SELECT * FROM approval_config WHERE id='singleton'")
      ]);

      let config = configRes.rows[0];
      if (!config) {
        await pool.query("INSERT INTO approval_config (id) VALUES ('singleton') ON CONFLICT DO NOTHING");
        const r2 = await pool.query("SELECT * FROM approval_config WHERE id='singleton'");
        config = r2.rows[0] || {};
      }

      // Map 'denied' to 'rejected' for UI
      const requests = reqRes.rows.map(r => ({
        ...r,
        status: r.status === 'denied' ? 'rejected' : r.status
      }));

      res.json({
        ok: true,
        requests,
        config
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- DECIDE ---
  app.patch("/api/approvals/decide", admin, async (req, res) => {
    try {
      const { ids, status, note, by } = req.body;
      if (!ids || !ids.length) return res.status(400).json({ error: "no ids" });

      // Map 'rejected' from UI to 'denied' in DB
      const dbStatus = status === 'rejected' ? 'denied' : status;

      const { rows } = await pool.query(
        `UPDATE approval_requests 
         SET status=$1, note=$2, decided_by=$3, decided_at=now()
         WHERE id = ANY($4)
         RETURNING *`,
        [dbStatus, note || "", by, ids]
      );

      const updated = rows.map(r => ({
        ...r,
        status: r.status === 'denied' ? 'rejected' : r.status
      }));

      res.json({ ok: true, decided: updated });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- REQUEST APPROVAL ---
  app.post("/api/approvals/request", admin, async (req, res) => {
    try {
      const draft = req.body;
      const { rows } = await pool.query(
        `INSERT INTO approval_requests 
          (id, title, requester, requester_group, agent_id, tool, target, policy, risk, args, origin, status, ttl_ms, expires_at, assigned_to)
         VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, now() + interval '1 millisecond' * $12, $13)
         RETURNING *`,
        [
          draft.id, draft.title, draft.requester, draft.requesterGroup, draft.agent, 
          draft.tool, draft.target, draft.policy, draft.risk, draft.args || '{}', 
          draft.origin || 'seed', draft.ttl_ms || 7200000, JSON.stringify(draft.assignedTo || [])
        ]
      );
      
      const r = rows[0];
      r.status = r.status === 'denied' ? 'rejected' : r.status;
      
      res.json({ ok: true, request: r });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- CONFIG ---
  app.patch("/api/approvals/config", admin, async (req, res) => {
    try {
      const { queue_armed, allow_self_approve } = req.body;
      const cur = await pool.query("SELECT * FROM approval_config WHERE id='singleton'");
      const cfg = cur.rows[0] || {};
      
      const nextArmed = queue_armed !== undefined ? queue_armed : cfg.queue_armed;
      const nextSelf = allow_self_approve !== undefined ? allow_self_approve : cfg.allow_self_approve;

      const { rows } = await pool.query(
        `UPDATE approval_config 
         SET queue_armed=$1, allow_self_approve=$2, updated_at=now()
         WHERE id='singleton' RETURNING *`,
        [nextArmed, nextSelf]
      );
      res.json({ ok: true, config: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}