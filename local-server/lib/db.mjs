// lib/db.mjs — DB bootstrap layer (extracted from server.mjs, Block E.2 Tur 1, 2026-05-30).
//
// Saf bootstrap katmanı: DATABASE_URL bekleme + ELARA sovereign normalize +
// pg Pool kurulumu + waitForDatabaseReady probe + pool error handler.
//
// HİÇBİR business logic burada YOK — sadece bağlantı sağlama. `migrate()` ve
// `ensure*` fonksiyonları kendi domain modüllerine ait (knowledge/agents/rbac);
// onlar ayrı bloklarda taşınacak.
//
// API:
//   bootstrapDatabase({ initialUrl, dbName?, forbiddenDbNames?, env? })
//     → { pool, databaseUrl, dbName }
//   waitForDatabaseReady(pool, { dbName, maxAttempts?, delayMs? })
//   attachPoolErrorHandler(pool, { onError? })
//
// Tüm console output orijinal server.mjs ile birebir aynı (boot loglarını
// koruyoruz; davranış değişmez).

import pg from "pg";

const { Pool } = pg;

const DEFAULT_FORBIDDEN = new Set([
  "openwebui",
  "open_webui",
  "typingmind",
  "anythingllm",
  "ollama",
]);

// --- 1) DATABASE_URL bekleme ------------------------------------------------
async function waitForDatabaseUrl({ initialUrl = null, env = process.env, maxAttempts, delayMs } = {}) {
  const tries = Number(maxAttempts ?? env.DB_BOOT_MAX_ATTEMPTS ?? 60);
  const wait  = Number(delayMs    ?? env.DB_BOOT_RETRY_MS      ?? 5_000);
  let url = initialUrl || env.DATABASE_URL || null;
  for (let i = 1; i <= tries; i++) {
    url = env.DATABASE_URL || url;
    if (url) return url;
    console.warn(`[boot] DATABASE_URL henüz yok — ${i}/${tries}, ${wait}ms bekliyorum…`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error("DATABASE_URL still missing after retries");
}

// --- 2) ELARA sovereign normalize -------------------------------------------
function normalizeDatabaseUrl(databaseUrl, { dbName, forbiddenDbNames = DEFAULT_FORBIDDEN, env = process.env } = {}) {
  if (!dbName) throw new Error("normalizeDatabaseUrl: dbName required");
  let out = databaseUrl;
  try {
    const u = new URL(databaseUrl);
    const current = decodeURIComponent((u.pathname || "/").replace(/^\//, "")).trim();
    if (!current || forbiddenDbNames.has(current.toLowerCase()) || current !== dbName) {
      u.pathname = `/${dbName}`;
      out = u.toString();
      env.DATABASE_URL = out;
    }
    env.PGDATABASE = dbName;
  } catch (e) {
    console.error(`[boot] DATABASE_URL parse edilemedi (${String(e?.message || e)}) — ham haliyle devam`);
  }
  return out;
}

// --- 3) Pool kurulumu -------------------------------------------------------
export function createDbPool(databaseUrl, { env = process.env } = {}) {
  // idle_in_transaction_session_timeout: pg startup `options` ile uygulanır.
  // pool.on("connect", c => c.query("SET ...")) yolu pg@8.19+ ile
  // "client.query() while client is already executing a query" deprecation
  // uyarısına yol açıyordu.
  const sessionOptions = `-c idle_in_transaction_session_timeout=${
    Number(env.PG_IDLE_IN_TX_TIMEOUT_MS ?? 30_000)
  }`;
  return new Pool({
    connectionString: databaseUrl,
    max: Number(env.PG_POOL_MAX ?? 8),
    min: Number(env.PG_POOL_MIN ?? 0),
    idleTimeoutMillis: Number(env.PG_IDLE_TIMEOUT_MS ?? 5_000),
    connectionTimeoutMillis: 8_000,
    statement_timeout: Number(env.PG_STATEMENT_TIMEOUT_MS ?? 60_000),
    query_timeout: Number(env.PG_QUERY_TIMEOUT_MS ?? 90_000),
    keepAlive: true,
    allowExitOnIdle: String(env.PG_ALLOW_EXIT_ON_IDLE ?? "1") === "1",
    options: sessionOptions,
  });
}

// --- 4) waitForDatabaseReady probe ------------------------------------------
export async function waitForDatabaseReady(pool, { dbName, maxAttempts, delayMs, env = process.env } = {}) {
  const tries = Number(maxAttempts ?? env.DB_BOOT_MAX_ATTEMPTS ?? 60);
  const wait  = Number(delayMs    ?? env.DB_BOOT_RETRY_MS      ?? 5_000);
  for (let i = 1; i <= tries; i++) {
    try {
      const c = await pool.connect();
      try {
        const r = await c.query(
          "SELECT current_database() AS db, current_user AS usr, inet_server_addr()::text AS host, inet_server_port() AS port"
        );
        const row = r.rows[0] || {};
        console.log(
          `[boot] PostgreSQL bağlantısı hazır (attempt ${i}) · db=${row.db} · user=${row.usr} · host=${row.host || "local"}:${row.port || ""}`
        );
        if (dbName && String(row.db).toLowerCase() !== String(dbName).toLowerCase()) {
          console.error(
            `[boot] UYARI — beklenen db='${dbName}' ama bağlanılan='${row.db}'. Bağlantı dizgesi/PGDATABASE çakışması var.`
          );
        }
      } finally {
        c.release();
      }
      return;
    } catch (e) {
      console.warn(`[boot] DB henüz uyanmadı — ${i}/${tries}: ${String(e?.message || e)}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  console.error("[boot] DB connection failed after retries — devam ediyorum, request sırasında tekrar denenecek.");
}

// --- 5) Pool error handler --------------------------------------------------
export function attachPoolErrorHandler(pool, { onError } = {}) {
  pool.on("error", (e) => {
    if (typeof onError === "function") {
      try { onError(e); return; } catch { /* fall through to default log */ }
    }
    console.error("[pg-pool] idle client error:", String(e?.message || e));
  });
}

// --- 6) Composed bootstrap --------------------------------------------------
// waitForUrl + normalize + createPool. waitForDatabaseReady ve init* çağrıları
// caller'a bırakılır (init*'lar pool gerektirir, sırası önemli).
export async function bootstrapDatabase({
  initialUrl = null,
  dbName,
  forbiddenDbNames,
  env = process.env,
} = {}) {
  const effectiveDbName = String(dbName || env.ELARA_DB_NAME || "elara_db").trim();
  const rawUrl = await waitForDatabaseUrl({ initialUrl, env });
  const normalized = normalizeDatabaseUrl(rawUrl, {
    dbName: effectiveDbName,
    forbiddenDbNames: forbiddenDbNames || DEFAULT_FORBIDDEN,
    env,
  });
  const pool = createDbPool(normalized, { env });
  return { pool, databaseUrl: normalized, dbName: effectiveDbName };
}
