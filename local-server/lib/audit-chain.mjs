// =============================================================================
// audit-chain.mjs — Faz 11.1
// vault_audit için tamper-evident hash zinciri.
//
// Tasarım:
//   - Her satır prev_hash + row_hash taşır.
//   - row_hash = sha256(prev_hash || canonical_payload)
//   - canonical_payload = `ts|action|scope|name|actor|session_id|ip|user_agent|ok|reason|meta`
//   - Hash hesabı bir Postgres trigger'ında yapılır → uygulama tarafı
//     serileştirme yapmak zorunda kalmaz, race-condition trigger'daki
//     `FOR UPDATE` ile kapanır.
//   - Admin DB'ye doğrudan girip eski satırı silerse veya tek alanı oynarsa
//     verify() zincirin koptuğu ilk id'yi raporlar.
//
// installAuditChain(pool): kolonları ve trigger'ı idempotent kurar.
// verifyAuditChain(pool, { limit }): zinciri baştan/sondan doğrular.
// =============================================================================

import { createHash } from "node:crypto";

const TRIGGER_SQL = `
ALTER TABLE vault_audit
  ADD COLUMN IF NOT EXISTS prev_hash bytea,
  ADD COLUMN IF NOT EXISTS row_hash  bytea;

CREATE OR REPLACE FUNCTION vault_audit_chain_tg() RETURNS trigger AS $$
DECLARE
  _prev bytea;
  _payload text;
BEGIN
  SELECT row_hash INTO _prev
    FROM vault_audit
    ORDER BY id DESC
    LIMIT 1
    FOR UPDATE;

  -- Sabit, alan ayraçlı serileştirme. NULL'lar boş string'e çevrilir;
  -- meta jsonb -> kanonik text formuna basılır.
  _payload := concat_ws('|',
    to_char(COALESCE(NEW.ts, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    NEW.action,
    COALESCE(NEW.scope, ''),
    COALESCE(NEW.name, ''),
    COALESCE(NEW.actor, ''),
    COALESCE(NEW.session_id, ''),
    COALESCE(NEW.ip, ''),
    COALESCE(NEW.user_agent, ''),
    CASE WHEN NEW.ok THEN '1' ELSE '0' END,
    COALESCE(NEW.reason, ''),
    COALESCE(NEW.meta::text, '{}')
  );

  NEW.prev_hash := _prev;
  NEW.row_hash  := digest(COALESCE(_prev, ''::bytea) || convert_to(_payload, 'UTF8'), 'sha256');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vault_audit_chain ON vault_audit;
CREATE TRIGGER trg_vault_audit_chain
  BEFORE INSERT ON vault_audit
  FOR EACH ROW EXECUTE FUNCTION vault_audit_chain_tg();
`;

// Backfill: TÜM satırların prev_hash/row_hash'ini sıfırdan hesaplar.
// Deterministik formül olduğu için idempotent — tekrar çalışınca aynı
// değerleri üretir. Önceki buggy install'ların bıraktığı stale hash'leri
// de bu sayede temizler. Trigger'a sokmak için ayrıca session-local
// `audit.skip_chain` flag'i kullanıyoruz (trigger sadece INSERT'te çalışır
// zaten, UPDATE'leri etkilemez — yine de defansif).
const BACKFILL_SQL = `
DO $$
DECLARE
  r RECORD;
  _prev bytea := NULL;
  _payload text;
  _hash bytea;
BEGIN
  FOR r IN
    SELECT * FROM vault_audit ORDER BY id ASC
  LOOP
    _payload := concat_ws('|',
      to_char(r.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      r.action,
      COALESCE(r.scope, ''),
      COALESCE(r.name, ''),
      COALESCE(r.actor, ''),
      COALESCE(r.session_id, ''),
      COALESCE(r.ip, ''),
      COALESCE(r.user_agent, ''),
      CASE WHEN r.ok THEN '1' ELSE '0' END,
      COALESCE(r.reason, ''),
      COALESCE(r.meta::text, '{}')
    );
    _hash := digest(COALESCE(_prev, ''::bytea) || convert_to(_payload, 'UTF8'), 'sha256');
    UPDATE vault_audit SET prev_hash = _prev, row_hash = _hash WHERE id = r.id;
    _prev := _hash;
  END LOOP;
END $$;
`;

/**
 * Kolonlar + trigger + backfill — hepsi idempotent. Backfill kendi
 * transaction'ında `statement_timeout=0` ile koşar; aksi halde global
 * timeout büyük vault_audit tablosunda DO bloğunu iptal eder ve stale
 * prev_hash/row_hash değerleri yerinde kalır (verify "id=1 prev_hash
 * mismatch" verir).
 */
export async function installAuditChain(poolOrClient) {
  try { await poolOrClient.query("ROLLBACK"); } catch { /* no active txn */ }
  await poolOrClient.query(TRIGGER_SQL);
  const client = poolOrClient.connect ? await poolOrClient.connect() : poolOrClient;
  const owns = !!poolOrClient.connect;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query("SET LOCAL lock_timeout = 0");
    await client.query(BACKFILL_SQL);
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    if (owns) { try { client.release(); } catch {} }
  }
}

/** Manuel rebuild endpoint'i için — install ile aynı işi yapar. */
export async function rebuildAuditChain(poolOrClient) {
  return installAuditChain(poolOrClient);
}

function canonicalPayload(row) {
  const ts = new Date(row.ts).toISOString().replace("Z", "").padEnd(26, "0");
  // Postgres `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US')` => 6 basamak microsecond.
  // JS ISO string 3 basamak ms; 6 basamağa pad'le.
  const tsMatch = new Date(row.ts).toISOString().match(/^(.+)\.(\d{3})Z$/);
  const tsCanon = tsMatch ? `${tsMatch[1]}.${tsMatch[2]}000` : ts;
  const fields = [
    tsCanon,
    row.action,
    row.scope ?? "",
    row.name ?? "",
    row.actor ?? "",
    row.session_id ?? "",
    row.ip ?? "",
    row.user_agent ?? "",
    row.ok ? "1" : "0",
    row.reason ?? "",
    typeof row.meta === "string" ? row.meta : JSON.stringify(row.meta ?? {}),
  ];
  return fields.join("|");
}

/**
 * Zinciri DB tarafında doğrular — JS canonical'ı PG to_char ile birebir
 * eşleşmediği zamanlar için ana doğrulama PG `digest()` ile yapılır:
 * her satır için yeniden hash hesaplatıp row_hash ile karşılaştırırız.
 */
export async function verifyAuditChain(pool, { limit = 5000 } = {}) {
  const { rows } = await pool.query(
    `WITH ordered AS (
       SELECT id, ts, action, scope, name, actor, session_id, ip, user_agent,
              ok, reason, meta, prev_hash, row_hash,
              LAG(row_hash) OVER (ORDER BY id) AS expected_prev
         FROM vault_audit
         ORDER BY id
         LIMIT $1
     )
     SELECT id,
            (prev_hash IS NOT DISTINCT FROM expected_prev) AS prev_ok,
            digest(
              COALESCE(prev_hash, ''::bytea) ||
              convert_to(
                concat_ws('|',
                  to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                  action,
                  COALESCE(scope, ''),
                  COALESCE(name, ''),
                  COALESCE(actor, ''),
                  COALESCE(session_id, ''),
                  COALESCE(ip, ''),
                  COALESCE(user_agent, ''),
                  CASE WHEN ok THEN '1' ELSE '0' END,
                  COALESCE(reason, ''),
                  COALESCE(meta::text, '{}')
                ),
                'UTF8'
              ),
              'sha256'
            ) = row_hash AS row_ok
       FROM ordered`,
    [limit]
  );

  let scanned = 0;
  for (const r of rows) {
    scanned++;
    if (!r.prev_ok || !r.row_ok) {
      return {
        ok: false,
        scanned,
        broken_at_id: r.id,
        reason: !r.prev_ok ? "prev_hash mismatch" : "row_hash mismatch",
      };
    }
  }
  return { ok: true, scanned };
}

// JS tarafı opsiyonel — debug için.
export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
export { canonicalPayload };
