// Vision Service routes — Local VLM engine manager (manual on/off from UI).
// Agnostic launcher: configurable via VLM_CMD env var, default to Python vllm/mlx/ollama proxy.
// Endpoints: status, start, stop, logs, analyze, config.

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const VISION_LOG_DIR = path.resolve(process.cwd(), "logs");
const VISION_LOG_FILE = path.join(VISION_LOG_DIR, "local-vlm.log");
try { fs.mkdirSync(VISION_LOG_DIR, { recursive: true }); } catch {}

export async function initVisionService({ pool, enqueueWrite, decField }) {
  console.log("[boot] initVisionService... ✅");
}

function visionBindHost() { return String(process.env.LOCAL_VLM_BIND || "0.0.0.0"); }
function visionPort() { return Number(process.env.LOCAL_VLM_PORT || 8011); }
function visionDefaultModel() {
  const cached = (globalThis.__elaraVisionCfg && globalThis.__elaraVisionCfg.model) || "";
  return cached || process.env.LOCAL_VLM_MODEL || "vision-local-default";
}

async function visionPortReachable(timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const sock = new net.Socket();
      let done = false;
      const finish = (ok) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(ok); };
      sock.setTimeout(timeoutMs);
      sock.once("connect", () => finish(true));
      sock.once("timeout", () => finish(false));
      sock.once("error", () => finish(false));
      sock.connect(visionPort(), "127.0.0.1");
    } catch { resolve(false); }
  });
}

function visionProcAlive() {
  const p = globalThis.__elaraVisionProc;
  if (!p || !p.pid) return false;
  try { process.kill(p.pid, 0); return true; } catch { return false; }
}

export function mountVisionServiceRoutes(app, deps) {
  const { pool, enqueueWrite, decField } = deps;

  app.get("/api/vision/service/status", async (_req, res) => {
    const p = globalThis.__elaraVisionProc;
    const alive = visionProcAlive();
    const reachable = await visionPortReachable();
    const startedAt = p?.startedAt || null;
    res.json({
      ok: true,
      running: alive,
      reachable,
      pid: alive ? p.pid : null,
      host: visionBindHost(),
      port: visionPort(),
      model: p?.model || visionDefaultModel(),
      startedAt,
      uptimeMs: startedAt ? Date.now() - startedAt : 0,
      lastError: globalThis.__elaraVisionLastError || null,
    });
  });

  app.post("/api/vision/service/start", async (req, res) => {
    if (visionProcAlive()) {
      const p = globalThis.__elaraVisionProc;
      return res.json({ ok: true, pid: p.pid, message: "already running" });
    }
    const model = (typeof req.body?.model === "string" && req.body.model.trim()) || visionDefaultModel();
    const host = visionBindHost();
    const port = visionPort();

    let cmd = process.env.LOCAL_VLM_CMD_BIN || "python3";
    let args = process.env.LOCAL_VLM_CMD_ARGS 
      ? process.env.LOCAL_VLM_CMD_ARGS.split(" ")
      : ["-m", "vllm.entrypoints.openai.api_server", "--host", host, "--port", String(port), "--model", model];

    try {
      const out = fs.openSync(VISION_LOG_FILE, "a");
      const err = fs.openSync(VISION_LOG_FILE, "a");
      const ts = new Date().toISOString();
      fs.appendFileSync(VISION_LOG_FILE, `\n----- ${ts} START ${cmd} ${args.join(" ")} -----\n`);
      const child = spawn(cmd, args, {
        stdio: ["ignore", out, err],
        detached: false,
        env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
      });
      child.on("error", (e) => {
        globalThis.__elaraVisionLastError = String(e?.message || e);
        try { fs.appendFileSync(VISION_LOG_FILE, `[spawn:error] ${globalThis.__elaraVisionLastError}\n`); } catch {}
      });
      child.on("exit", (code, sig) => {
        try { fs.appendFileSync(VISION_LOG_FILE, `[exit] code=${code} signal=${sig} at ${new Date().toISOString()}\n`); } catch {}
        if (globalThis.__elaraVisionProc && globalThis.__elaraVisionProc.pid === child.pid) {
          globalThis.__elaraVisionProc = null;
        }
      });
      globalThis.__elaraVisionProc = { pid: child.pid, model, host, port, startedAt: Date.now(), child };
      globalThis.__elaraVisionLastError = null;
      res.json({ ok: true, pid: child.pid, host, port, model });
    } catch (e) {
      globalThis.__elaraVisionLastError = String(e?.message || e);
      res.status(500).json({ ok: false, error: globalThis.__elaraVisionLastError });
    }
  });

  app.post("/api/vision/service/stop", async (_req, res) => {
    const p = globalThis.__elaraVisionProc;
    if (!p || !visionProcAlive()) {
      globalThis.__elaraVisionProc = null;
      return res.json({ ok: true, message: "not running" });
    }
    try {
      try { process.kill(p.pid, "SIGTERM"); } catch {}
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        await new Promise((r) => setTimeout(r, 200));
        if (!visionProcAlive()) break;
      }
      if (visionProcAlive()) { try { process.kill(p.pid, "SIGKILL"); } catch {} }
      globalThis.__elaraVisionProc = null;
      try { fs.appendFileSync(VISION_LOG_FILE, `[stop] requested at ${new Date().toISOString()}\n`); } catch {}
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/vision/service/logs", (req, res) => {
    const tail = Math.max(1, Math.min(500, Number(req.query?.tail || 50)));
    try {
      if (!fs.existsSync(VISION_LOG_FILE)) return res.json({ ok: true, lines: [] });
      const buf = fs.readFileSync(VISION_LOG_FILE, "utf8");
      const lines = buf.split(/\r?\n/).filter(Boolean);
      res.json({ ok: true, lines: lines.slice(-tail) });
    } catch (e) {
      res.json({ ok: false, lines: [], error: String(e?.message || e) });
    }
  });

  // ============================================================
  // Vision on Demand — single-frame analysis (Live Call "Look")
  // Routes using standard OpenAI Vision payload to target provider.
  // ============================================================
  app.post("/api/vision/analyze", async (req, res) => {
    const t0 = Date.now();
    const body = req.body ?? {};
    const cached = globalThis.__elaraVisionCfg || {};
    const pick = (key, fallback) =>
      body[key] !== undefined && body[key] !== null && body[key] !== ""
        ? body[key]
        : (cached[key] !== undefined && cached[key] !== null && cached[key] !== "" ? cached[key] : fallback);

    const { image } = body;
    if (!image) return res.status(400).json({ ok: false, error: "image (data URL or base64) required" });

    const systemPrompt = pick("systemPrompt", "");
    const userPrompt = pick("prompt", "Describe the scene.");
    let baseUrl = pick("baseUrl", "");
    let targetModel = pick("model", "");
    let apiKey = pick("apiKey", "");
    const temperature = Number(pick("temperature", 0.1));
    const maxTokens = Math.max(16, Math.min(4096, Number(pick("maxTokens", 800)) || 800));
    const visionTimeoutMs = Math.max(1000, Math.min(180000, Number(pick("timeoutMs", process.env.VISION_TIMEOUT_MS || 60000)) || 60000));
    const extra = (body.extra && typeof body.extra === "object" && !Array.isArray(body.extra))
      ? body.extra
      : (cached.extra && typeof cached.extra === "object" && !Array.isArray(cached.extra) ? cached.extra : {});

    // If deepDive (or no override provided), grab the cheapest/top vision-capable provider from DB.
    if (!baseUrl || !targetModel) {
      try {
        const { rows } = await pool.query(
          "SELECT * FROM ai_providers WHERE kind='vlm' OR kind='llm' AND is_active=true ORDER BY is_cheapest DESC, priority ASC LIMIT 1"
        );
        const p = rows[0];
        if (p) {
          baseUrl = baseUrl || p.base_url || "";
          targetModel = targetModel || p.model || "";
          if (!apiKey && p.api_key_ct) {
            apiKey = decField(p.api_key_ct, p.api_key_iv, p.api_key_tag) || "";
          }
        }
      } catch (e) {
        console.warn("[vision] Could not fetch DB fallback provider:", e.message);
      }
    }

    if (!baseUrl) {
      baseUrl = process.env.LOCAL_VLM_BASE_URL || "http://127.0.0.1:8011/v1";
    }
    if (!targetModel) {
      targetModel = process.env.LOCAL_VLM_MODEL || "vision-local-default";
    }

    const b64 = String(image).replace(/^data:[^;]+;base64,/, "");
    const dataUrl = String(image).startsWith("data:") ? String(image) : `data:image/png;base64,${b64}`;

    const msgs = [];
    if (systemPrompt && String(systemPrompt).trim()) {
      msgs.push({ role: "system", content: String(systemPrompt) });
    }
    msgs.push({ role: "user", content: [
      { type: "text", text: userPrompt },
      { type: "image_url", image_url: { url: dataUrl } },
    ]});

    const payload = {
      model: targetModel,
      stream: false,
      max_tokens: maxTokens,
      temperature,
      messages: msgs,
      ...extra,
    };

    let apiErr = null;
    try {
      const endpoint = baseUrl.replace(/\/$/, "") + (baseUrl.includes("/v1beta") ? "" : "/chat/completions");
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      else if (process.env.OPENAI_API_KEY && endpoint.includes("openai.com")) {
        headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
      }

      const r = await fetch(endpoint, {
        method: "POST", headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(visionTimeoutMs),
      });

      if (r.ok) {
        const j = await r.json();
        const text = j?.choices?.[0]?.message?.content;
        const out = typeof text === "string" ? text : Array.isArray(text) ? text.map(p=>p?.text||"").join("") : "";
        
        enqueueWrite(
          `INSERT INTO provider_usage(provider_id,provider_name,kind,model,total_tokens,latency_ms,status)
           VALUES (NULL,$1,'vlm',$2,$3,$4,'ok')`,
          [baseUrl, targetModel, (out.length/4)|0, Date.now()-t0]
        );
        return res.json({ ok: true, text: out, source: `vision:${targetModel}`, latencyMs: Date.now()-t0 });
      }
      apiErr = `HTTP ${r.status}: ${(await r.text().catch(()=>"")).slice(0,200)}`;
    } catch (e) {
      apiErr = String(e?.message || e);
    }

    if (apiErr) console.warn(`[vision] engine (${baseUrl}) failed: ${apiErr}`);
    res.json({ ok: false, text: "", source: "vision:error", error: apiErr || "Unknown error", latencyMs: Date.now()-t0 });
  });

  // Vision Console → Mac/Node cache seal
  app.post("/api/vision/config", (req, res) => {
    const b = req.body ?? {};
    const clamp = (n, lo, hi, dflt) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return dflt;
      return Math.max(lo, Math.min(hi, v));
    };
    globalThis.__elaraVisionCfg = {
      systemPrompt: typeof b.systemPrompt === "string" ? b.systemPrompt.slice(0, 8000) : "",
      prompt: typeof b.prompt === "string" ? b.prompt.slice(0, 4000) : "",
      baseUrl: typeof b.baseUrl === "string" ? b.baseUrl.slice(0, 500) : "",
      model: typeof b.model === "string" ? b.model.slice(0, 200) : "",
      temperature: clamp(b.temperature, 0, 2, 0.1),
      maxTokens: clamp(b.maxTokens, 16, 4096, 800),
      maxFrames: clamp(b.maxFrames, 1, 16, 1),
      timeoutMs: clamp(b.timeoutMs, 1000, 180000, 60000),
      extra: (b.extra && typeof b.extra === "object" && !Array.isArray(b.extra)) ? b.extra : {},
      sealedAt: Date.now(),
    };
    res.json({ ok: true, sealedAt: globalThis.__elaraVisionCfg.sealedAt });
  });
}
