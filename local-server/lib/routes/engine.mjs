// lib/routes/engine.mjs — /api/engine/* route grubu
// Tur 1 (RBAC sonrası): server.mjs'ten taşındı.
// 4 endpoint × 2 handler = 8 handler: intent-config, runtime, watchdog, transport (GET+POST).
// Tüm bağımlılıklar deps obje üzerinden DI ile geçirilir.

export function mountEngineRoutes(app, deps) {
  const {
    pool,
    // intent-config
    RUNTIME_INTENT_CFG, DEFAULT_CLASSIFIER_PROMPT,
    // runtime
    RUNTIME_PROVIDER_CFG, RUNTIME_PROVIDER_PRESETS,
    hydrateRuntimeProviderFromDb, resolveProvider, sanitizeModels,
    runtimeBase, runtimeUpstreamBase, runtimeModel, runtimeIsLocal,
    // watchdog
    getWatchdogCfg, setWatchdogCfg,
    getWorkerSelfHealCfg, setWorkerSelfHealCfg,
    persistWatchdogToDb,
    getSelfHealCooldownMs, getRespawnMaxInWindow,
    // transport
    getLocalTransportSnapshot, localWarmCacheTtlMs, LOCAL_TRANSPORT,
  } = deps;

  // ---------------------------------------------------------------- intent-config
  app.get("/api/engine/intent-config", (_req, res) => {
    res.json({
      ok: true,
      config: { ...RUNTIME_INTENT_CFG },
      bounds: {
        technicalThreshold: { min: 0, max: 1, step: 0.01 },
        semanticThreshold:  { min: 0.05, max: 1, step: 0.01 },
      },
      modes: ["auto", "always", "never"],
      classifierModes: ["embedding", "llm", "hybrid"],
      defaultClassifierPrompt: DEFAULT_CLASSIFIER_PROMPT,
    });
  });

  app.post("/api/engine/intent-config", async (req, res) => {
    const b = req.body || {};
    if (b.technicalThreshold != null) {
      const v = Number(b.technicalThreshold);
      if (Number.isFinite(v)) RUNTIME_INTENT_CFG.technicalThreshold = Math.min(1, Math.max(0, v));
    }
    if (typeof b.forceRagMode === "string" && ["auto", "always", "never"].includes(b.forceRagMode)) {
      RUNTIME_INTENT_CFG.forceRagMode = b.forceRagMode;
    }
    if (b.semanticThreshold != null) {
      const v = Number(b.semanticThreshold);
      if (Number.isFinite(v)) RUNTIME_INTENT_CFG.semanticThreshold = Math.min(1, Math.max(0.05, v));
    }
    if (typeof b.classifierMode === "string" && ["embedding","llm","hybrid"].includes(b.classifierMode)) {
      RUNTIME_INTENT_CFG.classifierMode = b.classifierMode;
    }
    if (typeof b.classifierPrompt === "string") {
      const p = b.classifierPrompt.trim();
      RUNTIME_INTENT_CFG.classifierPrompt = (p || DEFAULT_CLASSIFIER_PROMPT).slice(0, 4000);
    }
    try {
      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at)
         VALUES ('intent.config', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify({ ...RUNTIME_INTENT_CFG })]
      );
    } catch (e) { console.warn("[intent] persist failed:", String(e?.message || e)); }
    res.json({ ok: true, config: { ...RUNTIME_INTENT_CFG } });
  });

  // ---------------------------------------------------------------- runtime
  app.get("/api/engine/runtime", async (_req, res) => {
    await hydrateRuntimeProviderFromDb({ quiet: true });
    res.json({
      ok: true,
      config: { provider: RUNTIME_PROVIDER_CFG.provider, baseUrl: RUNTIME_PROVIDER_CFG.baseUrl, model: RUNTIME_PROVIDER_CFG.model, models: RUNTIME_PROVIDER_CFG.models },
      resolved: { baseUrl: runtimeBase(), upstreamBaseUrl: runtimeUpstreamBase(), model: runtimeModel(), isMlx: runtimeIsLocal(), hydrated: RUNTIME_PROVIDER_CFG.hydrated, updatedAt: RUNTIME_PROVIDER_CFG.updatedAt },
      presets: RUNTIME_PROVIDER_PRESETS,
      providers: ["mlx", "legacy", "custom"],
    });
  });

  app.post("/api/engine/runtime", async (req, res) => {
    const b = req.body || {};
    const provider = resolveProvider(b.provider ?? RUNTIME_PROVIDER_CFG.provider);
    const baseUrl  = b.baseUrl !== undefined ? String(b.baseUrl).trim() : RUNTIME_PROVIDER_CFG.baseUrl;
    const model    = b.model   !== undefined ? String(b.model).trim()   : RUNTIME_PROVIDER_CFG.model;
    const models   = b.models  !== undefined ? sanitizeModels(b.models) : RUNTIME_PROVIDER_CFG.models;
    const nextCfg = { provider, baseUrl, model, models };
    try {
      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at)
         VALUES ('runtime.provider', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(nextCfg)]
      );
      Object.assign(RUNTIME_PROVIDER_CFG, nextCfg, { hydrated: true, updatedAt: new Date().toISOString() });
    } catch (e) {
      console.warn("[runtime] persist failed:", String(e?.message || e));
      return res.status(500).json({ ok: false, error: `Runtime DB seal failed: ${String(e?.message || e)}` });
    }
    console.log(`[runtime] sealed in DB · provider=${RUNTIME_PROVIDER_CFG.provider} public=${runtimeBase()} upstream=${runtimeUpstreamBase()} model=${runtimeModel()}`);
    res.json({
      ok: true,
      config: { ...nextCfg },
      resolved: { baseUrl: runtimeBase(), upstreamBaseUrl: runtimeUpstreamBase(), model: runtimeModel(), isMlx: runtimeIsLocal(), hydrated: true, updatedAt: RUNTIME_PROVIDER_CFG.updatedAt },
      presets: RUNTIME_PROVIDER_PRESETS,
      providers: ["mlx", "legacy", "custom"],
    });
  });

  // ---------------------------------------------------------------- watchdog
  app.get("/api/engine/watchdog", (_req, res) => {
    res.json({
      ok: true,
      config: getWatchdogCfg(),
      floors: { headersMs: 90_000, firstTokenMs: 30_000, idleDeltaMs: 5_000, warmingNoticeMs: 1_000, coldFirstTokenMs: 60_000, streamTimeoutMs: 60_000, warmupTimeoutMs: 5_000 },
      workerSelfHeal: getWorkerSelfHealCfg(),
      workerSelfHealFloors: { cooldownMs: 30_000, respawnMax: 1, respawnMaxCeiling: 10 },
      note: "72B Qwen için 120000/60000/20000 önerilir. Floor altına düşürülemez.",
      persisted: true,
    });
  });

  app.post("/api/engine/watchdog", async (req, res) => {
    const body = req.body || {};
    const next = setWatchdogCfg(body);
    if (body.workerSelfHeal && typeof body.workerSelfHeal === "object") {
      setWorkerSelfHealCfg(body.workerSelfHeal);
    }
    await persistWatchdogToDb();
    console.log(`[watchdog] cockpit update · headers=${next.headersMs} firstToken=${next.firstTokenMs} idle=${next.idleDeltaMs} selfHealCooldown=${getSelfHealCooldownMs()} respawnMax=${getRespawnMaxInWindow()} (persisted)`);
    res.json({ ok: true, config: next, workerSelfHeal: getWorkerSelfHealCfg(), persisted: true });
  });

  // ---------------------------------------------------------------- transport
  app.get("/api/engine/transport", (_req, res) => {
    const transport = getLocalTransportSnapshot({ warmTtlMs: localWarmCacheTtlMs() });
    res.json({ ok: true, ...transport, transport });
  });

  app.post("/api/engine/transport", (req, res) => {
    const body = req.body || {};
    if (typeof body.resetUrl === "string") {
      LOCAL_TRANSPORT.resetUrl = body.resetUrl.trim();
      LOCAL_TRANSPORT.resetEnabled = LOCAL_TRANSPORT.resetUrl.length > 0;
    }
    if (typeof body.resetEnabled === "boolean") {
      LOCAL_TRANSPORT.resetEnabled = body.resetEnabled && LOCAL_TRANSPORT.resetUrl.length > 0;
    }
    if (typeof body.heartbeatEnabled === "boolean") {
      LOCAL_TRANSPORT.heartbeatEnabled = body.heartbeatEnabled;
    }
    if (Number.isFinite(Number(body.heartbeatMs))) {
      LOCAL_TRANSPORT.heartbeatMs = Math.max(15_000, Math.floor(Number(body.heartbeatMs)));
    }
    console.log(`[transport] cockpit update · resetEnabled=${LOCAL_TRANSPORT.resetEnabled} resetUrl=${LOCAL_TRANSPORT.resetUrl || "(none)"} heartbeat=${LOCAL_TRANSPORT.heartbeatEnabled}/${LOCAL_TRANSPORT.heartbeatMs}ms`);
    const transport = getLocalTransportSnapshot({ warmTtlMs: localWarmCacheTtlMs() });
    res.json({ ok: true, ...transport, transport });
  });
}
