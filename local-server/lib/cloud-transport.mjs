// cloud-transport.mjs — OpenAI-compatible HTTP transport for cloud models.
//
// 2026-06-02 — Yeni transport hattı: model satırının `transport='remote_compatible'`
// olduğu durumda streamFromLocalLLM bu modüle delege eder. Tek adapter:
// POST {base}/chat/completions + Bearer auth header.
//
// Kapsam (tek adapter ile ulaşılan provider'lar):
//   * Remote native       (https://api.openai.com/v1)
//   * OpenRouter          (https://openrouter.ai/api/v1)  → Claude, Gemini, Llama, vs.
//   * DeepSeek API        (https://api.deepseek.com/v1)
//   * Groq                (https://api.groq.com/openai/v1)
//   * Together            (https://api.together.xyz/v1)
//   * Mistral API         (https://api.mistral.ai/v1)
//   * Herhangi bir self-host /v1/chat/completions endpoint
//
// API anahtarı asla DB'de tutulmaz. Model satırının `api_key_env` alanı bir
// env değişkeni adı tutar (örn. OPENAI_API_KEY); değer process.env'den okunur.
// Anahtar yoksa endpoint açık kabul edilir (lokal proxy senaryosu).
//
// Çıkış SSE formatı server.mjs streamFromLocalLLM ile aynı:
//   yield { type:"warming" }       (opsiyonel)
//   yield { type:"delta", text }
//   yield { type:"done" }
//   throw on error                 (streamFromLocalLLM catch eder)

/**
 * Read the bearer token for a model row.
 * - api_key_env="" → no auth (local proxy)
 */
function _resolveAuthHeader(row) {
  const envName = String(row?.api_key_env || row?.apiKeyEnv || "").trim();
  if (!envName) return null;
  const value = process.env[envName];
  if (!value) {
    const err = new Error(`cloud transport: env ${envName} is not set (required for model ${row?.id})`);
    err.code = "MISSING_API_KEY";
    throw err;
  }
  return { name: "Authorization", value: `Bearer ${value}` };
}

/**
 * Normalise base url: must end with /v1 (strip trailing slash). We POST to
 * `${base}/chat/completions` ourselves so caller shouldn't include the path.
 */
function _normaliseBase(base) {
  let b = String(base || "").trim();
  if (!b) throw new Error("cloud transport: base_url is empty");
  b = b.replace(/\/+$/, "");
  if (b.endsWith("/chat/completions")) b = b.slice(0, -"/chat/completions".length);
  return b;
}

/**
 * streamCloudCompletion — async generator mirroring streamFromLocalLLM contract.
 *
 * @param {object} args
 * @param {object} args.row              models tablosu satırı (snake_case bekler)
 * @param {string} args.servingModel     /v1/models'de görünen ID (runtime_model_id ?? id)
 * @param {Array}  args.messages         OpenAI chat messages
 * @param {AbortSignal} [args.signal]
 * @param {number} [args.maxTokens]
 * @param {number} [args.temperature]
 * @param {object} [args.extraParams]    diğer body alanları (top_p, repetition_penalty, stop, ...)
 * @param {function} [args.onWarming]    headers gelene kadar tek sefer çağrılır
 * @param {boolean} [args.thinkOff]      chat_template_kwargs.enable_thinking=false ekler
 */
export async function* streamCloudCompletion({
  row, servingModel, messages, signal,
  maxTokens = 1000, temperature = null, extraParams = {},
  onWarming = null, thinkOff = false,
}) {
  if (!row) throw new Error("cloud transport: row required");
  const base = _normaliseBase(row.base_url ?? row.base);
  const target = `${base}/chat/completions`;
  const auth = _resolveAuthHeader(row);

  const body = {
    model: servingModel || row.runtime_model_id || row.id,
    messages,
    stream: true,
    max_tokens: maxTokens,
    ...(temperature != null ? { temperature } : {}),
    ...extraParams,
  };
  if (thinkOff) {
    body.chat_template_kwargs = { ...(extraParams.chat_template_kwargs || {}), enable_thinking: false };
  }

  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-Lovable-AIG-SDK": "elara-cloud-transport",
  };
  if (auth) headers[auth.name] = auth.value;

  console.log(`[CLOUD → ${target}] model=${body.model} max_tokens=${maxTokens} auth=${auth ? auth.name : "none"}`);

  let warmed = false;
  let resp;
  try {
    resp = await fetch(target, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (e) {
    throw new Error(`cloud transport fetch failed: ${String(e?.message || e)}`);
  }

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => "");
    if (resp.status === 429) throw new Error(`cloud transport 429 (rate limited): ${errText.slice(0, 300)}`);
    if (resp.status === 402) throw new Error(`cloud transport 402 (credits exhausted): ${errText.slice(0, 300)}`);
    if (resp.status === 401 || resp.status === 403) throw new Error(`cloud transport ${resp.status} (auth): ${errText.slice(0, 300)}`);
    throw new Error(`cloud transport HTTP ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  try {
    // headers arrived → no longer "warming"
    if (onWarming && !warmed) { try { onWarming(false); } catch {} warmed = true; }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE: events split by blank line. Each event: lines starting with "data: ".
      let nl;
      while ((nl = buf.indexOf("\n\n")) !== -1) {
        const event = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        for (const rawLine of event.split("\n")) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let json;
          try { json = JSON.parse(payload); } catch { continue; }
          // OpenAI-compatible: { choices: [{ delta: { content } }] }
          const choices = Array.isArray(json?.choices) ? json.choices : [];
          for (const c of choices) {
            const delta = c?.delta?.content ?? c?.message?.content ?? c?.text ?? "";
            if (delta) yield { type: "delta", text: String(delta) };
          }
        }
      }
    }
  } finally {
    try { reader.cancel(); } catch {}
  }
  yield { type: "done" };
}

/**
 * Probe a cloud endpoint: GET {base}/models with bearer.
 * Used by the model save handler to validate the URL+key combo without a full chat call.
 */
export async function probeCloudTransport(row, { timeoutMs = 5000 } = {}) {
  const t0 = Date.now();
  try {
    const base = _normaliseBase(row.base_url ?? row.base);
    const auth = _resolveAuthHeader(row);
    const headers = { Accept: "application/json" };
    if (auth) headers[auth.name] = auth.value;
    const r = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, message: `cloud probe HTTP ${r.status}`, latencyMs: ms };
    let loaded = [];
    try {
      const j = await r.json();
      if (Array.isArray(j?.data)) loaded = j.data.map((x) => String(x?.id || "")).filter(Boolean).slice(0, 6);
    } catch {}
    return { ok: true, message: `cloud reachable · ${loaded.length} models${loaded.length ? ` · ${loaded.slice(0, 3).join(", ")}${loaded.length > 3 ? "…" : ""}` : ""}`, latencyMs: ms, loaded };
  } catch (e) {
    return { ok: false, message: `cloud probe failed: ${String(e?.message || e)}`, latencyMs: Date.now() - t0 };
  }
}
