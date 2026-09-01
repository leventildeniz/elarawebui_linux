import { requireSession } from "../session-gate.mjs";
import path from "node:path";

export async function mountRegistryRoutes(app, { pool }) {
  const admin = requireSession();

  // Initialize with dynamic defaults based on actual server path
  const cwd = process.cwd();
  const defaultRoots = {
    agents: [path.join(cwd, "agents").replace(/\\/g, "/")],
    tools: [path.join(cwd, "tools").replace(/\\/g, "/")],
    skills: [path.join(cwd, "skills").replace(/\\/g, "/")]
  };

  app.get("/api/registry", admin, async (req, res) => {
    try {
      let { rows } = await pool.query("SELECT * FROM registry_state WHERE id='singleton'");
      let state = rows[0];

      if (!state) {
        const { rows: inserted } = await pool.query(
          `INSERT INTO registry_state (id, roots) VALUES ('singleton', $1) RETURNING *`,
          [JSON.stringify(defaultRoots)]
        );
        state = inserted[0];
      } else {
        // Legacy Hardcoded path cleanup
        // If it contains the old hardcoded 'levent' paths, fix them automatically
        let needsFix = false;
        const roots = state.roots || {};
        ['agents', 'tools', 'skills'].forEach(kind => {
          if (roots[kind] && roots[kind].some(p => p.includes("levent/ELARA_PROJECT"))) {
            roots[kind] = defaultRoots[kind];
            needsFix = true;
          }
        });
        
        if (needsFix) {
          await pool.query("UPDATE registry_state SET roots=$1 WHERE id='singleton'", [JSON.stringify(roots)]);
          state.roots = roots;
        }
      }

      res.json({
        ok: true,
        roots: state.roots || { agents: [], tools: [], skills: [] },
        disabled: state.disabled || [],
        deleted: state.deleted || [],
        lastScan: state.last_scan || {}
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/registry", admin, async (req, res) => {
    try {
      const { roots, disabled, deleted, lastScan } = req.body;
      const cur = await pool.query("SELECT * FROM registry_state WHERE id='singleton'");
      const state = cur.rows[0] || { roots: {}, disabled: [], deleted: [], last_scan: {} };

      const nextRoots = roots !== undefined ? roots : state.roots;
      const nextDisabled = disabled !== undefined ? disabled : state.disabled;
      const nextDeleted = deleted !== undefined ? deleted : state.deleted;
      const nextLastScan = lastScan !== undefined ? lastScan : state.last_scan;

      const { rows } = await pool.query(
        `UPDATE registry_state 
         SET roots=$1, disabled=$2, deleted=$3, last_scan=$4, updated_at=now()
         WHERE id='singleton' RETURNING *`,
        [JSON.stringify(nextRoots), JSON.stringify(nextDisabled), JSON.stringify(nextDeleted), JSON.stringify(nextLastScan)]
      );

      res.json({ ok: true, state: rows[0] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}