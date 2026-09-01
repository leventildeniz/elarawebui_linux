// lib/routes/chat-stream.mjs
// Block G — /api/chat/stream handler modülü
// G-2b: 486 satır POST handler server.mjs:5485-5970 → bu modül.
// Tüm bağımlılıklar deps üstünden DI. Standalone import: node:path.

import path from "node:path";
import { buildNowPreamble, parseNowHeaders } from "../now.mjs";
import { summarizePromptMessages } from "../prompt-size.mjs";
import { detectUserAgentMention, pickAgentForQuery } from "../user-agent-intent.mjs";
import { renderInspectorDirective } from "../system-prompts.mjs";
import { applyAgentsPlaceholder, formatAgentsManifestAnswer, renderAgentsManifest } from "../agents-manifest.mjs";
import { ensureMetaForgeAgent } from "../meta-forge/seed.mjs";
import { isMetaForgeScriptPath, resolveSelectedMetaForgeAgent } from "../meta-forge/selection.mjs";
import { findRecentAppliedForgePlanByPrompt, stampForgePlanUserPromptHash } from "../meta-forge/idempotency.mjs";


function extractForgeJsonFromText(text) {
  if (!text) return null;
  const raw = String(text);

  // Try direct parse first (if LLM was a good boy and returned pure JSON)
  try {
      const direct = JSON.parse(raw);
      if (direct && typeof direct === "object" && direct.plan) return direct;
  } catch {}

  // Try to find markdown block but DON'T blindly replace backticks everywhere
  let targetArea = raw;
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match && match[1]) {
      targetArea = match[1];
      try {
        const mdParsed = JSON.parse(targetArea);
        if (mdParsed && typeof mdParsed === "object" && mdParsed.plan) return mdParsed;
      } catch {}
  }

  // Fallback to AST scanner on the target area
  const candidates = [];
  for (let i = 0; i < targetArea.length; i++) {
    if (targetArea[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < targetArea.length; j++) {
      const ch = targetArea[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { candidates.push(targetArea.slice(i, j + 1)); i = j; break; }
      }
    }
  }
  
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object" && obj.plan) return obj;
    } catch { /* keep scanning */ }
  }
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* keep scanning */ }
  }
  
  return null;
}

async function parseForgePlanFromText(rawOut) {
  const obj = extractForgeJsonFromText(rawOut);
  if (!obj) return { planObj: null, validated: null, err: "no JSON object in stdout" };
  if (!obj.plan) return { planObj: obj, validated: null, err: "JSON has no `plan` field" };
  try {
    const mod = await import("../meta-forge/planner.mjs");
    return { planObj: obj, validated: mod.validateForgePlan(obj.plan), err: null };
  } catch (e) {
    return { planObj: obj, validated: null, err: String(e?.message || e) };
  }
}

function formatForgeBridgeSummary({ intentText, planId, finalStatus, applyResult, applyError, validated }) {
  const kindLabel = (k) => (k === "tool" ? "🔧" : k === "skill" ? "📘" : k === "agent" ? "🤖" : k === "pack" ? "📦" : "•");
  if (finalStatus === "applied") {
    const appliedList = (applyResult?.applied || []).map((a) => `${kindLabel(a.kind)} \`${a.kind}:${a.slug}\``).join(", ");
    const dedupedList = (applyResult?.deduped || []).map((d) => `♻️ \`${d.kind}:${d.existing_slug || d.slug}\``).join(", ");
    const deferredList = (applyResult?.deferred || []).map((d) => `⏸️ \`${d.kind}:${d.slug}\``).join(", ");
    const failedList = (applyResult?.failed || []).map((f) => `❌ \`${f.kind}:${f.slug}\` (${f.reason})`).join(", ");
    return [
      `✅ **Meta-Forge otomatik yazdı** — ${(applyResult?.applied || []).length} capability işlendi.`,
      `**Niyet:** ${intentText}`,
      appliedList ? `**Oluşturuldu:** ${appliedList}` : null,
      dedupedList ? `**Tekrar edildi (dedup):** ${dedupedList}` : null,
      deferredList ? `**Ertelendi (budget):** ${deferredList}` : null,
      failedList ? `**Başarısız:** ${failedList}` : null,
      validated?.reuse?.length ? `**Yeniden kullanıldı:** ${validated.reuse.map((r) => `${r.kind}:${r.slug}`).join(", ")}` : null,
    ].filter(Boolean).join("\n");
  }
  const failedList = (applyResult?.failed || []).map((f) => `❌ \`${f.kind}:${f.slug}\` — ${f.reason}`).join("\n");
  return [
    `⚠️ **Meta-Forge apply başarısız** (${applyError || "lint/disk/db error"}).`,
    `**Niyet:** ${intentText}`,
    failedList || null,
    planId ? `_Plan \`${planId}\` DB'de \`failed\` durumunda kayıtlı._` : null,
  ].filter(Boolean).join("\n");
}

// 2026-06-02 — passive_mention_guard kaldırıldı (mem://session/2026-06-02-...).
// Model `@[script.py]` emit ettiğinde bridge doğrudan spawn eder; smalltalk
// lane bridge'i intentHint==="smalltalk" check'i ile bağımsız olarak kapatır.


export function mountChatStreamRoutes(app, deps = {}) {
  const {
    PORT,
    LOCAL_RUNTIME_PORT,
    RAG_SETTINGS: initialRagSettings,
    getRagSettings,
    ROLE_RANK,
    LOCAL_TRANSPORT,
    TIMEOUT_BUDGETS,
    HEDGE_PATTERNS,
    // helpers (server.mjs-local)
    _brandDisplay,
    _mlxEffectiveFirstTokenMs,
    _makeThinkStripper,
    _mlxRecordFirstToken,
    agentErrorMessage,
    applyExecutionGuard,
    brandSync,
    broadcastAudit,
    broadcastBridge,
    buildAgentEnvForScript,
    buildFreeAnswerMessages,
    chatTrace,
    classifyAgentError,
    classifyIntent,
    detectAgentIntent,
    detectLibraryMatch,
    enqueueWrite,
    extractToolCalls,
    flushModelKvCache,
    getLibraryBrands,
    getAllowedAgents,
    logCheckpoint,
    localQueue,
    normalizeAccessLevel,
    pool,
    pushLog,
    ragProbeAndFetch,
    recordChatSample,
    recordMlxActivity,
    refineIntentSemantically,
    registerSyntheticRun,
    runLocalAgent,
    streamLocalAgent,
    runToolCallsForAgent,
    runtimeBase,
    runtimeModel,
    sseBegin,
    streamFromLocalLLM,
    triggerMlxZombieSelfHeal,
    hydrateAllowedAgentsFromDb,
  } = deps;


  // GET healthcheck (smoke gate)
  app.get("/api/chat/stream", (req, res) => {
    res.json({
      ok: true,
      route: "/api/chat/stream",
      method: "POST",
      port: PORT,
      direct: true,
      block: "G-2b-mounted",
    });
  });

  // --- Streaming chat (SSE) -------------------------------------------------
  app.post("/api/chat/stream", async (req, res) => {
  const { thread_id, model, messages, userRole, useRag, locale: bodyLocale, agent_id: bodyAgentId = null, agents = [], capabilitySmoke = false } = req.body ?? {};
  const RAG_SETTINGS = (typeof getRagSettings === "function") ? getRagSettings() : initialRagSettings;
  const isCapabilitySmoke = capabilitySmoke === true || String(req.headers["x-elara-capability-smoke"] || "") === "1";
  const agentId = bodyAgentId || null;
  const locale = String(bodyLocale || "tr").toLowerCase().startsWith("en") ? "en" : "tr";
  if (!thread_id || !Array.isArray(messages)) {
    return res.status(400).json({ error: "thread_id and messages[] required" });
  }
  const sse = sseBegin(req, res);
  const send = sse.send;
  const close = () => sse.close("[DONE]");
  const heartbeat = setInterval(() => sse.keepAlive(), 2_000);
  let __chatDone = false;
  const requestAbort = new AbortController();
  const onStreamClientGone = (reason) => {
    clearInterval(heartbeat);
    if (__chatDone || requestAbort.signal.aborted) return;
    requestAbort.abort(reason || new Error("client closed chat stream"));
    logCheckpoint("warn", "chat.aborted", "İstemci akışı kesti", { model: model || null, reason: String(reason || "close") }, thread_id);
  };
  // Do NOT use req.close here: on POST it can mean "body fully consumed" while
  // the SSE response is still alive. Real disconnect is covered by req.aborted
  // and res.close, matching sseBegin's semantics.
  req.on("aborted", () => onStreamClientGone("req.aborted"));
  res.on("close", () => onStreamClientGone("res.close"));
  // UI = TEK MERCİİ (2026-06-02). nowPreamble (auto "şu an" cümlesi) söküldü —
  // UI'da görünmüyordu. "Şu an" lazımsa UI'daki system_prompt'a yazılır.
  // Imzayı kırmamak için null geçiyoruz.
  const nowPreamble = null;
  // Agent bridge env builder `_nowHints.userNow/userTz` bekliyor — header'lardan
  // parse et. Tanımsız bırakırsak agent dispatch ReferenceError'a düşüyor.
  const _nowHints = (() => { try { return parseNowHeaders(req) || { userNow: null, userTz: null }; } catch { return { userNow: null, userTz: null }; } })();
  const lastUserPreview = [...messages].reverse().find((m) => m?.role === "user");
  logCheckpoint("info", "chat.request", `Sohbet isteği alındı · ${messages.length} mesaj`, {
    msg_len: String(lastUserPreview?.content ?? "").length,
    model: model || null,
    ragEnabled: useRag !== false,
  }, thread_id);
  logCheckpoint("info", "agent.step.start", `Agent devrede · chat-orchestrator`, {
    agent: "chat-orchestrator", step: "ingest", model: model || null,
  }, thread_id);

  // ---- Liyakatli RAG enrichment ------------------------------------------
  // Intent gate: smalltalk ('selam', 'naber', 'tşk') 285k satırı kazımaz.
  // Sosyal sohbet → RAG bypass → modele anında stream başlat (<1s).
  let augmentedMessages = messages;
  let ragUsedFlag = false;
  let intentKind = "query";
  const t0 = Date.now();
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  const q = String(lastUser?.content ?? "").slice(0, 500).trim();
  // NOTE: Deterministic agent-manifest lane moved BELOW semantic intent
  // classification. Trigger is `intent.subKind === "agent_manifest"` from the
  // embedding-anchor classifier (`INTENT_ANCHORS.agent_manifest`) — no regex.

  // Direct explicit agent calls (`@[agent.py] ...`) must not run the outer chat
  // RAG/LLM first. That double path was injecting irrelevant chat RAG cards for
  // self-intro turns and then queueing the real agent behind the first MLX job.
  let _rewriteHit = null;
  let _skipOuterLlm = false;
  const _directAgentMention = (() => {
    const m = String(q || "").match(/@\[\s*([\p{L}\p{N}_\-./]+\.py)\s*\]/iu);
    if (!m) return null;
    return { script: String(m[1] || "").trim(), query: String(q || "") };
  })();
  if (_directAgentMention?.script) {
    _rewriteHit = _directAgentMention;
    _skipOuterLlm = true;
    chatTrace(thread_id, "agent.direct_invocation", { script: _directAgentMention.script });
  }
  const tIntentStart = Date.now();
  let intent = classifyIntent(q);

  intent = applyExecutionGuard(intent, q, {});
  // Semantic refinement: embedding-anchor router (cosine similarity, regex YOK).
  // Smalltalk ('selam', 'naber') burada yakalanırsa probe TAMAMEN atlanır,
  // ilk token <1s'de gelir. RAG kararı = ragSim ≥ semanticThreshold.
  // Geri alma: INTENT_ROUTER_BYPASS=1 → router devre dışı, tek karar = injectThreshold.
  const _intentRouterBypass = (typeof RAG_SETTINGS?.intentRouterBypass === "boolean")
    ? RAG_SETTINGS.intentRouterBypass
    : String(process.env.INTENT_ROUTER_BYPASS ?? "0") === "1";
  if (!_intentRouterBypass && intent.mode !== "execution-guard") {
    try {
      intent = await refineIntentSemantically(q, intent);
    } catch (e) {
      pushLog("server", `intent refine failed: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  intentKind = intent.kind;
  const phaseIntentMs = Date.now() - tIntentStart;
  if (intent.mode === "execution-guard") {

    logCheckpoint("info", "intent.guard", `Execution intent yakalandı · ${intent.executionReason}`, { reason: intent.executionReason }, thread_id);
    broadcastBridge({ kind: "guard", status: "engaged", reason: intent.executionReason, thread_id });
  }
  chatTrace(thread_id, "rag.intent.refined", {
    kind: intent.kind, mode: intent.mode, ms: phaseIntentMs,
    reason: intent.intentClassifyReason ?? intent.classifyReason ?? null,
    warm: intent.intentClassifierWarm ?? intent.classifierWarm ?? null,
    budgetMs: intent.intentBudgetMs ?? null,
    anchorWaitMs: intent.intentAnchorWaitMs ?? null,
    qEmbedMs: intent.intentQEmbedMs ?? null,
    ragSim: intent.ragSim != null ? Number(intent.ragSim.toFixed(3)) : null,
    smallSim: intent.smallSim != null ? Number(intent.smallSim.toFixed(3)) : null,
  });
  // ── Deterministic agent-manifest lane ──────────────────────────────────
  // Semantic classifier flagged this turn as an "agent kadrosu" question via
  // INTENT_ANCHORS.agent_manifest (embedding cosine, no regex). Render the
  // manifest directly so MLX warmup/thinking + bridge/RAG side effects can't
  // slow it down or let the model summarize squads only.
  try {
    const manifestMode = String(RAG_SETTINGS?.elaraAgentManifestMode || "lazy").toLowerCase();
    const directManifestOn = RAG_SETTINGS?.elaraAgentManifestDirectAnswer !== false;
    const _manifestIntent = intent?.subKind === "agent_manifest";
    if (directManifestOn && manifestMode !== "off" && _manifestIntent) {
      const tManifest0 = Date.now();
      try { console.log(`[manifest-direct] stream mode=${manifestMode} direct=true manifestSim=${(intent.agentManifestSim ?? 0).toFixed(3)} q=${JSON.stringify(q).slice(0, 120)}`); } catch {}
      const manifest = await renderAgentsManifest({ pool });
      const out = formatAgentsManifestAnswer(manifest, { locale });
      const totalMs = Date.now() - tManifest0;
      chatTrace(thread_id, "agents.manifest.direct.done", { count: manifest?.count || 0, squads: manifest?.squads || [], totalMs, manifestSim: intent.agentManifestSim ?? null });
      try { send({ meta: { source: "agent-manifest", model: "deterministic", manifest_direct: true, manifest_mode: manifestMode, manifest_count: manifest?.count || 0 } }); } catch {}
      try { send({ phase: "streaming", intent: "meta" }); } catch {}
      try { send({ rag: { used: 0, sources: [], skipped: true, reason: "agent_manifest_meta", intent: "meta", mode: "direct-manifest", notice: null } }); } catch {}
      try { send({ delta: out }); } catch {}
      try { send({ latency: { thinkMs: 0, ragMs: 0, totalMs, tokensOut: String(out).trim().split(/\s+/).filter(Boolean).length } }); } catch {}
      enqueueWrite(
        `INSERT INTO chat_messages(thread_id, role, content, model)
         VALUES ($1,'assistant',$2,$3)`,
        [thread_id, out, "agent-manifest"]
      );
      enqueueWrite(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [thread_id]);
      __chatDone = true;
      clearInterval(heartbeat);
      close();
      return;
    }
  } catch (e) {
    chatTrace(thread_id, "agents.manifest.direct.error", { error: String(e?.message || e).slice(0, 160) }, "warn");
  }

  // ── Deterministic Meta-Forge lane ───────────────────────────────────────
  // /api/chat/orchestrate already has this lane. Keep /api/chat/stream in
  // parity; otherwise whichever endpoint the UI picks can miss the plan on the
  // first turn and only produce it after a warmed second attempt.
  try {
    const _forgeGateMode = String(RAG_SETTINGS?.metaForgeGateMode || "pre-classify").toLowerCase();
    const _selectedMetaForge = await resolveSelectedMetaForgeAgent({ pool, agentId, agents }).catch((e) => {
      chatTrace(thread_id, "meta_forge.selection.error", { error: String(e?.message || e).slice(0, 160) }, "warn");
      return null;
    });
    const forgeLaneOn = _forgeGateMode !== "off"
      && RAG_SETTINGS?.metaForgeLaneEnabled !== false
      && (_forgeGateMode === "pre-classify" || _selectedMetaForge);
    if (!isCapabilitySmoke && forgeLaneOn && (_selectedMetaForge || intent?.subKind === "meta_forge")) {
      const tForge0 = Date.now();
      chatTrace(thread_id, "meta_forge.lane.start", { route: "stream", forgeSim: intent.metaForgeSim ?? null, reason: _selectedMetaForge ? "selected_agent" : "semantic_router", selectedSource: _selectedMetaForge?.source || null });
      try { send({ phase: "meta_forge_planning", stage: "spawn" }); } catch {}

      try {
        const idemHit = await findRecentAppliedForgePlanByPrompt({ pool, ragSettings: RAG_SETTINGS, userPrompt: q });
        if (idemHit) {
          const { cached, cachedPlan, cachedIntent, ageSec, intentHash: planIntentHash, summary } = idemHit;
          chatTrace(thread_id, "meta_forge.idempotency.hit", { route: "stream-lane", planId: cached.id, ageSec, intentHash: planIntentHash.slice(0, 12) });
          try { send({ meta: { source: "meta-forge", model: "forge_master", forge_plan: true, dedup: true } }); } catch {}
          try { send({ phase: "streaming", intent: "meta_forge" }); } catch {}
          try { send({ rag: { used: 0, sources: [], skipped: true, reason: "meta_forge_idempotency", intent: "meta_forge", mode: "direct-forge", notice: null } }); } catch {}
          try { send({ forge_plan: { id: cached.id, intent: cachedIntent, plan: cachedPlan, status: "applied", requestedBy: cached.requested_by, autoApplied: true, dedup: true, ageSec } }); } catch {}
          try { send({ delta: summary }); } catch {}
          try { send({ latency: { thinkMs: 0, ragMs: 0, totalMs: Date.now() - tForge0, tokensOut: String(summary).trim().split(/\s+/).filter(Boolean).length } }); } catch {}
          enqueueWrite(`INSERT INTO chat_messages(thread_id, role, content, model) VALUES ($1,'assistant',$2,$3)`, [thread_id, summary, "meta-forge"]);
          enqueueWrite(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [thread_id]);
          __chatDone = true;
          clearInterval(heartbeat);
          close();
          return;
        }
      } catch (idemErr) {
        chatTrace(thread_id, "meta_forge.idempotency.error", { route: "stream-lane", error: String(idemErr?.message || idemErr).slice(0, 200) }, "warn");
      }

      let inventory = { agents: [], tools: [], skills: [], packs: [], counts: {} };
      try {
        const mod = await import("../meta-forge/planner.mjs");
        inventory = await mod.buildInventory(pool);
      } catch (invErr) {
        chatTrace(thread_id, "meta_forge.inventory.error", { error: String(invErr?.message || invErr).slice(0, 160) }, "warn");
      }

      try {
        const seededForge = await ensureMetaForgeAgent(pool);
        chatTrace(thread_id, "meta_forge.agent.ready", { id: seededForge?.id || null, status: seededForge?.status || null, path: seededForge?.agent_path || null });
      } catch (seedErr) {
        chatTrace(thread_id, "meta_forge.agent.seed.error", { error: String(seedErr?.message || seedErr).slice(0, 180) }, "warn");
      }

      const forgeEnv = await buildAgentEnvForScript(pool, "Meta/forge_master.py", {
        suppressToolManifest: true,
        userNow: _nowHints.userNow,
        userTz: _nowHints.userTz,
      }).catch((e) => {
        chatTrace(thread_id, "meta_forge.env.error", { error: String(e?.message || e).slice(0, 160) }, "warn");
        return {};
      });
      forgeEnv.ELARA_META_FORGE_INVENTORY = JSON.stringify(inventory);

      try { send({ phase: "meta_forge_planning", stage: "llm" }); } catch {}
      const runRes = await runLocalAgent({
        script: "Meta/forge_master.py",
        query: String(q || "").slice(0, 4000),
        env: forgeEnv,
        timeoutMs: 180_000,
      }).catch((err) => ({ _error: err }));

      if (runRes?._error) {
        const emsg = String(runRes._error?.message || runRes._error).slice(0, 200);
        const errCode = classifyAgentError(runRes._error);
        chatTrace(thread_id, "meta_forge.spawn.error", { error: emsg, code: errCode }, "warn");
        if (errCode === "timeout") {
          await triggerMlxZombieSelfHeal(`meta-forge:${emsg}`, (key, fields, level = "info") => {
            chatTrace(thread_id, key, fields || {}, level);
          }).catch(() => null);
        }
        const fallback = `⚠️ Meta-Forge planner çağrılamadı: ${emsg}`;
        try { send({ delta: fallback }); } catch {}
        enqueueWrite(`INSERT INTO chat_messages(thread_id, role, content, model) VALUES ($1,'assistant',$2,$3)`, [thread_id, fallback, "meta-forge"]);
        enqueueWrite(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [thread_id]);
        __chatDone = true;
        clearInterval(heartbeat);
        close();
        return;
      }

      const extractForgeJson = extractForgeJsonFromText;

      const parsePlan = async (rawOut) => {
        const obj = extractForgeJson(rawOut);
        if (!obj) return { planObj: null, validated: null, err: "no JSON object in stdout" };
        if (!obj.plan) return { planObj: obj, validated: null, err: "JSON has no `plan` field" };
        try {
          const mod = await import("../meta-forge/planner.mjs");
          return { planObj: obj, validated: mod.validateForgePlan(obj.plan), err: null };
        } catch (ve) {
          return { planObj: obj, validated: null, err: String(ve?.message || ve) };
        }
      };

      let rawOut = String(runRes?.stdout || "");
      let { planObj, validated, err: planErr } = await parsePlan(rawOut);

      if (!validated) {
        chatTrace(thread_id, "meta_forge.plan.retry", { firstErr: planErr }, "warn");
        const strictQuery = [
          "/no_think",
          "STRICT MODE: Respond with EXACTLY ONE JSON object. No prose, no markdown, no code fences.",
          'Shape: {"intent":"...","plan":{"reuse":[],"create":[ {"kind":"skill|tool|agent|pack", ...} ]}}',
          "Output MUST begin with `{` and end with `}`. Nothing else.",
          "",
          `User request: ${String(q || "").slice(0, 1500)}`,
        ].join("\n");
        const retryRes = await runLocalAgent({
          script: "Meta/forge_master.py",
          query: strictQuery,
          env: forgeEnv,
          timeoutMs: 120_000,
        }).catch((err) => ({ _error: err }));
        if (!retryRes?._error) {
          rawOut = String(retryRes?.stdout || "");
          const retryParsed = await parsePlan(rawOut);
          planObj = retryParsed.planObj;
          validated = retryParsed.validated;
          planErr = retryParsed.err;
        } else {
          planErr = `retry spawn failed: ${String(retryRes._error?.message || retryRes._error).slice(0, 160)}`;
        }
      }

      if (!validated) {
        chatTrace(thread_id, "meta_forge.plan.invalid", { error: planErr, stdoutHead: rawOut.slice(0, 200) }, "warn");
        const preview = rawOut.slice(0, 600) || "(boş cevap)";
        const msg = `⚠️ Meta-Forge planı ayrıştırılamadı (${planErr}).\n\nHam çıktı:\n\`\`\`\n${preview}\n\`\`\``;
        try { send({ delta: msg }); } catch {}
        enqueueWrite(`INSERT INTO chat_messages(thread_id, role, content, model) VALUES ($1,'assistant',$2,$3)`, [thread_id, msg, "meta-forge"]);
        enqueueWrite(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [thread_id]);
        __chatDone = true;
        clearInterval(heartbeat);
        close();
        return;
      }

      const intentText = String(planObj?.intent || q || "").slice(0, 500);
      const requestedBy = req.session?.username || "chat";
      const autoApplyEnabled = (RAG_SETTINGS?.metaForgeAutoApply !== false);
      const initialStatus = autoApplyEnabled ? "approved" : "pending";
      let planId = null;
      try {
        const ins = await pool.query(
          `INSERT INTO forge_plans (requested_by, intent, plan_json, status)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [requestedBy, intentText, JSON.stringify(validated), initialStatus]
        );
        planId = ins.rows[0]?.id || null;
      } catch (dbErr) {
        chatTrace(thread_id, "meta_forge.persist.error", { error: String(dbErr?.message || dbErr).slice(0, 200) }, "error");
      }

      let applyResult = null;
      let applyError = null;
      let finalStatus = initialStatus;
      if (autoApplyEnabled && planId) {
        try { send({ phase: "meta_forge_applying" }); } catch {}
        try {
          const applyMod = await import("../meta-forge/apply.mjs");
          const maxItems = Math.max(1, Number(RAG_SETTINGS?.metaForgeMaxItemsPerTurn) || 3);
          applyResult = await applyMod.applyForgePlan({ pool, planId, plan: validated, maxItems });
          finalStatus = (applyResult.failed?.length && !applyResult.applied?.length) ? "failed" : "applied";
          await pool.query(
            `UPDATE forge_plans SET status=$2, applied_at=now(), updated_at=now(), error=$3 WHERE id=$1`,
            [planId, finalStatus, applyResult.failed?.length ? JSON.stringify(applyResult.failed) : null]
          );
          await stampForgePlanUserPromptHash({ pool, planId, userPrompt: q });
          if (finalStatus === "applied" && typeof hydrateAllowedAgentsFromDb === "function") {
            try { await hydrateAllowedAgentsFromDb(); } catch { /* best-effort */ }
          }
          try { if (applyResult.deduped?.length) send({ forge_deduped: { planId, items: applyResult.deduped } }); } catch {}
          try { if (applyResult.deferred?.length) send({ forge_deferred: { planId, items: applyResult.deferred } }); } catch {}
          chatTrace(thread_id, "meta_forge.apply.done", { route: "stream", planId, applied: applyResult.applied?.length || 0, failed: applyResult.failed?.length || 0, deduped: applyResult.deduped?.length || 0, deferred: applyResult.deferred?.length || 0, status: finalStatus });
        } catch (aErr) {
          applyError = String(aErr?.message || aErr).slice(0, 500);
          finalStatus = "failed";
          try { await pool.query(`UPDATE forge_plans SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [planId, applyError]); } catch { /* */ }
          chatTrace(thread_id, "meta_forge.apply.error", { route: "stream", planId, error: applyError }, "error");
        }
      }

      const kindLabel = (k) => (k === "tool" ? "🔧" : k === "skill" ? "📘" : k === "agent" ? "🤖" : k === "pack" ? "📦" : "•");
      let summaryLines;
      if (!autoApplyEnabled) {
        summaryLines = [
          `**Meta-Forge planı hazır** — onayını bekliyor.`,
          `**Niyet:** ${intentText}`,
          validated.reuse.length ? `**Yeniden kullan:** ${validated.reuse.map(r => `${r.kind}:${r.slug}`).join(", ")}` : null,
          validated.create.length ? `**Oluştur:** ${validated.create.map(c => `${c.kind}:${c.slug}`).join(", ")}` : null,
        ].filter(Boolean).join("\n");
      } else if (finalStatus === "applied") {
        const appliedList = (applyResult?.applied || []).map(a => `${kindLabel(a.kind)} \`${a.kind}:${a.slug}\``).join(", ");
        const failedList = (applyResult?.failed || []).map(f => `❌ \`${f.kind}:${f.slug}\` (${f.reason})`).join(", ");
        summaryLines = [
          `✅ **Meta-Forge otomatik yazdı** — ${(applyResult?.applied || []).length} capability canlı.`,
          `**Niyet:** ${intentText}`,
          appliedList ? `**Oluşturuldu:** ${appliedList}` : null,
          failedList ? `**Başarısız:** ${failedList}` : null,
          validated.reuse.length ? `**Yeniden kullanıldı:** ${validated.reuse.map(r => `${r.kind}:${r.slug}`).join(", ")}` : null,
          "",
          "_Artık şu turdan itibaren kullanılabilir. Aynı isteği tekrar sorabilirsin._",
        ].filter(Boolean).join("\n");
      } else {
        const failedList = (applyResult?.failed || []).map(f => `❌ \`${f.kind}:${f.slug}\` — ${f.reason}`).join("\n");
        summaryLines = [
          `⚠️ **Meta-Forge apply başarısız** (${applyError || "lint/disk/db error"}).`,
          `**Niyet:** ${intentText}`,
          failedList || null,
          "",
          `_Plan \`${planId}\` DB'de \`failed\` durumunda kayıtlı. Admin UI'dan görüntüleyip elden düzeltebilirsin._`,
        ].filter(Boolean).join("\n");
      }

      try { send({ meta: { source: "meta-forge", model: "forge_master", forge_plan: true } }); } catch {}
      try { send({ phase: "streaming", intent: "meta_forge" }); } catch {}
      try { send({ rag: { used: 0, sources: [], skipped: true, reason: "meta_forge_lane", intent: "meta_forge", mode: "direct-forge", notice: null } }); } catch {}
      try { send({ forge_plan: { id: planId, intent: intentText, plan: validated, status: finalStatus, requestedBy, autoApplied: autoApplyEnabled, result: applyResult || undefined, error: applyError || undefined } }); } catch {}
      try { send({ delta: summaryLines }); } catch {}
      try { send({ latency: { thinkMs: 0, ragMs: 0, totalMs: Date.now() - tForge0, tokensOut: String(summaryLines).trim().split(/\s+/).filter(Boolean).length } }); } catch {}

      enqueueWrite(`INSERT INTO chat_messages(thread_id, role, content, model) VALUES ($1,'assistant',$2,$3)`, [thread_id, summaryLines, "meta-forge"]);
      enqueueWrite(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [thread_id]);
      chatTrace(thread_id, "meta_forge.lane.done", { route: "stream", planId, reuse: validated.reuse.length, create: validated.create.length, totalMs: Date.now() - tForge0, autoApplied: autoApplyEnabled, status: finalStatus });
      __chatDone = true;
      clearInterval(heartbeat);
      close();
      return;
    }
  } catch (e) {
    chatTrace(thread_id, "meta_forge.lane.error", { route: "stream", error: String(e?.message || e).slice(0, 200) }, "warn");
  }

  // Score-gated always-on RAG — tek karar mercii: injectThreshold.
  // Router bypass modunda her query probe'a girer; anchor-tabanlı fast-skip YOK.
  // Per-model RAG aç/kapa: model satırında rag_enabled=false ise tur boyunca RAG yok.
  let modelRagEnabled = true;
  let modelInspectorDirective = "";
  try {
    if (model) {
      const _mr = await pool.query("SELECT rag_enabled, inspector_directive FROM models WHERE id=$1", [model]);
      if (_mr.rows.length) {
        if (_mr.rows[0].rag_enabled === false) modelRagEnabled = false;
        modelInspectorDirective = String(_mr.rows[0].inspector_directive ?? "");
      }
    }
  } catch { /* lookup hatası → varsayılan açık */ }
  const ragGloballyEnabled = useRag !== false && modelRagEnabled && !_skipOuterLlm;

  const semanticSmalltalk = !_intentRouterBypass && intent.kind === "smalltalk" && (/bypass|cold-fallback/i.test(String(intent.mode || "")) || intent.useRag === false);
  let probeRes = { decision: "skip", reason: ragGloballyEnabled ? "no_query" : (!modelRagEnabled ? "model_rag_disabled" : "operator_disabled"), rows: [], top1: 0, tau: Number(RAG_SETTINGS.injectThreshold) || 0.45 };
  let probeMs = 0;
  // v11.3 — Probe-spesifik deadline (probe + rerank + fetch toplamı). UI knob.
  const ragDeadlineMs = Math.max(1500, Math.min(8000,
    Number(RAG_SETTINGS?.ragProbeDeadlineMs)
    || Number(process.env.RAG_PROBE_DEADLINE_MS)
    || Number(process.env.RAG_DEADLINE_MS)
    || 4500));
  // 2026-05-28 — Üst-seviye pre-RAG deadline. Probe sonrası kalan adımların
  // (library brand check, free-answer build) hung kalmasına karşı son halka.
  // Süre aşılırsa o tur RAG atlanır, ham messages MLX'e gider.
  const preRagDeadlineMs = Math.max(1500, Math.min(15000,
    Number(RAG_SETTINGS?.preRagDeadlineMs)
    || Number(process.env.PRE_RAG_DEADLINE_MS)
    || 6000));
  const tPreRagStart = Date.now();
  let preRagTimedOut = false;
  let preRagDone = false;
  chatTrace(thread_id, "rag.pre.start", { ragGloballyEnabled, modelRagEnabled, semanticSmalltalk, intentKind: intent.kind, preRagDeadlineMs, ragDeadlineMs });

  // 2026-07-06 — Capability Gap Detector hook söküldü. Yaratma sorumluluğu
  // Meta-Forge auto-routing directive'ine devredildi (aşağıda enjekte edilir).



  await Promise.race([
    (async () => {
      const probeStart = Date.now();
      if (semanticSmalltalk) {
        probeRes = { decision: "skip", reason: "smalltalk_bypass", rows: [], top1: 0, tau: Number(RAG_SETTINGS.injectThreshold) || 0.45 };
        logCheckpoint("info", "rag.bypass.smalltalk", `Smalltalk semantic-bypass — RAG atlandı`, { ragSim: intent.ragSim, smallSim: intent.smallSim, metaSim: intent.metaSim, mode: intent.mode, threshold: intent.semanticThreshold }, thread_id);
        chatTrace(thread_id, "rag.probe.skip", { reason: "smalltalk_bypass" });
      } else if (_skipOuterLlm) {
        probeRes = { decision: "skip", reason: "agent_direct_dispatch", rows: [], top1: 0, tau: Number(RAG_SETTINGS.injectThreshold) || 0.45 };
        chatTrace(thread_id, "rag.probe.skip", { reason: "agent_direct_dispatch", script: _rewriteHit?.script || null });
        preRagDone = true;
        return;
      } else if (ragGloballyEnabled && q) {
        // 2026-06-03 — Brand-mention gate (UI knob `requireBrandMentionForRag`, default ON).
        // Soruda DB library brand'lerinden biri (alias dahil) geçmiyorsa probe'a hiç girme;
        // sessizce free-answer'a düş. Statik vendor listesi YOK — DB tek mercii.
        if (RAG_SETTINGS?.requireBrandMentionForRag !== false) {
          try {
            const _libBrandsGate = await getLibraryBrands();
            const _detGate = detectLibraryMatch(String(q || ""), _libBrandsGate);
            if (!_detGate?.matched) {
              probeRes = { decision: "skip", reason: "no_library_brand_in_query", rows: [], top1: 0, tau: Number(RAG_SETTINGS.injectThreshold) || 0.45 };
              chatTrace(thread_id, "rag.brand_gate_skip", { libBrandsCount: (_libBrandsGate || []).length });
              return;
            }
          } catch (e) { console.warn("[brand-gate/stream]", e.message); }
        }
        const role = String(userRole ?? "Viewer").trim();
        const userRank = ROLE_RANK[normalizeAccessLevel(role)] ?? 0;
        const allowedLevels = Object.entries(ROLE_RANK)
          .filter(([, rank]) => rank <= userRank).map(([name]) => name);
        logCheckpoint("info", "rag.probe.start", `RAG probe · τ=${probeRes.tau}`, { tau: probeRes.tau, q_len: q.length, intent: intent.kind }, thread_id);
        chatTrace(thread_id, "rag.probe.start", { tau: probeRes.tau, deadlineMs: ragDeadlineMs });
        probeRes = await Promise.race([
          ragProbeAndFetch({ q, allowedLevels, agentId, caller: "stream" }),
          new Promise((resolve) => setTimeout(() => resolve({ decision: "skip", reason: `deadline_${ragDeadlineMs}ms`, rows: [], top1: 0, tau: Number(RAG_SETTINGS.injectThreshold) || 0.45 }), ragDeadlineMs)),
        ]).catch((e) => ({ decision: "skip", reason: "probe_threw", rows: [], top1: 0, tau: Number(RAG_SETTINGS.injectThreshold) || 0.45, error: String(e.message || e).slice(0, 200) }));
        chatTrace(thread_id, "rag.probe.done", { decision: probeRes.decision, reason: probeRes.reason, top1: Number((probeRes.top1 || 0).toFixed(3)), rows: probeRes.rows?.length || 0, ms: Date.now() - probeStart, stages: probeRes.stages || null, rerankerMs: probeRes.reranker?.ms || 0 });
        // NOT: runCapabilityGap artık yukarıya (rag.pre.start sonrasına) taşındı;
        // brand-gate skip'i kapasite tespitini vurmasın diye.

      } else {
        chatTrace(thread_id, "rag.probe.skip", { reason: probeRes.reason });
      }
      if (preRagTimedOut) return;
      probeMs = Date.now() - probeStart;
      send({ phase: probeRes.decision === "inject" ? "searching-knowledge" : "thinking", intent: intent.kind });

      // Cross-vendor guard (v16, 2026-05-29): if the user query targets a brand
      // the library knows (e.g. "a10 TPS") but the inject rows are dominated by
      // a different brand (e.g. all Checkpoint), demote to free-answer instead of
      // bleeding cross-vendor content into the response. Whitelist YOK — uses
      // detectLibraryMatch + ground-truth rows.brand histogram.
      if (probeRes.decision === "inject" && probeRes.rows.length && RAG_SETTINGS?.crossVendorGuard !== false) {
        try {
          const _libBrandsCV = await getLibraryBrands();
          const _detCV = detectLibraryMatch(probeRes.qForRetrieval || q || "", _libBrandsCV);
          const _qBrandCV = _detCV?.matched || null;
          const _bcCV = {};
          for (const r of probeRes.rows) { const b = String(r.brand || "").trim(); if (b) _bcCV[b] = (_bcCV[b] || 0) + 1; }
          const _beCV = Object.entries(_bcCV).sort((a, b) => b[1] - a[1]);
          const _ttCV = _beCV.reduce((acc, [, c]) => acc + c, 0);
          const _domCV = (_ttCV > 0 && _beCV[0][1] / _ttCV >= 0.70) ? _beCV[0][0] : null;
          if (_qBrandCV && _domCV && _qBrandCV !== _domCV) {
            chatTrace(thread_id, "rag.cross_vendor_reject", { questionBrand: _qBrandCV, dominantBrand: _domCV, rows: probeRes.rows.length });
            console.log(`[CROSS-VENDOR-GUARD/stream] q=${_qBrandCV} dom=${_domCV} → demote to free-answer`);
            probeRes.decision = "skip";
            probeRes.reason = "cross_vendor_mismatch";
            probeRes._crossVendor = { questionBrand: _qBrandCV, dominantBrand: _domCV };
          }
        } catch (e) { console.warn("[cross-vendor-guard/stream]", e.message); }
      }

      if (probeRes.decision === "inject" && probeRes.rows.length) {
        ragUsedFlag = true;
        const ctx = probeRes.rows.map((r, i) => {
          const _page = r.page_start ? ` · sayfa ${r.page_start}${r.page_end && r.page_end !== r.page_start ? `-${r.page_end}` : ""}` : "";
          return `[Kaynak ${i + 1}: ${path.basename(r.path || "chunk")}${_page} · chunk #${r.ord ?? 0} · skor ${Math.round(Math.min(1, Number(r.score) || 0) * 100)}% · ${r.access_level}]\n${String(r.content).slice(0, 900)}`;
        }).join("\n\n---\n\n");
        // UI = TEK MERCİİ (2026-06-02). Inspector directive (Rule 1-6) +
        // dominant brand lock (Rule 7) + concise (Rule 8) + no-tool (Rule 9) +
        // "MÜHÜRLÜ DÖKÜMANLAR/SORU" envelope SÖKÜLDÜ. Hiçbiri UI'da görünmüyordu.
        // RAG_SETTINGS.ragExpertMode/ragConciseAnswers/ragNoToolRuleStrict/
        // crossVendorGuard knob'ları UI'da kalıyor — şu an no-op. Bir sonraki
        // turda Prompt Registry'ye bağlanacak ve UI'dan metin editlenecek.
        // Şu an model'e SADECE kaynak blokları + kullanıcı sorusu gider; ek
        // backend talimatı YOK. RAG cevap kalitesi UI'daki model.system_prompt'a
        // bağlı kalır.
        if (preRagTimedOut) return;
        const _dominantBrand = (() => {
          const c = {}; for (const r of probeRes.rows) { const b = String(r.brand || "").trim(); if (b) c[b] = (c[b] || 0) + 1; }
          const e = Object.entries(c).sort((a, b) => b[1] - a[1]); const t = e.reduce((a, [, x]) => a + x, 0);
          return (t > 0 && e[0][1] / t >= 0.70) ? e[0][0] : null;
        })();
        const _sourceList = probeRes.rows.map((r, i) => {
          const _p = r.page_start ? ` s.${r.page_start}${r.page_end && r.page_end !== r.page_start ? `-${r.page_end}` : ""}` : "";
          return `[${i + 1}] ${path.basename(r.path || "chunk")}${_p}`;
        }).join(" · ");
        // 2026-06-03 — UI = tek mercii. inspectorDirective + inspectorBrandLock
        // RAG_SETTINGS textarea'sından override edilebilir; boş → kodda default.
        // Per-model override (Tur 2): model.inspector_directive doluysa o kazanır.
        const _settingsForDirective = modelInspectorDirective.trim()
          ? { ...RAG_SETTINGS, inspectorDirective: modelInspectorDirective }
          : RAG_SETTINGS;
        const _directive = renderInspectorDirective(_settingsForDirective, {
          dominantBrand: _dominantBrand,
          sourceList: _sourceList,
        });
        augmentedMessages = [
          ...messages.slice(0, -1),
          { role: "user", content: `${ctx}\n\n${_directive}\n\nSORU: ${lastUser.content}` },
        ];
        chatTrace(thread_id, "rag.inject.done", { sources: probeRes.rows.length, brandLock: _dominantBrand || null });
        logCheckpoint("info", "rag.injected", `RAG enjekte · top1=${probeRes.top1.toFixed(2)} · ${probeRes.rows.length} kaynak · ${probeMs}ms`, { top1: probeRes.top1, hits: probeRes.rows.length, ms: probeMs, tau: probeRes.tau, retriever: "probe+hnsw" }, thread_id);
        send({ rag: { used: probeRes.rows.length, denied: 0, skipped: false, fallback: null, notice: null, retriever: "probe+hnsw", top1: Math.round(probeRes.top1 * 100), tau: Math.round(probeRes.tau * 100), reranker: probeRes.reranker || { used: false, ms: 0, model: null }, confidence: probeRes.confidence || null, queryRewritten: probeRes.queryRewritten || null, sources: probeRes.rows.map((r, i) => ({ index: i + 1, name: path.basename(r.path || "chunk"), path: r.path, ord: r.ord ?? 0, score: Math.round(Math.min(1, Number(r.score) || 0) * 100) })), debug: { path: "stream", q, qForRetrieval: probeRes.qForRetrieval || null, queryClean: probeRes.queryClean || null, intent: intent.kind, mode: intent.mode, probe: { top1: probeRes.top1, ftsTop: probeRes.ftsTop ?? null, tau: probeRes.tau, decision: probeRes.decision, reason: probeRes.reason, ms: probeMs, topCoverage: probeRes.topCoverage ?? null, queryTerms: probeRes.queryTerms ?? null }, rerank: probeRes.reranker || null, brandLock: _dominantBrand || null, brandHistogram: { vector: probeRes.vectorRowsByBrand || null, fts: probeRes.ftsRowsByBrand || null }, hyde: probeRes.hyde || null, extractor: probeRes.extractor || null, finalRows: probeRes.rows.map((r, i) => ({ i: i + 1, path: r.path, ord: r.ord ?? 0, brand: r.brand || null, score: r.score, rerank_score: r.rerank_score ?? null, rerank_mix: r.rerank_mix ?? null, coverage: r.coverage ?? null, retriever: r.retriever || null })) } } });
      } else {
        // Library-aware free-answer (2026-05-26). Determine whether the user's
        // query targets a brand we DO have docs for (in_library_miss) or one we
        // don't (out_of_library). Drives both directive tone and UI chip.
        let _faCtx = null, _faFallback = null;
        chatTrace(thread_id, "rag.library.start", {});
        try {
          if (RAG_SETTINGS?.outOfLibraryFallback !== false) {
            const _libBrands = await getLibraryBrands();
            const _matchQ = (probeRes.qForRetrieval || q || "");
            const _det = detectLibraryMatch(_matchQ, _libBrands);
            _faCtx = { qForRetrieval: _matchQ, libBrands: _libBrands, matchedBrand: _det.matched, matchedBrandDisplay: _det.matchedDisplay };
            _faFallback = {
              kind: _det.matched ? "in_library_miss" : "out_of_library",
              brand: _det.matchedDisplay || (_det.matched ? _brandDisplay(_det.matched) : null),
              brands: _libBrands.slice(0, 5).map(_brandDisplay),
            };
          }
        } catch (e) { console.warn("[free-answer-ctx/stream]", e.message); }
        chatTrace(thread_id, "rag.library.done", { matched: !!_faCtx?.matchedBrand });
        if (preRagTimedOut) return;
        augmentedMessages = buildFreeAnswerMessages(messages, probeRes.reason || "rag_skip", _faCtx);
        const top1Pct = Math.round((probeRes.top1 || 0) * 100);
        const tauPct = Math.round((probeRes.tau || 0.45) * 100);
        const notice = !ragGloballyEnabled
          ? `${brandSync().persona_name || "Assistant"} kütüphane kapalı modda — serbest cevap.`
          : probeRes.reason === "below_threshold"
            ? `Kütüphanede en iyi eşleşme %${top1Pct} (eşik %${tauPct}) — eşik altı, kendi bilgimle cevaplıyorum.`
            : probeRes.reason === "embed_miss"
              ? "Embedding üretilemedi — model serbest cevap veriyor."
              : String(probeRes.reason || "").startsWith("deadline_")
                ? `RAG probe ${ragDeadlineMs}ms'i aştı — model serbest cevap veriyor.`
                : probeRes.reason === "no_rows_above_floor"
                  ? `Kütüphane probe geçti (%${top1Pct}) ama full fetch'te kalan kaynak yok — serbest cevap.`
                  : "Kütüphanede ilgili kaynak bulamadım — kendi bilgimle cevaplıyorum.";
        logCheckpoint("info", "rag.skipped", `RAG atlandı · ${probeRes.reason} · top1=${probeRes.top1.toFixed(2)} · ${probeMs}ms`, { top1: probeRes.top1, reason: probeRes.reason, ms: probeMs, tau: probeRes.tau, fallback: _faFallback }, thread_id);
        send({ rag: { used: 0, denied: 0, sources: [], skipped: true, intent: intent.kind, mode: intent.mode, reason: probeRes.reason, top1: top1Pct, tau: tauPct, retriever: "probe+hnsw", notice, fallback: _faFallback, debug: { path: "stream", q, qForRetrieval: probeRes.qForRetrieval || null, queryClean: probeRes.queryClean || null, probe: { top1: probeRes.top1, ftsTop: probeRes.ftsTop ?? null, tau: probeRes.tau, decision: probeRes.decision, reason: probeRes.reason, ms: probeMs, topCoverage: probeRes.topCoverage ?? null, queryTerms: probeRes.queryTerms ?? null }, rerank: probeRes.reranker || null, brandHistogram: { vector: probeRes.vectorRowsByBrand || null, fts: probeRes.ftsRowsByBrand || null }, hyde: probeRes.hyde || null, extractor: probeRes.extractor || null, rejectedTop: probeRes.rejectedTop || null, ftsError: probeRes.ftsError || null, embedError: probeRes.embedError || null } } });
      }
      preRagDone = true;
    })(),
    new Promise((resolve) => setTimeout(() => { preRagTimedOut = true; resolve(); }, preRagDeadlineMs)),
  ]);

  if (preRagTimedOut && !preRagDone) {
    const elapsedMs = Date.now() - tPreRagStart;
    chatTrace(thread_id, "rag.pre.timeout", { deadlineMs: preRagDeadlineMs, elapsedMs });
    logCheckpoint("warn", "rag.pre_pipeline.timeout", `Pre-RAG pipeline ${preRagDeadlineMs}ms aşıldı — fallback`, { deadlineMs: preRagDeadlineMs, elapsedMs }, thread_id);
    // Phase event may not have been emitted yet — push it now so UI advances.
    send({ phase: "thinking", intent: intent.kind });
    ragUsedFlag = false;
    augmentedMessages = buildFreeAnswerMessages(messages, "pre_rag_deadline", null);
    const tauPct = Math.round((Number(RAG_SETTINGS.injectThreshold) || 0.45) * 100);
    send({ rag: { used: 0, denied: 0, sources: [], skipped: true, intent: intent.kind, mode: intent.mode, reason: "pre_rag_deadline", top1: 0, tau: tauPct, retriever: "probe+hnsw", notice: `RAG ön-pipeline ${preRagDeadlineMs}ms'i aştı — model serbest cevap veriyor.`, fallback: { kind: "out_of_library", brand: null, brands: [] }, debug: { path: "stream", q, deadlineMs: preRagDeadlineMs, elapsedMs } } });
  } else {
    chatTrace(thread_id, "rag.pre.done", { decision: probeRes.decision, elapsedMs: Date.now() - tPreRagStart });
  }
  send({ phase: "streaming" });

  // 2026-07-06 — Proposal state injection söküldü (hat komple gitti).

  if (RAG_SETTINGS?.autoForgeRouting !== false) {
    try {
      const { resolvePrompt } = await import("../system-prompts.mjs");
      const gapDirective = resolvePrompt(RAG_SETTINGS, "capabilityGapDirective");
      if (gapDirective && gapDirective.trim()) {
        augmentedMessages = [{ role: "system", content: gapDirective }, ...augmentedMessages];
        chatTrace(thread_id, "capability.gap.directive.injected", { chars: gapDirective.length });
      }
    } catch (e) { console.warn("[capability-gap-directive/stream]", e?.message || e); }
  }

  // History pencere kırpma: MLX'e gönderilen messages'ı son N + system'a kıs.
  // 14-mesajlık konuşma KV cache'i şişirip 75 GB RAM + 25 sn "preparing" döngüsüne
  // yol açıyordu. System mesajlarını koru, son N user/assistant turunu tut.
  // Knob: RAG_SETTINGS.mlxHistoryKeep (default 4). Settings → Runtime'tan canlı.
  const MLX_HIST_KEEP = Math.max(2, Number(RAG_SETTINGS?.mlxHistoryKeep) || 4);
  if (Array.isArray(augmentedMessages) && augmentedMessages.length > MLX_HIST_KEEP + 1) {
    const systems = augmentedMessages.filter((m) => m?.role === "system");
    const nonSystems = augmentedMessages.filter((m) => m?.role !== "system");
    const tail = nonSystems.slice(-MLX_HIST_KEEP);
    augmentedMessages = [...systems, ...tail];
    chatTrace(thread_id, "mlx.history.trimmed", { kept: augmentedMessages.length, dropped: nonSystems.length - tail.length });
  }

  // 2026-06-29 — Elara agent manifest placeholder. System prompt'a `{AGENTS}`
  // yazılıysa: off=boş, lazy=meta intent ise dolu, always=her zaman dolu.
  let _agentManifestMetaTurn = String(intent?.subKind || "").toLowerCase() === "agent_manifest";
  try {
    const _mode = String(RAG_SETTINGS?.elaraAgentManifestMode || "lazy").toLowerCase();
    const _appRes = await applyAgentsPlaceholder(augmentedMessages, {
      mode: _mode,
      intentKind: intent?.kind,
      intentMode: intent?.mode,
      intentSubKind: intent?.subKind,
      renderFn: () => renderAgentsManifest({ pool }),
    });
    augmentedMessages = _appRes.messages;
    _agentManifestMetaTurn = _agentManifestMetaTurn || _appRes.injected || _appRes.reason === "intent_agent_manifest";
    if (_appRes.reason !== "no_placeholder") {
      chatTrace(thread_id, "agents.manifest", { mode: _appRes.mode, injected: _appRes.injected, count: _appRes.count, reason: _appRes.reason, intent: intent?.kind || null });
    }
  } catch (e) { console.warn("[agents-manifest/stream]", e.message); }

  // ── META-FORGE model-declare protocol ─────────────────────────────────────
  // Same contract as chat-orchestrate: inject hint, sniff stream for the
  // <forge kind name intent/> tag, strip from delta, emit SSE `forge_declared`.
  // Planner spawn stays in orchestrate — this hat is emit-only so any UI that
  // enters via stream still gets the signal.
  let _forgeGateStream = String(RAG_SETTINGS?.metaForgeGateMode || "pre-classify").toLowerCase();
  let _forgeDeclaredStream = null;
  let _forgeSnifferStream = null;
  if (!isCapabilitySmoke && _forgeGateStream === "model-declare") {
    try {
      const { DEFAULT_META_FORGE_SYSTEM_HINT } = await import("../meta-forge/system-hint.mjs");
      const { createForgeTagSniffer } = await import("../meta-forge/tag-parser.mjs");
      const _hintOverride = String(RAG_SETTINGS?.metaForgeSystemHint || "").trim();
      const _hintText = _hintOverride || DEFAULT_META_FORGE_SYSTEM_HINT;
      if (_hintText) {
        // APPEND as the last system message (right before the user turn) so
        // recency-biased models like Gemma 4 actually see the trigger rather
        // than burying it under 8k tokens of KİMLİK+ÜSLUP+TOOLS context.
        const _lastUserIdx = (() => {
          for (let i = augmentedMessages.length - 1; i >= 0; i -= 1) {
            if (augmentedMessages[i]?.role === "user") return i;
          }
          return augmentedMessages.length;
        })();
        const _hintMsg = { role: "system", content: _hintText, meta: { kind: "meta_forge_hint" } };
        augmentedMessages = [
          ...augmentedMessages.slice(0, _lastUserIdx),
          _hintMsg,
          ...augmentedMessages.slice(_lastUserIdx),
        ];
        chatTrace(thread_id, "meta_forge.hint.injected", { chars: _hintText.length, override: !!_hintOverride, position: "pre-user" });
      }
      _forgeSnifferStream = createForgeTagSniffer({
        windowChars: Number(RAG_SETTINGS?.metaForgeSnifferWindowChars || 1200),
        onDeclared: (payload) => {
          _forgeDeclaredStream = payload;
          chatTrace(thread_id, "meta_forge.declared", { kind: payload.kind, name: payload.name, intent: (payload.intent || "").slice(0, 120) });
          try { send({ forge_declared: { kind: payload.kind, name: payload.name, intent: payload.intent } }); } catch {}
        },
      });
    } catch (e) {
      console.warn("[meta-forge/stream] hint/sniffer init failed:", e?.message || e);
    }
  }



  let assembled = "";
  // Agent/skill bridge must only inspect user-visible assistant text. Gemma can
  // mention `@[agent.py]` or "call x.py" inside hidden thinking; the UI strips
  // that text, so using raw `assembled` caused ghost agent executions after
  // normal/meta answers.
  let visibleAssembled = "";
  let tFirstToken = 0;
  // 2026-06-02 — Rewrite layer `@[script.py]` enjekte ettiyse outer MLX'i atla
  // (Fix A: çift cevap + 130s latency keser). Agent bridge tek cevabı stream eder.
  // Smalltalk fast-path: probe top1 zayıfsa (anchor yok, semantic skor) kısa
  // token bütçesi. RAG inject olduysa "rag", probe geçti ama altıysa "query".
  // UI'dan kontrol: RAG_SETTINGS.smalltalkFastPath. Plist env boot fallback.
  const _fastPathOn = (typeof RAG_SETTINGS?.smalltalkFastPath === "boolean")
    ? RAG_SETTINGS.smalltalkFastPath
    : String(process.env.SMALLTALK_FAST_PATH || "1") !== "0";
  const _smallTh = Number(RAG_SETTINGS?.smalltalkProbeThreshold);
  const _smallThEff = Number.isFinite(_smallTh) ? _smallTh : 0.65;
  // v11.4 — Smalltalk lane SADECE semantic intent classifier ile tetiklenir.
  // Probe top1 zayıflığı (eski `_weakProbe`) artık lane'i flip etmez — düşük
  // probe sadece "RAG yok" demek, "kullanıcı selamlaşıyor" demek değil.
  // Memory: mem://decisions/intent-only-smalltalk-gate-2026-05-22.md
  // 2026-07-03 — Meta/manifest turns use the same lean lane as smalltalk.
  // Forcing query here kept Tool/Skill system blocks in the prompt and made
  // short self-intro turns pay a huge prefill cost. streamFromLocalLLM preserves
  // agent-manifest system blocks while suppressing other system manifests.
  const intentHint = ragUsedFlag
    ? "rag"
    : (_agentManifestMetaTurn ? "smalltalk"
      : ((_fastPathOn && semanticSmalltalk) ? "smalltalk" : "query"));
  console.log(`[SMALLTALK-LANE/stream] hint=${intentHint} ragUsed=${ragUsedFlag} top1=${(probeRes?.top1 || 0).toFixed(2)} th=${_smallThEff.toFixed(2)} semBypass=${semanticSmalltalk} fastPath=${_fastPathOn} metaTurn=${_agentManifestMetaTurn}`);

  try {
    // ===== Pre-LLM user→agent rewrite ======================================
    // Kullanıcı "X ajanına sor" / "firewall ajanına sor" gibi doğal dil yazdıysa,
    // niyetini yakala ve son user mesajına `@[script.py]` tag'i prepend et.
    // Böylece RAG + MLX streaming + library cards + token telemetry hattı AYNEN
    // çalışır; spawn işi mevcut `detectAgentIntent`/`tryStreamAgentExec` hattı
    // tarafından üstlenilir (kural #9 bridge'i kapatamaz, çünkü tetikleyici
    // model çıktısında değil — kullanıcı promptunda görünür).
    if (RAG_SETTINGS?.userAgentMentionDispatch === true && q && lastUserPreview) {
      let _agentRows = [];
      try {
        const _r = await pool.query(
          `SELECT id, name, agent_path, meta FROM agents
            WHERE coalesce(agent_path,'') <> ''
              AND lower(coalesce(status,'')) IN ('active','armed','idle')`
        );
        _agentRows = _r.rows || [];
      } catch (e) { console.warn("[user-agent-intent/stream] catalog query failed:", e?.message || e); }
      const _hit = detectUserAgentMention(q, _agentRows);
      if (_hit) {
        const _tag = `@[${_hit.script}]`;
        const _orig = String(lastUserPreview.content ?? "");
        if (!_orig.includes(_tag)) {
          lastUserPreview.content = `${_tag} ${_orig}`.trim();
          chatTrace(thread_id, "agent.user_intent.rewrite", { script: _hit.script, kind: _hit.matchKind, token: _hit.matchedToken });
        }
        _rewriteHit = _hit;
        if (RAG_SETTINGS?.skipOuterLlmOnAgentRewrite !== false) {
          _skipOuterLlm = true;
          chatTrace(thread_id, "mlx.skip_outer", { reason: "agent_rewrite", script: _hit.script });
        }
      }
    }

    // ===== Auto-route (Elara → Ajan) — stream hattı ==========================
    // Explicit mention yoksa ve `agentAutoRoute` ON ise, kullanıcı sorgusunu
    // keyword/brand skoruna göre uygun ajana yönlendir. Aynı `_rewriteHit` +
    // `_skipOuterLlm` hattını yeniden kullanır → mevcut agent dispatch tetiklenir.
    // 2026-06-04: Auto-route önündeki library brand-gate kaldırıldı.
    // Gate sadece DB brand token okuyordu; ajan alias JSON'unu (ör. FortiManager
    // → firewall_oracle) göremediği için alias ürünler ajan tetiklemiyordu.
    // Karar artık doğrudan pickAgentForQuery skor eşiğine bırakılıyor.
    try {
      // 2026-06-29: smalltalk gate. "teşekkürler / kendini tanıt" turlarında
      // zayıf token match ile ajan tetiklenmesini engelle. Knob:
      // RAG_SETTINGS.agentAutoRouteSkipSmalltalk (default true).
      let _smalltalkSkip = false;
      if (RAG_SETTINGS?.agentAutoRouteSkipSmalltalk !== false && q) {
        try {
          const mod = await import("../rag/intent-classifier.mjs");
          if (typeof mod.classifyIntent === "function" && typeof mod.refineIntentSemantically === "function") {
            const base = mod.classifyIntent(String(q));
            const refined = await Promise.race([
              mod.refineIntentSemantically(String(q), base),
              new Promise((resolve) => setTimeout(() => resolve(null), 500)),
            ]);
            // Only suppress auto-route for turns that are already obvious
            // smalltalk by the cheap classifier. Long compound automation
            // requests can be semantically misread as CHAT; skipping auto-route
            // there sends them to outer MLX instead of the approved agent.
            const _bypassSafe = base?.kind === "smalltalk" && (
              refined?.mode === "semantic-bypass" || refined?.mode === "semantic-meta" || refined?.kind === "smalltalk"
            );
            if (refined?.kind === "smalltalk" && refined?.useRag === false && _bypassSafe) {
              _smalltalkSkip = true;
              chatTrace(thread_id, "agent.auto_route.skip", { reason: "smalltalk_intent", base: base?.kind, refined: refined?.kind });
            }
          }
        } catch (e) {
          console.warn(`[agent-auto-route/stream] smalltalk classifier failed: ${e?.message || e}`);
        }
      }
      if (!isCapabilitySmoke && !_smalltalkSkip && !_rewriteHit && RAG_SETTINGS?.agentAutoRoute === true && q && lastUserPreview) {
        const _r2 = await pool.query(
          `SELECT id, name, agent_path, meta FROM agents
            WHERE coalesce(agent_path,'') <> ''
              AND lower(coalesce(status,'')) IN ('active','armed','idle')`,
        );
        const _pick = pickAgentForQuery(String(q), _r2.rows || [], {
          minScore: Number(RAG_SETTINGS?.agentAutoRouteMinScore || 2),
        });
        if (_pick) {
          const _tag = `@[${_pick.script}]`;
          const _orig = String(lastUserPreview.content ?? "");
          if (!_orig.includes(_tag)) {
            lastUserPreview.content = `${_tag} ${_orig}`.trim();
          }
          _rewriteHit = _pick;
          if (RAG_SETTINGS?.skipOuterLlmOnAgentRewrite !== false) {
            _skipOuterLlm = true;
            chatTrace(thread_id, "mlx.skip_outer", { reason: "agent_auto_route", script: _pick.script });
          }
          chatTrace(thread_id, "agent.auto_route", { script: _pick.script, score: _pick.score, matchedToken: _pick.matchedToken, hits: _pick.hits?.length || 0 });
          try {
            send({ agent: { autoRouted: true, script: _pick.script, agentName: _pick.row?.name || _pick.script, score: _pick.score, matchedToken: _pick.matchedToken } });
          } catch {}
        } else {
          chatTrace(thread_id, "agent.auto_route.skip", { reason: "no_pick", minScore: Number(RAG_SETTINGS?.agentAutoRouteMinScore || 2) });
        }
      }
    } catch (e) {
      console.warn(`[agent-auto-route/stream] failed: ${e?.message || e}`);
    }





    const _q2Label = `chat:${thread_id || "anon"}`;
    const tBeforeMlx = Date.now();
    const queueAbort = new AbortController();
    const queueSignal = typeof AbortSignal.any === "function"
      ? AbortSignal.any([requestAbort.signal, queueAbort.signal])
      : requestAbort.signal;
    const firstTokenBudgetMs = typeof _mlxEffectiveFirstTokenMs === "function"
      ? _mlxEffectiveFirstTokenMs()
      : Math.max(30_000, Number(RAG_SETTINGS?.mlxColdFirstTokenMs) || TIMEOUT_BUDGETS.MLX_STREAM_TOTAL_MS || 60_000);
    // [trace] kuyruk→MLX→ilk-token görünürlüğü (stream hattı, key=thread_id)
    let _slotAcqStream = 0, _qWaitStream = 0;
    if (_skipOuterLlm) {
      // Fix A: rewrite hattı agent'a yönlendirdi — outer MLX cevabı üretmiyoruz.
      // Kullanıcıya "ajan hazırlanıyor" sinyali için phase + minimum trace.
      send({ phase: "agent_dispatch", script: _rewriteHit?.script || null });
      chatTrace(thread_id, "mlx.bypass", { reason: "agent_rewrite", script: _rewriteHit?.script || null });
    } else {
    const _q2Stream = localQueue.enqueueStream(
      ({ signal: slotSignal }) => {
        _slotAcqStream = Date.now();
        _qWaitStream = _slotAcqStream - tBeforeMlx;
        chatTrace(thread_id, "local.slot.acquired", { queueWaitMs: _qWaitStream, stats: localQueue.stats() });
        chatTrace(thread_id, "local.fetch.start", { target: "local:" + LOCAL_RUNTIME_PORT, keepAlive: LOCAL_TRANSPORT.keepAlive, dirty: LOCAL_TRANSPORT.dirty });
        // DIAG (Plan B, 2026-06-02): prompt size breadcrumb (stream hattı).
        try {
          const _ps = summarizePromptMessages(augmentedMessages);
          chatTrace(thread_id, "mlx.prompt.size", { intentHint, ..._ps });
        } catch {}
        return streamFromLocalLLM({
          model,
          messages: augmentedMessages,
          signal: slotSignal,
          intentHint,
          nowPreamble,
          onWarming: ({ headersTimeoutMs, firstTokenTimeoutMs, cold }) => {
            const notice = cold
              ? "Runtime cold-start · first token may take longer than usual."
              : "Runtime is preparing the first token.";
            send({ phase: "mlx_warming", notice, headersTimeoutMs, firstTokenTimeoutMs, cold: !!cold });
          },
          onLoopGuard: (info) => {
            // Per-model loop guard tripped — kullanıcıya amber chip + akış kesildi.
            try { send({ phase: "loop_guard", reason: info?.reason || "loop", sample: info?.sample || "", count: info?.count || 0 }); } catch {}
          },
        });
      },
      { signal: queueSignal, label: _q2Label, priority: 1, maxWaitMs: Math.max(1_000, Number(RAG_SETTINGS?.localQueueWaitMs) || TIMEOUT_BUDGETS.MLX_QUEUE_WAIT_MS) }
    );
    const _thinkStrip = _makeThinkStripper();
    const _q2Iterator = _q2Stream[Symbol.asyncIterator]();
    const _readFirstStreamToken = async () => {
      let timer = null;
      try {
        return await Promise.race([
          _q2Iterator.next(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const err = new Error(`First token timeout after ${firstTokenBudgetMs}ms — upstream produced no bytes`);
              err.code = "MLX_FIRST_TOKEN_TIMEOUT";
              reject(err);
            }, firstTokenBudgetMs);
          }),
        ]);
      } catch (e) {
        if (!requestAbort.signal.aborted) {
          try { queueAbort.abort(e); } catch {}
        }
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    for (let step = await _readFirstStreamToken(); !step.done; step = await _q2Iterator.next()) {
      const delta = step.value || "";
      if (!tFirstToken) {
        tFirstToken = Date.now();
        _mlxRecordFirstToken(tFirstToken - tBeforeMlx);
        // FAZ 25.1 — Sıcaklık/dirty kararını orchestrate hattıyla eşitle:
        // başarılı first-token = upstream sağlıklı, dirty=false, lastActivity bump.
        recordMlxActivity();
        logCheckpoint("info", "model.first_token", `İlk token · ${tFirstToken - t0}ms`, { ms: tFirstToken - t0, model: model || null }, thread_id);
        chatTrace(thread_id, "mlx.first_token.received", { queueWaitMs: _qWaitStream, mlxGenMs: _slotAcqStream ? (tFirstToken - _slotAcqStream) : null, totalMs: tFirstToken - tBeforeMlx });
        if (process.env.TIMING_LOG === "1") console.log(`[TIMING/${intentHint}-stream] intent=${phaseIntentMs} probe=${probeMs} queueMlx=${tFirstToken - tBeforeMlx} total=${tFirstToken - t0}ms qLen=${q.length} qHead="${q.slice(0, 40).replace(/\n/g, " ")}"`);
      }
      assembled += delta;
      const _visibleRaw = _thinkStrip(delta);
      const _visible = _forgeSnifferStream ? _forgeSnifferStream.feed(_visibleRaw) : _visibleRaw;
      if (_visible) {
        visibleAssembled += _visible;
        send({ delta: _visible });
      }
    }
    if (_forgeSnifferStream) {
      try {
        const tail = _forgeSnifferStream.flush();
        if (tail) { visibleAssembled += tail; try { send({ delta: tail }); } catch {} }
      } catch { /* */ }
    }
    chatTrace(thread_id, "mlx.stream.done", { chars: assembled.length, totalMs: Date.now() - tBeforeMlx, firstToken: !!tFirstToken, forgeDeclared: !!_forgeDeclaredStream });
    } // end if (!_skipOuterLlm)



    // --- Agent Bridge: model "tetikliyorum: x.py" / "@[x.py]" niyetini beyan ettiyse
    // yerel Python ajanını koştur, stdout'u stream'e Elara'nın cevabıymış gibi enjekte et.
    try {
      const userPrompt = String(lastUserPreview?.content ?? "");
      const _userDirectAgent = /@\[\s*[\p{L}\p{N}_\-./]+\.py\s*\]/u.test(userPrompt);
      if (_agentManifestMetaTurn && !_userDirectAgent) {
        chatTrace(thread_id, "agent.bridge.skipped", { reason: "meta_manifest_turn" });
      }
      // Smalltalk lane: model promptuna rağmen "@[x.py]" yazarsa bile backend
      // tarafında spawn etme. Sohbet selamı tool tetiklemez.
      const _allowAssistantAgentDispatch = RAG_SETTINGS?.autoDispatchAgentsFromModelOutput === true || _userDirectAgent;
      const intent = (intentHint === "smalltalk" || (_agentManifestMetaTurn && !_userDirectAgent) || !_allowAssistantAgentDispatch) ? null : detectAgentIntent(visibleAssembled, userPrompt);
      if (intent) {
        logCheckpoint("info", "agent.bridge.start", `Yerel ajan tetiklendi · ${intent.script}`, { script: intent.script, queryLen: intent.query.length }, thread_id);
        send({ type: "agent_thinking", key: "agent.thinking", script: intent.script });
        // Bridge spawn'ları run history'ye düşsün diye synthetic registry entry.
        const _agentIdHint = path.basename(String(intent.script), ".py").toLowerCase();
        const _syn = registerSyntheticRun({ agentId: _agentIdHint, script: intent.script, source: "chat-bridge" });
        try {
          // Fix C: agent RAG meta'sını UI'a yansıt (yeşil kütüphane kartları).
          const _onAgentRagMeta = (meta) => {
            try {
              const _rag = {
                enabled: meta?.enabled !== false,
                intent: "agent",
                mode: meta?.mode || null,
                top1: typeof meta?.top1 === "number" ? meta.top1 : null,
                tau: typeof meta?.tau === "number" ? meta.tau : null,
                margin: typeof meta?.margin === "number" ? meta.margin : null,
                hits: meta?.hits ?? 0,
                decision: meta?.decision || null,
                reason: meta?.reason || null,
                sources: Array.isArray(meta?.sources) ? meta.sources : [],
                reranker: meta?.rerankInfo || null,
                confidence: meta?.confidence || null,
                queryRewritten: meta?.queryRewritten || null,
                fallback: meta?.fallback || null,
                diag: meta?.diag || null,
                rawReason: meta?.rawReason || meta?.reason || null,
                defensiveDropped: typeof meta?.defensiveDropped === "number" ? meta.defensiveDropped : null,
                retriever: "agent-rag",
                notice: null,
              };
              send({ rag: _rag });
            } catch (e) { console.warn("[agent-bridge/stream] rag meta emit failed:", e?.message || e); }
          };
          const _smalltalkToolGate = intentHint === "smalltalk";
          // UI tek mercii (2026-06-03): injectAgentToolsManifest OFF (default)
          // ise backend manifest enjeksiyonu KAPALI — operator agent prompt'una
          // tool listesini UI'dan elden yazıyor. ON ise eski smalltalk gate.
          const _injectManifest = RAG_SETTINGS?.injectAgentToolsManifest === true;
          const _suppressManifest = !_injectManifest
            || (_smalltalkToolGate && RAG_SETTINGS?.suppressToolManifestOnSmalltalk !== false);
          const _agentEnv = await buildAgentEnvForScript(pool, intent.script, {
            includeToolPrompts: _suppressManifest ? false : !!RAG_SETTINGS?.includeToolPromptsInAgent,
            suppressToolManifest: _suppressManifest,
            ragQuery: intent.query,
            userNow: _nowHints.userNow,
            userTz: _nowHints.userTz,
            onRagMeta: _onAgentRagMeta,
          });
          // Fix B: streaming agent execution (token-by-token). Knob ile fallback.
          const _useStream = RAG_SETTINGS?.streamAgentExec !== false && typeof streamLocalAgent === "function";
          const _agentExecTimeoutMs = Math.max(30_000, Math.min(300_000, Number(RAG_SETTINGS?.agentExecTimeoutMs || 180_000)));
          const isMetaForgeBridge = isMetaForgeScriptPath(intent.script);
          if (isMetaForgeBridge) {
            try {
              const idemHit = await findRecentAppliedForgePlanByPrompt({ pool, ragSettings: RAG_SETTINGS, userPrompt: userPrompt || intent.query });
              if (idemHit) {
                const { cached, cachedPlan, cachedIntent, ageSec, intentHash: planIntentHash, summary } = idemHit;
                chatTrace(thread_id, "meta_forge.idempotency.hit", { route: "stream-bridge", planId: cached.id, ageSec, intentHash: planIntentHash.slice(0, 12) });
                try { send({ meta: { source: "meta-forge", model: "forge_master", forge_plan: true, dedup: true } }); } catch {}
                try { send({ phase: "streaming", intent: "meta_forge" }); } catch {}
                try { send({ rag: { used: 0, sources: [], skipped: true, reason: "meta_forge_idempotency", intent: "meta_forge", mode: "agent-bridge", notice: null } }); } catch {}
                try { send({ forge_plan: { id: cached.id, intent: cachedIntent, plan: cachedPlan, status: "applied", requestedBy: cached.requested_by, autoApplied: true, dedup: true, ageSec } }); } catch {}
                send({ type: "agent_chunk", delta: summary });
                assembled += summary;
                return;
              }
            } catch (idemErr) {
              chatTrace(thread_id, "meta_forge.idempotency.error", { route: "stream-bridge", error: String(idemErr?.message || idemErr).slice(0, 200) }, "warn");
            }
          }
          const sep = "\n\n";
          if (!tFirstToken) tFirstToken = Date.now();
          if (!isMetaForgeBridge) {
            send({ type: "agent_chunk", delta: sep });
            assembled += sep;
          }
          let stdout = "", stderr = "";
          if (_useStream) {
            const r = await streamLocalAgent({
              script: intent.script, query: intent.query, env: _agentEnv,
              timeoutMs: _agentExecTimeoutMs,
              onChunk: (piece) => {
                if (!tFirstToken) tFirstToken = Date.now();
                if (isMetaForgeBridge) return;
                send({ type: "agent_chunk", delta: piece });
                assembled += piece;
              },
              onStderr: (piece) => { /* logged below */ },
            });
            stdout = r.stdout; stderr = r.stderr;
          } else {
            const r = await runLocalAgent({ script: intent.script, query: intent.query, env: _agentEnv, timeoutMs: _agentExecTimeoutMs });
            stdout = r.stdout; stderr = r.stderr;
            const clean = String(stdout || "").replace(/\r/g, "").trim();
            if (clean && !isMetaForgeBridge) {
              const CHUNK = 96;
              for (let i = 0; i < clean.length; i += CHUNK) {
                const piece = clean.slice(i, i + CHUNK);
                if (!tFirstToken) tFirstToken = Date.now();
                send({ type: "agent_chunk", delta: piece });
                assembled += piece;
              }
            }
          }
          if (stderr) {
            logCheckpoint("warn", "agent.bridge.stderr", `Ajan stderr · ${stderr.length} char`, { script: intent.script }, thread_id);
            console.warn(`[agent-bridge:${intent.script}] stderr:`, stderr.slice(0, 2000));
          }
          const clean = String(stdout || "").replace(/\r/g, "").trim();
          if (clean) {
            logCheckpoint("success", "agent.bridge.done", `Yerel ajan tamamlandı · ${clean.length} char`, { script: intent.script, chars: clean.length, streaming: _useStream }, thread_id);
            if (isMetaForgeBridge) {
              const parsed = await parseForgePlanFromText(clean);
              if (!parsed.validated) {
                const msg = `⚠️ Meta-Forge planı ayrıştırılamadı (${parsed.err}).`;
                send({ type: "agent_chunk", delta: msg });
                assembled += msg;
              } else {
                const intentText = String(parsed.planObj?.intent || intent.query || userPrompt || "").slice(0, 500);
                const requestedBy = req.session?.username || "chat";
                let planId = null;
                let applyResult = null;
                let applyError = null;
                let finalStatus = "applied";
                try {
                  const ins = await pool.query(
                    `INSERT INTO forge_plans (requested_by, intent, plan_json, status)
                     VALUES ($1, $2, $3, 'approved') RETURNING id`,
                    [requestedBy, intentText, JSON.stringify(parsed.validated)],
                  );
                  planId = ins.rows[0]?.id || null;
                  if (planId) {
                    const applyMod = await import("../meta-forge/apply.mjs");
                    const maxItems = Math.max(1, Number(RAG_SETTINGS?.metaForgeMaxItemsPerTurn) || 3);
                    applyResult = await applyMod.applyForgePlan({ pool, planId, plan: parsed.validated, maxItems });
                    finalStatus = (applyResult.failed?.length && !applyResult.applied?.length && !applyResult.deduped?.length) ? "failed" : "applied";
                    await pool.query(
                      `UPDATE forge_plans SET status=$2, applied_at=now(), updated_at=now(), error=$3 WHERE id=$1`,
                      [planId, finalStatus, applyResult.failed?.length ? JSON.stringify(applyResult.failed) : null],
                    );
                    await stampForgePlanUserPromptHash({ pool, planId, userPrompt: userPrompt || intent.query });
                    if (finalStatus === "applied" && typeof hydrateAllowedAgentsFromDb === "function") {
                      try { await hydrateAllowedAgentsFromDb(); } catch { /* best-effort */ }
                    }
                  }
                } catch (e) {
                  applyError = String(e?.message || e).slice(0, 500);
                  finalStatus = "failed";
                  if (planId) {
                    try { await pool.query(`UPDATE forge_plans SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [planId, applyError]); } catch { /* */ }
                  }
                }
                try { if (applyResult?.deduped?.length) send({ forge_deduped: { planId, items: applyResult.deduped } }); } catch {}
                try { if (applyResult?.deferred?.length) send({ forge_deferred: { planId, items: applyResult.deferred } }); } catch {}
                try { send({ forge_plan: { id: planId, intent: intentText, plan: parsed.validated, status: finalStatus, requestedBy, autoApplied: true, result: applyResult || undefined, error: applyError || undefined } }); } catch {}
                const summary = formatForgeBridgeSummary({ intentText, planId, finalStatus, applyResult, applyError, validated: parsed.validated });
                send({ type: "agent_chunk", delta: summary });
                assembled += summary;
              }
              try { _syn.finish(); } catch { /* noop */ }
              return;
            }
            // TUR-6 Phase C — parse `!<slug>({...})` and dispatch via loopback.
            const _parseTools = RAG_SETTINGS?.streamToolParse !== false && (!_smalltalkToolGate || RAG_SETTINGS?.streamToolParseOnSmalltalk === true);
            if (_parseTools) {
              try {
                const calls = extractToolCalls(clean);
                if (calls.length) {
                  logCheckpoint("info", "tool_call.parse", `${calls.length} tool call(s) parsed`, { script: intent.script, slugs: calls.map(c => c.slug) }, thread_id);
                  await runToolCallsForAgent({
                    scriptPath: intent.script, calls, port: PORT, send,
                    timeoutMs: RAG_SETTINGS?.streamToolCallTimeoutMs || 30000,
                    trace: (k, f, lvl) => logCheckpoint(lvl || "info", k, "", f, thread_id),
                  });
                }
              } catch (tcErr) {
                console.error("[tool-call-parser/stream]", tcErr?.message || tcErr);
              }
            }
          } else {
            logCheckpoint("warn", "agent.bridge.empty", `Yerel ajan boş çıktı`, { script: intent.script }, thread_id);
          }
        } catch (agentErr) {
          const code = classifyAgentError(agentErr);
          const masked = agentErrorMessage(code, locale);
          logCheckpoint("error", "agent.bridge.error", `Yerel ajan hatası · ${code}`, {
            script: intent.script, code,
            raw: String(agentErr?.message || agentErr).slice(0, 500),
          }, thread_id);
          console.error(`[agent-bridge:${intent.script}] ${code}:`, agentErr?.message || agentErr);
          try { console.error(`[agent-error-mirror] hattı=stream-bridge script=${intent.script} code=${code} text=${JSON.stringify(masked)} err=${JSON.stringify(String(agentErr?.message || agentErr)).slice(0, 400)}`); } catch { /* */ }
          send({
            type: "agent_error",
            key: `agent.error.${code}`,
            code,
            text: masked,
          });
          // Maskelenmiş mesajı DB'ye de yaz — kullanıcı geçmişte tutarlı görsün.
          assembled += "\n\n" + masked;
        } finally {
          try { _syn.finish(); } catch { /* noop */ }
        }
      }
    } catch (bridgeErr) {
      console.error("[agent-bridge] orchestration error:", bridgeErr?.message || bridgeErr);
    }
  } catch (e) {
    // Surface a clear handshake failure so the UI doesn't just show
    // the runtime's cryptic "Unable to connect" string.
    const raw = String(e?.message || e);
    const isFirstTokenTimeout = e?.code === "MLX_FIRST_TOKEN_TIMEOUT" || /first-?token timeout/i.test(raw);
    if (isFirstTokenTimeout) {
      await triggerMlxZombieSelfHeal(`stream:first-token-timeout:${raw.slice(0, 120)}`, (key, fields, level = "info") => {
        chatTrace(thread_id, key, fields, level);
      }).catch(() => null);
    }
    const base = runtimeBase() || "(unset)";
    const mdl  = runtimeModel() || "(unset)";
    const isUnreach = /unable to connect|ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw);
    const friendly = isUnreach
      ? `LLM handshake failed · base=${base} · model=${mdl} · runtime ayakta mı? (MLX: port ${process.env.LOCAL_RUNTIME_PORT || 8001} · Legacy HTTP runtime ayakta mı?) · upstream: ${raw}`
      : isFirstTokenTimeout
        ? `${raw} · automatic zombie cleanup: ${LOCAL_TRANSPORT.lastSelfHealStatus} (${LOCAL_TRANSPORT.lastSelfHealDetail || "no detail"})`
        : raw;
    logCheckpoint("error", "stream.error", `Stream hata: ${friendly.slice(0, 200)}`, { model: mdl }, thread_id);
    if (isFirstTokenTimeout && !assembled) assembled = friendly;
    send({ error: friendly });
  } finally {
    clearInterval(heartbeat);
    // RAM tırmanışı fix (debug suite kanıtı 13:46-13:48):
    // MLX prompt_cache her turda birikiyor — "merhaba" bile +1.5 GB kalıcı
    // bırakıyor, 10 turda Python süreci 80+ GB'a oturuyor. Stream kapanışında
    // thread'in cache slot'unu boşalt. Konuşma geçmişi DB'de, modele her turda
    // full messages[] zaten gönderiliyor → prompt_cache reuse'a ihtiyaç yok.
    try {
      const flushRes = await flushModelKvCache(thread_id);
      chatTrace(thread_id, "mlx.cache.flush", { ok: flushRes?.ok === true, url: flushRes?.url || null });
    } catch (e) {
      chatTrace(thread_id, "mlx.cache.flush", { ok: false, error: String(e?.message || e).slice(0, 120) }, "warn");
    }
    if (assembled) {
      enqueueWrite(
        `INSERT INTO chat_messages(thread_id, role, content, model)
         VALUES ($1,'assistant',$2,$3)`,
        [thread_id, assembled, model ?? null]
      );
      enqueueWrite(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [thread_id]);
      const hedged = HEDGE_PATTERNS.test(assembled);
      const totalMs = Date.now() - t0;
      recordChatSample({ ragUsed: ragUsedFlag, hedged, latencyMs: totalMs });
      const sealedTr = `Yanıt mühürlendi · ${assembled.length} char · ${totalMs}ms`;
      const sealedEn = `Response saved · ${assembled.length} chars · ${totalMs}ms`;
      logCheckpoint(hedged && !ragUsedFlag ? "warn" : "success", "model.responded",
        locale === "en" ? sealedEn : sealedTr,
        { chars: assembled.length, ms: totalMs, ragUsed: ragUsedFlag, hedged, ttft: tFirstToken ? tFirstToken - t0 : null, i18nKey: "chat.response.sealed" },
        thread_id);
      logCheckpoint("success", "agent.step.done",
        locale === "en" ? `Agent completed · chat-orchestrator · ${totalMs}ms` : `Agent tamamlandı · chat-orchestrator · ${totalMs}ms`,
        { agent: "chat-orchestrator", step: "respond", ms: totalMs, ragUsed: ragUsedFlag, i18nKey: "chat.agent.completed" }, thread_id);
      broadcastAudit({
        agent: "chat", level: hedged && !ragUsedFlag ? "warn" : "info",
        message: (locale === "en" ? sealedEn : sealedTr) + (ragUsedFlag ? " · RAG" : "") + (hedged ? " · hedged" : ""),
        key: "chat.response.sealed",
        vars: { chars: assembled.length, ms: totalMs, rag: ragUsedFlag, hedged },
      });
    }
    __chatDone = true;
    close();
  }
  });
}

