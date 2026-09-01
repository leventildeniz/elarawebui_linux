// Live-call WebSocket subsystem (extracted from server.mjs, T-2026-05-30).
// Owns: HTTP/HTTPS server creation, WS upgrade gating (soft SID), TLS bootstrap,
// /ws/live-call protocol (hello/user/frame/ping/echo + LLM stream relay).
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { WebSocketServer } from "ws";

export async function installLiveCall({ app, pool, port, __bootDir }) {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  async function validateWsSidIfPresent(req) {
    try {
      const u = new URL(req.url, "http://x");
      const sid = String(u.searchParams.get("sid") || req.headers["x-session-id"] || "").trim();
      if (!sid) return { ok: true, sid: null };
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(sid)) return { ok: false, reason: "bad_sid_format" };
      const { rows } = await pool.query(
        "SELECT id, last_seen FROM app_sessions WHERE id=$1 LIMIT 1",
        [sid]
      );
      const row = rows[0];
      if (!row) return { ok: false, reason: "no_session" };
      const lastSeen = row.last_seen ? new Date(row.last_seen).getTime() : 0;
      if (lastSeen && Date.now() - lastSeen > 24 * 60 * 60 * 1000) return { ok: false, reason: "stale_session" };
      return { ok: true, sid };
    } catch (e) {
      return { ok: false, reason: `gate_error:${String(e?.message || e).slice(0, 80)}` };
    }
  }

  function writeWsAuthReject(sock, reason) {
    try {
      const body = JSON.stringify({ ok: false, code: "ws_auth_required", reason });
      sock.write(
        "HTTP/1.1 401 Unauthorized\r\n" +
        "Connection: close\r\n" +
        "Content-Type: application/json\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        "\r\n" + body
      );
    } catch {}
    try { sock.destroy(); } catch {}
  }

  function handleLiveCallUpgrade(req, sock, head, proto = "http") {
    try {
      if (new URL(req.url, `${proto}://x`).pathname !== "/ws/live-call") { sock.destroy(); return; }
      validateWsSidIfPresent(req).then((res) => {
        if (!res.ok) return writeWsAuthReject(sock, res.reason);
        wss.handleUpgrade(req, sock, head, (ws) => wss.emit("connection", ws, req));
      }).catch(() => { try { sock.destroy(); } catch {} });
    } catch {
      try { sock.destroy(); } catch {}
    }
  }
  httpServer.on("upgrade", (req, sock, head) => handleLiveCallUpgrade(req, sock, head, "http"));

  // HTTPS sibling — TLS bound to the same Express app + same WSS handler.
  let httpsServer = null;
  const HTTPS_ENABLED = String(process.env.HTTPS_ENABLED || "").trim() === "1";
  const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3006);
  const TLS_CERT_FILE = process.env.TLS_CERT_FILE
    ? path.resolve(__bootDir, process.env.TLS_CERT_FILE)
    : path.join(__bootDir, "certs", "elara.pem");
  const TLS_KEY_FILE = process.env.TLS_KEY_FILE
    ? path.resolve(__bootDir, process.env.TLS_KEY_FILE)
    : path.join(__bootDir, "certs", "elara-key.pem");
  if (HTTPS_ENABLED) {
    if (!fs.existsSync(TLS_CERT_FILE) || !fs.existsSync(TLS_KEY_FILE)) {
      const issueScript = path.join(__bootDir, "scripts", "issue-cert.sh");
      if (fs.existsSync(issueScript)) {
        try {
          const { execFileSync } = await import("node:child_process");
          console.log(`[boot] TLS sertifikası eksik — issue-cert.sh otomatik tetikleniyor…`);
          execFileSync("bash", [issueScript], { stdio: "inherit", timeout: 30000, cwd: __bootDir });
          console.log(`[boot] TLS sertifikası üretildi.`);
        } catch (e) {
          console.warn(`[middleware] issue-cert.sh otomatik üretim başarısız: ${e.message}`);
        }
      }
    }
    if (fs.existsSync(TLS_CERT_FILE) && fs.existsSync(TLS_KEY_FILE)) {
      try {
        httpsServer = createHttpsServer({
          cert: fs.readFileSync(TLS_CERT_FILE),
          key: fs.readFileSync(TLS_KEY_FILE),
        }, app);
        httpsServer.on("upgrade", (req, sock, head) => handleLiveCallUpgrade(req, sock, head, "https"));
      } catch (e) {
        console.error(`[middleware] HTTPS init failed: ${e.message} — HTTP-only.`);
        httpsServer = null;
      }
    } else {
      console.warn(`[middleware] HTTPS_ENABLED=1 but cert/key missing (${TLS_CERT_FILE}). Run: bash local-server/scripts/issue-cert.sh`);
    }
  }

  wss.on("connection", (ws, req) => {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    const clientIp = forwarded || req.socket.remoteAddress || "unknown";
    console.log(`[INCOMING] Request from: ${clientIp} | WS /ws/live-call`);
    let session = { threadId: null, model: "phi3:medium", mode: "local", agents: [], history: [] };
    ws.send(JSON.stringify({ type: "ready", ts: Date.now() }));

    ws.on("message", async (raw) => {
      let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
      try {
        if (msg.type === "hello") {
          session = { ...session, ...msg, history: msg.history || [] };
          ws.send(JSON.stringify({ type: "ack", session: { threadId: session.threadId, model: session.model } }));
          return;
        }
        if (msg.type === "user") {
          const t0 = Date.now();
          session.history.push({ role: "user", content: String(msg.text || "").slice(0, 4000) });
          const url = `http://127.0.0.1:${port}/api/chat/orchestrate`;
          const upstream = await fetch(url, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              thread_id: session.threadId, model: session.model, mode: session.mode,
              agents: session.agents, messages: session.history,
            }),
          }).catch((e) => { ws.send(JSON.stringify({ type: "error", message: String(e.message || e) })); return null; });
          if (!upstream || !upstream.body) return;
          let assistant = ""; let source = "local";
          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n\n"); buf = lines.pop() || "";
            for (const line of lines) {
              const data = line.replace(/^data:\s*/, "").trim(); if (!data) continue;
              if (data === "[DONE]") { ws.send(JSON.stringify({ type: "done", source, latencyMs: Date.now()-t0 })); continue; }
              try {
                const j = JSON.parse(data);
                if (j.meta?.source) source = j.meta.source;
                if (j.delta) { assistant += j.delta; ws.send(JSON.stringify({ type: "delta", chunk: j.delta })); }
                if (j.done) { ws.send(JSON.stringify({ type: "done", source, latencyMs: Date.now()-t0 })); }
              } catch { /* */ }
            }
          }
          session.history.push({ role: "assistant", content: assistant });
          return;
        }
        if (msg.type === "frame") {
          const { type: _t, ...rest } = msg;
          const r = await fetch(`http://127.0.0.1:${port}/api/vision/analyze`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...rest, deepDive: session.mode === "deepdive" }),
          });
          const j = await r.json().catch(() => ({}));
          ws.send(JSON.stringify({ type: "vision", ...j }));
          return;
        }
        if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong", ts: Date.now() })); return; }
        if (msg.type === "echo") { ws.send(JSON.stringify({ type: "echo", payload: msg.payload ?? null, ts: Date.now() })); return; }
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", message: String(e.message || e) }));
      }
    });

    ws.on("close", () => { /* cleanup if needed */ });
  });

  return { httpServer, httpsServer, wss, HTTPS_ENABLED, HTTPS_PORT, TLS_CERT_FILE };
}
