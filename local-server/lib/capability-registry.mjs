// =============================================================================
// capability-registry.mjs — Faz 3
// Unified registry for skills / tools / agents. Tek tablo (`capabilities`) bu
// üç dünyayı eşler. Mevcut `skills` / `action_library` / `app_agents` kayıtları
// canonical kaynak olarak kalır; bu modül onları sync edip `capabilities`
// üstünden tek bir lookup yüzeyi sunar.
// =============================================================================

let _pool = null;
export function initCapabilityRegistry(pool) { _pool = pool; _colCache.clear(); }

// Cache: "table.column" -> boolean. Tek seferlik information_schema lookup,
// kolon yoksa sorgu hiç denenmeden atlanır (log gürültüsü olmaz).
const _colCache = new Map();
async function hasColumn(client, table, column) {
  const key = `${table}.${column}`;
  if (_colCache.has(key)) return _colCache.get(key);
  const { rowCount } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2
      LIMIT 1`,
    [table, column]
  );
  const exists = rowCount > 0;
  _colCache.set(key, exists);
  return exists;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "cap";
}

async function ensureUniqueSlug(client, desired, excludeId = null) {
  let base = slugify(desired);
  let s = base;
  let i = 2;
  while (true) {
    const q = excludeId
      ? `SELECT 1 FROM capabilities WHERE lower(slug)=lower($1) AND id<>$2`
      : `SELECT 1 FROM capabilities WHERE lower(slug)=lower($1)`;
    const args = excludeId ? [s, excludeId] : [s];
    const { rowCount } = await client.query(q, args);
    if (!rowCount) return s;
    s = `${base}-${i++}`;
    if (i > 50) return `${base}-${Date.now().toString(36)}`;
  }
}

// Mevcut tabloları capabilities tablosuna upsert eder.
export async function syncCapabilitiesFromSources() {
  if (!_pool) throw new Error("capability-registry not initialized");
  const client = await _pool.connect();
  let counts = { skills: 0, tools: 0, agents: 0 };
  // SAVEPOINT helper: kaynak tablo yoksa veya satır başına bir hata olursa
  // tx'i abort etmesin; sadece o satır/blok atlansın.
  async function withSavepoint(name, fn) {
    await client.query(`SAVEPOINT ${name}`);
    try { await fn(); await client.query(`RELEASE SAVEPOINT ${name}`); }
    catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
      console.warn(`[capabilities] ${name} skipped: ${String(e?.message || e).slice(0, 200)}`);
    }
  }
  try {
    await client.query("BEGIN");

    // Skills
    await withSavepoint("sp_skills", async () => {
      const hasEnabled = await hasColumn(client, "skills", "enabled");
      const enabledExpr = hasEnabled ? "enabled" : "TRUE AS enabled";
      const skillsRes = await client.query(
        `SELECT id, COALESCE(NULLIF(slug,''), name) AS hint, name, description,
                COALESCE(tags, '{}'::text[]) AS tags, ${enabledExpr}
           FROM skills`
      );
      for (const r of skillsRes.rows) {
        const id = `skill:${r.id}`;
        await withSavepoint(`sp_skill_${counts.skills}`, async () => {
          const slug = await ensureUniqueSlug(client, r.hint || r.name, id);
          await client.query(
            `INSERT INTO capabilities(id,kind,ref_id,slug,name,description,tags,enabled,updated_at)
             VALUES ($1,'skill',$2,$3,$4,$5,$6,COALESCE($7,true),now())
             ON CONFLICT (id) DO UPDATE SET
               slug=EXCLUDED.slug, name=EXCLUDED.name, description=EXCLUDED.description,
               tags=EXCLUDED.tags, enabled=EXCLUDED.enabled, updated_at=now()`,
            [id, r.id, slug, r.name || r.id, r.description || "", r.tags || [], r.enabled]
          );
          counts.skills++;
        });
      }
    });

    // Tools
    await withSavepoint("sp_tools", async () => {
      const toolsRes = await client.query(
        `SELECT id, name, description, COALESCE(tags, '{}'::text[]) AS tags FROM action_library`
      );
      for (const r of toolsRes.rows) {
        const id = `tool:${r.id}`;
        await withSavepoint(`sp_tool_${counts.tools}`, async () => {
          const slug = await ensureUniqueSlug(client, r.name || r.id, id);
          await client.query(
            `INSERT INTO capabilities(id,kind,ref_id,slug,name,description,tags,enabled,updated_at)
             VALUES ($1,'tool',$2,$3,$4,$5,$6,true,now())
             ON CONFLICT (id) DO UPDATE SET
               slug=EXCLUDED.slug, name=EXCLUDED.name, description=EXCLUDED.description,
               tags=EXCLUDED.tags, updated_at=now()`,
            [id, r.id, slug, r.name || r.id, r.description || "", r.tags || []]
          );
          counts.tools++;
        });
      }
    });

    // Agents
    await withSavepoint("sp_agents", async () => {
      const agentsRes = await client.query(
        `SELECT id, COALESCE(name, agent_name, id) AS name, COALESCE(description,'') AS description FROM app_agents`
      );
      for (const r of agentsRes.rows) {
        const id = `agent:${r.id}`;
        await withSavepoint(`sp_agent_${counts.agents}`, async () => {
          const slug = await ensureUniqueSlug(client, r.name || r.id, id);
          await client.query(
            `INSERT INTO capabilities(id,kind,ref_id,slug,name,description,tags,enabled,updated_at)
             VALUES ($1,'agent',$2,$3,$4,$5,'{}'::text[],true,now())
             ON CONFLICT (id) DO UPDATE SET
               slug=EXCLUDED.slug, name=EXCLUDED.name, description=EXCLUDED.description,
               updated_at=now()`,
            [id, r.id, slug, r.name || r.id, r.description]
          );
          counts.agents++;
        });
      }
    });

    // Migration ledger
    await withSavepoint("sp_ledger", async () => {
      await client.query(
        `INSERT INTO capability_migrations(version,name)
           VALUES (12,'unified-capabilities-registry')
         ON CONFLICT (version) DO NOTHING`
      );
    });

    await client.query("COMMIT");
    return counts;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function findCapabilityBySlug(slug) {
  if (!_pool) return null;
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return null;
  const { rows } = await _pool.query(
    `SELECT * FROM capabilities WHERE lower(slug)=$1 AND enabled=true LIMIT 1`,
    [s]
  );
  return rows[0] || null;
}

export async function findCapabilityByToolRef(filename) {
  // @[x.py] -> tool whose ref_id matches filename or name matches basename
  if (!_pool) return null;
  const f = String(filename || "").trim();
  if (!f) return null;
  const { rows } = await _pool.query(
    `SELECT c.* FROM capabilities c
      WHERE c.kind='tool' AND c.enabled=true
        AND (lower(c.name)=lower($1) OR lower(c.slug)=lower($2) OR c.ref_id=$1)
      LIMIT 1`,
    [f, slugify(f)]
  );
  return rows[0] || null;
}

export async function listCapabilities({ kind = null, enabledOnly = true } = {}) {
  if (!_pool) return [];
  const where = [];
  const args = [];
  if (kind) { args.push(kind); where.push(`kind=$${args.length}`); }
  if (enabledOnly) where.push(`enabled=true`);
  const sql = `SELECT * FROM capabilities${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY kind, name`;
  const { rows } = await _pool.query(sql, args);
  return rows;
}
