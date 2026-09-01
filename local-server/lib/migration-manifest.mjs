// Faz 10 — Migration rollback manifest.
//
// Şema değişimleri sadece ileri gitmesin: her capability/tool/workflow şema
// güncellemesi bir manifest'le birlikte gelir. Manifest, ileri (`up`) ve geri
// (`down`) SQL'i tek dosyada tutar; her uygulanan migration `schema_migrations`
// tablosuna kaydedilir, `down` SQL ile geri alınabilir.
//
// Bu modül schema.sql üstündeki idempotent CREATE'leri değiştirmez; onların
// üstüne capability/tool/workflow için "versionlu" migration kapısı açar.

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id            text PRIMARY KEY,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  description   text,
  up_sql        text NOT NULL,
  down_sql      text NOT NULL,
  checksum      text,
  backup_ref    text
);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC);
`;

export async function ensureMigrationTable(pool) {
  await pool.query(TABLE_SQL);
}

export async function isApplied(pool, id) {
  const { rows } = await pool.query("SELECT 1 FROM schema_migrations WHERE id=$1", [id]);
  return rows.length > 0;
}

/**
 * Apply a migration manifest.
 *   manifest = { id, description, up, down, checksum?, backupRef? }
 * "up" ve "down" SQL string'leri TEK transaction içinde uygulanır.
 * Başarısızlık halinde transaction ROLLBACK olur, schema_migrations'a yazılmaz.
 */
export async function applyMigration(pool, manifest) {
  if (!manifest?.id || !manifest?.up || !manifest?.down) {
    throw new Error("manifest requires { id, up, down }");
  }
  await ensureMigrationTable(pool);
  if (await isApplied(pool, manifest.id)) return { id: manifest.id, skipped: true };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(manifest.up);
    await client.query(
      `INSERT INTO schema_migrations(id,description,up_sql,down_sql,checksum,backup_ref)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [manifest.id, manifest.description ?? null, manifest.up, manifest.down,
       manifest.checksum ?? null, manifest.backupRef ?? null]
    );
    await client.query("COMMIT");
    return { id: manifest.id, applied: true };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Roll back a previously applied migration by id. */
export async function rollbackMigration(pool, id) {
  await ensureMigrationTable(pool);
  const { rows } = await pool.query("SELECT down_sql FROM schema_migrations WHERE id=$1", [id]);
  if (!rows[0]) throw new Error(`migration not found: ${id}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(rows[0].down_sql);
    await client.query("DELETE FROM schema_migrations WHERE id=$1", [id]);
    await client.query("COMMIT");
    return { id, rolled_back: true };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function listMigrations(pool) {
  await ensureMigrationTable(pool);
  const { rows } = await pool.query(
    "SELECT id, description, applied_at, checksum, backup_ref FROM schema_migrations ORDER BY applied_at DESC"
  );
  return rows;
}
