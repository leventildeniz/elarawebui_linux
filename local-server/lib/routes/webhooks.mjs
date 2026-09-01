// =============================================================================
// MESSAGING WEBHOOKS — Telegram · Teams · WhatsApp · Signal · Generic
// Real-time ingestion. Each endpoint normalizes payload → ingestMessagingEvent.
// Extracted from server.mjs 2026-05-30 (post-SHA d2b5e3d46567).
// =============================================================================
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";

export function mountWebhookRoutes({ app, express, pool, extractFileContent, ingestMediaUrl, ingestSource }) {
  // rate-limit (in-memory; per-platform IP bucket: 60/min)
  const _rateBuckets = new Map();
  function rateLimitOk(key, limit = 60, windowMs = 60_000) {
    const now = Date.now();
    const arr = (_rateBuckets.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= limit) return false;
    arr.push(now); _rateBuckets.set(key, arr); return true;
  }

  async function logMessagingJob(job) {
    try {
      const r = await pool.query(
        `INSERT INTO messaging_jobs(platform, chat_id, sender, kind, status, raw)
         VALUES ($1,$2,$3,$4,'queued',$5) RETURNING id`,
        [job.platform, job.chatId || null, job.sender || null, job.kind, job.raw || {}]
      );
      return r.rows[0].id;
    } catch (e) { console.error("[mjob:log]", e.message); return null; }
  }
  async function finishMessagingJob(jobId, status, sourceId, error) {
    if (!jobId) return;
    try {
      await pool.query(
        `UPDATE messaging_jobs SET status=$1, source_id=$2, error=$3, finished_at=now() WHERE id=$4`,
        [status, sourceId, error || null, jobId]
      );
    } catch {}
  }

  // Download a remote URL to a temp file (with optional headers for auth).
  async function downloadToTemp(url, headers = {}) {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`download failed [${r.status}]`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ext = (url.match(/\.([a-z0-9]{1,5})(?:\?|#|$)/i)?.[1] || "bin").toLowerCase();
    const tmp = path.join(os.tmpdir(), `mjob-${Date.now()}-${Math.random().toString(36).slice(2,7)}.${ext}`);
    await fs.promises.writeFile(tmp, buf);
    return { path: tmp, ext: `.${ext}`, size: buf.length };
  }

  // Universal messaging ingest: text|audio|image|video → knowledge_chunks
  async function ingestMessagingEvent(msg) {
    const jobId = await logMessagingJob(msg);
    await pool.query("UPDATE messaging_jobs SET status='processing' WHERE id=$1", [jobId]).catch(()=>{});
    try {
      const ts = msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp || Date.now());
      const tag = `${msg.platform[0].toUpperCase()}${msg.platform.slice(1)}`;
      const brand = msg.platform;
      let content = "";
      let name = `${tag} · ${msg.chatId || "chat"} · ${ts.toISOString()}`;

      if (msg.kind === "text" && msg.text) {
        content = `# ${tag} message\nFrom: ${msg.sender || "?"}\nChat: ${msg.chatId || "?"}\nTime: ${ts.toISOString()}\n\n${msg.text}`;
      } else if (msg.kind === "audio" && msg.audioUrl) {
        const dl = await downloadToTemp(msg.audioUrl, msg.downloadHeaders || {});
        const ex = await extractFileContent(dl.path, dl.ext.match(/\.(mp3|wav|m4a|ogg|opus|flac|aac)$/i) ? dl.ext : ".ogg");
        try { await fs.promises.unlink(dl.path); } catch {}
        content = `# ${tag} voice message\nFrom: ${msg.sender || "?"}\nTime: ${ts.toISOString()}\n\n${ex.ok ? ex.content : "[transcription failed: "+ex.error+"]"}`;
      } else if (msg.kind === "image" && msg.imageUrl) {
        const dl = await downloadToTemp(msg.imageUrl, msg.downloadHeaders || {});
        const ex = await extractFileContent(dl.path, dl.ext.match(/\.(png|jpg|jpeg|webp|bmp|gif|tiff)$/i) ? dl.ext : ".jpg");
        try { await fs.promises.unlink(dl.path); } catch {}
        content = `# ${tag} image (Vision RAG)\nFrom: ${msg.sender || "?"}\nTime: ${ts.toISOString()}\nCaption: ${msg.text || "(none)"}\n\n${ex.ok ? ex.content : "[vision failed: "+ex.error+"]"}`;
      } else if (msg.kind === "video" && msg.videoUrl) {
        const r = await ingestMediaUrl(msg.videoUrl, {}).catch(e => ({ ok:false, error:String(e?.message||e) }));
        await finishMessagingJob(jobId, r.ok ? "done" : "error", r.id || null, r.ok ? null : r.error);
        return r;
      } else {
        throw new Error(`unsupported messaging kind: ${msg.kind}`);
      }

      const result = await ingestSource({
        name, type: "messaging", content, tag, brand, sourceTimestamp: ts,
      });
      await finishMessagingJob(jobId, "done", result.sourceId, null);
      return { ok: true, id: result.sourceId, chunks: result.chunks, version: result.version };
    } catch (e) {
      await finishMessagingJob(jobId, "error", null, String(e?.message || e));
      return { ok: false, error: String(e?.message || e) };
    }
  }

  function safeEqualStr(a, b) {
    const A = Buffer.from(String(a||"")); const B = Buffer.from(String(b||""));
    return A.length === B.length && timingSafeEqual(A, B);
  }

  // ----- Telegram -----
  app.post("/api/webhooks/telegram", async (req, res) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const got = req.headers["x-telegram-bot-api-secret-token"];
      if (!safeEqualStr(got, secret)) return res.status(401).json({ ok: false, error: "bad secret" });
    }
    if (!rateLimitOk(`tg:${req.ip}`)) return res.status(429).json({ ok: false, error: "rate limited" });
    const u = req.body || {};
    const m = u.message || u.edited_message || u.channel_post;
    if (!m) return res.json({ ok: true, ignored: true });
    let kind = "text", text = m.text || m.caption || "", audioUrl = null, imageUrl = null;
    if (m.voice || m.audio) { kind = "audio"; audioUrl = m.voice?.url || m.audio?.url || null; }
    else if (m.photo?.length || m.document?.mime_type?.startsWith("image/")) {
      kind = "image"; imageUrl = m.photo?.[m.photo.length-1]?.url || m.document?.url || null;
    } else if (m.video) { kind = "video"; }
    if ((kind === "audio" && !audioUrl) || (kind === "image" && !imageUrl)) {
      text = `[${kind} attachment file_id: ${m.voice?.file_id || m.audio?.file_id || m.photo?.slice(-1)[0]?.file_id || m.document?.file_id}] ${text||""}`;
      kind = "text";
    }
    const job = {
      platform: "telegram",
      chatId: String(m.chat?.id || ""),
      sender: m.from?.username || m.from?.first_name || String(m.from?.id || ""),
      timestamp: new Date((m.date || Math.floor(Date.now()/1000)) * 1000),
      kind, text, audioUrl, imageUrl, raw: u,
    };
    res.json({ ok: true, queued: true });
    setImmediate(() => ingestMessagingEvent(job).catch(e => console.error("[tg ingest]", e)));
  });

  // ----- Microsoft Teams (Outgoing Webhook with HMAC) -----
  app.post("/api/webhooks/teams", express.raw({ type: "*/*", limit: "20mb" }), async (req, res) => {
    const secret = process.env.MSTEAMS_WEBHOOK_SECRET;
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (secret) {
      const got = String(req.headers["authorization"] || "").replace(/^HMAC\s+/i, "");
      const { createHmac } = await import("node:crypto");
      const expected = createHmac("sha256", Buffer.from(secret, "base64")).update(raw).digest("base64");
      if (!safeEqualStr(got, expected)) return res.status(401).json({ ok: false, error: "bad hmac" });
    }
    if (!rateLimitOk(`teams:${req.ip}`)) return res.status(429).json({ ok: false, error: "rate limited" });
    let u = {};
    try { u = JSON.parse(raw.toString("utf8")); } catch {}
    const text = String(u.text || "").replace(/<[^>]+>/g, " ").trim();
    const job = {
      platform: "teams",
      chatId: u.conversation?.id || u.channelData?.channel?.id || "",
      sender: u.from?.name || u.from?.id || "",
      timestamp: new Date(u.timestamp || Date.now()),
      kind: "text", text, raw: u,
    };
    res.json({ type: "message", text: "✅ Sealed (RAG)" });
    setImmediate(() => ingestMessagingEvent(job).catch(e => console.error("[teams ingest]", e)));
  });

  // ----- WhatsApp Cloud API -----
  app.get("/api/webhooks/whatsapp", (req, res) => {
    const verify = process.env.WHATSAPP_VERIFY_TOKEN;
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verify) {
      return res.status(200).send(String(req.query["hub.challenge"] || ""));
    }
    res.status(403).end();
  });
  app.post("/api/webhooks/whatsapp", async (req, res) => {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (appSecret) {
      const sig = String(req.headers["x-hub-signature-256"] || "").replace(/^sha256=/, "");
      const { createHmac } = await import("node:crypto");
      const expected = createHmac("sha256", appSecret).update(JSON.stringify(req.body || {})).digest("hex");
      if (!safeEqualStr(sig, expected)) return res.status(401).json({ ok: false });
    }
    if (!rateLimitOk(`wa:${req.ip}`)) return res.status(429).json({ ok: false });
    const u = req.body || {};
    res.json({ ok: true });
    for (const entry of u.entry || []) {
      for (const ch of entry.changes || []) {
        const value = ch.value || {};
        for (const m of value.messages || []) {
          let kind = "text", text = m.text?.body || m.image?.caption || m.video?.caption || "";
          let imageUrl = null, audioUrl = null;
          if (m.image) {
            if (m.image.url) { kind = "image"; imageUrl = m.image.url; }
            else text = `[image id:${m.image.id}] ${text}`;
          } else if (m.voice || m.audio) {
            const a = m.voice || m.audio;
            if (a.url) { kind = "audio"; audioUrl = a.url; }
            else text = `[voice id:${a.id}] ${text}`;
          } else if (m.video) {
            if (m.video.url) { kind = "video"; }
          }
          const job = {
            platform: "whatsapp",
            chatId: m.from || value.metadata?.phone_number_id || "",
            sender: m.from || "",
            timestamp: new Date(parseInt(m.timestamp || "0", 10) * 1000 || Date.now()),
            kind, text, imageUrl, audioUrl,
            videoUrl: kind === "video" ? m.video.url : null,
            raw: m,
          };
          setImmediate(() => ingestMessagingEvent(job).catch(e => console.error("[wa ingest]", e)));
        }
      }
    }
  });

  // ----- Signal (signal-cli REST bridge) -----
  app.post("/api/webhooks/signal", async (req, res) => {
    const tok = process.env.SIGNAL_WEBHOOK_TOKEN;
    if (tok) {
      const got = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
      if (!safeEqualStr(got, tok)) return res.status(401).json({ ok: false });
    }
    if (!rateLimitOk(`sig:${req.ip}`)) return res.status(429).json({ ok: false });
    const m = req.body || {};
    const text = m.message || m.envelope?.dataMessage?.message || "";
    const att = m.envelope?.dataMessage?.attachments?.[0];
    let kind = "text", imageUrl = null, audioUrl = null;
    if (att?.contentType?.startsWith("image/") && att.url) { kind = "image"; imageUrl = att.url; }
    else if (att?.contentType?.startsWith("audio/") && att.url) { kind = "audio"; audioUrl = att.url; }
    const job = {
      platform: "signal",
      chatId: m.envelope?.source || m.source || "",
      sender: m.envelope?.sourceName || m.source || "",
      timestamp: new Date(m.envelope?.timestamp || Date.now()),
      kind, text, imageUrl, audioUrl, raw: m,
    };
    res.json({ ok: true });
    setImmediate(() => ingestMessagingEvent(job).catch(e => console.error("[sig ingest]", e)));
  });

  // ----- Generic (Slack/Discord/IFTTT/n8n) -----
  app.post("/api/webhooks/generic", async (req, res) => {
    const tok = process.env.GENERIC_WEBHOOK_TOKEN;
    if (tok) {
      const got = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
      if (!safeEqualStr(got, tok)) return res.status(401).json({ ok: false });
    }
    if (!rateLimitOk(`gen:${req.ip}`)) return res.status(429).json({ ok: false });
    const b = req.body || {};
    const kind = b.videoUrl ? "video" : b.imageUrl ? "image" : b.audioUrl ? "audio" : "text";
    const job = {
      platform: String(b.platform || "generic").toLowerCase(),
      chatId: b.chatId || b.channel || "",
      sender: b.sender || b.user || "",
      timestamp: b.timestamp ? new Date(b.timestamp) : new Date(),
      kind, text: b.text || "", imageUrl: b.imageUrl || null,
      audioUrl: b.audioUrl || null, videoUrl: b.videoUrl || null,
      raw: b,
    };
    res.json({ ok: true });
    setImmediate(() => ingestMessagingEvent(job).catch(e => console.error("[gen ingest]", e)));
  });

  // ----- Webhook info (for UI to display URLs) -----
  app.get("/api/webhooks/info", (req, res) => {
    const base = `${req.protocol}://${req.get("host")}`;
    res.json({
      base,
      endpoints: {
        telegram: `${base}/api/webhooks/telegram`,
        teams:    `${base}/api/webhooks/teams`,
        whatsapp: `${base}/api/webhooks/whatsapp`,
        signal:   `${base}/api/webhooks/signal`,
        generic:  `${base}/api/webhooks/generic`,
      },
      secrets_configured: {
        telegram: !!process.env.TELEGRAM_WEBHOOK_SECRET,
        teams:    !!process.env.MSTEAMS_WEBHOOK_SECRET,
        whatsapp: !!process.env.WHATSAPP_APP_SECRET && !!process.env.WHATSAPP_VERIFY_TOKEN,
        signal:   !!process.env.SIGNAL_WEBHOOK_TOKEN,
        generic:  !!process.env.GENERIC_WEBHOOK_TOKEN,
      },
    });
  });

  // Export helpers for callers that need to enqueue a messaging event programmatically.
  return { ingestMessagingEvent };
}
