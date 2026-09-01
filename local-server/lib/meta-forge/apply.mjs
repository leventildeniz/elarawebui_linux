// local-server/lib/meta-forge/apply.mjs
// v2 (2026-07-05) — Auto-Creator ajan hattı.
//
// Değişiklikler:
//   • Hybrid approval: kind=tool auto-live (smoke ok + confidence≥0.7);
//     kind=agent|skill|pack → pending_review (disk yazılır, live=false).
//   • Idempotency: intent_hash = sha256(kind:normalized(intent)); DB unique
//     index + preflight check → aynı niyet iki kez yazılmaz (deduped döner).
//   • Budget guard: opts.maxItems (default 3) → fazlası deferred listesine.
//   • Sandbox smoke (kind=tool): tools/<slug>.py __probe → 5s timeout.
//     Fail → auto-live iptal, pending_review'a düşer.
//   • Rollback zinciri: forge_plans.applied_files jsonb (disk + capability id
//     izleri) her başarılı yazımda güncellenir.
//   • Rozet: capabilities.origin='auto_forge' + forged_by + forged_at +
//     confidence + intent_hash + reasoning her item için işlenir.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { lintPython } from "./guard.mjs";
import { refreshCapabilitiesAfterForgeApply } from "./refresh.mjs";
import { runToolSmoke } from "./smoke.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const TOOLS_DIR = path.join(PROJECT_ROOT, "tools");
const AGENTS_DIR = path.join(PROJECT_ROOT, "agents");
const TRASH_DIR = path.join(PROJECT_ROOT, ".forge-trash");

const AUTO_LIVE_CONFIDENCE_MIN = 0.7;
const DEFAULT_MAX_ITEMS_PER_TURN = 3;

function safeFileSlug(raw) {
  const slug = String(raw || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  if (!slug) throw new Error("empty slug");
  return slug;
}

function safeSubdir(raw) {
  if (!raw) return "";
  const cleaned = String(raw)
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9_/-]/g, "_")
    .replace(/\.+/g, "_")
    .replace(/^\/+|\/+$/g, "");
  if (!cleaned) return "";
  if (cleaned.includes("..")) throw new Error(`invalid dir: ${raw}`);
  return cleaned;
}

function assertInside(baseDir, target) {
  const resolved = path.resolve(target);
  const base = path.resolve(baseDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes ${path.relative(PROJECT_ROOT, base)}/: ${path.relative(PROJECT_ROOT, resolved)}`);
  }
  return resolved;
}

// Deterministic intent hash — same kind + normalized intent = same hash.
function computeIntentHash(kind, intentRaw) {
  const norm = String(intentRaw || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha256").update(`${kind}:${norm}`).digest("hex");
}

function clampConfidence(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

// Look up existing capability by intent_hash or exact slug/kind. Returns row or null.
async function findDuplicateByHash(pool, intentHash, item = {}) {
  if (!intentHash && !item?.slug) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, kind, live, review_status, forged_at
         FROM capabilities
        WHERE (origin='auto_forge' AND intent_hash=$1)
           OR (slug=$2 AND kind=$3)
        ORDER BY CASE WHEN origin='auto_forge' AND intent_hash=$1 THEN 0 ELSE 1 END
        LIMIT 1`,
      [intentHash, item?.slug || null, item?.kind || null],
    );
    return rows[0] || null;
  } catch {
    // Column may not exist yet on cold DBs — treat as no-dup.
    return null;
  }
}

// Best-effort stamp capabilities row with auto-forge metadata.
// Safe if columns don't exist (catches + logs).
async function stampCapabilityMeta(pool, { slug, kind, intentHash, confidence, reasoning, reviewStatus, live, forgedBy }) {
  try {
    await pool.query(
      `UPDATE capabilities
          SET origin        = 'auto_forge',
              forged_by     = $2,
              forged_at     = now(),
              review_status = $3,
              confidence    = $4,
              intent_hash   = $5,
              reasoning     = $6,
              live          = $7
        WHERE slug = $1 AND kind = $8`,
      [slug, forgedBy || "meta-forge-master", reviewStatus, confidence, intentHash, reasoning || null, !!live, kind],
    );
  } catch (e) {
    console.warn("[forge:apply] stamp meta failed", slug, e?.message || e);
  }
}

async function applySkillCreate(pool, planId, item, meta) {
  const slug = String(item.slug).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
  const name = String(item.name || slug).slice(0, 120);
  const instructions = String(item.body || item.instructions || item.source || "").slice(0, 20000);
  const description = String(item.description || "").slice(0, 500);
  if (!instructions.trim()) throw new Error(`skill ${slug}: body/instructions required`);
  const r = await pool.query(
    `INSERT INTO skills (id, slug, name, description, instructions, script_kind, script_body, is_system)
     VALUES ($1, $2, $3, $4, $5, 'prompt', '', false)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,
       description=EXCLUDED.description, instructions=EXCLUDED.instructions,
       updated_at=now()
     RETURNING id`,
    [slug, slug, name, description, instructions],
  );
  await pool.query(
    `INSERT INTO forge_artifacts (plan_id, kind, slug, db_row_id)
     VALUES ($1, 'skill', $2, $3) ON CONFLICT DO NOTHING`,
    [planId, slug, r.rows[0].id],
  );
  await stampCapabilityMeta(pool, { slug, kind: "skill", ...meta });
  return { kind: "skill", slug, id: r.rows[0].id, ...meta };
}

async function applyPackCreate(pool, planId, item, meta) {
  const slug = String(item.slug).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
  const name = String(item.name || slug).slice(0, 120);
  const description = String(item.description || "").slice(0, 500);
  const actionIds = Array.isArray(item.tools) ? item.tools : [];
  const skillIds = Array.isArray(item.skills) ? item.skills : [];
  const brandKeywords = Array.isArray(item.brand_keywords) ? item.brand_keywords : [];
  const r = await pool.query(
    `INSERT INTO capability_packs (id, name, description, action_ids, skill_ids, brand_keywords, is_system)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, false)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       action_ids=EXCLUDED.action_ids, skill_ids=EXCLUDED.skill_ids,
       brand_keywords=EXCLUDED.brand_keywords
     RETURNING id`,
    [slug, name, description, JSON.stringify(actionIds), JSON.stringify(skillIds), JSON.stringify(brandKeywords)],
  );
  await pool.query(
    `INSERT INTO forge_artifacts (plan_id, kind, slug, db_row_id)
     VALUES ($1, 'pack', $2, $3) ON CONFLICT DO NOTHING`,
    [planId, slug, r.rows[0].id],
  );
  await stampCapabilityMeta(pool, { slug, kind: "pack", ...meta });
  return { kind: "pack", slug, id: r.rows[0].id, ...meta };
}

function normalizePythonSource(src, kind, slug) {
  let s = String(src || "");
  s = s.replace(/^\uFEFF/, "").replace(/^\s*\n+/, "");
  if (!/^#!\/usr\/bin\/env\s+python3\s*\n/.test(s)) {
    s = `#!/usr/bin/env python3\n${s}`;
  }
  if (kind === "agent" && !/^#\s*@tools:/m.test(s)) {
    const nl = s.indexOf("\n");
    s = s.slice(0, nl + 1) + "# @tools: -\n" + s.slice(nl + 1);
  }
  if (kind === "tool" && !/^#\s*@tool:\s*[a-zA-Z0-9_-]+/m.test(s)) {
    const nl = s.indexOf("\n");
    s = s.slice(0, nl + 1) + `# @tool: ${slug}\n` + s.slice(nl + 1);
  }
  return s;
}

async function applyToolCreate(pool, planId, item, meta) {
  const slug = safeFileSlug(item.slug);
  const source = normalizePythonSource(item.source || item.body || "", "tool", slug);
  const lint = lintPython(source, { kind: "tool" });
  if (!lint.ok) throw new Error(`lint: ${lint.errors.join("; ")}`);
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const filePath = path.join(TOOLS_DIR, `${slug}.py`);
  assertInside(TOOLS_DIR, filePath);
  const rel = path.relative(PROJECT_ROOT, filePath);
  if (fs.existsSync(filePath) && !item.overwrite) {
    throw new Error(`tool file exists: ${rel} (set overwrite:true to replace)`);
  }
  fs.writeFileSync(filePath, source, { mode: 0o644 });

  // Sandbox smoke — auto-live only when smoke passes AND confidence≥threshold.
  const smoke = await runToolSmoke(filePath).catch((e) => ({ ok: false, stderr: String(e?.message || e), ms: 0 }));
  const conf = meta.confidence ?? 0;
  const canAutoLive = smoke.ok && conf >= AUTO_LIVE_CONFIDENCE_MIN;
  const effectiveMeta = {
    ...meta,
    live: canAutoLive,
    reviewStatus: canAutoLive ? "approved" : "pending_review",
  };

  await pool.query(
    `INSERT INTO forge_artifacts (plan_id, kind, slug, disk_path)
     VALUES ($1, 'tool', $2, $3) ON CONFLICT DO NOTHING`,
    [planId, slug, rel],
  );
  await stampCapabilityMeta(pool, { slug, kind: "tool", ...effectiveMeta });
  return { kind: "tool", slug, disk_path: rel, smoke, autoLive: canAutoLive, ...effectiveMeta };
}

async function applyAgentCreate(pool, planId, item, meta) {
  const slug = safeFileSlug(item.slug);
  const source = normalizePythonSource(item.source || item.body || "", "agent");
  const lint = lintPython(source, { kind: "agent" });
  if (!lint.ok) throw new Error(`lint: ${lint.errors.join("; ")}`);
  const subdir = safeSubdir(item.dir);
  const targetDir = subdir ? path.join(AGENTS_DIR, subdir) : AGENTS_DIR;
  assertInside(AGENTS_DIR, targetDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, `${slug}.py`);
  assertInside(AGENTS_DIR, filePath);
  const rel = path.relative(PROJECT_ROOT, filePath);
  if (fs.existsSync(filePath) && !item.overwrite) {
    throw new Error(`agent file exists: ${rel} (set overwrite:true to replace)`);
  }
  fs.writeFileSync(filePath, source, { mode: 0o644 });
  await pool.query(
    `INSERT INTO forge_artifacts (plan_id, kind, slug, disk_path)
     VALUES ($1, 'agent', $2, $3) ON CONFLICT DO NOTHING`,
    [planId, slug, rel],
  );
  // Agents always pending_review (hybrid gate — never auto-live).
  await stampCapabilityMeta(pool, { slug, kind: "agent", ...meta });
  return { kind: "agent", slug, disk_path: rel, autoLive: false, ...meta };
}

/**
 * Apply an approved plan.
 * @param {object} opts
 * @param {import('pg').Pool} opts.pool
 * @param {string} opts.planId
 * @param {object} opts.plan   — validated ForgePlan { create, reuse, ... }
 * @param {number} [opts.maxItems=3] — budget guard.
 * @param {string} [opts.forgedBy='meta-forge-master']
 * @returns {Promise<{applied, failed, deduped, deferred, appliedFiles}>}
 */
export async function applyForgePlan({ pool, planId, plan, maxItems = DEFAULT_MAX_ITEMS_PER_TURN, forgedBy = "meta-forge-master" }) {
  const applied = [];
  const failed = [];
  const deduped = [];
  const deferred = [];
  const appliedFiles = [];
  const itemIntentHashes = [];

  const items = Array.isArray(plan?.create) ? plan.create : [];
  const cap = Math.max(1, Number(maxItems) || DEFAULT_MAX_ITEMS_PER_TURN);

  let processed = 0;
  for (const item of items) {
    // Budget guard — first N applied, rest deferred.
    if (processed >= cap) {
      deferred.push({ kind: item.kind, slug: item.slug, reason: `budget_cap:${cap}` });
      continue;
    }

    const intentRaw = item.intent || item.description || item.name || item.slug;
    const intentHash = computeIntentHash(item.kind, intentRaw);
    itemIntentHashes.push({ kind: item.kind, slug: item.slug, intent_hash: intentHash });
    const confidence = clampConfidence(item.confidence ?? plan?.confidence);
    const reasoning = String(item.reasoning || plan?.reasoning || "").slice(0, 1000);

    // Idempotency preflight — check capabilities.intent_hash AND forge_plans.intent_hash.
    // Belt+suspenders: capability row may not exist yet on a cold DB, but the
    // previous plan's forge_plans row does.
    const dup = await findDuplicateByHash(pool, intentHash, { slug: item.slug, kind: item.kind });
    let planDup = null;
    if (!dup) {
      try {
        const { rows } = await pool.query(
          `SELECT id, status, applied_files FROM forge_plans
            WHERE status IN ('applied','approved')
              AND id <> $2
              AND (
                   intent_hash=$1
                OR COALESCE(smoke_report->'intent_hashes','[]'::jsonb) @> $3::jsonb
                OR EXISTS (
                     SELECT 1
                       FROM jsonb_array_elements(COALESCE(plan_json->'create','[]'::jsonb)) AS elem
                      WHERE elem->>'kind' = $4 AND elem->>'slug' = $5
                   )
              )
            ORDER BY created_at DESC LIMIT 1`,
          [
            intentHash,
            planId || "00000000-0000-0000-0000-000000000000",
            JSON.stringify([{ kind: item.kind, slug: item.slug, intent_hash: intentHash }]),
            item.kind,
            item.slug,
          ],
        );
        planDup = rows[0] || null;
      } catch { /* column may be missing */ }
    }
    if (dup || planDup) {
      deduped.push({
        kind: item.kind,
        slug: item.slug,
        existing_slug: dup?.slug || null,
        existing_id: dup?.id || null,
        existing_plan_id: planDup?.id || null,
        review_status: dup?.review_status || null,
        live: dup?.live ?? null,
        reason: dup ? "capability_intent_hash" : "plan_intent_hash",
      });
      if (dup) {
        try { await pool.query(`UPDATE capabilities SET forged_at=now() WHERE id=$1`, [dup.id]); } catch { /* */ }
      }
      processed++;
      continue;
    }

    const meta = {
      intentHash,
      confidence,
      reasoning,
      reviewStatus: item.kind === "tool" ? "pending_review" : "pending_review", // tool overwritten inside applyToolCreate
      live: false,
      forgedBy,
    };

    try {
      let res;
      if (item.kind === "skill")      res = await applySkillCreate(pool, planId, item, meta);
      else if (item.kind === "pack")  res = await applyPackCreate(pool, planId, item, meta);
      else if (item.kind === "tool")  res = await applyToolCreate(pool, planId, item, meta);
      else if (item.kind === "agent") res = await applyAgentCreate(pool, planId, item, meta);
      else {
        failed.push({ kind: item.kind, slug: item.slug, reason: `unknown kind: ${item.kind}` });
        processed++;
        continue;
      }
      applied.push(res);
      if (res.disk_path) appliedFiles.push({ kind: res.kind, slug: res.slug, disk_path: res.disk_path });
      else if (res.id)   appliedFiles.push({ kind: res.kind, slug: res.slug, db_row_id: res.id });
    } catch (e) {
      failed.push({ kind: item.kind, slug: item.slug, reason: String(e?.message || e) });
    }
    processed++;
  }

  // Stamp plan-level intent_hash on forge_plans (so next-turn dedup works even
  // if the capability row hasn't materialized yet).
  const planIntentRaw = plan?.intent || items[0]?.intent || items[0]?.description || "";
  const planIntentHash = planIntentRaw ? computeIntentHash("plan", planIntentRaw) : null;

  // Persist applied_files + deferred + smoke report + intent_hash on forge_plans.
  if (planId) {
    try {
      await pool.query(
        `UPDATE forge_plans
            SET applied_files = $2::jsonb,
                smoke_report  = $3::jsonb,
                intent_hash   = COALESCE($4, intent_hash),
                updated_at    = now()
          WHERE id = $1`,
        [
          planId,
          JSON.stringify(appliedFiles),
          JSON.stringify({
            deduped,
            deferred,
            intent_hashes: itemIntentHashes,
            smoke: applied.filter((a) => a.smoke).map((a) => ({ slug: a.slug, ok: a.smoke.ok, ms: a.smoke.ms })),
          }),
          planIntentHash,
        ],
      );
    } catch (e) {
      console.warn("[forge:apply] applied_files persist failed", e?.message || e);
    }
  }

  // Registry refresh — disk-scan → action_library → capabilities.
  // MUST run before final re-stamp: syncCapabilitiesFromSources() creates the
  // capabilities row for newly-forged tools/agents; earlier UPDATE stamps hit 0
  // rows because the row didn't exist yet.
  if (applied.length > 0) {
    try {
      const refreshed = await refreshCapabilitiesAfterForgeApply({ pool, plan });
      console.log("[forge:apply] registry refreshed", {
        applied: applied.length,
        deduped: deduped.length,
        deferred: deferred.length,
        scans: refreshed?.scans ? Object.keys(refreshed.scans) : null,
      });
    } catch (err) {
      console.error("[forge:apply] REGISTRY REFRESH FAILED", err?.message, err?.stack);
    }

    // CRITICAL: re-stamp meta AFTER refresh so intent_hash actually persists on
    // the capabilities row. Without this the idempotency check on the next turn
    // finds no duplicate and the model forges the same tool again.
    for (const res of applied) {
      try {
        const effective = {
          intentHash: res.intentHash,
          confidence: res.confidence,
          reasoning: res.reasoning,
          reviewStatus: res.reviewStatus || "pending_review",
          live: !!res.live,
          forgedBy: res.forgedBy || forgedBy,
        };
        await stampCapabilityMeta(pool, { slug: res.slug, kind: res.kind, ...effective });
      } catch (e) {
        console.warn("[forge:apply] post-refresh re-stamp failed", res.slug, e?.message || e);
      }
    }
  }

  return { applied, failed, deduped, deferred, appliedFiles };
}

/**
 * Rollback (undo): delete DB rows (skill/pack); move disk artifacts to .forge-trash/.
 * Same as before; retained for /api/meta-forge/plans/:id/undo endpoint.
 */
export async function rollbackForgePlan({ pool, planId }) {
  const { rows } = await pool.query(
    `SELECT kind, slug, db_row_id, disk_path FROM forge_artifacts WHERE plan_id=$1`,
    [planId],
  );
  const removed = [];
  for (const a of rows) {
    try {
      if (a.kind === "skill" && a.db_row_id) {
        await pool.query(`DELETE FROM skills WHERE id=$1`, [a.db_row_id]);
        removed.push({ kind: "skill", slug: a.slug });
      } else if (a.kind === "pack" && a.db_row_id) {
        await pool.query(`DELETE FROM capability_packs WHERE id=$1 AND is_system=false`, [a.db_row_id]);
        removed.push({ kind: "pack", slug: a.slug });
      } else if ((a.kind === "tool" || a.kind === "agent") && a.disk_path) {
        const abs = path.resolve(PROJECT_ROOT, a.disk_path);
        const baseDir = a.kind === "tool" ? TOOLS_DIR : AGENTS_DIR;
        assertInside(baseDir, abs);
        if (fs.existsSync(abs)) {
          fs.mkdirSync(TRASH_DIR, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const trashPath = path.join(TRASH_DIR, `${a.kind}-${a.slug}-${stamp}.py`);
          fs.renameSync(abs, trashPath);
        }
        removed.push({ kind: a.kind, slug: a.slug, disk_path: a.disk_path });
      }
      // Also clean the capability row (any origin) for this slug/kind.
      try {
        await pool.query(`DELETE FROM capabilities WHERE slug=$1 AND kind=$2 AND origin='auto_forge'`, [a.slug, a.kind]);
      } catch { /* */ }
    } catch (e) {
      removed.push({ kind: a.kind, slug: a.slug, error: String(e?.message || e) });
    }
  }
  await pool.query(`DELETE FROM forge_artifacts WHERE plan_id=$1`, [planId]);
  return { removed };
}

// Exported for testing / external smoke.
export { computeIntentHash, AUTO_LIVE_CONFIDENCE_MIN, DEFAULT_MAX_ITEMS_PER_TURN };
