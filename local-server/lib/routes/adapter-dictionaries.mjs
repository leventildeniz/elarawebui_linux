// Adapter dictionaries — kind/value/label CRUD for connector taxonomy.
// Extracted from server.mjs.

const ADAPTER_DICT_KINDS = new Set(["category", "connection", "runner"]);
	
	
	export async function initAdapterDictionaries({ pool }) {
	  console.log("[boot] initAdapterDictionaries... ✅");
	}
	
	export function mountAdapterDictionariesRoutes(app, deps) {
  const { pool } = deps;

  app.get("/api/adapter-dictionaries", async (req, res) => {
    try {
      const kind = String(req.query.kind || "").trim();
      const params = [];
      let where = "";
      if (kind) {
        if (!ADAPTER_DICT_KINDS.has(kind)) return res.status(400).json({ ok: false, error: "invalid kind" });
        where = "WHERE kind=$1";
        params.push(kind);
      }
      const r = await pool.query(
        `SELECT id, kind, value, label, builtin, created_at FROM adapter_dictionaries ${where} ORDER BY kind, builtin DESC, value`,
        params,
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/adapter-dictionaries", async (req, res) => {
    try {
      const kind = String(req.body?.kind || "").trim();
      const value = String(req.body?.value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      const label = req.body?.label ? String(req.body.label).trim().slice(0, 80) : null;
      if (!ADAPTER_DICT_KINDS.has(kind)) return res.status(400).json({ ok: false, error: "invalid kind" });
      if (!value || value.length > 64) return res.status(400).json({ ok: false, error: "invalid value" });
      const r = await pool.query(
        `INSERT INTO adapter_dictionaries(kind, value, label, builtin) VALUES ($1,$2,$3,false)
           ON CONFLICT (kind, value) DO UPDATE SET label=EXCLUDED.label RETURNING *`,
        [kind, value, label],
      );
      res.json({ ok: true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.patch("/api/adapter-dictionaries/:id", async (req, res) => {
    try {
      const row = await pool.query("SELECT * FROM adapter_dictionaries WHERE id=$1", [req.params.id]);
      if (!row.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      const cur = row.rows[0];
      const label = req.body?.label !== undefined ? (req.body.label ? String(req.body.label).trim().slice(0, 80) : null) : cur.label;
      let value = cur.value;
      if (req.body?.value !== undefined) {
        value = String(req.body.value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        if (!value || value.length > 64) return res.status(400).json({ ok: false, error: "invalid value" });
      }
      const r = await pool.query(
        `UPDATE adapter_dictionaries SET value=$2, label=$3 WHERE id=$1 RETURNING *`,
        [req.params.id, value, label],
      );
      res.json({ ok: true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.delete("/api/adapter-dictionaries/:id", async (req, res) => {
    try {
      const row = await pool.query("SELECT id FROM adapter_dictionaries WHERE id=$1", [req.params.id]);
      if (!row.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      await pool.query("DELETE FROM adapter_dictionaries WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
