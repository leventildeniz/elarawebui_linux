// Backup subsystem — full system snapshots (.eez), cluster pg_dump (.eezpg),
// restore orchestrator with pre-restore safety + atomic swap + supervisor-aware
// restart. Extracted from server.mjs (Tur 1.4 — Block I).
//
// DI: app, pool, enqueueWrite, spawnPg, initPgVersion, upload (multer),
//     UPLOAD_DIR, BACKUP_DIR, DATABASE_URL, __bootDir, startedAt,
//     brandSync, safeSlug.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

export function mountBackupRoutes(app, deps) {
  const {
    pool, enqueueWrite, spawnPg, initPgVersion, upload,
    UPLOAD_DIR, BACKUP_DIR, DATABASE_URL, __bootDir, startedAt,
    brandSync, safeSlug,
  } = deps;

  const { getPgClientMajor, getPgServerMajor, ensurePgVersionsCompatible } = initPgVersion({ pool, spawnPg });

// ============================================================
// FULL BACKUP — schema.sql + server.mjs + .env + DB JSON dump.
// Returns a streamed application/zip (built by hand, no native deps).
// Includes:
//   - schema.sql       (current schema file on disk)
//   - server.mjs       (current middleware source)
//   - .env.example     (sanitised template)
//   - manifest.json    (timestamp, host, table list, row counts)
//   - data/<table>.json  (full row dump for every public table)
// Rollback companion: POST /api/backup/restore  with multipart "file" → applies
// the JSON dumps via TRUNCATE + INSERT inside a transaction. Schema is NOT
// recreated automatically (schema.sql is included in the zip; replay manually).
// ============================================================

const HEX_ID = "0";
function crc32(buf) {
  // Tiny CRC32 (no deps). Good enough for ZIP integrity.
  const table = crc32.t || (crc32.t = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })());
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files /* [{ name, data: Buffer }] */) {
  // Stored (no deflate). Simple but valid ZIP — opens in macOS Finder.
  const localParts = []; const centralParts = []; let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const data = f.data;
    const crc = crc32(data);
    const size = data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version
    lh.writeUInt16LE(0x0800, 6); // utf-8 flag
    lh.writeUInt16LE(0, 8); // method = stored
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); // time/date
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    localParts.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centralParts.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const localBytes = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, central, eocd]);
}

function readStoredZipEntries(buf) {
  const entries = new Map();
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const size = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const nameStart = off + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");
    if (method !== 0) throw new Error(`unsupported zip compression for ${name}; expected stored archive`);
    entries.set(name, buf.subarray(dataStart, dataStart + size));
    off = dataStart + size;
  }
  return entries;
}

function tablesFromBackupBuffer(buf, ext = "") {
  if (ext === ".json") {
    const payload = JSON.parse(buf.toString("utf8"));
    return payload?.tables && typeof payload.tables === "object" ? payload.tables : payload;
  }
  const entries = readStoredZipEntries(buf);
  const tables = {};
  for (const [name, data] of entries) {
    const m = name.match(/^data\/([a-z_][a-z_0-9]*)\.json$/i);
    if (m) tables[m[1]] = JSON.parse(data.toString("utf8"));
  }
  return tables;
}

function restoreUploadsFromBuffer(buf, ext = "") {
  if (ext === ".json") return 0;
  let entries;
  try { entries = readStoredZipEntries(buf); } catch { return 0; }
  let count = 0;
  for (const [name, data] of entries) {
    if (!name.startsWith("uploads/")) continue;
    const rel = name.slice("uploads/".length);
    if (!rel || rel.includes("..")) continue;
    const abs = path.join(UPLOAD_DIR, rel);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
      count++;
    } catch { /* skip */ }
  }
  return count;
}

// ============================================================
// v15.1 — System Snapshot helpers
// ============================================================
const PROJECT_ROOT = path.resolve(__bootDir, "..");
const SNAPSHOT_DIRS = [
  { real: "local-server", staged: "server/local-server" },
  { real: "src",          staged: "app/src" },
  { real: ".lovable",     staged: "memory/.lovable" },
];
const SNAPSHOT_ROOT_FILES = [
  "package.json", "vite.config.ts", "tsconfig.json", "components.json",
  "wrangler.jsonc", "eslint.config.js", ".prettierrc", ".prettierignore", "bunfig.toml",
];
// Asla arşive girmeyecek şeyler (regex). Modeller, cache, build çıktıları, git.
const SNAPSHOT_BLACKLIST = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)\.vite(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/)venv(\/|$)/,
  /(^|\/)\.venv(\/|$)/,
  /(^|\/)\.DS_Store$/,
  /\.log$/,
  /(^|\/)uploads(\/|$)/,    // uploads ayrı katman (UPLOAD_DIR, repo dışı)
  /(^|\/)backups(\/|$)/,    // backup'ın kendisi
  /(^|\/)\.pending-swap\.json$/,
  /(^|\/)\.library-root$/,
];
const SNAPSHOT_FILE_CAP = 200 * 1024 * 1024;   // tek dosya tavanı
const SNAPSHOT_TOTAL_CAP = 1024 * 1024 * 1024; // toplam kod tavanı

function sha256Buf(buf) { return createHash("sha256").update(buf).digest("hex"); }
function safeIdent(s) { return /^[a-zA-Z0-9_\-]+$/.test(String(s || "")); }

// Recursively copy a directory tree (mkdir + copyFile). Used by restore to
// overlay live runtime state onto the staging dir so a code-swap doesn't
// regress UI-managed JSON files (brand-aliases, rag-settings, etc).
function _copyDirRecursive(srcDir, destDir) {
  let count = 0;
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const sp = path.join(srcDir, entry.name);
    const dp = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += _copyDirRecursive(sp, dp);
    } else if (entry.isFile()) {
      try { fs.copyFileSync(sp, dp); count += 1; } catch { /* skip */ }
    }
  }
  return count;
}

function parseDbUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || "5432",
      user: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
      database: decodeURIComponent((u.pathname || "/").slice(1)) || "postgres",
    };
  } catch {
    return null;
  }
}
function maintenanceUrl(database = "postgres") {
  const p = parseDbUrl(DATABASE_URL);
  if (!p) return DATABASE_URL;
  const u = new URL(DATABASE_URL);
  u.pathname = "/" + database;
  return u.toString();
}

// spawnPg → lib/port-process.mjs (Block C Tur 1)


async function listDatabases() {
  const url = maintenanceUrl("postgres");
  const { stdout } = await spawnPg("psql", [
    "--dbname", url, "-Atc",
    "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname",
  ]);
  return String(stdout).split("\n").map(s => s.trim()).filter(Boolean);
}

function isBlacklisted(rel) {
  for (const re of SNAPSHOT_BLACKLIST) if (re.test(rel)) return true;
  return false;
}
function walkInto(absRoot, stagedPrefix, files, counters) {
  let entries;
  try { entries = fs.readdirSync(absRoot, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const abs = path.join(absRoot, ent.name);
    const rel = `${stagedPrefix}/${ent.name}`;
    const matchKey = path.relative(PROJECT_ROOT, abs).split(path.sep).join("/");
    if (isBlacklisted(matchKey) || isBlacklisted(ent.name)) continue;
    if (ent.isDirectory()) { walkInto(abs, rel, files, counters); continue; }
    try {
      const stat = fs.statSync(abs);
      if (stat.size > SNAPSHOT_FILE_CAP) { counters.skipped.push({ rel: matchKey, reason: `>${SNAPSHOT_FILE_CAP} bytes` }); continue; }
      if (counters.bytes + stat.size > SNAPSHOT_TOTAL_CAP) { counters.skipped.push({ rel: matchKey, reason: "total cap" }); continue; }
      files.push({ name: rel, data: fs.readFileSync(abs) });
      counters.bytes += stat.size;
      counters.count += 1;
    } catch { /* skip */ }
  }
}

async function buildBackupArchive(opts = {}) {
  const t0 = Date.now();
  const includeCode = opts.includeCode !== false;       // default ON: true system snapshot
  const includeUploads = opts.includeUploads !== false; // default ON
  const includeDbDump  = opts.includeDbDump !== false;  // default ON: real pg_dump
  const files = [];
  const counters = { bytes: 0, count: 0, skipped: [] };

  // ── Code / config / memory ────────────────────────────────────────────
  if (includeCode) {
    for (const grp of SNAPSHOT_DIRS) {
      const abs = path.join(PROJECT_ROOT, grp.real);
      if (fs.existsSync(abs)) walkInto(abs, grp.staged, files, counters);
    }
    for (const name of SNAPSHOT_ROOT_FILES) {
      const abs = path.join(PROJECT_ROOT, name);
      try {
        const stat = fs.statSync(abs);
        if (!stat.isFile()) continue;
        if (stat.size > SNAPSHOT_FILE_CAP) continue;
        files.push({ name: `config/${name}`, data: fs.readFileSync(abs) });
        counters.bytes += stat.size; counters.count += 1;
      } catch { /* missing is fine */ }
    }
  }

  // ── Uploads (knowledge, pcap, vb.) ─────────────────────────────────────
  let uploadBytes = 0;
  const UPLOAD_CAP = 256 * 1024 * 1024;
  const walkUploads = (absDir, relPrefix) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.name === "backups") continue;
      const abs = path.join(absDir, ent.name);
      const rel = `${relPrefix}/${ent.name}`;
      if (ent.isDirectory()) { walkUploads(abs, rel); continue; }
      try {
        const stat = fs.statSync(abs);
        if (uploadBytes + stat.size > UPLOAD_CAP) continue;
        files.push({ name: rel, data: fs.readFileSync(abs) });
        uploadBytes += stat.size;
      } catch { /* skip */ }
    }
  };
  if (includeUploads) walkUploads(UPLOAD_DIR, "uploads");

  // ── Tables JSON (legacy/audit fallback) ────────────────────────────────
  const t = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const tableCounts = {};
  for (const { tablename } of t.rows) {
    try {
      const r = await pool.query(`SELECT * FROM "${tablename}"`);
      files.push({ name: `data/${tablename}.json`, data: Buffer.from(JSON.stringify(r.rows, null, 2), "utf8") });
      tableCounts[tablename] = r.rows.length;
    } catch (e) {
      tableCounts[tablename] = `error: ${String(e.message || e)}`;
    }
  }

  // ── DB dumps (authoritative) ───────────────────────────────────────────
  const dbDumps = {};
  let pgInfo = { client: null, server: null };
  if (includeDbDump) {
    try {
      pgInfo = await ensurePgVersionsCompatible();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "elara-pgdump-"));
      try {
        // Globals (roles, tablespaces, grants) — cluster-wide
        const globalsPath = path.join(tmpDir, "globals.sql");
        await spawnPg("pg_dumpall", ["--dbname", maintenanceUrl("postgres"), "--globals-only", "--no-role-passwords", "-f", globalsPath]);
        files.push({ name: "db/globals.sql", data: fs.readFileSync(globalsPath) });
        dbDumps.globals = fs.statSync(globalsPath).size;
        // Per-DB custom-format dumps
        const dbs = await listDatabases();
        for (const db of dbs) {
          if (!safeIdent(db)) continue;
          const dumpPath = path.join(tmpDir, `${db}.dump`);
          try {
            await spawnPg("pg_dump", ["--no-owner", "--no-privileges", "-Fc", "-f", dumpPath, "--dbname", maintenanceUrl(db)]);
            const buf = fs.readFileSync(dumpPath);
            files.push({ name: `db/${db}.dump`, data: buf });
            dbDumps[db] = { bytes: buf.length, sha256: sha256Buf(buf) };
          } catch (e) {
            dbDumps[db] = { error: String(e.stderr || e.message || e) };
          }
        }
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    } catch (e) {
      dbDumps._error = String(e.message || e);
    }
  }

  const manifest = {
    version: 2,
    snapshot_kind: includeCode ? "system" : "data-only",
    created_at: new Date().toISOString(),
    host: os.hostname(),
    uptime_ms: Date.now() - startedAt,
    durationMs: Date.now() - t0,
    pg: pgInfo,
    db: dbDumps,
    tables: tableCounts,
    code: { files: counters.count, bytes: counters.bytes, skipped: counters.skipped.slice(0, 50) },
    uploads: { bytes: uploadBytes },
    includes: [
      ...(includeCode ? ["server/local-server/**", "app/src/**", "config/*", "memory/.lovable/**"] : []),
      ...(includeDbDump ? ["db/globals.sql", "db/*.dump"] : []),
      "data/*.json",
      ...(includeUploads ? ["uploads/**"] : []),
    ],
  };
  files.push({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });
  return { zip: buildZip(files), manifest };
}

async function restoreTablesFromBackup(tables) {
  if (!tables || typeof tables !== "object") throw new Error("expected backup archive with data/*.json table dumps");
  const summary = {};
  const tableNames = Object.keys(tables).filter((name) => /^[a-z_][a-z_0-9]*$/i.test(name) && Array.isArray(tables[name]));
  await pool.query("BEGIN");
  try {
    if (tableNames.length) await pool.query(`TRUNCATE ${tableNames.map((name) => `"${name}"`).join(",")} RESTART IDENTITY CASCADE`);
    const priority = ["chat_threads", "app_groups", "app_users", "agents", "models"];
    const ordered = tableNames.sort((a, b) => {
      const ai = priority.includes(a) ? priority.indexOf(a) : priority.length;
      const bi = priority.includes(b) ? priority.indexOf(b) : priority.length;
      return ai - bi || a.localeCompare(b);
    });
    for (const name of ordered) {
      const rows = tables[name];
      for (const row of rows) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
        const values = cols.map((c) => row[c]);
        await pool.query(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders})`, values);
      }
      summary[name] = rows.length;
    }
    const seqs = await pool.query(`
      SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE s.relkind='S' AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
    `);
    for (const { seq, tbl, col } of seqs.rows) {
      try {
        await pool.query(
          `SELECT setval('"${seq}"', COALESCE((SELECT MAX("${col}") FROM "${tbl}"), 1), (SELECT MAX("${col}") IS NOT NULL FROM "${tbl}"))`
        );
      } catch { /* skip */ }
    }
    await pool.query("COMMIT");
    return summary;
  } catch (e) {
    await pool.query("ROLLBACK").catch(() => {});
    e.partial = summary;
    throw e;
  }
}

// ── Pre-restore safety snapshot — DB only (kod tar'ı opsiyonel) ──────────
async function preRestoreSnapshot(stamp) {
  const filename = `_pre-restore-${stamp}.dump`;
  const outPath = path.join(BACKUP_DIR, filename);
  try {
    const current = parseDbUrl(DATABASE_URL);
    if (!current) throw new Error("cannot parse DATABASE_URL");
    await spawnPg("pg_dump", ["--no-owner", "--no-privileges", "-Fc", "-f", outPath, "--dbname", DATABASE_URL]);
    const buf = fs.readFileSync(outPath);
    fs.writeFileSync(`${outPath}.sha256`, sha256Buf(buf));
    return { ok: true, filename, bytes: buf.length };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message || e) };
  }
}

// ── 5-stage restore orchestrator ─────────────────────────────────────────
async function restoreSnapshot(buf, ext, mode = "full") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const log = [];
  const step = (name, status, detail = {}) => {
    const line = { step: name, status, ts: new Date().toISOString(), ...detail };
    log.push(line);
    enqueueWrite(
      `INSERT INTO agent_logs(agent,level,message,meta) VALUES ('backup','info',$1,$2)`,
      [`restore.${name}.${status}`, { mode, stamp, ...detail }]
    );
  };

  // Parse archive
  let entries = null;
  let tables = null;
  if (ext === ".json") {
    try { tables = tablesFromBackupBuffer(buf, ext); }
    catch (e) { throw new Error(`invalid JSON archive: ${e.message}`); }
  } else {
    try { entries = readStoredZipEntries(buf); }
    catch (e) { throw new Error(`invalid zip archive: ${e.message}`); }
  }
  const has = (name) => entries && entries.has(name);
  const get = (name) => entries && entries.get(name);

  // 0. PRE-FLIGHT
  step("preflight", "start");
  let manifest = null;
  if (entries && has("manifest.json")) {
    try { manifest = JSON.parse(get("manifest.json").toString("utf8")); } catch {}
  }
  let pre = null;
  if (mode !== "files") {
    pre = await preRestoreSnapshot(stamp);
    step("preflight", pre.ok ? "ok" : "warn", { snapshot: pre });
  } else {
    step("preflight", "ok", { snapshot: "skipped (files-only)" });
  }

  // 1. CODE / CONFIG → staging (full only; not files-only/db-only)
  let stagingDir = null;
  let pendingItems = [];
  if (mode === "full" && entries) {
    stagingDir = path.join(BACKUP_DIR, `_staging-${stamp}`);
    fs.mkdirSync(stagingDir, { recursive: true });
    let staged = 0;
    for (const [name, data] of entries) {
      if (!name.startsWith("server/") && !name.startsWith("app/") && !name.startsWith("config/") && !name.startsWith("memory/")) continue;
      if (name.includes("..")) continue;
      const abs = path.join(stagingDir, name);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
      staged += 1;
    }
    step("code_staging", "ok", { files: staged, staging: stagingDir });

    // 1b. PRESERVE RUNTIME STATE — overlay live runtime dirs onto staging so
    // a code-swap restore does NOT wipe UI-managed JSON state (brand aliases,
    // rag-settings, etc). The archive may carry an older/empty data/ dir;
    // copying the live tree on top makes the swap idempotent for runtime state.
    try {
      const liveDataDir = path.join(PROJECT_ROOT, "local-server", "data");
      const stagedDataDir = path.join(stagingDir, "server", "local-server", "data");
      if (fs.existsSync(liveDataDir)) {
        const overlayCount = _copyDirRecursive(liveDataDir, stagedDataDir);
        step("preserve_runtime_state", "ok", { dir: "local-server/data", files: overlayCount });
      } else {
        step("preserve_runtime_state", "skipped", { reason: "no live data dir" });
      }
    } catch (e) {
      step("preserve_runtime_state", "warn", { error: String(e?.message || e) });
    }

    // Build pending-swap items list for boot-time application
    const groups = [
      { stagedRoot: "server/local-server", real: "local-server" },
      { stagedRoot: "app/src",             real: "src" },
      { stagedRoot: "memory/.lovable",     real: ".lovable" },
    ];
    for (const g of groups) {
      if (fs.existsSync(path.join(stagingDir, g.stagedRoot))) {
        pendingItems.push({ real: g.real, staged: g.stagedRoot });
      }
    }
    if (fs.existsSync(path.join(stagingDir, "config"))) {
      for (const ent of fs.readdirSync(path.join(stagingDir, "config"))) {
        pendingItems.push({ real: ent, staged: `config/${ent}` });
      }
    }
  } else {
    step("code_staging", "skipped", { reason: mode === "full" ? "no archive entries" : `mode=${mode}` });
  }

  // 2. DB RESTORE
  let dbSummary = { mode: "skipped" };
  if (mode !== "files") {
    if (entries && has("db/globals.sql")) {
      // New format: real pg_dump archive
      try {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "elara-pgrestore-"));
        try {
          const globalsPath = path.join(tmpDir, "globals.sql");
          fs.writeFileSync(globalsPath, get("db/globals.sql"));
          await spawnPg("psql", ["--dbname", maintenanceUrl("postgres"), "-v", "ON_ERROR_STOP=1", "-f", globalsPath]);
          const restored = {};
          for (const [name, data] of entries) {
            const m = name.match(/^db\/([a-zA-Z0-9_\-]+)\.dump$/);
            if (!m) continue;
            const db = m[1];
            const dumpPath = path.join(tmpDir, `${db}.dump`);
            fs.writeFileSync(dumpPath, data);
            // Ensure DB exists
            try { await spawnPg("psql", ["--dbname", maintenanceUrl("postgres"), "-c", `CREATE DATABASE "${db}"`]); } catch { /* exists */ }
            await spawnPg("pg_restore", [
              "--clean", "--if-exists", "--no-owner", "--no-privileges",
              "--dbname", maintenanceUrl(db), dumpPath,
            ]).catch((e) => { restored[db] = { error: String(e.stderr || e.message) }; throw e; });
            restored[db] = { ok: true, bytes: data.length };
          }
          dbSummary = { mode: "pg_restore", restored };
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
        step("db_restore", "ok", dbSummary);
      } catch (e) {
        step("db_restore", "error", { error: String(e.message || e) });
        // Try auto-rollback from pre snapshot
        if (pre?.ok) {
          try {
            await spawnPg("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges",
              "--dbname", DATABASE_URL, path.join(BACKUP_DIR, pre.filename)]);
            step("db_rollback", "ok", { from: pre.filename });
          } catch (re) { step("db_rollback", "error", { error: String(re.message || re) }); }
        }
        throw e;
      }
    } else {
      // Legacy fallback: JSON tablo dumpları
      try {
        const t = tables ?? tablesFromBackupBuffer(buf, ext);
        const summary = await restoreTablesFromBackup(t);
        dbSummary = { mode: "tables_json", restored: summary };
        step("db_restore", "ok", dbSummary);
      } catch (e) {
        step("db_restore", "error", { error: String(e.message || e), partial: e.partial ?? {} });
        if (pre?.ok) {
          try {
            await spawnPg("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges",
              "--dbname", DATABASE_URL, path.join(BACKUP_DIR, pre.filename)]);
            step("db_rollback", "ok", { from: pre.filename });
          } catch (re) { step("db_rollback", "error", { error: String(re.message || re) }); }
        }
        throw e;
      }
    }
  } else {
    step("db_restore", "skipped", { reason: "files-only" });
  }

  // 3. UPLOADS
  let uploadsCount = 0;
  if (mode !== "db" && entries) {
    uploadsCount = restoreUploadsFromBuffer(buf, ext);
    step("uploads_restore", "ok", { files: uploadsCount });
  } else {
    step("uploads_restore", "skipped", { reason: mode === "db" ? "db-only" : "no archive" });
  }

  // 4. ATOMIC SWAP — write marker, exit on next tick (operator sees toast)
  let restartScheduled = false;
  if (mode === "full" && pendingItems.length && stagingDir) {
    const marker = {
      stamp,
      backup_dir: BACKUP_DIR,
      staging_dir: stagingDir,
      items: pendingItems,
      created_at: new Date().toISOString(),
    };
    const markerPath = path.join(__bootDir, ".pending-swap.json");
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
    step("atomic_swap", "scheduled", { items: pendingItems.length, marker: markerPath });
    restartScheduled = true;
  } else {
    step("atomic_swap", "skipped", { reason: pendingItems.length ? "no staging" : "no code in archive" });
  }

  // 5. RESTART signal
  const supervisor = detectSupervisor();
  if (restartScheduled) {
    step("restart", supervisor.can_auto_restart ? "scheduled" : "manual_required", { supervisor });
    if (supervisor.can_auto_restart) {
      // Defer exit so the HTTP response can flush.
      setTimeout(() => {
        console.log(`[restore] exiting to apply pending swap (${supervisor.kind} will respawn)`);
        process.exit(0);
      }, 2_000);
    } else {
      console.warn("[restore] no supervisor detected — operator must restart manually to apply swap");
    }
  } else {
    step("restart", "skipped");
  }

  return { ok: true, stamp, mode, manifest, db: dbSummary, uploads: uploadsCount, restart: restartScheduled, supervisor, log };
}

// ─── Supervisor detection (auto-restart capability) ─────────────────────
// Detects whether the bridge is supervised by launchd/pm2/systemd. If yes,
// process.exit(0) after a restore is safe — the supervisor respawns us.
// If "none", the operator must restart manually after FULL restore.
function detectSupervisor() {
  const env = process.env;
  // launchd (macOS): sets XPC_SERVICE_NAME for managed jobs.
  if (env.XPC_SERVICE_NAME && !env.XPC_SERVICE_NAME.startsWith("0x")) {
    let keepAlive = null, plistPath = null;
    try {
      // Try to locate plist in common LaunchAgents/Daemons dirs.
      const label = env.XPC_SERVICE_NAME;
      const candidates = [
        path.join(env.HOME || "/", "Library/LaunchAgents", `${label}.plist`),
        `/Library/LaunchAgents/${label}.plist`,
        `/Library/LaunchDaemons/${label}.plist`,
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          plistPath = p;
          const xml = fs.readFileSync(p, "utf8");
          // Match <key>KeepAlive</key> followed by <true/> or a dict.
          const m = xml.match(/<key>KeepAlive<\/key>\s*<(true\/|false\/|dict)/);
          keepAlive = m ? (m[1] === "true/" || m[1] === "dict") : false;
          break;
        }
      }
    } catch {}
    return { kind: "launchd", label: env.XPC_SERVICE_NAME, plist: plistPath, keep_alive: keepAlive, can_auto_restart: keepAlive !== false };
  }
  // pm2
  if (env.pm_id || env.PM2_HOME || env.PM2_USAGE) {
    return { kind: "pm2", label: env.name || env.pm_id || null, can_auto_restart: true };
  }
  // systemd
  if (env.INVOCATION_ID || env.JOURNAL_STREAM) {
    return { kind: "systemd", label: env.SYSTEMD_EXEC_PID || null, can_auto_restart: true };
  }
  // Docker with restart policy is hard to detect from inside; conservative "unknown".
  if (env.KUBERNETES_SERVICE_HOST) return { kind: "kubernetes", can_auto_restart: true };
  return { kind: "none", can_auto_restart: false, hint: "Run under launchd (KeepAlive=true), pm2, or systemd to enable auto-restart after FULL restore." };
}

function listBackupFiles() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => /\.(eez|eezpg|zip|dump|sql|json)$/i.test(f))
      .map((f) => {
        const abs = path.join(BACKUP_DIR, f);
        const st = fs.statSync(abs);
        let sha = "";
        try { sha = fs.readFileSync(`${abs}.sha256`, "utf8").trim(); } catch {}
        return { name: f, bytes: st.size, mtime: st.mtimeMs, sha256: sha || null };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}

// ============================================================
// Endpoints
// ============================================================
app.get("/api/backup/export", async (req, res) => {
  try {
    const includeCode = req.query.code !== "0";
    const includeUploads = req.query.uploads !== "0";
    const includeDbDump = req.query.db !== "0";
    const { zip, manifest } = await buildBackupArchive({ includeCode, includeUploads, includeDbDump });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${safeSlug(brandSync().short_name || brandSync().app_name)}-snapshot-${stamp}.eez`;
    fs.writeFileSync(path.join(BACKUP_DIR, filename), zip);
    fs.writeFileSync(path.join(BACKUP_DIR, `${filename}.sha256`), sha256Buf(zip));
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", zip.length);
    res.end(zip);
    enqueueWrite(
      `INSERT INTO agent_logs(agent,level,message,meta) VALUES ('backup','info',$1,$2)`,
      ["full_backup_export", { snapshot_kind: manifest.snapshot_kind, tables: Object.keys(manifest.tables).length, dbs: Object.keys(manifest.db || {}).length, code_files: manifest.code?.files, bytes: zip.length, filename }]
    );
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/backup/restore", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "file required (multipart 'file')" });
  const mode = String(req.body?.mode || req.query?.mode || "full").toLowerCase();
  if (!["full", "db", "files"].includes(mode)) return res.status(400).json({ ok: false, error: "mode must be full|db|files" });
  let buf, ext;
  try {
    ext = path.extname(req.file.originalname || req.file.path).toLowerCase();
    buf = fs.readFileSync(req.file.path);
  } catch (e) { return res.status(400).json({ ok: false, error: `unreadable upload: ${String(e.message || e)}` }); }
  try {
    const result = await restoreSnapshot(buf, ext, mode);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e), partial: e.partial ?? {} });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }
});

app.post("/api/backup/rollback", async (req, res) => {
  try {
    // Prefer most recent _pre-restore-*.dump; fall back to latest .eez/.eezpg
    const files = fs.readdirSync(BACKUP_DIR)
      .map((f) => ({ name: f, abs: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const pre = files.find((f) => /^_pre-restore-.+\.dump$/.test(f.name));
    const mode = String(req.body?.mode || req.query?.mode || "full").toLowerCase();
    if (pre) {
      await spawnPg("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", DATABASE_URL, pre.abs]);
      enqueueWrite(`INSERT INTO agent_logs(agent,level,message,meta) VALUES ('backup','warn',$1,$2)`,
        ["full_backup_rollback", { source: "pre_restore_snapshot", file: pre.name }]);
      return res.json({ ok: true, source: "pre_restore_snapshot", file: pre.name });
    }
    const latest = files.find((f) => /\.(eez|eezpg|zip)$/i.test(f.name));
    if (!latest) return res.status(404).json({ ok: false, error: "no backup or pre-restore snapshot found" });
    const buf = fs.readFileSync(latest.abs);
    const ext = path.extname(latest.name).toLowerCase();
    const result = await restoreSnapshot(buf, ext, mode);
    enqueueWrite(`INSERT INTO agent_logs(agent,level,message,meta) VALUES ('backup','warn',$1,$2)`,
      ["full_backup_rollback", { source: "latest_archive", file: latest.name, ...result }]);
    res.json({ ok: true, source: "latest_archive", file: latest.name, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ─── Cluster-wide PostgreSQL backup (pg_dumpall + per-DB pg_dump -Fc) ────────
app.get("/api/backup/pg-dump", async (_req, res) => {
  try {
    await ensurePgVersionsCompatible();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "elara-cluster-"));
    const files = [];
    const manifest = { version: 2, kind: "pg_cluster", created_at: new Date().toISOString(), host: os.hostname(), dbs: {}, globals: null };
    try {
      const globalsPath = path.join(tmpDir, "globals.sql");
      await spawnPg("pg_dumpall", ["--dbname", maintenanceUrl("postgres"), "--globals-only", "--no-role-passwords", "-f", globalsPath]);
      const gbuf = fs.readFileSync(globalsPath);
      files.push({ name: "globals.sql", data: gbuf });
      manifest.globals = { bytes: gbuf.length, sha256: sha256Buf(gbuf) };
      const dbs = await listDatabases();
      for (const db of dbs) {
        if (!safeIdent(db)) continue;
        const dumpPath = path.join(tmpDir, `${db}.dump`);
        try {
          await spawnPg("pg_dump", ["--no-owner", "--no-privileges", "-Fc", "-f", dumpPath, "--dbname", maintenanceUrl(db)]);
          const buf = fs.readFileSync(dumpPath);
          files.push({ name: `${db}.dump`, data: buf });
          manifest.dbs[db] = { bytes: buf.length, sha256: sha256Buf(buf) };
        } catch (e) {
          manifest.dbs[db] = { error: String(e.stderr || e.message || e) };
        }
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
    files.push({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });
    const zip = buildZip(files);
    const filename = `pg-cluster-${stamp}.eezpg`;
    fs.writeFileSync(path.join(BACKUP_DIR, filename), zip);
    fs.writeFileSync(path.join(BACKUP_DIR, `${filename}.sha256`), sha256Buf(zip));
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", zip.length);
    res.end(zip);
    enqueueWrite(`INSERT INTO agent_logs(agent,level,message,meta) VALUES ('backup','info',$1,$2)`,
      ["pg_cluster_export", { filename, bytes: zip.length, dbs: Object.keys(manifest.dbs) }]);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e), stderr: e.stderr ?? "" });
  }
});

// POST /api/backup/pg-restore  multipart "file" — accepts .eezpg (cluster), .dump (single), .sql
app.post("/api/backup/pg-restore", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "file required (multipart 'file')" });
  const ext = path.extname(req.file.originalname || req.file.path).toLowerCase();
  try {
    if (ext === ".sql") {
      await spawnPg("psql", ["--dbname", DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", req.file.path]);
      enqueueWrite(`INSERT INTO agent_logs(agent,level,message,meta) VALUES ('backup','warn',$1,$2)`,
        ["pg_restore_apply", { filename: req.file.originalname, ext, kind: "psql" }]);
      return res.json({ ok: true, file: req.file.originalname, kind: "psql" });
    }
    // Distinguish .eezpg (zip) from .dump (custom binary). pg_dump custom magic = "PGDMP".
    const head = fs.readFileSync(req.file.path, { encoding: null }).slice(0, 5);
    const isZip = head[0] === 0x50 && head[1] === 0x4B; // "PK"
    if (!isZip) {
      await spawnPg("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", DATABASE_URL, req.file.path]);
      enqueueWrite(`INSERT INTO agent_logs(agent,level,message,meta) VALUES ('backup','warn',$1,$2)`,
        ["pg_restore_apply", { filename: req.file.originalname, ext, kind: "pg_restore_single" }]);
      return res.json({ ok: true, file: req.file.originalname, kind: "pg_restore_single" });
    }
    // .eezpg cluster archive
    const buf = fs.readFileSync(req.file.path);
    const entries = readStoredZipEntries(buf);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "elara-pgrestore-"));
    const summary = {};
    try {
      if (entries.has("globals.sql")) {
        const gp = path.join(tmpDir, "globals.sql");
        fs.writeFileSync(gp, entries.get("globals.sql"));
        await spawnPg("psql", ["--dbname", maintenanceUrl("postgres"), "-v", "ON_ERROR_STOP=1", "-f", gp]);
        summary.globals = "ok";
      }
      for (const [name, data] of entries) {
        const m = name.match(/^([a-zA-Z0-9_\-]+)\.dump$/);
        if (!m) continue;
        const db = m[1];
        const dp = path.join(tmpDir, `${db}.dump`);
        fs.writeFileSync(dp, data);
        try { await spawnPg("psql", ["--dbname", maintenanceUrl("postgres"), "-c", `CREATE DATABASE "${db}"`]); } catch { /* exists */ }
        try {
          await spawnPg("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", maintenanceUrl(db), dp]);
          summary[db] = { ok: true, bytes: data.length };
        } catch (e) {
          summary[db] = { error: String(e.stderr || e.message) };
        }
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
    enqueueWrite(`INSERT INTO agent_logs(agent,level,message,meta) VALUES ('backup','warn',$1,$2)`,
      ["pg_cluster_restore", { filename: req.file.originalname, summary }]);
    res.json({ ok: true, file: req.file.originalname, kind: "eezpg", restored: summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e), stderr: e.stderr ?? "" });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }
});

// ─── Catalog endpoints ──────────────────────────────────────────────────
app.get("/api/backup/list", (_req, res) => {
  res.json({ ok: true, dir: BACKUP_DIR, files: listBackupFiles() });
});

app.get("/api/backup/supervisor", (_req, res) => {
  res.json({ ok: true, supervisor: detectSupervisor(), pid: process.pid, ppid: process.ppid });
});

app.get("/api/backup/file/:name", (req, res) => {
  const name = String(req.params.name || "");
  if (!/^[\w.\-]+$/.test(name)) return res.status(400).json({ ok: false, error: "invalid name" });
  const abs = path.join(BACKUP_DIR, name);
  if (!abs.startsWith(BACKUP_DIR + path.sep) || !fs.existsSync(abs)) return res.status(404).json({ ok: false, error: "not found" });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  fs.createReadStream(abs).pipe(res);
});

app.delete("/api/backup/file/:name", (req, res) => {
  const name = String(req.params.name || "");
  if (!/^[\w.\-]+$/.test(name)) return res.status(400).json({ ok: false, error: "invalid name" });
  const abs = path.join(BACKUP_DIR, name);
  if (!abs.startsWith(BACKUP_DIR + path.sep)) return res.status(400).json({ ok: false, error: "path escape" });
  try {
    fs.unlinkSync(abs);
    try { fs.unlinkSync(`${abs}.sha256`); } catch {}
    enqueueWrite(`INSERT INTO agent_logs(agent,level,message,meta) VALUES ('backup','warn',$1,$2)`,
      ["backup_file_delete", { name }]);
    res.json({ ok: true, name });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/backup/restore-file", async (req, res) => {
  const name = String(req.body?.name || "");
  const mode = String(req.body?.mode || "full").toLowerCase();
  if (!/^[\w.\-]+$/.test(name)) return res.status(400).json({ ok: false, error: "invalid name" });
  if (!["full", "db", "files"].includes(mode)) return res.status(400).json({ ok: false, error: "mode must be full|db|files" });
  const abs = path.join(BACKUP_DIR, name);
  if (!abs.startsWith(BACKUP_DIR + path.sep) || !fs.existsSync(abs)) return res.status(404).json({ ok: false, error: "file not found" });
  try {
    const ext = path.extname(name).toLowerCase();
    const buf = fs.readFileSync(abs);
    const result = await restoreSnapshot(buf, ext, mode);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e), partial: e.partial ?? {} });
  }
});

  return { ensurePgVersionsCompatible, getPgClientMajor, getPgServerMajor };
}
