// lib/routes/threads.mjs
// Thread CRUD + messages list/clear endpoints.
// Mount via `mountThreadRoutes(app, { pool, isUuid, flushModelKvCache })`.
// Extracted from server.mjs (Block T-2a, 2026-05-30).

export function mountThreadRoutes(app, deps) {
  const { pool, isUuid, flushModelKvCache } = deps;
  if (!pool || typeof isUuid !== "function" || typeof flushModelKvCache !== "function") {
    throw new Error("mountThreadRoutes: missing required deps (pool, isUuid, flushModelKvCache)");
  }

  app.get("/api/threads", async (_req, res) => {
    // 1. Temizlik: İçi boş ve varsayılan isimli (New chat vs) kullanılmayan eski chatleri temizle.
    // En son açılan 1 tanesini (kullanıcının o an ekranda gördüğü boş chat olabilir diye) koru.
    await pool.query(`
      DELETE FROM chat_threads t
       WHERE (t.title = 'New chat' OR t.title = 'New conversation' OR t.title ~ '^Chat [0-9]+$')
         AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.thread_id = t.id)
         AND t.id NOT IN (
           SELECT id FROM chat_threads
            WHERE (title = 'New chat' OR title = 'New conversation' OR title ~ '^Chat [0-9]+$')
            ORDER BY updated_at DESC
            LIMIT 1
         )
    `).catch(() => {});
    const { rows: threads } = await pool.query("SELECT id, title, pinned, color, context, branched_from as \"branchedFrom\", title_locked as \"titleLocked\", EXTRACT(EPOCH FROM created_at)*1000 as \"createdAt\" FROM chat_threads ORDER BY updated_at DESC LIMIT 50");
    
    // Fetch messages for these threads
    const { rows: msgs } = await pool.query("SELECT thread_id, role, body as text, thinking, streaming, approval, proposals, compaction, agent, retrieval, activity FROM chat_messages WHERE thread_id = ANY($1) ORDER BY seq ASC", [threads.map(t => t.id)]);
    
    // Fetch files for these threads
    const { rows: files } = await pool.query("SELECT thread_id, message_id, id, name, size_bytes as size, kind, mime, url FROM chat_files WHERE thread_id = ANY($1)", [threads.map(t => t.id)]);

    const result = threads.map(t => {
      const threadMsgs = msgs.filter(m => m.thread_id === t.id).map(m => {
         const mFiles = files.filter(f => f.message_id === m.id).map(f => ({
            id: f.id, name: f.name, size: f.size, kind: f.kind, mime: f.mime, url: f.url
         }));
         return {
            role: m.role,
            text: m.text,
            thinking: m.thinking,
            streaming: m.streaming,
            approval: m.approval,
            proposals: m.proposals,
            compaction: m.compaction,
            agent: m.agent,
            retrieval: m.retrieval,
            activity: m.activity,
            files: mFiles
         };
      });
      const threadFiles = files.filter(f => f.thread_id === t.id && !f.message_id).map(f => ({
         id: f.id, name: f.name, size: f.size, kind: f.kind, mime: f.mime, url: f.url
      }));
      return {
         ...t,
         messages: threadMsgs,
         files: threadFiles
      };
    });
    
    res.json(result);
  });

  app.post("/api/threads", async (req, res) => {
    const title = String(req.body?.title ?? "New conversation").slice(0, 200);
    const providedId = req.body?.id;
    const isChatId = typeof providedId === "string" && providedId.startsWith("chat_");
    const id = isChatId ? providedId : ('chat_' + (Date.now() * 1000).toString());

    const { rows } = await pool.query(
      "INSERT INTO chat_threads(id, title) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title RETURNING id, title, pinned, color, context, branched_from as \"branchedFrom\", title_locked as \"titleLocked\", EXTRACT(EPOCH FROM created_at)*1000 as \"createdAt\"",
      [id, title]
    );
    const result = {
      ...rows[0],
      messages: [],
      files: []
    };
    res.status(201).json(result);
  });

  app.delete("/api/threads/:id", async (req, res) => {
    if (!req.params.id) return res.status(400).json({ error: "missing thread id" });
    await pool.query("DELETE FROM chat_threads WHERE id = $1", [req.params.id]);
    res.status(204).end();
  });

  app.get("/api/threads/:id/messages", async (req, res) => {
    if (!req.params.id) return res.json([]);
    const { rows } = await pool.query(
      "SELECT * FROM chat_messages WHERE thread_id = $1 ORDER BY seq ASC",
      [req.params.id]
    );
    res.json(rows);
  });

  // Hard delete: thread'in tüm mesajlarını fiziksel olarak siler (thread'i tutar).
  // Refresh sonrası geri gelmemesi için "Bağlam Temizle" buton'undan tetiklenir.
  // Kutu C: Kalıcılık için PUT uçları
  app.put("/api/threads/:id/messages", async (req, res) => {
    const threadId = req.params.id;
    const messages = req.body?.messages || [];
    
    try {
      await pool.query('BEGIN');
      
      // Auto-create thread if missing (upsert)
      await pool.query(
         `INSERT INTO chat_threads (id, title) VALUES ($1, 'New chat') 
          ON CONFLICT (id) DO NOTHING`,
         [threadId]
      );
      
      // 1. Array'in dışında kalan eski/artık mesajları sil (Trim işlemi)
      await pool.query("DELETE FROM chat_messages WHERE thread_id = $1 AND seq >= $2", [threadId, messages.length]);
      
      // 2. Mevcut mesajları Upsert mantığıyla güncelle veya yeni ise Ekle (Tüm DB'yi yıkmamak için)
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];

        // Sanitize bozuk unicode / yarım kalmış emojileri silmek için:
        // Sadece PostgreSQL jsonb parser'ını bozacak olan izole (tek başına kalmış) surrogate'leri ayıklarız.
        const cleanJSON = (obj) => {
            if (!obj) return null;
            let str = JSON.stringify(obj);
            // Replace isolated high or low surrogates (which break PostgreSQL jsonb parser)
            str = str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|([^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1');
            return str;
        };

        const params = [
            threadId, i, m.role || "user", m.text || "", m.thinking || null,
            cleanJSON(m.approval),
            cleanJSON(m.proposals || []),
            cleanJSON(m.compaction),
            cleanJSON(m.agent),
            cleanJSON(m.retrieval),
            cleanJSON(m.activity)
        ];

        const updateRes = await pool.query(
          `UPDATE chat_messages 
           SET role = $3, body = $4, thinking = $5, approval = $6, proposals = $7, compaction = $8, agent = $9, retrieval = $10, activity = $11 
           WHERE thread_id = $1 AND seq = $2`,
          params
        );

        if (updateRes.rowCount === 0) {
           await pool.query(
             `INSERT INTO chat_messages (
                id, thread_id, seq, role, body, thinking, approval, proposals, compaction, agent, retrieval, activity
              ) VALUES (
                gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
              )`,
             params
           );
        }
      }
      
      await pool.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error("PUT messages error:", e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.put("/api/threads/:id/files", async (req, res) => {
    const threadId = req.params.id;
    const files = req.body?.files || [];
    
    try {
      await pool.query('BEGIN');
      
      // Auto-create thread if missing (upsert)
      await pool.query(
         `INSERT INTO chat_threads (id, title) VALUES ($1, 'New chat') 
          ON CONFLICT (id) DO NOTHING`,
         [threadId]
      );
      
      await pool.query("DELETE FROM chat_files WHERE thread_id = $1 AND message_id IS NULL", [threadId]);
      
      for (const f of files) {
        await pool.query(
          "INSERT INTO chat_files (id, thread_id, name, size_bytes, kind, mime, url) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url",
          [f.id, threadId, f.name, f.size, f.kind, f.mime, f.url]
        );
      }
      await pool.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await pool.query('ROLLBACK');
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.patch("/api/threads/:id", async (req, res) => {
    const id = req.params.id;
    const { title, titleLocked, pinned, color, context } = req.body || {};
    try {
      await pool.query(
        "UPDATE chat_threads SET title = COALESCE($2, title), title_locked = COALESCE($3, title_locked), pinned = COALESCE($4, pinned), color = COALESCE($5, color), context = COALESCE($6, context), updated_at = now() WHERE id = $1 RETURNING *",
        [id, title, titleLocked, pinned, color, context]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
