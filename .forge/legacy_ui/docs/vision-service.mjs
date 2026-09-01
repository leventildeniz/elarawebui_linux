// Vision Service routes — MLX VLM engine on :8011 (manual on/off from Models → Vision).
// No autostart, no launchd entry; operator toggles from UI.
// Endpoints: status, start, stop, logs, analyze, config.
// Extracted from server.mjs (Tur — vision modularization).

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

let _deps = null;

export function initVisionService(deps) {
  // deps: { pool, enqueueWrite, decField }
  _deps = deps;
}

const VISION_LOG_DIR = path.resolve(process.cwd(), "logs");
const VISION_LOG_FILE = path.join(VISION_LOG_DIR, "vision-8011.log");
try { fs.mkdirSync(VISION_LOG_DIR, { recursive: true }); } catch {}

function visionBindHost() { return String(process.env.MLX_VISION_BIND || "0.0.0.0"); }
function visionPort() { return Number(process.env.MLX_VISION_PORT || 8011); }
function visionDefaultModel() {
  const cached = (globalThis.__elaraVisionCfg && globalThis.__elaraVisionCfg.model) || "";
  return cached || process.env.MLX_VISION_MODEL || "mlx-community/Qwen2-VL-7B-Instruct-4bit";
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

export function mountVisionServiceRoutes({ app }) {
  if (!_deps) throw new Error("initVisionService must be called before mountVisionServiceRoutes");
  const { pool, enqueueWrite, decField } = _deps;

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
    // Prefer installed mlx_vlm.server binary (Homebrew). Fallback to `python3 -m mlx_vlm.server`.
    const binCandidates = [
      process.env.MLX_VLM_BIN,
      "/opt/homebrew/bin/mlx_vlm.server",
      "/usr/local/bin/mlx_vlm.server",
    ].filter(Boolean);
    let cmd = "python3";
    let args = ["-m", "mlx_vlm.server", "--host", host, "--port", String(port), "--model", model];
    for (const b of binCandidates) {
      try { if (fs.existsSync(b)) { cmd = b; args = ["--host", host, "--port", String(port), "--model", model]; break; } } catch {}
    }
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
  // Routes to active vision LLM provider; falls back to local MLX VLM.
  // ============================================================
  app.post("/api/vision/analyze", async (req, res) => {
    const t0 = Date.now();
    const body = req.body ?? {};
    const cached = globalThis.__elaraVisionCfg || {};
    // Operatörün UI'da seçtiği canlı ayar > Mac middleware cache > env > default.
    const pick = (key, fallback) =>
      body[key] !== undefined && body[key] !== null && body[key] !== ""
        ? body[key]
        : (cached[key] !== undefined && cached[key] !== null && cached[key] !== "" ? cached[key] : fallback);

    const { image, deepDive = false } = body;
    if (!image) return res.status(400).json({ ok: false, error: "image (data URL or base64) required" });

    const systemPrompt = pick("systemPrompt", "");
    const userPrompt = pick("prompt", "Sahneyi tarif et.");
    const baseUrlOverride = pick("baseUrl", "");
    const modelOverride = pick("model", "");
    const temperature = Number(pick("temperature", 0.1));
    const maxTokens = Math.max(16, Math.min(4096, Number(pick("maxTokens", 800)) || 800));
    const visionTimeoutMs = Math.max(1000, Math.min(180000, Number(pick("timeoutMs", process.env.MLX_VISION_TIMEOUT_MS || 60000)) || 60000));
    const extra = (body.extra && typeof body.extra === "object" && !Array.isArray(body.extra))
      ? body.extra
      : (cached.extra && typeof cached.extra === "object" && !Array.isArray(cached.extra) ? cached.extra : {});

    // OpenAI-style messages: system prompt opsiyonel, sonra user (text+image).
    const buildMessages = (dataUrl) => {
      const msgs = [];
      if (systemPrompt && String(systemPrompt).trim()) {
        msgs.push({ role: "system", content: String(systemPrompt) });
      }
      msgs.push({ role: "user", content: [
        { type: "text", text: userPrompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ]});
      return msgs;
    };

    try {
      if (deepDive) {
        const { rows } = await pool.query(
          "SELECT * FROM ai_providers WHERE kind='llm' AND is_active=true ORDER BY priority ASC LIMIT 1"
        );
        const p = rows[0];
        if (p) {
          const key = decField(p.api_key_ct, p.api_key_iv, p.api_key_tag);
          if (/gemini/i.test(p.provider_name) && key) {
            const model = modelOverride || p.model || "gemini-1.5-pro-vision";
            const base = p.base_url || "https://generativelanguage.googleapis.com";
            const b64 = String(image).replace(/^data:[^;]+;base64,/, "");
            const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
            const r = await fetch(
              `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
              { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [
                  { text: fullPrompt },
                  { inline_data: { mime_type: "image/png", data: b64 } },
                ]}] }),
              },
            );
            const j = await r.json();
            const text = j?.candidates?.[0]?.content?.parts?.map(x => x.text).filter(Boolean).join("\n") || "";
            enqueueWrite(
              `INSERT INTO provider_usage(provider_id,provider_name,kind,model,total_tokens,latency_ms,status)
               VALUES ($1,$2,'llm',$3,$4,$5,$6)`,
              [p.id, p.provider_name, model, (text.length/4)|0, Date.now()-t0, r.ok ? "ok" : "err"]
            );
            return res.json({ ok: true, text, source: `vision:${p.provider_name}`, latencyMs: Date.now()-t0 });
          }
        }
      }
      // Local: MLX VLM (OpenAI-compatible /v1/chat/completions)
      const mlxBase = String(baseUrlOverride || process.env.MLX_VISION_BASE_URL || process.env.MLX_BASE_URL || "http://127.0.0.1:8011").replace(/\/$/,"");
      const mlxModel = String(modelOverride || process.env.MLX_VISION_MODEL || "mlx-community/Qwen2-VL-7B-Instruct-4bit");
      const b64 = String(image).replace(/^data:[^;]+;base64,/, "");
      const dataUrl = String(image).startsWith("data:") ? String(image) : `data:image/png;base64,${b64}`;
      let mlxErr = null;
      try {
        const mlxBody = {
          model: mlxModel,
          stream: false,
          max_tokens: maxTokens,
          temperature,
          messages: buildMessages(dataUrl),
          ...extra, // operatörün custom parametreleri (top_p, repetition_penalty, seed, …)
        };
        const r = await fetch(`${mlxBase}/v1/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mlxBody),
          signal: AbortSignal.timeout(visionTimeoutMs),
        });
        if (r.ok) {
          const j = await r.json();
          const text = j?.choices?.[0]?.message?.content;
          const out = typeof text === "string" ? text : Array.isArray(text) ? text.map(p=>p?.text||"").join("") : "";
          return res.json({ ok: true, text: out, source: `vision:mlx:${mlxModel}`, latencyMs: Date.now()-t0 });
        }
        mlxErr = `HTTP ${r.status}: ${(await r.text().catch(()=>"")).slice(0,200)}`;
      } catch (e) {
        mlxErr = String(e?.message || e);
      }
      if (mlxErr) console.warn(`[vision] mlx (${mlxBase}) failed: ${mlxErr}`);

      // Cloud fallback: OpenAI Vision
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const oaiModel = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
          const oa = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: oaiModel,
              max_tokens: maxTokens,
              temperature,
              messages: buildMessages(dataUrl),
            }),
            signal: AbortSignal.timeout(20000),
          });
          if (oa.ok) {
            const j = await oa.json();
            const text = j?.choices?.[0]?.message?.content;
            const out = typeof text === "string" ? text : Array.isArray(text) ? text.map(p=>p?.text||"").join("") : "";
            enqueueWrite(
              `INSERT INTO provider_usage(provider_id,provider_name,kind,model,total_tokens,latency_ms,status)
               VALUES (NULL,'openai','llm',$1,$2,$3,'ok')`,
              [oaiModel, (out.length/4)|0, Date.now()-t0]
            );
            return res.json({ ok: true, text: out, source: `vision:openai:${oaiModel}`, latencyMs: Date.now()-t0 });
          }
          const errTxt = await oa.text().catch(() => "");
          return res.json({ ok: false, text: "", source: "vision:openai-error", error: `OpenAI vision ${oa.status}: ${errTxt.slice(0,200)}`, latencyMs: Date.now()-t0 });
        } catch (e) {
          return res.json({ ok: false, text: "", source: "vision:openai-error", error: `OpenAI vision: ${String(e?.message || e)}`, latencyMs: Date.now()-t0 });
        }
      }

      res.json({ ok: false, text: "", source: "vision:offline", error: `MLX (${mlxBase}) hata/timeout (${mlxErr || "unknown"}) ve OPENAI_API_KEY yok — vision fallback yok.`, latencyMs: Date.now()-t0 });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Vision Console → Mac mührü. UI değiştikçe cache güncellenir; WS frame'leri
  // body'de override yoksa bu cache'ten beslenir. Persistans yok — UI zaten
  // localStorage'da tutuyor; reboot sonrası ilk push yeniden mühürler.
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
