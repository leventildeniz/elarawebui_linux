// Identity schema bootstrap — extracted from server.mjs (Block E.2 Tur 5).
// DI: { pool, allTabIds }
// Exports: initIdentitySchema(deps) → { ensureRbacTable, ensureModelIdentitiesTable }
//
// Two pure schema bootstrappers + Admin tab-permission self-heal:
//   - tab_permissions (RBAC scope→tab list, seeded with role defaults)
//   - model_identities (per-model avatar registry)
//
// Both are idempotent (CREATE IF NOT EXISTS + UPSERT). ensureRbacTable also
// guarantees the Admin row always contains the full ALL_TAB_IDS set so new
// tabs propagate without a manual reseed.

export function initIdentitySchema({ pool, allTabIds }) {
  if (!pool) throw new Error("initIdentitySchema: pool required");
  if (!Array.isArray(allTabIds) || allTabIds.length === 0) {
    throw new Error("initIdentitySchema: allTabIds (non-empty array) required");
  }

  async function ensureRbacTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tab_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_type TEXT NOT NULL,
        scope_id   TEXT NOT NULL,
        allowed_tabs TEXT[] NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(scope_type, scope_id)
      );
    `).catch(() => {});
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM tab_permissions").catch(() => ({ rows: [{ n: 1 }] }));
    if (!rows[0]?.n) {
      const seeds = [
        ["role", "Admin", allTabIds],
        ["role", "Engineer", ["chat","dashboard","knowledge","agents","workflows","tools","skills","models","templates","python","forge","telemetry","reports"]],
        ["role", "Security", ["chat","dashboard","knowledge","policies","security","middleware","telemetry","reports","debug"]],
        ["role", "Operator", ["chat","dashboard","knowledge","agents","workflows","reports"]],
        ["role", "Viewer",   ["chat"]],
      ];
      for (const [t, id, tabs] of seeds) {
        await pool.query(
          `INSERT INTO tab_permissions(scope_type,scope_id,allowed_tabs) VALUES ($1,$2,$3)
           ON CONFLICT (scope_type,scope_id) DO NOTHING`,
          [t, id, tabs]
        ).catch(() => {});
      }
    }
    // Idempotent: Admin satırı her zaman tüm tab'ları içermeli (yeni tablar geldikçe genişler).
    await pool.query(
      `UPDATE tab_permissions SET allowed_tabs=$1, updated_at=now()
       WHERE scope_type='role' AND scope_id='Admin'
         AND NOT (allowed_tabs @> $1::text[])`,
      [allTabIds]
    ).catch(() => {});
  }

  async function ensureModelIdentitiesTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS model_identities (
        name        text PRIMARY KEY,
        avatar_url  text NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  return { ensureRbacTable, ensureModelIdentitiesTable };
}
