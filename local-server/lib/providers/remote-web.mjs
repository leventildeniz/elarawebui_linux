// remote-web.mjs — Remote SSE streamer + web-search dispatcher.
// Extracted from server.mjs 2026-05-30 (Batch B turn 1).
// streamFromRemote = pure (no deps). runWebSearch = pool + getActiveProvider DI.

let _deps = null;
export function initRemoteWeb(deps) { _deps = deps || {}; }

export async function streamFromRemote({ apiKey, model, baseUrl, messages, signal }) {
  const mdl = model || "remote-2.0-flash";
  const url = `${baseUrl || "https://api.remote.internal"}/v1beta/models/${mdl}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`remote ${r.status} ${await r.text().catch(()=> "")}`);
  return (async function*() {
    const reader = r.body.getReader(); const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split("\n\n"); buf = frames.pop() ?? "";
      for (const f of frames) {
        const line = f.trim(); if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5).trim());
          const piece = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (piece) yield piece;
        } catch {}
      }
    }
  })();
}

export async function runWebSearch({ query, signal }) {
  if (!_deps) throw new Error("[remote-web] initRemoteWeb() not called");
  const { pool, getActiveProvider } = _deps;
  // 1) Try local Researcher agent on :3001 first
  try {
    const { rows } = await pool.query(
      "SELECT * FROM app_agents WHERE status='active' AND lower(role)='researcher' ORDER BY updated_at DESC LIMIT 1"
    );
    const agent = rows[0];
    if (agent && agent.bridge_url) {
      const r = await fetch(`${agent.bridge_url}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const j = await r.json();
        return { source: `local:${agent.agent_name}`, results: j.results ?? j };
      }
    }
  } catch (e) { console.warn("[web-search] local agent failed:", e.message); }

  // 2) Fallback: Tavily / Serper from ai_providers
  const tavily = await getActiveProvider("search");
  if (tavily && /tavily/i.test(tavily.provider_name) && tavily.apiKey) {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: tavily.apiKey, query, max_results: 5 }),
      signal,
    });
    if (r.ok) return { source: `cloud:${tavily.provider_name}`, providerId: tavily.id, providerName: tavily.provider_name, results: await r.json() };
  }
  if (tavily && /serper/i.test(tavily.provider_name) && tavily.apiKey) {
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": tavily.apiKey },
      body: JSON.stringify({ q: query }),
      signal,
    });
    if (r.ok) return { source: `cloud:${tavily.provider_name}`, providerId: tavily.id, providerName: tavily.provider_name, results: await r.json() };
  }
  return { source: "none", results: null };
}
