// lib/knowledge/maintenance.mjs
// Tur B (2026-05-30): cleanupKnowledgeGhosts + syncCanonicalLibraryPaths + seedForgeLibrary
// server.mjs'ten ayrıştırıldı. Factory: createKnowledgeMaintenance({deps})
import fs from "fs";
import path from "path";

export function createKnowledgeMaintenance(deps) {
  const {
    pool,
    migrateReady,
    ensureKnowledgeFilesTable,
    ensureKnowledgeChunksTable,
    normalizeDirRoot,
    rootOrPathUnderRootExpr,
    purgeLegacyKnowledgeTables,
    purgeGraphOrphans,
    tableHasColumn,
    getDefaultLibraryRoot,
    SYSTEM_ACTIONS,
    SYS_DISK_TOOLS,
    serverDirname,
  } = deps;

  async function cleanupKnowledgeGhosts({ staleOnly = true, deepFileCheck = false } = {}) {
    void staleOnly;
    await ensureKnowledgeFilesTable();
    await ensureKnowledgeChunksTable();
    const report = {
      removedFiles: 0,
      removedChunks: 0,
      removedSources: 0,
      removedDocuments: 0,
      removedEmbeddings: 0,
      removedEmptySources: 0,
      removedRoots: [],
      nestedRootsPurged: [],
      checkedRoots: 0,
      missingFilesRemoved: 0,
    };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = 0").catch(() => {});

      const rootsRes = await client.query(
        `SELECT DISTINCT root FROM knowledge_files WHERE root IS NOT NULL AND root <> ''`
      );
      for (const row of rootsRes.rows) {
        report.checkedRoots++;
        const r = normalizeDirRoot(row.root);
        if (!r) continue;
        let exists = false;
        try { exists = fs.existsSync(r) && (await fs.promises.stat(r)).isDirectory(); }
        catch { exists = false; }
        if (exists) continue;
        const pc = await client.query(`DELETE FROM knowledge_chunks WHERE ${rootOrPathUnderRootExpr("root", "path")}`, [r]);
        const pf = await client.query(`DELETE FROM knowledge_files WHERE ${rootOrPathUnderRootExpr("root", "path")}`, [r]);
        const legacy = await purgeLegacyKnowledgeTables(client, r).catch(() => ({ documents: { removed: 0 }, embeddings: { removed: 0 } }));
        report.removedChunks += pc.rowCount || 0;
        report.removedFiles += pf.rowCount || 0;
        report.removedDocuments += legacy.documents?.removed || 0;
        report.removedEmbeddings += legacy.embeddings?.removed || 0;
        if ((pc.rowCount || pf.rowCount) > 0) {
          report.removedRoots.push(r);
          console.log(`[knowledge:cleanup:missing-root] root=${r} files=${pf.rowCount || 0} chunks=${pc.rowCount || 0}`);
        }
      }

      if (deepFileCheck) {
        const filesRes = await client.query(
          `SELECT id, root, path FROM knowledge_files WHERE root IS NOT NULL AND root <> '' AND path IS NOT NULL AND path <> ''`
        );
        const missingIds = [];
        for (const row of filesRes.rows) {
          const r = normalizeDirRoot(row.root);
          const p = String(row.path || "");
          if (!r || !p) continue;
          const abs = path.isAbsolute(p) ? p : path.join(r, p);
          try { if (fs.existsSync(abs)) continue; } catch { /* fall through */ }
          missingIds.push(row.id);
        }
        if (missingIds.length) {
          const dc = await client.query(`DELETE FROM knowledge_chunks WHERE file_id = ANY($1::text[])`, [missingIds]).catch(() => ({ rowCount: 0 }));
          const df = await client.query(`DELETE FROM knowledge_files  WHERE id      = ANY($1::text[])`, [missingIds]).catch(() => ({ rowCount: 0 }));
          report.removedChunks += dc.rowCount || 0;
          report.removedFiles += df.rowCount || 0;
          report.missingFilesRemoved = df.rowCount || 0;
          console.log(`[knowledge:cleanup:missing-files] files=${df.rowCount || 0} chunks=${dc.rowCount || 0}`);
        }
      }

      const orphanChunks = await client.query(`
        DELETE FROM knowledge_chunks c
         WHERE NOT EXISTS (
           SELECT 1 FROM knowledge_files f
            WHERE f.id = c.file_id OR (f.root = c.root AND f.path = c.path)
         )
           AND NOT EXISTS (
           SELECT 1 FROM knowledge_sources s
            WHERE s.id::text = c.file_id
         )
      `);
      report.removedChunks += orphanChunks.rowCount || 0;
      const graph = await purgeGraphOrphans(client).catch(() => ({ removedEdges: 0, removedEntities: 0 }));
      report.removedGraphEdges = graph.removedEdges;
      report.removedGraphEntities = graph.removedEntities;

      await client.query("COMMIT");
      return report;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async function syncCanonicalLibraryPaths() {
    await ensureKnowledgeFilesTable();
    await ensureKnowledgeChunksTable();
    const root = getDefaultLibraryRoot().replace(/\/+$/, "");
    const mapExpr = `CASE
      WHEN path LIKE $1 || '/%' THEN path
      WHEN path LIKE '%/library/%' THEN $1 || '/' || split_part(path, '/library/', 2)
      WHEN path LIKE '/%' THEN $1 || '/' || regexp_replace(path, '^.*/', '')
      ELSE $1 || '/' || regexp_replace(path, '^/+', '')
    END`;
    const client = await pool.connect();
    let files = { rowCount: 0 };
    let chunks = { rowCount: 0 };
    let documents = { exists: false, updated: 0 };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = 0").catch(() => {});
      files = await client.query(`
        WITH mapped AS (
          SELECT ctid, ${mapExpr} AS new_path FROM knowledge_files WHERE path IS NOT NULL
        ), dedup AS (
          SELECT ctid, new_path, row_number() OVER (PARTITION BY new_path ORDER BY ctid DESC) AS rn FROM mapped
        )
        UPDATE knowledge_files k
           SET root=$1, path=d.new_path
          FROM dedup d
         WHERE k.ctid=d.ctid AND d.rn=1
           AND NOT EXISTS (SELECT 1 FROM knowledge_files x WHERE x.root=$1 AND x.path=d.new_path AND x.ctid<>k.ctid)
           AND (k.root IS DISTINCT FROM $1 OR k.path IS DISTINCT FROM d.new_path)
      `, [root]).catch((e) => ({ rowCount: 0, error: e.message }));
      chunks = await client.query(`
        WITH mapped AS (
          SELECT ctid, ${mapExpr} AS new_path FROM knowledge_chunks WHERE path IS NOT NULL
        )
        UPDATE knowledge_chunks k
           SET root=$1, path=m.new_path
          FROM mapped m
         WHERE k.ctid=m.ctid
           AND (k.root IS DISTINCT FROM $1 OR k.path IS DISTINCT FROM m.new_path)
      `, [root]).catch((e) => ({ rowCount: 0, error: e.message }));

      if (await tableHasColumn("documents", "path").catch(() => false)) {
        const hasRoot = await tableHasColumn("documents", "root").catch(() => false);
        const r = await client.query(hasRoot ? `
          WITH mapped AS (
            SELECT ctid, ${mapExpr} AS new_path FROM documents WHERE path IS NOT NULL
          ), dedup AS (
            SELECT ctid, new_path, row_number() OVER (PARTITION BY new_path ORDER BY ctid DESC) AS rn FROM mapped
          )
          UPDATE documents d
             SET root=$1, path=m.new_path
            FROM dedup m
           WHERE d.ctid=m.ctid AND m.rn=1
             AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.root=$1 AND x.path=m.new_path AND x.ctid<>d.ctid)
             AND (d.root IS DISTINCT FROM $1 OR d.path IS DISTINCT FROM m.new_path)
        ` : `
          WITH mapped AS (
            SELECT ctid, ${mapExpr} AS new_path FROM documents WHERE path IS NOT NULL
          ), dedup AS (
            SELECT ctid, new_path, row_number() OVER (PARTITION BY new_path ORDER BY ctid DESC) AS rn FROM mapped
          )
          UPDATE documents d
             SET path=m.new_path
            FROM dedup m
           WHERE d.ctid=m.ctid AND m.rn=1
             AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.path=m.new_path AND x.ctid<>d.ctid)
             AND d.path IS DISTINCT FROM m.new_path
        `, [root]).catch((e) => ({ rowCount: 0, error: e.message }));
        documents = { exists: true, updated: r.rowCount || 0, error: r.error };
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const report = { root, filesUpdated: files.rowCount || 0, chunksUpdated: chunks.rowCount || 0, documents };
    global.__lastLibraryPathSync = { ...report, ts: Date.now() };
    return report;
  }

  async function seedForgeLibrary() {
    try {
      await migrateReady;
      await pool.query(`CREATE TABLE IF NOT EXISTS action_seed_skip (id text PRIMARY KEY, deleted_at timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`ALTER TABLE action_library ADD COLUMN IF NOT EXISTS system_prompt text NOT NULL DEFAULT ''`).catch(() => {});
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS capability_pack_id text`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_agents_capability_pack ON agents(capability_pack_id) WHERE capability_pack_id IS NOT NULL`).catch(() => {});
      await pool.query(`ALTER TABLE capability_packs ADD COLUMN IF NOT EXISTS skill_ids jsonb NOT NULL DEFAULT '[]'::jsonb`).catch(() => {});
      await pool.query(`ALTER TABLE capability_packs ADD COLUMN IF NOT EXISTS default_model text`).catch(() => {});
      await pool.query(`ALTER TABLE capability_packs ADD COLUMN IF NOT EXISTS default_interpreter_path text`).catch(() => {});
      await pool.query(`ALTER TABLE capability_packs ADD COLUMN IF NOT EXISTS brand_keywords jsonb NOT NULL DEFAULT '[]'::jsonb`).catch(() => {});
      await pool.query(`ALTER TABLE capability_packs ADD COLUMN IF NOT EXISTS system_prompt text NOT NULL DEFAULT ''`).catch(() => {});
      await pool.query(`ALTER TABLE skills ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT ''`).catch(() => {});
      await pool.query(`ALTER TABLE skills ADD COLUMN IF NOT EXISTS interpreter_path text NOT NULL DEFAULT ''`).catch(() => {});
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agent_capability_packs (
          agent_id   text NOT NULL,
          pack_id    text NOT NULL REFERENCES capability_packs(id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (agent_id, pack_id)
        )`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_acp_agent ON agent_capability_packs(agent_id)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_acp_pack  ON agent_capability_packs(pack_id)`).catch(() => {});
      await pool.query(`
        INSERT INTO agent_capability_packs(agent_id, pack_id)
        SELECT a.id, a.capability_pack_id
          FROM agents a
         WHERE a.capability_pack_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM capability_packs cp WHERE cp.id = a.capability_pack_id)
        ON CONFLICT DO NOTHING`).catch(() => {});
      const { rows: skipRows } = await pool.query(`SELECT id FROM action_seed_skip`);
      const skip = new Set(skipRows.map(r => r.id));
      let inserted = 0;
      for (const a of SYSTEM_ACTIONS) {
        if (skip.has(a.id)) continue;
        const runtime = { ...(a.runtime || {}) };
        if (runtime.handler === "python" && runtime.script && !path.isAbsolute(runtime.script)) {
          runtime.script = path.join(serverDirname, runtime.script);
        }
        await pool.query(
          `INSERT INTO action_library(id, kind, name, category, provider, icon, color, description, params, outputs, runtime, is_system, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true, now())
           ON CONFLICT (id) DO NOTHING`,
          [a.id, a.kind, a.name, a.category, a.provider || "", a.icon || "Zap", a.color || "#06b6d4",
           a.description || "", JSON.stringify(a.params), JSON.stringify(a.outputs), JSON.stringify(runtime)]
        );
        inserted++;
      }
      for (const [sysSlug, rel] of Object.entries(SYS_DISK_TOOLS)) {
        const abs = path.join(serverDirname, rel);
        const newRuntime = { handler: "python", script: abs };
        await pool.query(
          `UPDATE action_library
              SET runtime = $2::jsonb, updated_at = now()
            WHERE id = $1
              AND COALESCE(is_system, false) = true
              AND (runtime->>'handler') IN ('builtin','noop')`,
          [sysSlug, JSON.stringify(newRuntime)]
        ).catch((e) => console.warn(`[forge] disk-bind backfill failed for ${sysSlug}:`, e.message));
      }
      console.log(`[forge] seeded ${inserted} system actions (${skip.size} skipped); disk-bind backfill checked`);
    } catch (e) { console.error("[forge] seed failed:", e.message); }
  }

  return { cleanupKnowledgeGhosts, syncCanonicalLibraryPaths, seedForgeLibrary };
}
