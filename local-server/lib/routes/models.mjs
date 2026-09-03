import { requireSession } from "../session-gate.mjs";

export async function mountModelsRoutes(app, { pool }) {
  const admin = requireSession();

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
      const [groupsRes, modelsRes, engineCfg] = await Promise.all([
        pool.query("SELECT * FROM model_groups ORDER BY id ASC"),
        pool.query("SELECT * FROM models ORDER BY created_at DESC"),
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
        createdAt: new Date(m.created_at).getTime()
      }));

      res.json({
        ok: true,
        groups,
        models,
        defaultId: engineCfg.rows[0]?.active_model_id || ""
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- CRUD GROUPS ---
  app.post("/api/models/groups", admin, async (req, res) => {
    try {
      const { id, name, tone } = req.body;
      const { rows } = await pool.query(
        "INSERT INTO model_groups (id, name, tone) VALUES ($1, $2, $3) RETURNING *",
        [id, name, tone]
      );
      res.json({ ok: true, group: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/models/groups/:id", admin, async (req, res) => {
    try {
      const { name } = req.body;
      const { rows } = await pool.query(
        "UPDATE model_groups SET name=$1 WHERE id=$2 RETURNING *",
        [name, req.params.id]
      );
      res.json({ ok: true, group: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/models/groups/:id", admin, async (req, res) => {
    try {
      await pool.query("DELETE FROM model_groups WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- CRUD MODELS ---
  app.post("/api/models", admin, async (req, res) => {
    try {
      const m = req.body;
      
      // Temizlik: "manual:" prefix'ini veritabanına yazmadan önce uçur
      let cleanApiKeyRef = m.apiKeyRef || "";
      if (cleanApiKeyRef.startsWith("manual:")) {
        cleanApiKeyRef = cleanApiKeyRef.substring(7); // "manual:" kelimesini sil
      }

      const { rows } = await pool.query(
        `INSERT INTO models
         (id, name, model_id, vendor, base_url, api_key_ref, system_prompt, rag, streaming, temperature, top_p, top_k, repetition_penalty, think_enabled, think_statement, stop_sequences, advanced, chat_template_id, chat_template, context_window, max_tokens, input_cost, output_cost, avatar, model_group, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
         RETURNING *`,
        [
          m.id, m.name, m.modelId, m.vendor || "", m.baseUrl || "", cleanApiKeyRef,
          m.systemPrompt || "", !!m.rag, m.streaming !== false, m.temperature || 0.2, m.topP || 0.85,
          m.topK || 40, m.repetitionPenalty || 1.1, !!m.thinkEnabled, m.thinkStatement || "",
          JSON.stringify(m.stopSequences || []), JSON.stringify(m.advanced || []),
          m.chatTemplateId || "auto", m.chatTemplate || "", m.contextWindow || 8192,
          m.maxTokens || 4096, m.inputCost || 0, m.outputCost || 0, JSON.stringify(m.avatar || {}), m.group || "local", m.enabled !== false
        ]
      );
      res.json({ ok: true, model: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/models/:id", admin, async (req, res) => {
    try {
      const m = req.body;
      const updates = [];
      const values = [];
      let idx = 1;

      // Temizlik: "manual:" prefix'ini veritabanına yazmadan önce uçur
      if (m.apiKeyRef !== undefined && typeof m.apiKeyRef === "string" && m.apiKeyRef.startsWith("manual:")) {
        m.apiKeyRef = m.apiKeyRef.substring(7); // "manual:" kelimesini sil
      }

      for (const key of ['name', 'modelId', 'vendor', 'baseUrl', 'apiKeyRef', 'systemPrompt', 'rag', 'streaming', 'temperature', 'topP', 'topK', 'repetitionPenalty', 'thinkEnabled', 'thinkStatement', 'stopSequences', 'advanced', 'chatTemplateId', 'chatTemplate', 'contextWindow', 'maxTokens', 'inputCost', 'outputCost', 'avatar', 'group', 'enabled']) {
        if (m[key] !== undefined) {
          let colName = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
          if (colName === "group") colName = "model_group";
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
        `UPDATE models SET ${updates.join(", ")} WHERE id=$${idx} RETURNING *`,
        values
      );
      res.json({ ok: true, model: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/models/:id", admin, async (req, res) => {
    try {
      await pool.query("DELETE FROM models WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- DEFAULT MODEL SETTING ---
  app.post("/api/models/default", admin, async (req, res) => {
    try {
      const { id } = req.body;
      await pool.query("UPDATE engine_config SET active_model_id=$1 WHERE id='singleton'", [id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
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
