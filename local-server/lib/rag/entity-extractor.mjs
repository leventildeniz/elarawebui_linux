// lib/rag/entity-extractor.mjs — NER Upsert / Edge Linker
// Extracted from server.mjs.
// 2026-08: S.A.R.P. Operation - Hardcoded vendor/brand regex lists removed.
// System relies strictly on HyDE + Semantic Vectors + Agent Delegation as architected.

let _pool = null;

export function initEntityExtractor({ pool }) {
  _pool = pool;
}

// Deterministic generic entity extractor (IP, CVE). 
// Vendor/brand lists have been completely wiped. The LLM / HyDE will handle semantic routing.
export function extractEntities(text) {
  const found = new Map();
  const add = (name, type, metadata = {}) => {
    const canonical = String(name).trim().toLowerCase().replace(/\s+/g, "");
    if (!canonical || canonical.length < 2) return;
    const key = `${type}:${canonical}`;
    if (!found.has(key)) found.set(key, { name: String(name).trim(), type, canonical, metadata });
  };
  
  const t = String(text || "");
  
  // Sadece temel ağ / güvenlik objeleri (opsiyonel tutuldu, vendor listesi SİLİNDİ)
  for (const m of t.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g)) add(m[0], "ip");
  for (const m of t.matchAll(/\bCVE-\d{4}-\d{4,7}\b/gi)) add(m[0].toUpperCase(), "cve");
  
  return Array.from(found.values()).slice(0, 80);
}

export async function upsertEntity(client, e) {
  const r = await client.query(
    `INSERT INTO knowledge_entities(name, type, canonical, metadata)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (canonical, type) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [e.name, e.type, e.canonical, e.metadata || {}]
  );
  return r.rows[0].id;
}

export async function linkEntitiesForChunk(chunkId, content) {
  const ents = extractEntities(content);
  if (ents.length < 1) return 0;
  const client = await _pool.connect();
  try {
    await client.query("BEGIN");
    const ids = [];
    for (const e of ents) ids.push(await upsertEntity(client, e));
    const cap = Math.min(ids.length, 25);
    for (let i = 0; i < cap; i++) {
      for (let j = i + 1; j < cap; j++) {
        // Updated to use the correct table for edges according to schema
        await client.query(
          `INSERT INTO knowledge_relations(source, target, type, weight)
           VALUES ($1,$2,'mentioned_with',1.0) ON CONFLICT DO NOTHING`,
          [ids[i], ids[j]]
        );
      }
      
      await client.query(
        `INSERT INTO knowledge_entity_mentions(chunk_id, entity_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [chunkId, ids[i]]
      );
    }
    await client.query("COMMIT");
    return ents.length;
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[linkEntities]", e?.message || e);
    return 0;
  } finally {
    client.release();
  }
}

export async function purgeGraphOrphans(client) {
  let removedEdges = 0;
  let removedEntities = 0;
  try {
    const edel = await client.query(`
      DELETE FROM knowledge_entity_mentions ed 
      WHERE ed.chunk_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM knowledge_chunks kc WHERE kc.id = ed.chunk_id)
    `);
    removedEdges = edel.rowCount || 0;
    
    const endel = await client.query(`
      DELETE FROM knowledge_entities e 
      WHERE NOT EXISTS (SELECT 1 FROM knowledge_entity_mentions ed WHERE ed.entity_id=e.id)
    `);
    removedEntities = endel.rowCount || 0;
  } catch(e) {
    console.error("[purgeGraphOrphans]", e?.message || e);
  }
  return { removedEdges, removedEntities };
}

