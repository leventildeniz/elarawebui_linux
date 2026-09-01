// local-server/lib/routes/brand-aliases.mjs
// ----------------------------------------------------------------------------
// Brand Aliases — UI-managed alias data for contextual enrichment.
// Extracted from server.mjs 2026-05-30. Owns:
//   GET  /api/rag/brand-aliases
//   POST /api/rag/brand-aliases
//   POST /api/rag/brand-aliases/reenrich
//   GET  /api/rag/brand-aliases/reenrich
// Plus exported helpers: spawnBrandReenrich, maybeAutoReenrich,
// triggerSyncAutoReenrich, _coerceBool — consumed by ingest routes.
// Storage: local-server/data/brand-aliases.json (JSON file).
// Hiçbir runtime sözlük lookup'ı YOK — alias yalnız enrichment preamble'a gömülür.
// ----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getBrandAliasesPath, migrateBrandAliasesIfNeeded } from "../state-paths.mjs";

let _deps = null;
function deps() {
  if (!_deps) throw new Error("brand-aliases not initialized — call initBrandAliases({...}) before use");
  return _deps;
}
export function initBrandAliases(d) {
  _deps = d;
  const legacy = path.join(d.baseDir, "data", "brand-aliases.json");
  const mig = migrateBrandAliasesIfNeeded(legacy);
  BRAND_ALIASES_PATH = getBrandAliasesPath();
  if (mig.migrated) {
    console.log(`[brand-aliases:migrate] copied ${mig.brandCount} brand(s) from ${mig.from} → ${mig.to}`);
  }
  ENRICH_SCRIPT_PATH = path.join(d.baseDir, "scripts", "enrich-structured-chunks.mjs");
}

let BRAND_ALIASES_PATH = null;
let ENRICH_SCRIPT_PATH = null;


function _readBrandAliases() {
  try {
    if (!fs.existsSync(BRAND_ALIASES_PATH)) return {};
    const raw = fs.readFileSync(BRAND_ALIASES_PATH, "utf8");
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    console.warn("[brand-aliases] read failed:", e.message);
    return {};
  }
}
function _backupBrandAliases() {
  try {
    if (!fs.existsSync(BRAND_ALIASES_PATH)) return;
    const dir = path.dirname(BRAND_ALIASES_PATH);
    const base = path.basename(BRAND_ALIASES_PATH);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(BRAND_ALIASES_PATH, path.join(dir, `${base}.${ts}.bak`));
    // rotate — keep last 5 backups
    const baks = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(base + ".") && n.endsWith(".bak"))
      .sort();
    while (baks.length > 5) {
      const old = baks.shift();
      try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn("[brand-aliases:backup] failed:", e.message);
  }
}
function _writeBrandAliasesAtomic(obj) {
  try {
    fs.mkdirSync(path.dirname(BRAND_ALIASES_PATH), { recursive: true });
  } catch {/* ignore */}
  _backupBrandAliases();
  const tmp = BRAND_ALIASES_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, BRAND_ALIASES_PATH);
}
function _sanitizeAliasList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (s.length > 60) continue;
    const lower = s.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

function _brandKey(s) {
  return String(s || "").toLowerCase().replace(/[_\-].*$/, "").trim();
}
function _aliasKeysForBrand(obj, brand) {
  if (obj?.[brand]) return [brand];
  const want = _brandKey(brand);
  if (!want) return [brand];
  const matches = Object.keys(obj || {}).filter((k) => _brandKey(k) === want);
  return matches.length ? matches : [brand];
}
function _aliasEntryForBrand(obj, brand) {
  const merged = { aliases: [] };
  const seen = new Set();
  for (const key of _aliasKeysForBrand(obj, brand)) {
    const entry = obj?.[key];
    if (!entry || typeof entry !== "object") continue;
    for (const alias of Array.isArray(entry.aliases) ? entry.aliases : []) {
      const s = String(alias || "").trim();
      const low = s.toLowerCase();
      if (!s || seen.has(low)) continue;
      seen.add(low);
      merged.aliases.push(s);
    }
    if (entry.updated_at && (!merged.updated_at || new Date(entry.updated_at) > new Date(merged.updated_at))) merged.updated_at = entry.updated_at;
    if (entry.reenriched_at && (!merged.reenriched_at || new Date(entry.reenriched_at) > new Date(merged.reenriched_at))) merged.reenriched_at = entry.reenriched_at;
  }
  return merged.aliases.length || merged.updated_at || merged.reenriched_at ? merged : {};
}
async function _recoverAliasesFromEnrichedChunks(pool, obj) {
  try {
    const r = await pool.query(`
      SELECT brand,
             split_part(split_part(content_enriched, 'Also known as: ', 2), E'\n', 1) AS alias_line,
             MAX(enriched_at) AS recovered_at
        FROM knowledge_chunks
       WHERE content_enriched LIKE '%Also known as:%'
         AND brand IS NOT NULL
       GROUP BY 1, 2
    `);
    let changed = false;
    for (const row of r.rows || []) {
      const brand = String(row.brand || "").trim();
      if (!brand || _aliasEntryForBrand(obj, brand).aliases?.length) continue;
      const aliases = _sanitizeAliasList(String(row.alias_line || "").replace(/\.$/, "").split(","));
      if (!aliases.length) continue;
      obj[brand] = { aliases, updated_at: row.recovered_at ? new Date(row.recovered_at).toISOString() : new Date().toISOString(), recovered_from: "content_enriched" };
      changed = true;
    }
    if (changed) _writeBrandAliasesAtomic(obj);
    return obj;
  } catch (e) {
    console.warn(`[brand-aliases:recover] failed: ${e?.message || e}`);
    return obj;
  }
}

// In-memory re-enrich job state — single job at a time per brand,
// status survives until next reenrich call for same brand.
const _brandReenrichJobs = new Map();

export function spawnBrandReenrich(brandRaw) {
  const { pool, baseDir } = deps();
  const brand = String(brandRaw || "").trim();
  if (!brand) return { ok: false, reason: "brand_required" };

  const existing = _brandReenrichJobs.get(brand);
  if (existing && existing.status === "running") {
    return { ok: false, reason: "already_running", job: { status: existing.status, startedAt: existing.startedAt, pid: existing.pid } };
  }

  const job = { status: "running", startedAt: new Date().toISOString(), endedAt: null, pid: null, stdout: "", stderr: "", code: null };
  _brandReenrichJobs.set(brand, job);

  try {
    const child = spawn(process.execPath.endsWith("bun") ? process.execPath : "bun", [
      "run", ENRICH_SCRIPT_PATH,
      "--brand", brand,
      "--all-rows",
    ], { cwd: baseDir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    job.pid = child.pid;

    child.stdout.on("data", (d) => { job.stdout += d.toString("utf8"); if (job.stdout.length > 200_000) job.stdout = job.stdout.slice(-150_000); });
    child.stderr.on("data", (d) => { job.stderr += d.toString("utf8"); if (job.stderr.length > 200_000) job.stderr = job.stderr.slice(-150_000); });

    child.on("error", (err) => {
      job.status = "error";
      job.endedAt = new Date().toISOString();
      job.stderr += `\n[spawn error] ${err.message}`;
    });

    child.on("exit", async (code) => {
      job.code = code;
      job.endedAt = new Date().toISOString();
      if (code !== 0) {
        job.status = "error";
        return;
      }
      try {
        const r = await pool.query(
          `UPDATE knowledge_chunks
              SET embedding_status = 'stale'
            WHERE brand = $1
              AND content_enriched IS NOT NULL
              AND embedding_status = 'ok'`,
          [brand]
        );
        job.stalemarked = r.rowCount || 0;
        job.status = "ok";
        try {
          const obj = _readBrandAliases();
          if (obj[brand]) {
            obj[brand].reenriched_at = job.endedAt;
            obj[brand].updated_at = job.endedAt;
            _writeBrandAliasesAtomic(obj);
          }
        } catch (e2) {
          job.stderr += `\n[reenriched_at write error] ${e2.message}`;
        }
      } catch (e) {
        job.status = "error";
        job.stderr += `\n[stale-mark error] ${e.message}`;
      }
    });

    return { ok: true, brand, job: { status: job.status, startedAt: job.startedAt, pid: job.pid } };
  } catch (e) {
    job.status = "error";
    job.endedAt = new Date().toISOString();
    job.stderr += `\n[spawn fail] ${e.message}`;
    return { ok: false, reason: "spawn_fail", error: String(e?.message || e) };
  }
}

// Permissive boolean coerce for ingest form bodies (multipart sends strings).
export function _coerceBool(v) {
  if (v === true || v === false) return v;
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return undefined;
}

// Auto re-enrich coordinator — called from ingest endpoints.
export function maybeAutoReenrich({ brand, perRequestFlag, source }) {
  const { getRagSettings } = deps();
  const RAG_SETTINGS = getRagSettings();
  const b = String(brand || "").trim();
  if (!b) return { spawned: false, reason: "no_brand" };
  const globalOn = RAG_SETTINGS?.autoReEnrichOnIngest === true;
  const effective = (perRequestFlag === true || perRequestFlag === false)
    ? perRequestFlag
    : globalOn;
  if (!effective) return { spawned: false, reason: "disabled" };
  const existing = _brandReenrichJobs.get(b);
  if (existing && existing.status === "running") {
    return { spawned: false, reason: "already_running", brand: b };
  }
  const r = spawnBrandReenrich(b);
  if (r.ok) {
    console.log(`[auto-reenrich] spawned brand=${b} source=${source} pid=${r.job?.pid}`);
    return { spawned: true, brand: b, pid: r.job?.pid, source };
  }
  console.warn(`[auto-reenrich] skip brand=${b} source=${source} reason=${r.reason}`);
  return { spawned: false, reason: r.reason, brand: b };
}

export async function triggerSyncAutoReenrich(brandSet, jobId) {
  const { getRagSettings } = deps();
  const RAG_SETTINGS = getRagSettings();
  if (!RAG_SETTINGS?.autoReEnrichOnIngest) return;
  if (!brandSet || brandSet.size === 0) return;
  const cap = 3;
  const brands = [...brandSet];
  const toRun = brands.slice(0, cap);
  const skipped = brands.slice(cap);
  if (skipped.length) {
    console.log(`[sync:auto-reenrich] job=${jobId} fan-out cap=${cap} ran=[${toRun.join(",")}] skipped=[${skipped.join(",")}]`);
  }
  for (const brand of toRun) {
    try {
      const result = maybeAutoReenrich({ brand, perRequestFlag: null, source: `sync:${jobId}` });
      if (result?.spawned) {
        console.log(`[sync:auto-reenrich] spawned brand=${brand} pid=${result.pid} job=${jobId}`);
      }
    } catch (e) {
      console.warn(`[sync:auto-reenrich] brand=${brand} job=${jobId} failed: ${e?.message || e}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export function mountBrandAliasesRoutes({ app }) {
  app.get("/api/rag/brand-aliases", async (_req, res) => {
    try {
      const { pool, deriveBrandFromKnowledgeSource } = deps();
      const aliases = await _recoverAliasesFromEnrichedChunks(pool, _readBrandAliases());
      const { rows } = await pool.query(`
        SELECT
          COALESCE(brand, '') AS brand,
          COUNT(*)::int       AS chunk_count,
          MAX(enriched_at)    AS last_enriched_at
          FROM knowledge_chunks
         GROUP BY 1
         ORDER BY chunk_count DESC
      `);
      const brandMap = new Map();
      for (const r of rows) {
        if (!r.brand || r.brand.startsWith("_")) continue;
        brandMap.set(r.brand, {
          name: r.brand,
          chunkCount: r.chunk_count,
          lastEnrichedAt: r.last_enriched_at ? new Date(r.last_enriched_at).toISOString() : null,
        });
      }

      const sourceBrands = await pool.query(`
        SELECT id, name, type, tag, url
          FROM knowledge_sources
         WHERE parent_id IS NULL
         ORDER BY created_at DESC
      `).catch(() => ({ rows: [] }));
      for (const s of sourceBrands.rows || []) {
        const name = deriveBrandFromKnowledgeSource(s);
        if (!name || name.startsWith("_") || brandMap.has(name)) continue;
        brandMap.set(name, { name, chunkCount: 0, lastEnrichedAt: null });
      }

      const brands = Array.from(brandMap.values())
        .sort((a, b) => b.chunkCount - a.chunkCount || a.name.localeCompare(b.name))
        .map(b => {
          const entry = _aliasEntryForBrand(aliases, b.name);
          const job = _brandReenrichJobs.get(b.name) || null;
          const reenrichedAt = entry.reenriched_at || b.lastEnrichedAt;
          const stale = !!(entry.updated_at && (!reenrichedAt || new Date(entry.updated_at) > new Date(reenrichedAt)));
          return {
            name: b.name,
            chunkCount: b.chunkCount,
            lastEnrichedAt: b.lastEnrichedAt,
            aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
            aliasesUpdatedAt: entry.updated_at || null,
            reenrichedAt,
            stale,
            reenrichJob: job ? {
              status: job.status,
              startedAt: job.startedAt,
              endedAt: job.endedAt || null,
              exitCode: typeof job.code === "number" ? job.code : null,
            } : null,
          };
        });
      res.json({ ok: true, brands, path: BRAND_ALIASES_PATH });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/rag/brand-aliases", (req, res) => {
    const body = req.body || {};
    const brand = String(body.brand || "").trim();
    if (!brand) return res.status(400).json({ ok: false, error: "brand required" });
    if (brand.length > 120) return res.status(400).json({ ok: false, error: "brand too long" });
    const aliases = _sanitizeAliasList(body.aliases);
    const confirmDelete = body.confirmDelete === true;
    try {
      const obj = _readBrandAliases();
      const existingKeys = _aliasKeysForBrand(obj, brand);
      const existingEntry = _aliasEntryForBrand(obj, brand);
      const before = Array.isArray(existingEntry.aliases) ? existingEntry.aliases.length : 0;
      // Safety guard: prevent silent wipe of existing aliases by an empty save.
      // Caller must explicitly pass { confirmDelete: true } to clear all aliases.
      if (aliases.length === 0 && before > 0 && !confirmDelete) {
        console.warn(`[brand-aliases:write] BLOCKED empty save brand=${brand} before=${before}`);
        return res.status(409).json({
          ok: false,
          reason: "empty_save_blocked",
          brand,
          before,
          hint: "send { confirmDelete: true } to wipe all aliases for this brand",
        });
      }
      if (aliases.length === 0) {
        for (const key of existingKeys) delete obj[key];
      } else {
        for (const key of existingKeys) if (key !== brand) delete obj[key];
        obj[brand] = { ...existingEntry, aliases, updated_at: new Date().toISOString() };
      }
      _writeBrandAliasesAtomic(obj);
      console.log(`[brand-aliases:write] brand=${brand} before=${before} after=${aliases.length}${confirmDelete ? " (confirmDelete)" : ""}`);
      res.json({ ok: true, brand, aliases, count: aliases.length, before });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });


  app.post("/api/rag/brand-aliases/reenrich", (req, res) => {
    const body = req.body || {};
    const brand = String(body.brand || "").trim();
    if (!brand) return res.status(400).json({ ok: false, error: "brand required" });
    const r = spawnBrandReenrich(brand);
    if (!r.ok && r.reason === "already_running") {
      return res.status(409).json({ ok: false, error: "already_running", job: r.job });
    }
    if (!r.ok) {
      return res.status(500).json({ ok: false, error: r.error || r.reason });
    }
    res.status(202).json({ ok: true, brand, job: r.job });
  });

  app.get("/api/rag/brand-aliases/reenrich", (req, res) => {
    const brand = String(req.query?.brand || "").trim();
    if (!brand) return res.status(400).json({ ok: false, error: "brand required" });
    const job = _brandReenrichJobs.get(brand);
    if (!job) return res.json({ ok: true, brand, job: null });
    res.json({
      ok: true,
      brand,
      job: {
        status: job.status,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        pid: job.pid,
        exitCode: typeof job.code === "number" ? job.code : null,
        stalemarked: job.stalemarked ?? null,
        stdoutTail: job.stdout.slice(-2000),
        stderrTail: job.stderr.slice(-2000),
      },
    });
  });
}
