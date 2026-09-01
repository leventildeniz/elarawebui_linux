// /api/graph/* — knowledge graph stats + orphan purge + neighbor lookup.
// Extracted from server.mjs (2026-05-30, ~54 lines).
export function mountGraphRoutes({ app, pool, purgeGraphOrphans, extractEntities }) {
  app.get("/api/graph/stats", async (_req, res) => {
    const e = await pool.query("SELECT COUNT(*)::int n FROM knowledge_entities").catch(()=>({rows:[{n:0}]}));
    const ed = await pool.query("SELECT COUNT(*)::int n FROM knowledge_edges").catch(()=>({rows:[{n:0}]}));
    const orphanEdges = await pool.query(
      `SELECT COUNT(*)::int n
       FROM knowledge_edges ed
       LEFT JOIN knowledge_chunks kc ON kc.id = ed.source_chunk_id
       WHERE ed.source_chunk_id IS NOT NULL AND kc.id IS NULL`
    ).catch(()=>({rows:[{n:0}]}));
    const orphanEntities = await pool.query(
      `SELECT COUNT(*)::int n
       FROM knowledge_entities e
       WHERE NOT EXISTS (
         SELECT 1 FROM knowledge_edges ed WHERE ed.src_id=e.id OR ed.dst_id=e.id
       )`
    ).catch(()=>({rows:[{n:0}]}));
    const top = await pool.query(
      `SELECT e.name, e.type, COUNT(*)::int as degree
       FROM knowledge_entities e
       JOIN knowledge_edges ed ON ed.src_id=e.id OR ed.dst_id=e.id
       GROUP BY e.id, e.name, e.type ORDER BY degree DESC LIMIT 20`
    ).catch(()=>({rows:[]}));
    res.json({ ok: true, entities: e.rows[0].n, edges: ed.rows[0].n, orphanEntities: orphanEntities.rows[0].n, orphanEdges: orphanEdges.rows[0].n, top: top.rows });
  });

  app.post("/api/graph/purge-orphans", async (_req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const graph = await purgeGraphOrphans(client);
      await client.query("COMMIT");
      res.json({ ok: true, removedEdges: graph.removedEdges, removedEntities: graph.removedEntities });
    } catch (e) {
      await client.query("ROLLBACK").catch(()=>{});
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    } finally {
      client.release();
    }
  });

  app.post("/api/graph/neighbors", async (req, res) => {
    const { query } = req.body || {};
    const ents = extractEntities(String(query || ""));
    if (!ents.length) return res.json({ ok: true, entities: [], chunks: [] });
    const canonicals = ents.map(e => e.canonical);
    const r = await pool.query(
      `SELECT DISTINCT kc.id, kc.path, kc.brand, kc.source_type, kc.version, kc.content
       FROM knowledge_entities ke
       JOIN knowledge_edges kg ON kg.src_id=ke.id OR kg.dst_id=ke.id
       JOIN knowledge_chunks kc ON kc.id=kg.source_chunk_id
       WHERE ke.canonical = ANY($1::text[])
       LIMIT 12`,
      [canonicals]
    ).catch(()=>({rows:[]}));
    res.json({ ok: true, entities: ents, chunks: r.rows });
  });
}
