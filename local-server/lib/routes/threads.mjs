// lib/routes/threads.mjs
// Thread CRUD + messages list/clear endpoints.
// Mount via `mountThreadRoutes(app, { pool, isUuid, flushModelKvCache })`.
// Extracted from server.mjs (Block T-2a, 2026-05-30).

import multer from "multer";
import { saveAttachmentFile, purgeThreadAttachments, deleteAttachmentFile } from "../storage-engine.mjs";

export function mountThreadRoutes(app, deps) {
  const { pool, isUuid, flushModelKvCache, resolveActorContext } = deps;
  if (!pool || typeof isUuid !== "function" || typeof flushModelKvCache !== "function") {
    throw new Error("mountThreadRoutes: missing required deps (pool, isUuid, flushModelKvCache)");
  }

  const attachmentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per attachment
  });

  // POST /api/chat/attachments — Upload attachment (image, PDF, doc, code) to shared storage
  app.post("/api/chat/attachments", attachmentUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: "file required" });
    try {
      const ctx = typeof resolveActorContext === "function"
        ? await resolveActorContext(req)
        : { isSuperAdmin: true, tenantId: "default", actor: "admin" };
      const tenantId = ctx.tenantId || "default";
      const threadId = req.body?.thread_id || req.body?.threadId || null;

      const saved = await saveAttachmentFile({
        pool,
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        threadId,
        tenantId,
      });

      res.status(201).json({ ok: true, file: saved, ...saved });
    } catch (err) {
      console.error("[AttachmentUpload] Error:", err);
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.get("/api/threads", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default", actor: "admin" };
      const tenantId = ctx.tenantId || "default";
      const userMatches = [ctx.userId, ctx.username, ctx.actor].filter(Boolean);

      // Janitor: Prune empty orphan threads with default names ('New chat') that have no messages.
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

      let query = "SELECT id, title, pinned, color, context, branched_from as \"branchedFrom\", title_locked as \"titleLocked\", EXTRACT(EPOCH FROM created_at)*1000 as \"createdAt\" FROM chat_threads";
      const params = [];

      // Chat threads: SuperAdmin sees their own threads plus legacy root/admin threads; regular operators strictly see their own
      if (ctx.isSuperAdmin) {
        query += ` WHERE (tenant_id = $1 OR tenant_id IS NULL) AND (owner_id = ANY($2) OR lower(owner_id) = ANY($2) OR owner_id = '00000000-0000-0000-0000-000000000000' OR owner_id IS NULL OR lower(owner_id) = 'admin')`;
        params.push(tenantId, userMatches.length > 0 ? userMatches : [ctx.userId || "admin"]);
      } else if (userMatches.length > 0) {
        query += ` WHERE (tenant_id = $1 OR tenant_id IS NULL) AND (owner_id = ANY($2) OR lower(owner_id) = ANY($2))`;
        params.push(tenantId, userMatches);
      } else {
        query += ` WHERE (tenant_id = $1 OR tenant_id IS NULL) AND owner_id = $2`;
        params.push(tenantId, ctx.userId || "anonymous");
      }
      query += " ORDER BY updated_at DESC LIMIT 50";

      const { rows: threads } = await pool.query(query, params);
      if (!threads.length) return res.json([]);
      
      const threadIds = threads.map(t => t.id);
      // Fetch messages for these threads
      const { rows: msgs } = await pool.query("SELECT thread_id, role, body as text, thinking, streaming, approval, proposals, compaction, agent, retrieval, activity FROM chat_messages WHERE thread_id = ANY($1) ORDER BY seq ASC", [threadIds]);
      
      // Fetch files for these threads
      const { rows: files } = await pool.query("SELECT thread_id, message_id, id, name, size_bytes as size, kind, mime, url FROM chat_files WHERE thread_id = ANY($1)", [threadIds]);

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
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/threads", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default", actor: "admin" };
      const title = String(req.body?.title ?? "New conversation").slice(0, 200);
      const providedId = req.body?.id;
      const isChatId = typeof providedId === "string" && providedId.startsWith("chat_");
      const id = isChatId ? providedId : ('chat_' + (Date.now() * 1000).toString());
      let ownerId = ctx.userId || null;
      if (!ownerId && ctx.actor) {
        const uRow = await pool.query("SELECT id FROM app_users WHERE lower(username) = lower($1) LIMIT 1", [ctx.actor]);
        ownerId = uRow.rows[0]?.id || null;
      }
      const tenantId = ctx.tenantId || "default";

      const { rows } = await pool.query(
        `INSERT INTO chat_threads(id, title, owner_id, tenant_id) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (id) DO UPDATE SET 
           title = EXCLUDED.title, 
           owner_id = COALESCE(chat_threads.owner_id, EXCLUDED.owner_id),
           tenant_id = COALESCE(chat_threads.tenant_id, EXCLUDED.tenant_id),
           updated_at = now()
         RETURNING id, title, pinned, color, context, branched_from as "branchedFrom", title_locked as "titleLocked", EXTRACT(EPOCH FROM created_at)*1000 as "createdAt"`,
        [id, title, ownerId, tenantId]
      );
      const result = {
        ...rows[0],
        messages: [],
        files: []
      };
      res.status(201).json(result);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/threads/:id", async (req, res) => {
    if (!req.params.id) return res.status(400).json({ error: "missing thread id" });
    const threadId = req.params.id;
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default", actor: "admin" };
      
      // Purge physical files from shared storage and clean DB records
      await purgeThreadAttachments(threadId, { pool });

      if (!ctx.isSuperAdmin) {
        const userMatches = [ctx.userId, ctx.username, ctx.actor].filter(Boolean);
        await pool.query(
          `DELETE FROM chat_threads 
           WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) AND (owner_id = ANY(ARRAY[$3]::text[]) OR lower(owner_id) = ANY(ARRAY[$3]::text[]) OR owner_id IS NULL)`,
          [threadId, ctx.tenantId || "default", userMatches]
        );
      } else {
        await pool.query("DELETE FROM chat_threads WHERE id = $1", [threadId]);
      }
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/threads/:id/messages", async (req, res) => {
    if (!req.params.id) return res.json([]);
    const { rows } = await pool.query(
      "SELECT * FROM chat_messages WHERE thread_id = $1 ORDER BY seq ASC",
      [req.params.id]
    );
    res.json(rows);
  });

  // Persist messages endpoint: syncs full thread message state with PostgreSQL
  app.put("/api/threads/:id/messages", async (req, res) => {
    const threadId = req.params.id;
    const messages = req.body?.messages || [];
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default", actor: "admin" };
    const tenantId = ctx.tenantId || "default";
    let ownerId = ctx.userId || null;
    if (!ownerId && ctx.actor) {
      const uRow = await pool.query("SELECT id FROM app_users WHERE lower(username) = lower($1) LIMIT 1", [ctx.actor]);
      ownerId = uRow.rows[0]?.id || null;
    }
    
    try {
      await pool.query('BEGIN');
      
      // Auto-create thread if missing (upsert) with owner_id and tenant_id
      await pool.query(
         `INSERT INTO chat_threads (id, title, owner_id, tenant_id) VALUES ($1, 'New chat', $2, $3) 
          ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
         [threadId, ownerId, tenantId]
      );
      
      // 1. Trim deleted/trailing messages outside the current message array bounds
      await pool.query("DELETE FROM chat_messages WHERE thread_id = $1 AND seq >= $2", [threadId, messages.length]);
      
      // 2. Upsert existing messages or insert new ones (preserves message sequences)
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];

        // Sanitize broken Unicode and isolated surrogates to prevent PostgreSQL JSONB parser crashes
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
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default", actor: "admin" };
    const tenantId = ctx.tenantId || "default";
    let ownerId = ctx.userId || null;
    if (!ownerId && ctx.actor) {
      const uRow = await pool.query("SELECT id FROM app_users WHERE lower(username) = lower($1) LIMIT 1", [ctx.actor]);
      ownerId = uRow.rows[0]?.id || null;
    }
    
    try {
      await pool.query('BEGIN');
      
      // Auto-create thread if missing (upsert) with owner_id and tenant_id
      await pool.query(
         `INSERT INTO chat_threads (id, title, owner_id, tenant_id) VALUES ($1, 'New chat', $2, $3) 
          ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
         [threadId, ownerId, tenantId]
      );
      
      // Physical cleanup: remove unreferenced files on disk
      const keepIds = new Set(files.map(f => f.id));
      const { rows: existingFiles } = await pool.query("SELECT id FROM chat_files WHERE thread_id = $1 AND message_id IS NULL", [threadId]);
      for (const ef of existingFiles) {
        if (!keepIds.has(ef.id)) {
          await deleteAttachmentFile(ef.id, { pool });
        }
      }

      await pool.query("DELETE FROM chat_files WHERE thread_id = $1 AND message_id IS NULL", [threadId]);
      
      for (const f of files) {
        await pool.query(
          `INSERT INTO chat_files (id, thread_id, name, size_bytes, kind, mime, url, tenant_id) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
           ON CONFLICT (id) DO UPDATE SET 
             name = EXCLUDED.name,
             size_bytes = EXCLUDED.size_bytes,
             kind = EXCLUDED.kind,
             mime = EXCLUDED.mime,
             url = EXCLUDED.url,
             tenant_id = EXCLUDED.tenant_id`,
          [f.id, threadId, f.name, f.size, f.kind, f.mime, f.url, tenantId]
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
