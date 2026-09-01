import "dotenv/config";
import express from "express";
import cors from "cors";

const PORT = Number(process.env.GATEWAY_PORT || process.env.PORT || 8002);
const TARGET = String(process.env.GATEWAY_TARGET || process.env.BRIDGE_TARGET || "http://127.0.0.1:3005").replace(/\/+$/, "");
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.options(/.*/, cors({ origin: true, credentials: true }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "eagle-eye-gateway", port: PORT, target: TARGET, uptime_s: Math.floor(process.uptime()) });
});

// Fire-and-forget latency mark — bridge writes it as `infra.latency` checkpoint.
// Skips its own /api/logs round-trip to avoid feedback loops.
function emitLatency(method, path, ms, status) {
  if (path.startsWith("/api/logs") || path.startsWith("/api/audit/stream") || path.startsWith("/api/metrics/stream")) return;
  const body = JSON.stringify({
    agent: "checkpoint",
    level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
    message: `infra.latency · ${method} ${path} · ${ms}ms · ${status}`,
    meta: { tag: "infra.latency", method, path, ms, status },
  });
  fetch(`${TARGET}/api/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => void 0);
}

app.use(async (req, res) => {
  const t0 = Date.now();
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers["content-length"];
    const ctrl = new AbortController();
    // 2026-05-28 — Timeout sadece HEADER fazını korur (fetch SSE'de header
    // gelince resolve eder, sonra timer temizlenir → streaming body kesilmez).
    // Yine de chat/stream gibi cold-start ağır uçlarda header öncesi middleware
    // first-token watchdog'undan (120s) DAHA UZUN bekle ki "gerçek suçlu kim?"
    // körlüğü olmasın: gateway header timeout < middleware watchdog ise abort'u
    // gateway tetikler ve middleware'in kendi hatasını maskeler.
    const _p = req.path || "";
    const _isHeavy = /\/api\/chat\/|\/orchestrate|\/api\/agents\/|\/stream/.test(_p);
    const _hdrTimeoutMs = Number(
      _isHeavy
        ? (process.env.GATEWAY_HEAVY_TIMEOUT_MS || 180000)
        : (process.env.GATEWAY_PROXY_TIMEOUT_MS || 120000)
    );
    const timer = setTimeout(() => {
      console.warn(`[gateway] header timeout ${_hdrTimeoutMs}ms → abort ${req.method} ${_p}`);
      ctrl.abort();
    }, _hdrTimeoutMs);
    const upstream = await fetch(`${TARGET}${req.originalUrl}`, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    res.on("close", () => emitLatency(req.method, req.path, Date.now() - t0, upstream.status));
    res.status(upstream.status);
    const isStream = /text\/event-stream/i.test(upstream.headers.get("content-type") || "");
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      // SSE seal: never proxy upstream content/transfer encoding — we re-emit
      // identity so neither this gateway nor any intermediary buffers the stream.
      if (["content-encoding", "transfer-encoding", "connection"].includes(k)) return;
      if (isStream && k === "content-length") return;
      res.setHeader(key, value);
    });
    try { req.socket?.setNoDelay?.(true); req.socket?.setKeepAlive?.(true, 30_000); req.socket?.setTimeout?.(0); } catch {}
    try { res.socket?.setNoDelay?.(true); res.socket?.setKeepAlive?.(true, 30_000); res.socket?.setTimeout?.(0); } catch {}
    if (isStream) {
      res.setHeader("Content-Encoding", "identity");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("X-Stream-Flush", "immediate");
      res.flushHeaders?.();
    }
    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value?.length) {
        res.write(Buffer.from(value));
        res.flush?.();
        if (isStream) {
          res.flushHeaders?.();
          res.socket?.uncork?.();
          // Yield once per chunk so the event loop can ship the bytes before
          // we block on the next upstream read — keeps SSE perceptibly real-time.
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }
    res.end();
  } catch (e) {
    emitLatency(req.method, req.path, Date.now() - t0, 502);
    res.status(502).json({ ok: false, error: String(e?.message || e), target: TARGET });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[gateway] listening on 127.0.0.1:${PORT} -> ${TARGET}`);
});