import { requireSession } from '../session-gate.mjs';

export async function mountRagFoldersRoutes(app, deps) {
  const { pool, createPrefixedId } = deps;

  app.get("/api/rag-folders", requireSession(), async (req, res) => {
    try {
      // Create uploads folder if missing
      await pool.query(`
        INSERT INTO rag_folders (id, name, auto_tags, builtin, color)
        VALUES ('uploads', 'Uploads', '[]'::jsonb, true, 'sapphire')
        ON CONFLICT (id) DO NOTHING
      `);

      const { rows } = await pool.query("SELECT * FROM rag_folders ORDER BY created_at ASC");
      res.json(rows.map(r => ({
        id: r.id,
        name: r.name,
        autoTags: r.auto_tags || [],
        builtin: r.builtin,
        color: r.color,
        createdAt: new Date(r.created_at).getTime(),
        ownerId: r.owner_id
      })));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/rag-folders", requireSession(), async (req, res) => {
    const { name, autoTags, color } = req.body;
    const id = createPrefixedId("fld.");

    try {
      await pool.query(
        `INSERT INTO rag_folders (id, name, auto_tags, builtin, color, owner_id)
         VALUES ($1, $2, $3::jsonb, false, $4, $5)`,
        [id, name, JSON.stringify(autoTags || []), color || "sapphire", req.session?.userId || null]
      );
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.patch("/api/rag-folders/:id", requireSession(), async (req, res) => {
    const { name, color } = req.body;
    const updates = [];
    const values = [];
    let i = 1;

    if (name !== undefined) { updates.push(`name=$${i++}`); values.push(name); }
    if (color !== undefined) { updates.push(`color=$${i++}`); values.push(color); }

    if (updates.length > 0) {
      values.push(req.params.id);
      try {
        await pool.query(
          `UPDATE rag_folders SET ${updates.join(", ")} WHERE id=$${i}`,
          values
        );
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e.message || e) });
      }
    }
    res.json({ ok: true });
  });

  app.delete("/api/rag-folders/:id", requireSession(), async (req, res) => {
    try {
      await pool.query("DELETE FROM rag_folders WHERE id=$1 AND builtin=false", [req.params.id]);
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
