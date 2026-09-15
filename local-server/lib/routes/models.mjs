import { requireSession } from "../session-gate.mjs";

export function isSystemModelGroup(g) {
  if (!g) return false;
  const id = String(g.id || "").toLowerCase();
  const name = String(g.name || "").trim().toLowerCase();
  return (
    id === "local" ||
    id === "cloud" ||
    id.startsWith("local_llm") ||
    id.startsWith("cloudbased_llm") ||
    id.startsWith("cloud_based") ||
    name === "local_llm" ||
    name === "local llm" ||
    name === "cloudbased_llm" ||
    name === "cloud based" ||
    name === "cloud_based" ||
    name === "cloud_llm" ||
    name === "cloud llm"
  );
}

export async function mountModelsRoutes(app, deps) {
  const pool = deps.pool;
  const resolveActorContext = deps.resolveActorContext;
  const admin = typeof deps.requireSession === "function" ? deps.requireSession() : requireSession();

  function requireSuperAdmin(req, res, next) {
    if (!req.session || req.session.role !== "admin" || (req.session.tenant_id && req.session.tenant_id !== "default")) {
      return res.status(403).json({ ok: false, error: "Only Super-Admin can perform this operation." });
    }
    next();
  }

  // Ensure model_groups table exists
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS model_groups (
        id text PRIMARY KEY,
        name text NOT NULL,
        tone text NOT NULL DEFAULT 'sapphire'
      );
    `);
    
    // Seed groups if empty
    const { rowCount } = await pool.query("SELECT 1 FROM model_groups LIMIT 1");
    if (rowCount === 0) {
      await pool.query(`
        INSERT INTO model_groups (id, name, tone) VALUES 
        ('local', 'Local LLM', 'sapphire'),
        ('cloud', 'Cloud Based', 'emerald')
      `);
    }

    // Ensure engine_config has a singleton row
    await pool.query("INSERT INTO engine_config (id) VALUES ('singleton') ON CONFLICT DO NOTHING");
  } catch (e) {
    console.error("[models api] Bootstrap error:", e.message);
  }

  // --- GET ALL MODELS & GROUPS ---
  app.get("/api/models", admin, async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      let modelsQuery = "SELECT * FROM models";
      const queryParams = [];

      if (!ctx?.isSuperAdmin) {
        const tenantId = ctx?.tenantId || req.session?.tenant_id || "default";
        const tRes = await pool.query("SELECT allowed_models FROM app_tenants WHERE slug = $1 OR id::text = $1 LIMIT 1", [tenantId]);
        const allowedModels = tRes.rows[0]?.allowed_models;

        if (Array.isArray(allowedModels) && allowedModels.length > 0) {
          modelsQuery += " WHERE (tenant_id = $1 OR (is_global = true AND (id = ANY($2::text[]) OR model_id = ANY($2::text[]))))";
          queryParams.push(tenantId, allowedModels);
        } else {
          modelsQuery += " WHERE (tenant_id = $1 OR is_global = true OR tenant_id = 'default')";
          queryParams.push(tenantId);
        }
      }

      modelsQuery += " ORDER BY created_at DESC";

      const [groupsRes, modelsRes, engineCfg] = await Promise.all([
        pool.query("SELECT * FROM model_groups ORDER BY id ASC"),
        pool.query(modelsQuery, queryParams),
        pool.query("SELECT active_model_id FROM engine_config WHERE id='singleton'")
      ]);

      const groups = groupsRes.rows.map(g => ({
        id: g.id,
        name: g.name,
        tone: g.tone
      }));

      const models = modelsRes.rows.map(m => ({
        id: m.id,
        name: m.name,
        modelId: m.model_id,
        vendor: m.vendor || "",
        baseUrl: m.base_url || "",
        apiKeyRef: m.api_key_ref || "",
        systemPrompt: m.system_prompt || "",
        rag: !!m.rag,
        streaming: !!m.streaming,
        temperature: Number(m.temperature || 0.2),
        topP: Number(m.top_p || 0.85),
        topK: Number(m.top_k || 40),
        repetitionPenalty: Number(m.repetition_penalty || 1.1),
        thinkEnabled: !!m.think_enabled,
        thinkStatement: m.think_statement || "",
        stopSequences: m.stop_sequences || [],
        advanced: m.advanced || [],
        chatTemplateId: m.chat_template_id || "auto",
        chatTemplate: m.chat_template || "",
        contextWindow: Number(m.context_window || 8192),
        maxTokens: Number(m.max_tokens || 4096),
        inputCost: Number(m.input_cost || 0),
        outputCost: Number(m.output_cost || 0),
        avatar: m.avatar || { seed: m.id, style: "shapes", jewel: "sapphire" },
        group: m.model_group || "local",
        enabled: !!m.enabled,
        isGlobal: m.is_global !== false,
        is_global: m.is_global !== false,
        tenantId: m.tenant_id || "default",
        tenant_id: m.tenant_id || "default",
        ownerId: m.owner_id || "",
        owner_id: m.owner_id || "",
        visibility: m.visibility || "workspace",
        createdAt: new Date(m.created_at).getTime()
      }));

      res.json({
        ok: true,
        groups,
        models,
        defaultId: engineCfg.rows[0]?.active_model_id || ""
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- CRUD GROUPS ---
  app.post("/api/models/groups", admin, requireSuperAdmin, async (req, res) => {
    try {
      const { id, name, tone } = req.body;
      const { rows } = await pool.query(
        "INSERT INTO model_groups (id, name, tone) VALUES ($1, $2, $3) RETURNING *",
        [id, name, tone]
      );
      res.json({ ok: true, group: rows[0] });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.patch("/api/models/groups/:id", admin, requireSuperAdmin, async (req, res) => {
    try {
      const { name } = req.body;
      const { rows } = await pool.query(
        "UPDATE model_groups SET name=$1 WHERE id=$2 RETURNING *",
        [name, req.params.id]
      );
      res.json({ ok: true, group: rows[0] });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.delete("/api/models/groups/:id", admin, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM model_groups WHERE id=$1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: "group not found" });
      if (isSystemModelGroup(rows[0])) {
        return res.status(400).json({ ok: false, error: "Baseline system model groups (Local and Cloud) cannot be deleted." });
      }
      await pool.query("DELETE FROM model_groups WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // --- CRUD MODELS ---
  app.post("/api/models", admin, async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      if (!ctx?.isAdmin && !ctx?.isSuperAdmin && !ctx?.isTenantAdmin) {
        return res.status(403).json({ ok: false, error: "Only administrators can provision new AI models." });
      }

      const m = req.body;
      let cleanApiKeyRef = m.apiKeyRef || "";
      if (cleanApiKeyRef.startsWith("manual:")) {
        cleanApiKeyRef = cleanApiKeyRef.substring(7);
      }

      const tenantId = ctx?.isSuperAdmin ? (m.tenant_id || m.tenantId || "default") : (ctx?.tenantId || "default");
      const isGlobal = ctx?.isSuperAdmin ? (m.is_global !== undefined ? !!m.is_global : (m.isGlobal !== undefined ? !!m.isGlobal : true)) : false;
      const ownerId = ctx?.userId || (ctx?.isSuperAdmin ? "00000000-0000-0000-0000-000000000000" : null);
      const visibility = m.visibility || "workspace";

      const { rows } = await pool.query(
        `INSERT INTO models
         (id, name, model_id, vendor, base_url, api_key_ref, system_prompt, rag, streaming, temperature, top_p, top_k, repetition_penalty, think_enabled, think_statement, stop_sequences, advanced, chat_template_id, chat_template, context_window, max_tokens, input_cost, output_cost, avatar, model_group, enabled, is_global, tenant_id, owner_id, visibility)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
         RETURNING *`,
        [
          m.id, m.name, m.modelId, m.vendor || "", m.baseUrl || "", cleanApiKeyRef,
          m.systemPrompt || "", !!m.rag, m.streaming !== false, m.temperature || 0.2, m.topP || 0.85,
          m.topK || 40, m.repetitionPenalty || 1.1, !!m.thinkEnabled, m.thinkStatement || "",
          JSON.stringify(m.stopSequences || []), JSON.stringify(m.advanced || []),
          m.chatTemplateId || "auto", m.chatTemplate || "", m.contextWindow || 8192,
          m.maxTokens || 4096, m.inputCost || 0, m.outputCost || 0, JSON.stringify(m.avatar || {}), m.group || "local", m.enabled !== false,
          isGlobal, tenantId, ownerId, visibility
        ]
      );
      res.json({ ok: true, model: rows[0] });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.patch("/api/models/:id", admin, async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const { rows: existingRows } = await pool.query("SELECT * FROM models WHERE id=$1", [req.params.id]);
      if (!existingRows.length) return res.status(404).json({ ok: false, error: "Model not found" });
      const existing = existingRows[0];

      if (existing.is_global && !ctx?.isSuperAdmin) {
        return res.status(403).json({ ok: false, error: "Global system models can only be modified by Super-Admin." });
      }
      if (!ctx?.isSuperAdmin && existing.tenant_id !== ctx?.tenantId) {
        return res.status(403).json({ ok: false, error: "Access denied to model outside your organization." });
      }

      const m = req.body;
      const updates = [];
      const values = [];
      let idx = 1;

      if (m.apiKeyRef !== undefined && typeof m.apiKeyRef === "string" && m.apiKeyRef.startsWith("manual:")) {
        m.apiKeyRef = m.apiKeyRef.substring(7);
      }

      for (const key of ['name', 'modelId', 'vendor', 'baseUrl', 'apiKeyRef', 'systemPrompt', 'rag', 'streaming', 'temperature', 'topP', 'topK', 'repetitionPenalty', 'thinkEnabled', 'thinkStatement', 'stopSequences', 'advanced', 'chatTemplateId', 'chatTemplate', 'contextWindow', 'maxTokens', 'inputCost', 'outputCost', 'avatar', 'group', 'enabled', 'isGlobal', 'is_global', 'visibility']) {
        if (m[key] !== undefined) {
          let colName = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
          if (colName === "group") colName = "model_group";
          if (colName === "is_global" && !ctx?.isSuperAdmin) continue; // Non-superadmin cannot toggle is_global

          updates.push(`${colName}=$${idx++}`);
          if (['stopSequences', 'advanced', 'avatar'].includes(key)) {
            values.push(JSON.stringify(m[key]));
          } else {
            values.push(m[key]);
          }
        }
      }

      if (updates.length === 0) return res.json({ ok: true });

      values.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE models SET ${updates.join(", ")}, updated_at=now() WHERE id=$${idx} RETURNING *`,
        values
      );
      res.json({ ok: true, model: rows[0] });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.delete("/api/models/:id", admin, async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const { rows: existingRows } = await pool.query("SELECT * FROM models WHERE id=$1", [req.params.id]);
      if (!existingRows.length) return res.status(404).json({ ok: false, error: "Model not found" });
      const existing = existingRows[0];

      if (existing.is_global && !ctx?.isSuperAdmin) {
        return res.status(403).json({ ok: false, error: "Global system models can only be deleted by Super-Admin." });
      }
      if (!ctx?.isSuperAdmin && existing.tenant_id !== ctx?.tenantId) {
        return res.status(403).json({ ok: false, error: "Access denied to model outside your organization." });
      }

      await pool.query("DELETE FROM models WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // --- DEFAULT MODEL SETTING ---
  app.post("/api/models/default", admin, async (req, res) => {
    try {
      const { id } = req.body;
      await pool.query("UPDATE engine_config SET active_model_id=$1 WHERE id='singleton'", [id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // --- LIVE MODEL ENDPOINT PROBE ---
  app.post("/api/models/probe", admin, async (req, res) => {
    try {
      const { baseUrl, apiKeyRef, modelId } = req.body || {};
      if (!baseUrl) return res.json({ ok: false, error: "Base URL is required" });
      if (!modelId) return res.json({ ok: false, error: "Model ID is required" });

      const { resolveCredential } = await import("../vault.mjs");
      let cleanKey = apiKeyRef || "";
      if (cleanKey.startsWith("manual:")) cleanKey = cleanKey.substring(7);
      const apiKey = await resolveCredential(pool, cleanKey, "api_key");

      const t0 = performance.now();
      let requestUrl = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
      if (baseUrl.includes("generativelanguage.googleapis.com") && !requestUrl.includes("/openai/")) {
        requestUrl = `${baseUrl.replace(/\/+$/, "")}/openai/chat/completions`;
      }

      const headers = { "Content-Type": "application/json" };
      if (apiKey && apiKey !== "no_needed" && apiKey !== "dummy-key") {
        headers["Authorization"] = `Bearer ${apiKey}`;
        if (baseUrl.includes("generativelanguage.googleapis.com")) {
          headers["x-goog-api-key"] = apiKey;
        }
      }

      const payload = {
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1
      };

      const resp = await fetch(requestUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      const latency = Math.round(performance.now() - t0);
      if (resp.ok) {
        return res.json({ ok: true, latency });
      } else {
        const errText = await resp.text().catch(() => "");
        return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 140)}` });
      }
    } catch (e) {
      return res.json({ ok: false, error: e.message });
    }
  });
}
