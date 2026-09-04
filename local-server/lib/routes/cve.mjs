import { requireSession } from "../session-gate.mjs";

export async function mountCveRoutes(app, deps) {
  const { pool, broadcastAudit, enqueueWrite } = deps;
  const admin = requireSession();

  const emitCveLog = (level, action, message, meta = {}) => {
    const fullMeta = { tag: "cve", stream: "policy", ...meta };
    if (broadcastAudit) {
      try {
        broadcastAudit({
          agent: "cve",
          level,
          message: `cve.${action}: ${message}`,
          meta: fullMeta,
        });
      } catch (err) {
        console.warn("[cve] broadcastAudit notice:", err.message);
      }
    }
    if (enqueueWrite) {
      try {
        enqueueWrite(
          `INSERT INTO agent_logs(agent, level, message, meta) VALUES ($1,$2,$3,$4)`,
          ["cve", level, `cve.${action}:${message}`, fullMeta]
        );
      } catch (err) {
        console.warn("[cve] enqueueWrite notice:", err.message);
      }
    }
  };

  // --- GET ALL CVE DATA ---
  app.get("/api/cve", admin, async (req, res) => {
    try {
      const [sourcesRes, watchlistsRes, entriesRes] = await Promise.all([
        pool.query("SELECT * FROM cve_sources ORDER BY id"),
        pool.query("SELECT * FROM cve_watchlists ORDER BY name"),
        pool.query("SELECT * FROM cve_entries ORDER BY published_at DESC LIMIT 500")
      ]);

      // Map to UI format
      const sources = sourcesRes.rows.map(s => ({
        id: s.id,
        enabled: s.enabled,
        provider: s.provider,
        label: s.label,
        watchlist: s.watchlist,
        ecosystem: s.ecosystem,
        query: s.query,
        version: s.version,
        url: s.url,
        headers: s.headers,
        map: s.map || {},
        defaultScore: Number(s.default_score),
        minScore: Number(s.min_score),
        lastSyncAt: s.last_sync_at ? new Date(s.last_sync_at).getTime() : null,
        lastResult: s.last_result || ""
      }));

      const watchlists = watchlistsRes.rows.map(w => ({
        id: w.id,
        name: w.name,
        tone: w.tone,
        components: w.components || []
      }));

      const entries = entriesRes.rows.map(e => ({
        id: e.id,
        cve: e.cve,
        title: e.title,
        summary: e.summary,
        score: Number(e.score),
        severity: e.severity,
        watchlist: e.watchlist,
        component: e.component,
        version: e.version,
        fixedIn: e.fixed_in,
        vector: e.vector,
        reference: e.reference,
        affected: e.affected || [],
        status: e.status,
        note: e.note || "",
        origin: e.origin,
        sourceId: e.source_id,
        publishedAt: e.published_at ? new Date(e.published_at).getTime() : 0,
        ingestedAt: e.ingested_at ? new Date(e.ingested_at).getTime() : 0
      }));

      res.json({ ok: true, sources, watchlists, entries });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- CRUD SOURCES ---
  app.post("/api/cve/sources", admin, async (req, res) => {
    try {
      const s = req.body;
      const { rows } = await pool.query(
        `INSERT INTO cve_sources 
         (id, enabled, provider, label, watchlist, ecosystem, query, version, url, headers, map, default_score, min_score, last_sync_at, last_result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [s.id, s.enabled, s.provider, s.label, s.watchlist, s.ecosystem || "", s.query || "", s.version || "", s.url || "", s.headers || "", s.map || {}, s.defaultScore || 0, s.minScore || 0, s.lastSyncAt ? new Date(s.lastSyncAt) : null, s.lastResult || ""]
      );
      emitCveLog("info", "source.created", `${s.label || s.id} (${s.provider})`, { id: s.id, provider: s.provider });
      res.json({ ok: true, source: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/cve/sources/:id", admin, async (req, res) => {
    try {
      const s = req.body;
      // We only update provided fields, dynamically building the query
      const updates = [];
      const values = [];
      let idx = 1;

      for (const key of ['enabled', 'provider', 'label', 'watchlist', 'ecosystem', 'query', 'version', 'url', 'headers', 'map', 'defaultScore', 'minScore', 'lastSyncAt', 'lastResult']) {
        if (s[key] !== undefined) {
          const colName = key.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase());
          updates.push(`${colName}=$${idx++}`);
          if (key === 'lastSyncAt') values.push(s[key] ? new Date(s[key]) : null);
          else values.push(s[key]);
        }
      }

      if (updates.length === 0) return res.json({ ok: true });

      values.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE cve_sources SET ${updates.join(", ")} WHERE id=$${idx} RETURNING *`,
        values
      );
      res.json({ ok: true, source: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/cve/sources/:id", admin, async (req, res) => {
    try {
      await pool.query("DELETE FROM cve_sources WHERE id=$1", [req.params.id]);
      emitCveLog("warn", "source.deleted", `id=${req.params.id}`, { id: req.params.id });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- CRUD WATCHLISTS ---
  app.post("/api/cve/watchlists", admin, async (req, res) => {
    try {
      const w = req.body;
      const { rows } = await pool.query(
        "INSERT INTO cve_watchlists (id, name, tone, components) VALUES ($1, $2, $3, $4) RETURNING *",
        [w.id, w.name, w.tone, w.components || []]
      );
      res.json({ ok: true, watchlist: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/cve/watchlists/:id", admin, async (req, res) => {
    try {
      const { name, tone, components } = req.body;
      const { rows } = await pool.query(
        "UPDATE cve_watchlists SET name=COALESCE($1, name), tone=COALESCE($2, tone), components=COALESCE($3, components) WHERE id=$4 RETURNING *",
        [name, tone, components ? JSON.stringify(components) : null, req.params.id]
      );
      res.json({ ok: true, watchlist: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/cve/watchlists/:id", admin, async (req, res) => {
    try {
      await pool.query("DELETE FROM cve_watchlists WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- CRUD ENTRIES ---
  app.patch("/api/cve/entries/:id", admin, async (req, res) => {
    try {
      const { status, note } = req.body;
      const { rows } = await pool.query(
        "UPDATE cve_entries SET status=COALESCE($1, status), note=COALESCE($2, note) WHERE id=$3 RETURNING *",
        [status, note, req.params.id]
      );
      emitCveLog("info", "entry.status", `advisory=${rows[0]?.cve || req.params.id} status=${status}`, { id: req.params.id, status });
      res.json({ ok: true, entry: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/cve/entries/merge", admin, async (req, res) => {
    try {
      const { incoming } = req.body;
      let added = 0;

      // Note: A more efficient query would be an UPSERT with ON CONFLICT DO NOTHING,
      // but we need to match by origin or cve+watchlist.
      for (const inc of incoming) {
        // Try to insert
        try {
          await pool.query(
            `INSERT INTO cve_entries 
             (id, cve, title, summary, score, severity, watchlist, component, version, fixed_in, vector, reference, affected, status, note, origin, source_id, published_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'new', '', $14, $15, $16)
             ON CONFLICT DO NOTHING`, // Ignore if unique constraint fails
            [
              `cve.${Math.random().toString(36).slice(2, 10)}`, // better id generation
              inc.cve, inc.title, inc.summary, inc.score, inc.severity, inc.watchlist,
              inc.component, inc.version, inc.fixedIn, inc.vector, inc.reference,
              JSON.stringify(inc.affected || []), inc.origin, inc.sourceId, new Date(inc.publishedAt)
            ]
          );
          added++;
        } catch(e) {
          // ignore unique constraint or let it log
          console.error("Failed to insert CVE:", e.message);
        }
      }
      emitCveLog("info", "sync.merge", `ingested ${added} new advisories`, { added });
      res.json({ ok: true, added });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}