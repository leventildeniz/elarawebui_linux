import { computeIntentHash } from "./apply.mjs";

const DEFAULT_WINDOW_MS = 86_400_000;

function resolveMetaForgeIdempotencyWindow(ragSettings = {}) {
  const raw = Number(ragSettings?.metaForgeIdempotencyWindowMs);
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : DEFAULT_WINDOW_MS;
}

function parsePlanJson(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

function buildForgeDedupSummary({ cachedId, cachedIntent, cachedPlan, ageSec }) {
  return [
    `♻️ **Meta-Forge dedup** — bu istek ${ageSec}sn önce zaten uygulanmıştı, yeniden yazmıyorum.`,
    `**Niyet:** ${cachedIntent}`,
    cachedPlan?.create?.length ? `**Mevcut capability'ler:** ${cachedPlan.create.map((c) => `\`${c.kind}:${c.slug}\``).join(", ")}` : null,
    "",
    `_Plan \`${cachedId}\` DB'de \`applied\`. Yeni bir tur açmak istersen prompt'u farklı yaz veya \`RAG_SETTINGS.metaForgeIdempotencyWindowMs\` knob'unu 0 yap._`,
  ].filter(Boolean).join("\n");
}

export async function findRecentAppliedForgePlanByPrompt({ pool, ragSettings, userPrompt }) {
  const prompt = String(userPrompt || "").trim();
  const windowMs = resolveMetaForgeIdempotencyWindow(ragSettings);
  if (!pool || !prompt || windowMs <= 0) return null;

  const intentHash = computeIntentHash("plan", prompt);
  const { rows } = await pool.query(
    `SELECT id, intent, plan_json, status, applied_files, smoke_report, requested_by,
            EXTRACT(EPOCH FROM (now() - created_at))*1000 AS age_ms
       FROM forge_plans
      WHERE intent_hash = $1
        AND status = 'applied'
        AND created_at > now() - ($2::int || ' milliseconds')::interval
      ORDER BY created_at DESC LIMIT 1`,
    [intentHash, windowMs],
  );
  const cached = rows?.[0] || null;
  if (!cached) return null;

  const ageSec = Math.round(Number(cached.age_ms || 0) / 1000);
  const cachedPlan = parsePlanJson(cached.plan_json);
  const cachedIntent = String(cached.intent || prompt).slice(0, 500);
  return {
    cached,
    cachedPlan,
    cachedIntent,
    ageSec,
    intentHash,
    summary: buildForgeDedupSummary({ cachedId: cached.id, cachedIntent, cachedPlan, ageSec }),
  };
}

export async function stampForgePlanUserPromptHash({ pool, planId, userPrompt }) {
  const prompt = String(userPrompt || "").trim();
  if (!pool || !planId || !prompt) return null;
  const intentHash = computeIntentHash("plan", prompt);
  await pool.query(
    `UPDATE forge_plans
        SET intent_hash = COALESCE($2, intent_hash),
            updated_at = now()
      WHERE id = $1`,
    [planId, intentHash],
  );
  return intentHash;
}

export { computeIntentHash };