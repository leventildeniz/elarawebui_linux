// =============================================================================
// plan-and-execute.mjs — Faz 6 Planner v0
//
// Amaç: RAG'a ek olarak, modelin "bu soru hangi tool'u + hangi sırayla
// gerektirir?" kararını ayrı bir LLM step'inde verip, mevcut chat akışına
// EK CONTEXT olarak iliştiren orkestratör. Mevcut akışı hiç değiştirmiyor —
// settings.enabled=false ise bir no-op döner. Tamamen opt-in.
//
// Modlar:
//   • shadow  → çalışır, log atar, cevabı etkilemez (1 hafta veri toplamak için)
//   • active  → çalışır + tool çıktılarını "PLANNER OUTPUTS" bloğu olarak ekler
//
// Telemetry: planner_runs tablosu — her karar + tool sırası + latency + grounded.
// Settings: file-backed (.planner-settings.json) — RAG_SETTINGS ile aynı patern.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolvePrompt } from "./system-prompts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "..", ".planner-settings.json");

const DEFAULTS = {
  enabled: false,                     // master switch
  mode: "shadow",                     // shadow | active
  model: null,                        // null → runtime default model
  maxTools: 3,                        // her turda en fazla N tool çağrısı
  toolTimeoutMs: 8000,                // her tool için ceiling
  plannerTimeoutMs: 4000,             // planner LLM step için ceiling
  minScoreForActive: 0.35,            // active modda RAG top1 bunun altındaysa planner devreye girer
  allowedKinds: ["tool", "skill"],    // hangi capability türlerini çağırabilir
  systemPrompt: null,                 // null → default planner promptu
  crossCheckEnabled: true,            // tool sonucu RAG ile çelişiyorsa flagle
  // Auto-fallback: sliding window'da hata oranı eşiği aşarsa enabled=false'a düşür.
  autoFallback: {
    enabled: true,
    windowSize: 20,                   // son N koşum
    errorRateThreshold: 0.5,          // %50+ hata → kapan
    minRuns: 5,                       // en az bu kadar koşum birikmeden tetikleme
  },
  _autoFallbackTriggered: null,       // last trigger timestamp (read-only)
  updatedAt: null,
};

let SETTINGS = { ...DEFAULTS };
let _pool = null;
let _deps = null; // { llmChat, listCapabilities, executeCapability, logger }

// ---------------------------------------------------------------- bootstrap

export async function initPlanner(pool, deps = {}) {
  _pool = pool;
  _deps = {
    llmChat:           deps.llmChat           || null,   // async ({ messages, maxTokens, temperature, jsonMode, timeoutMs, model }) → string
    listCapabilities:  deps.listCapabilities  || null,   // async ({ enabledOnly }) → caps[]
    executeCapability: deps.executeCapability || null,   // async (cap, args, ctx) → result
    logger:            deps.logger            || ((...a) => console.log("[planner]", ...a)),
    // 2026-06-03 (Tur 2) — UI tek mercii. Boş ise default planner sysprompt.
    getRagSettings:    deps.getRagSettings    || (() => ({})),
  };
  loadSettings();
  await ensureSchema().catch((e) => _deps.logger(`schema bootstrap failed: ${e.message || e}`));
  _deps.logger(`ready · enabled=${SETTINGS.enabled} mode=${SETTINGS.mode} maxTools=${SETTINGS.maxTools}`);
}

async function ensureSchema() {
  if (!_pool) return;
  await _pool.query(`
    CREATE TABLE IF NOT EXISTS planner_runs (
      id              text PRIMARY KEY,
      thread_id       uuid,
      username        text,
      session_id      text,
      mode            text NOT NULL CHECK (mode IN ('shadow','active')),
      question        text NOT NULL,
      plan            jsonb NOT NULL DEFAULT '{}'::jsonb,
      tools_called    jsonb NOT NULL DEFAULT '[]'::jsonb,
      rag_top1        numeric,
      rag_hit         boolean,
      grounded        boolean,
      contradiction   boolean DEFAULT false,
      latency_ms      integer,
      planner_ms      integer,
      tools_ms        integer,
      error           text,
      answer_preview  text,
      created_at      timestamptz NOT NULL DEFAULT now(),
      finished_at     timestamptz
    );
    CREATE INDEX IF NOT EXISTS idx_planner_runs_created ON planner_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_planner_runs_mode    ON planner_runs(mode);
    CREATE INDEX IF NOT EXISTS idx_planner_runs_user    ON planner_runs(lower(username));
  `);
}

// ---------------------------------------------------------------- settings

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const j = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      SETTINGS = sanitize({ ...DEFAULTS, ...j });
    }
  } catch (e) {
    console.warn(`[planner] settings load failed: ${e.message || e}`);
    SETTINGS = { ...DEFAULTS };
  }
}

function persistSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(SETTINGS, null, 2));
  } catch (e) {
    console.warn(`[planner] settings save failed: ${e.message || e}`);
  }
}

function sanitize(patch) {
  const out = { ...SETTINGS, ...patch };
  out.enabled = !!out.enabled;
  out.mode = out.mode === "active" ? "active" : "shadow";
  out.maxTools = Math.min(8, Math.max(0, Number(out.maxTools) || 0));
  out.toolTimeoutMs = Math.min(60_000, Math.max(500, Number(out.toolTimeoutMs) || 8000));
  out.plannerTimeoutMs = Math.min(20_000, Math.max(500, Number(out.plannerTimeoutMs) || 4000));
  out.minScoreForActive = Math.min(1, Math.max(0, Number(out.minScoreForActive) || 0));
  if (!Array.isArray(out.allowedKinds) || !out.allowedKinds.length) out.allowedKinds = ["tool", "skill"];
  out.allowedKinds = out.allowedKinds.filter((k) => ["tool", "skill", "agent", "workflow"].includes(k));
  out.crossCheckEnabled = !!out.crossCheckEnabled;
  out.model = out.model && typeof out.model === "string" ? out.model.trim() : null;
  out.systemPrompt = out.systemPrompt && typeof out.systemPrompt === "string" ? out.systemPrompt : null;
  // auto-fallback nested object
  const af = (out.autoFallback && typeof out.autoFallback === "object") ? out.autoFallback : {};
  out.autoFallback = {
    enabled: af.enabled !== false,
    windowSize: Math.min(200, Math.max(5, Number(af.windowSize) || 20)),
    errorRateThreshold: Math.min(1, Math.max(0.05, Number(af.errorRateThreshold) || 0.5)),
    minRuns: Math.min(100, Math.max(3, Number(af.minRuns) || 5)),
  };
  out._autoFallbackTriggered = out._autoFallbackTriggered || null;
  return out;
}

export function getSettings() { return { ...SETTINGS, defaults: DEFAULTS }; }

export function updateSettings(patch = {}) {
  SETTINGS = sanitize({ ...patch });
  SETTINGS.updatedAt = new Date().toISOString();
  persistSettings();
  return getSettings();
}

// ---------------------------------------------------------------- main entry

/**
 * Plan a turn. Returns:
 *   { skipped: true } when disabled or no deps
 *   { skipped: false, mode, plan, tools, contextBlock, plannerRunId, ms }
 *
 * `contextBlock` is the string to prepend to the user prompt in active mode.
 * Caller is responsible for honoring shadow/active distinction.
 */
export async function runPlanner({
  q,
  threadId = null,
  username = null,
  sessionId = null,
  ragTop1 = 0,
  ragRows = [],
}) {
  const t0 = Date.now();
  if (!SETTINGS.enabled || !_deps?.llmChat || !_deps?.listCapabilities) {
    return { skipped: true, reason: "disabled" };
  }
  const query = String(q || "").trim();
  if (!query) return { skipped: true, reason: "empty" };

  // In active mode, only intervene when RAG isn't strong on its own.
  if (SETTINGS.mode === "active" && Number(ragTop1) >= 1 - SETTINGS.minScoreForActive) {
    // RAG already covers it; still log for telemetry.
    const id = await recordRun({
      threadId, username, sessionId, query, mode: SETTINGS.mode,
      plan: { skipped: "rag_sufficient", ragTop1 },
      ragTop1, plannerMs: 0, toolsMs: 0,
    });
    return { skipped: true, reason: "rag_sufficient", plannerRunId: id };
  }

  // ----- 1) catalog
  let caps = [];
  try {
    caps = await _deps.listCapabilities({ enabledOnly: true });
  } catch (e) {
    _deps.logger(`catalog load failed: ${e.message || e}`);
  }
  const allowed = caps.filter((c) => SETTINGS.allowedKinds.includes(c.kind));
  if (!allowed.length) {
    return { skipped: true, reason: "no_capabilities" };
  }

  // ----- 2) ask planner LLM for a plan
  const tPlan0 = Date.now();
  const plan = await askPlanner(query, allowed, ragRows).catch((e) => {
    _deps.logger(`planner step failed: ${e.message || e}`);
    return { steps: [], reasoning: `planner_error: ${String(e.message || e).slice(0, 200)}` };
  });
  const plannerMs = Date.now() - tPlan0;

  // ----- 3) execute selected tools (bounded by maxTools)
  const tTools0 = Date.now();
  const requested = Array.isArray(plan?.steps) ? plan.steps.slice(0, SETTINGS.maxTools) : [];
  const toolResults = [];
  for (const step of requested) {
    const cap = allowed.find((c) => c.id === step.capabilityId || c.slug === step.slug);
    if (!cap) {
      toolResults.push({ slug: step.slug || step.capabilityId, ok: false, error: "capability_not_found" });
      continue;
    }
    if (!_deps.executeCapability) {
      toolResults.push({ slug: cap.slug, ok: false, error: "executor_unavailable" });
      continue;
    }
    const tCall = Date.now();
    try {
      const res = await Promise.race([
        _deps.executeCapability(cap, step.args || {}, { threadId, username, sessionId, source: "planner" }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("tool_timeout")), SETTINGS.toolTimeoutMs)),
      ]);
      toolResults.push({
        slug: cap.slug, kind: cap.kind, ok: true,
        ms: Date.now() - tCall,
        output: truncate(res, 4000),
      });
    } catch (e) {
      toolResults.push({
        slug: cap.slug, kind: cap.kind, ok: false,
        ms: Date.now() - tCall,
        error: String(e.message || e).slice(0, 200),
      });
    }
  }
  const toolsMs = Date.now() - tTools0;

  // ----- 4) shape a context block (only used in active mode by caller)
  const contextBlock = toolResults.length ? formatContextBlock(plan, toolResults) : "";

  // ----- 4b) cross-check: tool output vs RAG rows — kabaca sayısal/entity çelişki
  const contradiction = SETTINGS.crossCheckEnabled
    ? detectContradiction(toolResults, ragRows)
    : false;

  // ----- 5) audit
  const plannerRunId = await recordRun({
    threadId, username, sessionId, query, mode: SETTINGS.mode,
    plan, toolsCalled: toolResults,
    ragTop1, ragHit: Number(ragTop1) > 0,
    contradiction,
    plannerMs, toolsMs,
  });

  // ----- 6) auto-fallback değerlendirmesi (async, koşumu bloklamaz)
  if (SETTINGS.autoFallback.enabled) {
    evaluateAutoFallback().catch((e) => _deps?.logger(`auto-fallback eval failed: ${e.message || e}`));
  }

  return {
    skipped: false,
    mode: SETTINGS.mode,
    plan,
    tools: toolResults,
    contextBlock,
    contradiction,
    plannerRunId,
    ms: Date.now() - t0,
  };
}

// Basit cross-check: tool stdout/output string'i içinde RAG snippet'lerinde
// olmayan farklı sayılar varsa flagle. Gerçek NLI değil — yön gösterici sinyal.
function detectContradiction(toolResults, ragRows) {
  if (!Array.isArray(toolResults) || !toolResults.length) return false;
  if (!Array.isArray(ragRows) || !ragRows.length) return false;
  const ragText = ragRows.map((r) => String(r.content || "")).join(" ").toLowerCase();
  const ragNums = new Set((ragText.match(/\b\d{2,}([.,]\d+)?\b/g) || []).map(n => n.replace(",", ".")));
  if (!ragNums.size) return false;
  for (const t of toolResults) {
    if (!t.ok) continue;
    const txt = (typeof t.output === "string" ? t.output : JSON.stringify(t.output || "")).toLowerCase();
    const toolNums = (txt.match(/\b\d{2,}([.,]\d+)?\b/g) || []).map(n => n.replace(",", "."));
    if (!toolNums.length) continue;
    // Aynı bağlamda hem RAG'da hem tool'da geçen sayılar yoksa ama tool sayı veriyorsa → şüpheli
    const overlap = toolNums.filter((n) => ragNums.has(n)).length;
    if (overlap === 0 && toolNums.length >= 2) return true;
  }
  return false;
}

// Sliding window: son N koşumda hata oranı eşiği aşarsa enabled=false yap.
async function evaluateAutoFallback() {
  if (!_pool || !SETTINGS.enabled) return;
  const af = SETTINGS.autoFallback;
  const { rows } = await _pool.query(
    `SELECT error, tools_called FROM planner_runs
      ORDER BY created_at DESC LIMIT $1`,
    [af.windowSize]
  );
  if (rows.length < af.minRuns) return;
  const failed = rows.filter((r) => {
    if (r.error) return true;
    const tc = Array.isArray(r.tools_called) ? r.tools_called : [];
    if (!tc.length) return false;
    const failures = tc.filter((t) => t && t.ok === false).length;
    return failures / tc.length > 0.5;
  }).length;
  const rate = failed / rows.length;
  if (rate >= af.errorRateThreshold) {
    _deps?.logger(`AUTO-FALLBACK tetiklendi: ${failed}/${rows.length} hatalı (eşik ${Math.round(af.errorRateThreshold*100)}%). enabled=false yapılıyor.`);
    SETTINGS.enabled = false;
    SETTINGS._autoFallbackTriggered = new Date().toISOString();
    persistSettings();
  }
}

function formatContextBlock(plan, toolResults) {
  const reasoning = plan?.reasoning ? `Planner reasoning: ${plan.reasoning}\n\n` : "";
  const blocks = toolResults.map((r, i) => {
    const head = `[PlannerTool ${i + 1} · ${r.slug} · ${r.ok ? "ok" : "fail"} · ${r.ms}ms]`;
    const body = r.ok
      ? (typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2))
      : `ERROR: ${r.error}`;
    return `${head}\n${body}`;
  }).join("\n\n---\n\n");
  return `[PLANNER OUTPUTS — opt-in additional context]\n${reasoning}${blocks}`;
}

// ---------------------------------------------------------------- planner LLM

// 2026-06-03 (Tur 2) — DEFAULT_PLANNER_PROMPT lib/system-prompts.mjs'e taşındı.
// Çözünürlük: SETTINGS.systemPrompt (planner-specific override) → RAG_SETTINGS.plannerSystemPrompt
// (global UI knob) → lib/system-prompts.mjs DEFAULT_PLANNER_SYSTEM_PROMPT.

async function askPlanner(query, capabilities, ragRows) {
  const catalog = capabilities.slice(0, 40).map((c) => ({
    slug: c.slug,
    kind: c.kind,
    name: c.name,
    description: String(c.description || "").slice(0, 200),
    tags: c.tags || [],
  }));
  const ragHint = ragRows.length
    ? `\n\nRAG'TAN GELEN İLK İPUÇLARI (kaynak ipucu, full değil):\n${ragRows.slice(0, 3).map((r, i) => `${i + 1}. ${String(r.content || "").slice(0, 200)}`).join("\n")}`
    : "";

  const _ragSettings = (() => { try { return _deps.getRagSettings() || {}; } catch { return {}; } })();
  const sysPrompt = SETTINGS.systemPrompt
    ? String(SETTINGS.systemPrompt).replace("{MAX_TOOLS}", String(SETTINGS.maxTools))
    : resolvePrompt(_ragSettings, "plannerSystemPrompt", { MAX_TOOLS: String(SETTINGS.maxTools) });
  const userPrompt = `KULLANICI SORUSU:\n"""${query.slice(0, 1200)}"""\n\nMEVCUT ARAÇLAR (JSON):\n${JSON.stringify(catalog, null, 2)}${ragHint}\n\nPLAN (sadece JSON):`;

  const raw = await _deps.llmChat({
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 600,
    temperature: 0,
    timeoutMs: SETTINGS.plannerTimeoutMs,
    model: SETTINGS.model,
    jsonMode: true,
  });

  return parsePlan(raw);
}

function parsePlan(raw) {
  const s = String(raw || "").trim();
  // strip code fences if model insists
  const cleaned = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  // grab the first {...} block
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return { steps: [], reasoning: "parse_no_json" };
  try {
    const j = JSON.parse(m[0]);
    return {
      reasoning: String(j.reasoning || "").slice(0, 500),
      steps: Array.isArray(j.steps)
        ? j.steps.filter((s) => s && typeof s.slug === "string").map((s) => ({
            slug: String(s.slug).slice(0, 80),
            args: (s.args && typeof s.args === "object") ? s.args : {},
          }))
        : [],
    };
  } catch {
    return { steps: [], reasoning: "parse_invalid_json" };
  }
}

// ---------------------------------------------------------------- audit

async function recordRun({
  threadId, username, sessionId, query, mode,
  plan = {}, toolsCalled = [], ragTop1 = null, ragHit = null,
  contradiction = false,
  plannerMs = 0, toolsMs = 0, error = null,
}) {
  if (!_pool) return null;
  const id = randomUUID();
  try {
    await _pool.query(
      `INSERT INTO planner_runs (
         id, thread_id, username, session_id, mode, question,
         plan, tools_called, rag_top1, rag_hit, contradiction,
         planner_ms, tools_ms, latency_ms, error
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id, threadId || null, username || null, sessionId || null,
        mode, String(query).slice(0, 2000),
        JSON.stringify(plan), JSON.stringify(toolsCalled),
        ragTop1, ragHit, !!contradiction,
        plannerMs, toolsMs, plannerMs + toolsMs, error,
      ]
    );
    return id;
  } catch (e) {
    _deps?.logger(`recordRun failed: ${e.message || e}`);
    return null;
  }
}

export async function finalizePlannerRun(plannerRunId, { grounded = null, contradiction = false, answerPreview = null } = {}) {
  if (!_pool || !plannerRunId) return;
  try {
    await _pool.query(
      `UPDATE planner_runs
          SET grounded = COALESCE($2, grounded),
              contradiction = COALESCE($3, contradiction),
              answer_preview = COALESCE($4, answer_preview),
              finished_at = now()
        WHERE id = $1`,
      [plannerRunId, grounded, contradiction, answerPreview ? String(answerPreview).slice(0, 800) : null]
    );
  } catch (e) {
    _deps?.logger(`finalize failed: ${e.message || e}`);
  }
}

// ---------------------------------------------------------------- read API

export async function getStats({ days = 7 } = {}) {
  if (!_pool) return null;
  const since = `now() - interval '${Math.min(90, Math.max(1, Number(days) || 7))} days'`;
  const { rows: [agg] } = await _pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE mode = 'active')::int AS active_runs,
      COUNT(*) FILTER (WHERE mode = 'shadow')::int AS shadow_runs,
      COUNT(*) FILTER (WHERE rag_hit IS TRUE)::int AS rag_hits,
      COUNT(*) FILTER (WHERE jsonb_array_length(tools_called) > 0)::int AS with_tools,
      COUNT(*) FILTER (WHERE rag_hit IS FALSE AND jsonb_array_length(tools_called) = 0)::int AS both_empty,
      COUNT(*) FILTER (WHERE grounded IS TRUE)::int AS grounded_ok,
      COUNT(*) FILTER (WHERE contradiction IS TRUE)::int AS contradictions,
      ROUND(AVG(latency_ms))::int AS avg_latency_ms,
      ROUND(AVG(planner_ms))::int AS avg_planner_ms,
      ROUND(AVG(tools_ms))::int   AS avg_tools_ms
    FROM planner_runs
    WHERE created_at >= ${since}
  `);
  const { rows: topTools } = await _pool.query(`
    SELECT tool ->> 'slug' AS slug,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE (tool ->> 'ok')::boolean = true)::int AS ok,
           ROUND(AVG((tool ->> 'ms')::numeric))::int AS avg_ms
      FROM planner_runs, jsonb_array_elements(tools_called) tool
     WHERE created_at >= ${since}
     GROUP BY 1
     ORDER BY calls DESC
     LIMIT 10
  `);
  return { window_days: Number(days) || 7, summary: agg || {}, top_tools: topTools };
}

export async function getRecent({ limit = 25, mode = null } = {}) {
  if (!_pool) return [];
  const args = [Math.min(200, Math.max(1, Number(limit) || 25))];
  let where = "";
  if (mode === "shadow" || mode === "active") { args.push(mode); where = `WHERE mode = $2`; }
  const { rows } = await _pool.query(
    `SELECT id, thread_id, username, mode, question, plan, tools_called,
            rag_top1, rag_hit, grounded, contradiction,
            latency_ms, planner_ms, tools_ms, error, answer_preview,
            created_at, finished_at
       FROM planner_runs
       ${where}
      ORDER BY created_at DESC
      LIMIT $1`,
    args
  );
  return rows;
}

// ---------------------------------------------------------------- helpers

function truncate(v, max) {
  if (v == null) return null;
  if (typeof v === "string") return v.length > max ? v.slice(0, max) + "…[truncated]" : v;
  try {
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + "…[truncated]" : v;
  } catch { return String(v).slice(0, max); }
}
