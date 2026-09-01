// Embed worker probes — health, alive-check, warmup.
// Block C Tur 2 — server.mjs'ten taşındı 2026-05-30.
// pushLog DI'lı; env değişkenleri call-time'da okunur (rotation/restart için).

let warmupInflight = null;

export function initEmbedWorkerProbe({
  host = "127.0.0.1",
  port,
  defaultModel = "BAAI/bge-m3",
  healthTimeoutMs = 3000,
  pushLog = () => {},
} = {}) {
  if (!port) throw new Error("initEmbedWorkerProbe: port required");
  const base = `http://${host}:${port}`;

  async function probeWorkerHealth() {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(healthTimeoutMs) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  // Zombi detection: /health can lie. Real round-trip → numeric vector back.
  async function verifyEmbedAlive(timeoutMs = 3000) {
    try {
      const model = process.env.MLX_EMBED_MODEL || defaultModel;
      const r = await fetch(`${base}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: ["ping"] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) return false;
      const j = await r.json().catch(() => null);
      const v = j?.data?.[0]?.embedding;
      return Array.isArray(v) && v.length > 0 && Number.isFinite(v[0]);
    } catch { return false; }
  }

  async function warmEmbedWorker(reason = "boot") {
    const enabled = String(process.env.EMBED_WORKER_WARMUP ?? process.env.EMBED_PREWARM ?? "0") === "1";
    if (!enabled) {
      pushLog("worker", `[warmup:${reason}:disabled] EMBED_WORKER_WARMUP=0`);
      return false;
    }
    if (warmupInflight) return warmupInflight;
    warmupInflight = (async () => {
      const model = process.env.MLX_EMBED_MODEL || defaultModel;
      try {
        const r = await fetch(`${base}/v1/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: ["warmup"] }),
          signal: AbortSignal.timeout(Number(process.env.EMBED_WARMUP_TIMEOUT_MS || 30_000)),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        await r.json().catch(() => null);
        pushLog("worker", `[warmup:${reason}] embedding engine ready · model=${model}`);
        return true;
      } catch (e) {
        pushLog("worker", `[warmup:${reason}:skip] ${e?.message || e}`);
        return false;
      } finally {
        warmupInflight = null;
      }
    })();
    return warmupInflight;
  }

  return { probeWorkerHealth, verifyEmbedAlive, warmEmbedWorker };
}
