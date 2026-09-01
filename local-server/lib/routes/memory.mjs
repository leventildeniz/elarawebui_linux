import { requireSession } from "../session-gate.mjs";

export async function mountMemoryRoutes(app, { pool, resolveActorContext }) {
  const admin = requireSession();

  // --- GET ALL MEMORY STATE ---
  app.get("/api/memory", admin, async (req, res) => {
    try {
      const [workingRes, episodicRes, factsRes, policyRes] = await Promise.all([
        pool.query("SELECT id, thread_id, label, origin, tokens, pinned, tone, updated_at FROM memory_working ORDER BY updated_at DESC LIMIT 100"),
        pool.query("SELECT id, at, actor, summary, thread_id as thread, tokens, outcome FROM memory_episodic ORDER BY at DESC LIMIT 100"),
        pool.query("SELECT id, key, value, scope, confidence, source, locked, updated_at FROM memory_facts ORDER BY updated_at DESC LIMIT 200"),
        pool.query("SELECT * FROM memory_policy WHERE id='singleton'")
      ]);

      let policy = policyRes.rows[0];
      if (!policy) {
        await pool.query("INSERT INTO memory_policy (id) VALUES ('singleton') ON CONFLICT DO NOTHING");
        const r2 = await pool.query("SELECT * FROM memory_policy WHERE id='singleton'");
        policy = r2.rows[0] || {};
      }

      res.json({
        ok: true,
        working: workingRes.rows,
        episodic: episodicRes.rows,
        facts: factsRes.rows,
        policy
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- WORKING SET ---
  app.patch("/api/memory/working/:id/pin", admin, async (req, res) => {
    try {
      const { pinned } = req.body;
      const { rows } = await pool.query(
        "UPDATE memory_working SET pinned = $1 WHERE id = $2 RETURNING *",
        [!!pinned, req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "not found" });
      res.json({ ok: true, working: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/memory/working/:id", admin, async (req, res) => {
    try {
      await pool.query("DELETE FROM memory_working WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- EPISODIC TRACES ---
  app.delete("/api/memory/episodic", admin, async (req, res) => {
    try {
      // Clear all episodic traces
      await pool.query("DELETE FROM memory_episodic");
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- SEMANTIC FACTS ---
  app.post("/api/memory/facts", admin, async (req, res) => {
    try {
      const { id, key, value, scope, confidence, source, locked } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO memory_facts (id, key, value, scope, confidence, source, locked)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, key, value, scope, confidence, source, locked, updated_at`,
        [id, key, value, scope, confidence || 0, source, !!locked]
      );
      res.json({ ok: true, fact: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/memory/facts/:id", admin, async (req, res) => {
    try {
      const cur = await pool.query("SELECT * FROM memory_facts WHERE id = $1", [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ error: "not found" });
      
      const patch = req.body || {};
      const merged = { ...cur.rows[0], ...patch };
      
      const { rows } = await pool.query(
        `UPDATE memory_facts SET key=$1, value=$2, scope=$3, confidence=$4, source=$5, locked=$6, updated_at=now()
         WHERE id=$7 RETURNING id, key, value, scope, confidence, source, locked, updated_at`,
        [merged.key, merged.value, merged.scope, merged.confidence, merged.source, merged.locked, req.params.id]
      );
      res.json({ ok: true, fact: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/memory/facts/:id", admin, async (req, res) => {
    try {
      await pool.query("DELETE FROM memory_facts WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- MEMORY POLICY ---
  app.patch("/api/memory/policy", admin, async (req, res) => {
    try {
      const cur = await pool.query("SELECT * FROM memory_policy WHERE id='singleton'");
      const policy = cur.rows[0] || {};
      const patch = req.body || {};
      
      const merged = {
        context_window: patch.context_window ?? policy.context_window,
        compact_at: patch.compact_at ?? policy.compact_at,
        keep_last_turns: patch.keep_last_turns ?? policy.keep_last_turns,
        episodic_retention_days: patch.episodic_retention_days ?? policy.episodic_retention_days,
        auto_promote_facts: patch.auto_promote_facts ?? policy.auto_promote_facts,
        promote_threshold: patch.promote_threshold ?? policy.promote_threshold,
        dedupe: patch.dedupe ?? policy.dedupe,
        redact_secrets: patch.redact_secrets ?? policy.redact_secrets,
        embed_on_write: patch.embed_on_write ?? policy.embed_on_write,
        summarizer: patch.summarizer ?? policy.summarizer
      };

      const { rows } = await pool.query(
        `UPDATE memory_policy SET 
           context_window=$1, compact_at=$2, keep_last_turns=$3, episodic_retention_days=$4,
           auto_promote_facts=$5, promote_threshold=$6, dedupe=$7, redact_secrets=$8,
           embed_on_write=$9, summarizer=$10, updated_at=now()
         WHERE id='singleton' RETURNING *`,
        [
          merged.context_window, merged.compact_at, merged.keep_last_turns, merged.episodic_retention_days,
          merged.auto_promote_facts, merged.promote_threshold, merged.dedupe, merged.redact_secrets,
          merged.embed_on_write, merged.summarizer
        ]
      );
      res.json({ ok: true, policy: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/memory/policy/reset", admin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE memory_policy SET
           context_window=8192, compact_at=75, keep_last_turns=6, episodic_retention_days=90,
           auto_promote_facts=false, promote_threshold=0.8, dedupe=true, redact_secrets=true,
           embed_on_write=false, summarizer=null, updated_at=now()
         WHERE id='singleton' RETURNING *`
      );
      res.json({ ok: true, policy: rows[0] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // --- COMPACT CONTEXT & EPISODIC MEMORY ---
  app.post("/api/memory/compact", admin, async (req, res) => {
    try {
      const { title = "Session", model = "default", effort = "low", turns = [], threadId = "unknown" } = req.body;
      
      const transcript = turns
        .filter((t) => t.text && t.text.trim())
        .map((t) => `${t.role === "user" ? "OPERATOR" : "ELARA"}: ${t.text.trim()}`)
        .join("\n\n")
        .slice(-60000); // Max safe length

      if (!transcript) {
        return res.json({ lede: "Empty session", objective: "", decisions: [], open: [], next: [], digest: [], sections: [] });
      }

      // Backend-native LLM call using our Universal Orchestration logic 
      // (Since we don't have direct access to streamFromProvider here without circular deps, 
      // we'll make a local sub-request to our own /api/chat/orchestrate or use a simplified native fetch)
      
      const prompt = `You are Elara, the assistant inside Sovereign Studio, writing a context-compaction handover.
Read the folded transcript and produce a precise, technical continuation note.
Rules:
- Write in first person, calm and factual. No marketing tone, no filler.
- "digest": 4-8 one-line facts preserved from the folded turns.
- "sections": numbered technical memory. Use headings such as "Scope & Intent", "Decisions & Direction", "Open Threads", "Runtime State". Each item has a short label (e.g. D1, T1, "Working brief") and a dense one-or-two sentence text.
- Wrap identifiers, file paths, commands and values in \`backticks\`.
- Never invent facts.
- Output ONLY valid JSON matching this structure: { "lede": "...", "objective": "...", "decisions": ["..."], "open": ["..."], "next": ["..."], "digest": ["..."], "sections": [ { "heading": "...", "items": [ { "label": "...", "text": "..." } ] } ] }

Session: ${title}
Folded transcript:
${transcript}`;

      // Sunucunun kendi içine HTTP isteği (Loopback) atarak LLM'i çalıştırıyoruz (Orchestrator'a bağımlı kalmamak için)
      // Bu sayede model ayarları, failover vs ne varsa aynen işleyecek.
      const baseUrl = `http://127.0.0.1:${process.env.PORT || 3005}`;
      const llmRes = await fetch(`${baseUrl}/api/chat/orchestrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers['authorization'] || ''
        },
        body: JSON.stringify({
          model,
          effort: "none", // JSON üretimi için effort'u düşürüyoruz ki saçmalamasın
          routing_mode: "failover",
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!llmRes.ok) throw new Error("Local orchestrator failed to compact memory");

      const reader = llmRes.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (dataStr === "[DONE]" || !dataStr) continue;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === "out") text += parsed.delta;
          } catch(e) {}
        }
      }

      // JSON'ı temizle (Markdown ```json ... ``` içindeyse çıkart)
      text = text.trim();
      if (text.startsWith("```json")) text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      else if (text.startsWith("```")) text = text.replace(/```/g, "").trim();

      const parsedMemory = JSON.parse(text);

      // Veritabanına (Episodic Memory) kaydet
      let summaryText = parsedMemory.lede || parsedMemory.objective || "Context compacted";
      try {
          const actorCtx = resolveActorContext ? await resolveActorContext(req) : null;
          const actorName = actorCtx?.user?.name || actorCtx?.user?.email || "system";

          await pool.query(
            `INSERT INTO memory_episodic (id, at, actor, summary, thread_id, tokens, outcome)
             VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7)`,
            [`epi.${Math.random().toString(36).slice(2,8)}`, Date.now(), actorName, summaryText.substring(0,250), threadId !== "unknown" ? threadId : null, Math.round(transcript.length / 4), 'resolved']
          );
      } catch(dbErr) {
          console.error("Failed to save episodic trace:", dbErr.message);
      }

      res.json(parsedMemory);
    } catch (e) { 
      console.error("Memory Compaction Error:", e);
      res.status(500).json({ error: String(e.message || e) }); 
    }
  });
}
