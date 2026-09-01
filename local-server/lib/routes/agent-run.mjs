// Tur 2C-β: /api/agents/:id/run handler extracted from server.mjs.
// Pure DI: no module-level state. probeAgentHealth stays in server.mjs
// because setAgentArmedState consumes it; only the run hot path moves here.

import { execFile } from "node:child_process";
import path from "node:path";
import { applyForgePlan } from "../meta-forge/apply.mjs";
import { validateForgePlan } from "../meta-forge/planner.mjs";
import { isMetaForgeScriptPath } from "../meta-forge/selection.mjs";

function extractForgeJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  const candidates = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < cleaned.length; j++) {
      const ch = cleaned[j];
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
        if (depth === 0) { candidates.push(cleaned.slice(i, j + 1)); i = j; break; }
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

function parseForgePlanFromStdout(stdout) {
  const planObj = extractForgeJson(stdout);
  if (!planObj) return { planObj: null, validated: null, err: "no JSON object in stdout" };
  if (!planObj.plan) return { planObj, validated: null, err: "JSON has no `plan` field" };
  try {
    return { planObj, validated: validateForgePlan(planObj.plan), err: null };
  } catch (e) {
    return { planObj, validated: null, err: String(e?.message || e) };
  }
}

function formatForgeSummary({ intentText, planId, finalStatus, applyResult, applyError, validated }) {
  const kindLabel = (k) => (k === "tool" ? "🔧" : k === "skill" ? "📘" : k === "agent" ? "🤖" : k === "pack" ? "📦" : "•");
  if (finalStatus === "applied") {
    const appliedList = (applyResult?.applied || []).map(a => `${kindLabel(a.kind)} \`${a.kind}:${a.slug}\``).join(", ");
    const failedList = (applyResult?.failed || []).map(f => `❌ \`${f.kind}:${f.slug}\` (${f.reason})`).join(", ");
    return [
      `✅ **Meta-Forge otomatik yazdı** — ${(applyResult?.applied || []).length} capability canlı.`,
      `**Niyet:** ${intentText}`,
      appliedList ? `**Oluşturuldu:** ${appliedList}` : null,
      failedList ? `**Başarısız:** ${failedList}` : null,
      validated?.reuse?.length ? `**Yeniden kullanıldı:** ${validated.reuse.map(r => `${r.kind}:${r.slug}`).join(", ")}` : null,
      "",
      "_Artık şu turdan itibaren kullanılabilir. Aynı isteği tekrar sorabilirsin._",
    ].filter(Boolean).join("\n");
  }
  const failedList = (applyResult?.failed || []).map(f => `❌ \`${f.kind}:${f.slug}\` — ${f.reason}`).join("\n");
  return [
    `⚠️ **Meta-Forge apply başarısız** (${applyError || "lint/disk/db error"}).`,
    `**Niyet:** ${intentText}`,
    failedList || null,
    "",
    `_Plan \`${planId}\` DB'de \`failed\` durumunda kayıtlı. Admin UI'dan görüntüleyip elden düzeltebilirsin._`,
  ].filter(Boolean).join("\n");
}

export function mountAgentRunRoute(app, deps) {
  const {
    pool,
    coerceParams,
    getSecretsForScope,
    vaultAuditRuntime,
    buildFieldBindingEnvForAgent,
    buildAgentRagContext,
    spawnAgentRun,
    recordAgentRunFinish,
    buildAgentEnv,
    buildBrainEnv,
    buildAgentToolsEnv,
    cancelAgentRun,
    classifyAgentError,
    agentErrorMessage,
    getRagSettings,
      isUuid,
      enqueueWrite,
    AGENT_RUN_TIMEOUT_MS,
    hydrateAllowedAgentsFromDb,
  } = deps;

  app.post("/api/agents/:id/run", async (req, res) => {
    const id = req.params.id;
    const locale = String(req.body?.locale || req.get("accept-language") || "tr").toLowerCase();
    try {
      const { rows } = await pool.query("SELECT * FROM agents WHERE id=$1", [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: `agent ${id} not found` });
      const a = rows[0];
      const meta = a.meta && typeof a.meta === "object" ? a.meta : {};
      console.error(`[agent-run] request id=${id} bridgeScript=${String(a.script_path || "")} hasAgentPath=${!!a.script_path} textLen=${String(req.body?.text || req.body?.query || "").length}`);

      const rawParams = req.body?.params ?? {};
      const freeText = String(req.body?.text ?? req.body?.query ?? "").trim()
        || "Introduce yourself briefly in English and confirm you are operational.";
      const paramSchema = (meta.param_schema && typeof meta.param_schema === "object")
        ? meta.param_schema
        : null;
      const payload = coerceParams(paramSchema, rawParams, freeText);

      const bridgeScript = String(a.script_path || meta.script || payload.script || "").trim();
      if (bridgeScript && /\.py$/i.test(bridgeScript)) {
        const isMetaForgeRun = a.id === "meta-forge-master" || isMetaForgeScriptPath(bridgeScript);
        const t0 = Date.now();
        const vaultSecrets = await getSecretsForScope(pool, `agent:${a.id}`);
        const ephemeral = (req.body?.ephemeralCredentials && typeof req.body.ephemeralCredentials === "object")
          ? req.body.ephemeralCredentials : {};
        const ephemeralNames = Object.keys(ephemeral);
        if (ephemeralNames.length) {
          vaultAuditRuntime(pool, {
            action: "ephemeral-inject",
            scope: `agent:${a.id}`,
            name: ephemeralNames.join(","),
            actor: "chat-ephemeral",
            meta: { names: ephemeralNames, agent: a.id },
          });
        }
        const credEnv = {};
        for (const [k, v] of Object.entries(vaultSecrets)) {
          credEnv[`ELARA_SECRET_${k}`] = String(v);
          credEnv[k] = String(v);
        }
        for (const [k, v] of Object.entries(ephemeral)) {
          credEnv[`ELARA_SECRET_${k}`] = String(v);
          credEnv[k] = String(v);
        }
        const fieldEnv = await buildFieldBindingEnvForAgent(pool, a.id);
        const _rawRagQ = payload.query || payload.input || payload.text || payload.prompt || freeText || "";
        const chatThreadId = String(req.body?.thread_id || "");
        const userMessageId = String(req.body?.user_message_id || "");
        const assistantMessageId = String(req.body?.assistant_message_id || "");
        const chatModel = req.body?.model == null ? null : String(req.body.model);
        const persistChatMessage = (role, content, messageId = null) => {
          if (typeof enqueueWrite !== "function" || typeof isUuid !== "function") return;
          const body = String(content || "").trim();
          if (!isUuid(chatThreadId) || !body) return;
          if (messageId && isUuid(messageId)) {
            enqueueWrite(
              `INSERT INTO chat_messages(id, thread_id, role, content, model)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, model = EXCLUDED.model`,
              [messageId, chatThreadId, role, body, chatModel]
            );
          } else {
            enqueueWrite(
              `INSERT INTO chat_messages(thread_id, role, content, model) VALUES ($1,$2,$3,$4)`,
              [chatThreadId, role, body, chatModel]
            );
          }
          enqueueWrite(`UPDATE chat_threads SET updated_at = now() WHERE id = $1`, [chatThreadId]);
        };
        persistChatMessage("user", req.body?.user_content || freeText, userMessageId);

        const wantStream = req.body?.stream === true || String(req.get("accept") || "").includes("text/event-stream");

        let _sseSend = null;
        let _sseHb = null;
        const _stopSseHb = () => { if (_sseHb) { try { clearInterval(_sseHb); } catch {} _sseHb = null; } };
        if (wantStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          });
          try { req.socket?.setNoDelay?.(true); req.socket?.setKeepAlive?.(true, 30_000); req.socket?.setTimeout?.(0); } catch {}
          _sseSend = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* socket gone */ } };
          // Heartbeat — agent SSE bekleme (AI Queue) süresince browser/proxy
          // idle-drop'tan ("BodyStreamBuffer was aborted") koru. SSE comment frame,
          // EventSource görmez ama TCP'yi canlı tutar. UI knob: agentSseKeepAliveMs
          // (default 15000ms, 0=off).
          try {
            const _hbMs = Math.max(0, Math.min(60_000, Number(getRagSettings?.()?.agentSseKeepAliveMs ?? 15_000)));
            if (_hbMs > 0) {
              _sseHb = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch { _stopSseHb(); } }, _hbMs);
            }
          } catch { /* never let hb init break dispatch */ }
          req.on("close", _stopSseHb);
          res.on("close", _stopSseHb);
          _sseSend({ type: "agent_thinking", phase: "rag_probing" });
        }

        const _tTelStart = Date.now();
        // 2026-06-05: agent hattına smalltalk gate. Chat hattındaki refineIntentSemantically
        // koruması burada yoktu — "kendini tanıt" gibi self-intro'larda da koşulsuz RAG probe
        // çalışıyor, UI'da "SEARCHING SEALED LIBRARY" notice'ı çıkıyordu.
        // UI knob: RAG_SETTINGS.agentSmalltalkSkipRag (default true).
        const _ragSettingsEarly = (() => { try { return getRagSettings?.() || {}; } catch { return {}; } })();
        const _fastNoRagEnv = (lane = "smalltalk") => {
          const out = { ELARA_AGENT_RAG_ENABLED: "0" };
          const shouldDisable = lane === "smalltalk"
            ? _ragSettingsEarly.disableThinkOnSmalltalk !== false
            : _ragSettingsEarly.disableThinkOnQuery !== false;
          if (shouldDisable) out.ELARA_LLM_FORCE_DISABLE_THINKING = "1";
          // Do not override ELARA_AGENT_MAX_TOKENS on agent smalltalk/self-intro.
          // The agent editor's max_output_tokens remains the single source of
          // truth; applying the chat smalltalk cap here truncated persona intros.
          return out;
        };
        const _agentSmalltalkSkip = _ragSettingsEarly.agentSmalltalkSkipRag !== false;
        let _skipRagSmalltalk = false;
        let _classifierTrace = null;
        if (!isMetaForgeRun && _agentSmalltalkSkip && _rawRagQ) {
          try {
            const mod = await import("../rag/intent-classifier.mjs");
            if (typeof mod.classifyIntent === "function" && typeof mod.refineIntentSemantically === "function") {
              const _t0 = Date.now();
              const base = mod.classifyIntent(_rawRagQ);
              const refined = await mod.refineIntentSemantically(_rawRagQ, base);
              _classifierTrace = { baseKind: base?.kind, baseMode: base?.mode, refKind: refined?.kind, refMode: refined?.mode, refUseRag: refined?.useRag, refScore: refined?.score, ms: Date.now()-_t0 };
              console.error(`[AGENT-RAG-DEBUG] agent=${id} q="${_rawRagQ.slice(0,80)}" base=${base?.kind}/${base?.mode} refined=${refined?.kind}/${refined?.mode} useRag=${refined?.useRag} score=${refined?.score?.toFixed?.(3)} ms=${Date.now()-_t0}`);
              // 2026-06-25: cold-fallback flip'i smalltalk'a güvenme — yalnızca
              // semantic-bypass (kanıtlanmış smalltalk) VEYA base classifier de
              // smalltalk dediyse skip. Aksi halde teknik query'leri "kendini
              // tanıt" gibi muamele edip RAG'ı söndürüyordu.
              const _bypassSafe = refined?.mode === "semantic-bypass" || base?.kind === "smalltalk";
              if (refined?.kind === "smalltalk" && refined?.useRag === false && _bypassSafe) {
                _skipRagSmalltalk = true;
                console.error(`[SMALLTALK-LANE/agent] agent=${id} rag.SKIPPED (${refined.mode || "smalltalk"}; base=${base?.kind})`);
              } else if (refined?.kind === "smalltalk") {
                console.error(`[SMALLTALK-LANE/agent] agent=${id} rag.KEPT mode=${refined.mode} base=${base?.kind} (cold-fallback override ignored)`);
              }
            } else {
              console.error(`[AGENT-RAG-DEBUG] agent=${id} classifier exports missing`);
            }
          } catch (e) {
            console.warn(`[AGENT-RAG-DEBUG] agent=${id} classifier failed: ${e.message}`);
          }
        } else {
          console.error(`[AGENT-RAG-DEBUG] agent=${id} skipGate=${_agentSmalltalkSkip} rawQ="${(_rawRagQ||"").slice(0,80)}" (gate bypassed)`);
        }
        let rag;
        if (isMetaForgeRun) {
          rag = { env: { ELARA_AGENT_RAG_ENABLED: "0", ELARA_LLM_FORCE_DISABLE_THINKING: "1" }, args: [], meta: { enabled: false, hits: 0, decision: "skip", reason: "meta_forge_direct", mode: "meta-forge" } };
          console.error(`[AGENT-RAG-DEBUG] agent=${id} path=SKIP (meta-forge direct)`);
        } else if (_skipRagSmalltalk) {
          rag = { env: _fastNoRagEnv("smalltalk"), args: [], meta: { enabled: false, hits: 0, decision: "skip", reason: "smalltalk_intent", mode: "smalltalk-gate" } };
          console.error(`[AGENT-RAG-DEBUG] agent=${id} path=SKIP (smalltalk gate)`);
        } else {
          const _tRag = Date.now();
          // Soft warning only. A hard Promise.race here discards valid RAG hits
          // that arrive just after the cutoff, while the underlying DB/LLM work
          // keeps running anyway. Heartbeat frames already keep SSE alive.
          const _agentRagWarnMs = Math.max(2000, Math.min(60000, Number(_ragSettingsEarly.agentRagDeadlineMs ?? 8000)));
          let _ragSlowTimer = null;
          try {
            _ragSlowTimer = setTimeout(() => {
              console.warn(`[AGENT-RAG-DEBUG] agent=${id} path=SLOW>${_agentRagWarnMs}ms q="${String(_rawRagQ || "").slice(0,80)}"`);
              try { if (wantStream && _sseSend) _sseSend({ type: "agent_thinking", phase: "rag_slow", ms: _agentRagWarnMs }); } catch { /* socket gone */ }
            }, _agentRagWarnMs);
            rag = await buildAgentRagContext(pool, a.id, _rawRagQ);
          } catch (e) {
            rag = {
              env: { ELARA_AGENT_RAG_ENABLED: "1" },
              args: [],
              meta: { enabled: true, hits: 0, decision: "skip", reason: "agent_rag_probe_threw", rawReason: e?.message || String(e), mode: "agent-rag-error" },
            };
          } finally {
            if (_ragSlowTimer) clearTimeout(_ragSlowTimer);
          }
          console.error(`[AGENT-RAG-DEBUG] agent=${id} path=BUILT ms=${Date.now()-_tRag} enabled=${rag?.meta?.enabled} hits=${rag?.meta?.hits} decision=${rag?.meta?.decision} reason=${rag?.meta?.reason||"-"} mode=${rag?.meta?.mode||"-"} envRagEnabled=${rag?.env?.ELARA_AGENT_RAG_ENABLED}`);
        }
        const _ragMs = Date.now() - _tTelStart;
        let _tFirstChunk = 0;

        if (wantStream) {
          _sseSend({
            type: "agent_thinking",
            phase: _skipRagSmalltalk ? "rag_skipped_smalltalk" : "rag_done",
            hits: rag?.meta?.hits ?? 0,
            decision: rag?.meta?.decision ?? null,
          });
        }

        try {
          const stopGraceMs = Number.isFinite(+a.stop_grace_ms) ? +a.stop_grace_ms : 5000;
          // UI tek mercii (2026-06-03): injectAgentToolsManifest OFF (default)
          // ise tool manifest enjeksiyonu KAPALI; operator agent prompt'una elden yazıyor.
          const _ragSettingsForManifest = getRagSettings();
          const _injectManifest = _ragSettingsForManifest?.injectAgentToolsManifest === true;
          const toolsEnv = _injectManifest
            ? await buildAgentToolsEnv(pool, a, { includeToolPrompts: !!_ragSettingsForManifest?.includeToolPromptsInAgent })
            : {};
          const brainEnv = await buildBrainEnv(pool, a);
          const RAG_SETTINGS = _ragSettingsForManifest;
          const _lg = (a?.meta?.inference?.loop_guard && typeof a.meta.inference.loop_guard === "object") ? a.meta.inference.loop_guard : {};
          const _lgPick = (override, global, def) => {
            const o = Number(override);
            if (Number.isFinite(o) && o > 0) return String(Math.floor(o));
            return String(global ?? def);
          };
          const loopGuardEnv = {
            ELARA_LOOP_GUARD_LINE_MIN_CHARS: _lgPick(_lg.line_min_chars, RAG_SETTINGS?.loopGuardLineMinChars, 40),
            ELARA_LOOP_GUARD_LINE_REP:       _lgPick(_lg.line_repeat,    RAG_SETTINGS?.loopGuardLineRepeat, 14),
            ELARA_LOOP_GUARD_SUBSTR_WIN:     _lgPick(_lg.substr_win,     RAG_SETTINGS?.loopGuardSubstringWindow, 120),
            ELARA_LOOP_GUARD_SUBSTR_REP:     _lgPick(_lg.substr_repeat,  RAG_SETTINGS?.loopGuardSubstringRepeat, 20),
            ELARA_LOOP_GUARD_PHRASE_REP:     _lgPick(_lg.phrase_repeat,  RAG_SETTINGS?.loopGuardPhraseRepeat, 12),
          };
          const agentExecTimeoutMs = Math.max(30000, Math.min(300000, Number(RAG_SETTINGS?.agentExecTimeoutMs || AGENT_RUN_TIMEOUT_MS || 180000)));
          console.error(`[agent-run] spawn.prepare id=${id} script=${bridgeScript} stopGraceMs=${stopGraceMs} timeoutMs=${agentExecTimeoutMs} brain.base=${brainEnv.ELARA_MLX_BASE_URL || "-"} brain.model=${brainEnv.ELARA_AGENT_MODEL || "-"} loopGuard=${JSON.stringify(loopGuardEnv)}`);

          if (wantStream) {
            const send = _sseSend;
            send({ type: "agent_thinking", phase: "spawning" });

            const entry = spawnAgentRun({
              agentId: a.id,
              script: bridgeScript,
              query: payload.query || payload.input || payload.text || payload.prompt || freeText || "",
              env: { ...buildAgentEnv(a), ...brainEnv, ...toolsEnv, ...credEnv, ...fieldEnv, ...rag.env,
                ...loopGuardEnv,
                ...(req.body?.debugDumpPrompt ? { ELARA_DUMP_PROMPT: "1" } : {}) },

              stopGraceMs,
              onStart: (info) => send({ type: "agent_thinking", phase: "running", runId: info.runId, pid: info.pid }),
              onStdout: (chunk) => { if (!_tFirstChunk) _tFirstChunk = Date.now(); if (!isMetaForgeRun) send({ type: "agent_chunk", delta: chunk }); },
              onFinish: (info) => recordAgentRunFinish(pool, { ...info, username: req.session?.username || req.actor || null, ragMeta: rag?.meta || null, inference: a?.meta?.inference || null }),
              timeoutMs: agentExecTimeoutMs,
            });

            req.on("close", () => {
              if (!entry.cancelRequested) {
                try { cancelAgentRun(entry.runId, 1000); } catch { /* noop */ }
              }
            });

            const result = await entry.done;
            try {
              const lines = String(result.stderr || "").split("\n");
              const KNOWN_PREFIX = /^\[(config_center|runner|firewall_oracle|agent-rag|dispatch|tool|tools|skill|skills|orchestrator|copy_smith|hashtag_alchemist|engagement_concierge|scheduler_maestro|trend_radar|visual_brief|brand_voice|hook_lab|sentiment_scout|squad_orchestrator)\]/i;
              const PY_ERROR = /^(Traceback|\s*File ".+", line \d+|[A-Za-z_][A-Za-z0-9_.]*Error:|httpx\.|openai\.|ConnectionError|ModuleNotFoundError|ImportError|RuntimeError|AssertionError|ValueError|KeyError|TypeError)/;
              for (const ln of lines) {
                if (!ln) continue;
                if (KNOWN_PREFIX.test(ln) || (!result.ok && PY_ERROR.test(ln))) {
                  console.error(`[agent-stderr] runId=${entry.runId} agent=${a.name} ${ln}`);
                }
              }
            } catch { /* never let log forwarding break the request */ }

            if (result.ok) {
              try {
                const newMeta = { ...meta, lastStdout: String(result.stdout).slice(-400), lastRunMs: result.durationMs, lastRunOk: true, lastRag: rag.meta };
                await pool.query(
                  "UPDATE agents SET calls=calls+1, last_active=now(), meta=$2::jsonb, updated_at=now() WHERE id=$1",
                  [id, JSON.stringify(newMeta)]
                );
              } catch { /* meta persist best-effort */ }
            }
            let finalStdout = result.stdout;
            let forgeEnvelope = null;
            if (result.ok && isMetaForgeRun) {
              const parsed = parseForgePlanFromStdout(result.stdout);
              if (!parsed.validated) {
                finalStdout = `⚠️ Meta-Forge planı ayrıştırılamadı (${parsed.err}).\n\nHam çıktı:\n\`\`\`\n${String(result.stdout || "").slice(0, 800) || "(boş cevap)"}\n\`\`\``;
              } else {
                const intentText = String(parsed.planObj?.intent || freeText || "").slice(0, 500);
                let planId = null;
                let applyResult = null;
                let applyError = null;
                let finalStatus = "applied";
                try {
                  const ins = await pool.query(
                    `INSERT INTO forge_plans (requested_by, intent, plan_json, status)
                     VALUES ($1, $2, $3, 'approved') RETURNING id`,
                    [req.session?.username || req.actor || "chat", intentText, JSON.stringify(parsed.validated)],
                  );
                  planId = ins.rows[0]?.id || null;
                  if (planId) {
                    const maxItems = Math.max(1, Number(RAG_SETTINGS?.metaForgeMaxItemsPerTurn) || 3);
                    applyResult = await applyForgePlan({ pool, planId, plan: parsed.validated, maxItems });
                    finalStatus = (applyResult.failed?.length && !applyResult.applied?.length) ? "failed" : "applied";
                    await pool.query(
                      `UPDATE forge_plans SET status=$2, applied_at=now(), updated_at=now(), error=$3 WHERE id=$1`,
                      [planId, finalStatus, applyResult.failed?.length ? JSON.stringify(applyResult.failed) : null],
                    );
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
                finalStdout = formatForgeSummary({ intentText, planId, finalStatus, applyResult, applyError, validated: parsed.validated });
                forgeEnvelope = { id: planId, intent: intentText, plan: parsed.validated, status: finalStatus, requestedBy: req.session?.username || req.actor || "chat", autoApplied: true, result: applyResult || undefined, error: applyError || undefined };
              }
              send({ type: "agent_chunk", delta: finalStdout });
            }
            const _doneEnvelope = {
              type: "agent_done",
              ok: !!result.ok,
              cancelled: !!result.cancelled,
              latencyMs: result.durationMs,
              runId: entry.runId,
              error: result.ok ? null : (result.cancelled
                ? "agent.cancelled"
                : `exit ${result.code ?? "?"}${result.signal ? ` (${result.signal})` : ""}`),
              agent_error: result.ok ? null : (result.cancelled
                ? { code: "cancelled", text: locale.startsWith("tr") ? "Ajan kullanıcı tarafından durduruldu." : "Agent stopped by user." }
                : { code: result.signal ? "timeout" : "exit_nonzero", text: agentErrorMessage(result.signal ? "timeout" : "exit_nonzero", locale) }),
              rag: rag.meta,
              telemetry: {
                thinkMs: _tFirstChunk ? (_tFirstChunk - _tTelStart) : null,
                ragMs: _ragMs,
                totalMs: result.durationMs,
                tokensOut: Math.round(String(finalStdout || "").length / 4),
              },
              stderr: String(result.stderr || "").slice(-2000),
              forge_plan: forgeEnvelope,
            };
            try {
              console.error(`[agent-done-mirror] runId=${entry.runId} hattı=stream ok=${_doneEnvelope.ok} code=${result.code ?? "?"} sig=${result.signal || "-"} stdoutHead=${JSON.stringify(String(result.stdout || "").slice(0, 200))} stderrHead=${JSON.stringify(String(result.stderr || "").slice(0, 200))}`);
            } catch { /* never break send */ }
            persistChatMessage(
              "assistant",
              result.ok ? finalStdout : (result.stdout || result.stderr || _doneEnvelope.error || "agent failed"),
              assistantMessageId,
            );
            send(_doneEnvelope);
            try { res.write("data: [DONE]\n\n"); } catch { /* */ }
            _stopSseHb();
            try { res.end(); } catch { /* */ }
            return;
          }

          const entry = spawnAgentRun({
            agentId: a.id,
            script: bridgeScript,
            query: payload.query || payload.input || payload.text || payload.prompt || freeText || "",
            env: { ...buildAgentEnv(a), ...brainEnv, ...toolsEnv, ...credEnv, ...fieldEnv, ...rag.env,
              ...loopGuardEnv,
              ...(req.body?.debugDumpPrompt ? { ELARA_DUMP_PROMPT: "1" } : {}) },

            stopGraceMs,
            onFinish: (info) => recordAgentRunFinish(pool, { ...info, username: req.session?.username || req.actor || null, ragMeta: rag?.meta || null, inference: a?.meta?.inference || null }),
          });

          res.setHeader("X-Agent-Run-Id", entry.runId);
          const result = await entry.done;
          try {
            const lines = String(result.stderr || "").split("\n");
            const KNOWN_PREFIX = /^\[(config_center|runner|firewall_oracle|agent-rag|dispatch|tool|tools|skill|skills|orchestrator|copy_smith|hashtag_alchemist|engagement_concierge|scheduler_maestro|trend_radar|visual_brief|brand_voice|hook_lab|sentiment_scout|squad_orchestrator)\]/i;
            const PY_ERROR = /^(Traceback|\s*File ".+", line \d+|[A-Za-z_][A-Za-z0-9_.]*Error:|httpx\.|openai\.|ConnectionError|ModuleNotFoundError|ImportError|RuntimeError|AssertionError|ValueError|KeyError|TypeError)/;
            for (const ln of lines) {
              if (!ln) continue;
              if (KNOWN_PREFIX.test(ln) || (!result.ok && PY_ERROR.test(ln))) {
                console.error(`[agent-stderr] runId=${entry.runId} agent=${a.name} ${ln}`);
              }
            }
          } catch { /* never let log forwarding break the request */ }
          if (result.cancelled) {
            return res.json({
              ok: false, latencyMs: result.durationMs,
              stdout: result.stdout, stderr: result.stderr, parsed: null,
              error: "agent.cancelled",
              agent_error: { code: "cancelled", text: locale.startsWith("tr") ? "Ajan kullanıcı tarafından durduruldu." : "Agent stopped by user." },
              bridge: "local-agent", runId: entry.runId,
            });
          }
          if (!result.ok) {
            const code = result.signal ? "timeout" : "exit_nonzero";
            try { console.error(`[agent-done-mirror] runId=${entry.runId} hattı=json ok=false code=${code} exit=${result.code ?? "?"} sig=${result.signal || "-"} stderrHead=${JSON.stringify(String(result.stderr || "").slice(0, 200))}`); } catch { /* */ }
            return res.json({
              ok: false, latencyMs: result.durationMs,
              stdout: result.stdout, stderr: result.stderr, parsed: null,
              error: `exit ${result.code ?? "?"}${result.signal ? ` (${result.signal})` : ""}`,
              agent_error: { code, text: agentErrorMessage(code, locale) },
              bridge: "local-agent", runId: entry.runId,
            });
          }
          const newStats = { ...(a.stats || {}), calls: ((a.stats?.calls || 0) + 1), latencyMs: result.durationMs, lastRunOk: true };
          await pool.query(
            "UPDATE agents SET stats=$2::jsonb, updated_at=now() WHERE id=$1",
            [id, JSON.stringify(newStats)]
          );
          try { console.error(`[agent-done-mirror] runId=${entry.runId} hattı=json ok=true stdoutHead=${JSON.stringify(String(result.stdout || "").slice(0, 200))}`); } catch { /* */ }
          persistChatMessage("assistant", result.stdout, assistantMessageId);
          return res.json({ ok: true, latencyMs: result.durationMs, stdout: result.stdout, stderr: result.stderr, parsed: null, error: null, bridge: "local-agent", rag: rag.meta, runId: entry.runId });
        } catch (err) {
          const code = classifyAgentError(err);
          const text = agentErrorMessage(code, locale);
          try { console.error(`[agent-error-mirror] hattı=run code=${code} text=${JSON.stringify(text)} err=${JSON.stringify(String(err?.message || err)).slice(0, 400)} stack=${JSON.stringify(String(err?.stack || "").slice(0, 400))}`); } catch { /* */ }
          if (res.headersSent) {
            try { res.write(`data: ${JSON.stringify({ type: "agent_error", code, text, error: String(err?.message || err) })}\n\n`); } catch { /* */ }
            try { res.write("data: [DONE]\n\n"); } catch { /* */ }
            _stopSseHb();
            try { res.end(); } catch { /* */ }
            return;
          }
          return res.json({
            ok: false, latencyMs: Date.now() - t0, stdout: "", stderr: String(err?.stderr || ""), parsed: null,
            error: String(err?.message || err),
            agent_error: { code, text },
            bridge: "local-agent",
          });
        }
      }

      // Klasik execFile yolu (interpreter + agentPath kayıtlı agent'lar için).
      let interpreter = a.runtime_path || a.interpreter_path || meta.interpreterPath || "";
      const agentPath = a.script_path || a.agent_path || meta.agentPath || "";
      if (!interpreter) {
        try {
          const { rows: pr } = await pool.query("SELECT value FROM app_settings WHERE key='python.primary'");
          if (pr[0]?.value?.path) interpreter = String(pr[0].value.path);
        } catch { /* ignore */ }
      }
      if (!agentPath) {
        const t0 = Date.now();
        const runId = `run.${Math.random().toString(36).slice(2, 8)}`;
        const result = {
          ok: true, latencyMs: 25, stdout: "Agent profile loaded. Ready for orchestration.\n(Prompt-only agent, no local script execution)", stderr: "", parsed: null, error: null, bridge: "orchestrator"
        };
        recordAgentRunFinish(pool, { runId, agentId: id, script: "prompt-only", source: "spawn", ok: true, startedAt: t0, durationMs: 25, stdout: result.stdout, username: req.session?.username || req.actor || null });
        const newStats = { ...(a.stats || {}), calls: ((a.stats?.calls || 0) + 1), latencyMs: 25, lastRunOk: true };
        await pool.query("UPDATE agents SET stats=$2::jsonb, updated_at=now() WHERE id=$1", [id, JSON.stringify(newStats)]);
        return res.json(result);
      }
      if (!interpreter) return res.status(400).json({ ok: false, error: "interpreter_path (or sealed Primary Python) required" });
      const t0 = Date.now();
      console.error(`[agent-run] classic-execfile id=${id} interpreter=${path.basename(interpreter)} script=${path.basename(agentPath)} timeoutMs=${AGENT_RUN_TIMEOUT_MS}`);
      const out = await new Promise((resolve) => {
        execFile(interpreter, [agentPath, "--params", JSON.stringify(payload)], { timeout: AGENT_RUN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
          resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout || ""), stderr: String(stderr || ""), error: err ? String(err.message || err) : null, _err: err });
        });
      });
      let parsed = null;
      const trimmed = out.stdout.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try { parsed = JSON.parse(trimmed); } catch { /* not JSON */ }
      }
      const stdoutSnippet = out.stdout.slice(-400);
      const newStats = { ...(a.stats || {}), calls: ((a.stats?.calls || 0) + 1), latencyMs: Date.now() - t0, lastRunOk: out.ok };
      await pool.query(
        "UPDATE agents SET stats=$2::jsonb, updated_at=now() WHERE id=$1",
        [id, JSON.stringify(newStats)]
      );
      let agent_error = null;
      if (!out.ok) {
        const code = classifyAgentError(out._err || { message: out.error, code: out.code });
        agent_error = { code, text: agentErrorMessage(code, locale) };
      }
      res.json({ ok: out.ok, latencyMs: Date.now() - t0, stdout: out.stdout, stderr: out.stderr, parsed, error: out.error, agent_error });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
