// local-server/lib/mcp/dispatch.mjs
// Route MCP tools/call → existing Elara HTTP endpoints (loopback).
// Reusing HTTP paths guarantees identical behavior + audit + policy checks
// as the internal chat/UI hits.

const DEFAULT_TIMEOUT_MS = 180_000;

async function loopbackFetch(port, path, body, { timeoutMs = DEFAULT_TIMEOUT_MS, mcpTag = "unknown" } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mcp-source": mcpTag,
      },
      body: JSON.stringify(body || {}),
      signal: ctl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { ok: r.ok, status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

function extractQuery(input) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  return String(input.query || input.text || input.prompt || input.input || "").trim();
}

/**
 * Dispatch an MCP tools/call.
 * @returns {Promise<{content: Array, isError?: boolean}>}
 */
export async function dispatchMcpCall({ pool, port, kind, slug, args = {}, clientTag = "mcp" }) {
  const timeoutMs = DEFAULT_TIMEOUT_MS;

  if (kind === "agent") {
    const query = extractQuery(args) || "Introduce yourself briefly.";
    const params = (args && typeof args === "object" && !Array.isArray(args))
      ? { ...args } : {};
    delete params.query; delete params.text; delete params.prompt; delete params.input;
    const r = await loopbackFetch(port, `/api/agents/${encodeURIComponent(slug)}/run`,
      { text: query, params, locale: "en" },
      { timeoutMs, mcpTag: `${clientTag}:agent:${slug}` });
    if (!r.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Agent ${slug} failed (HTTP ${r.status}): ${r.json?.error || r.text || "unknown"}` }],
      };
    }
    const j = r.json || {};
    const out = j.output || j.stdout || j.text || j.result || JSON.stringify(j);
    return { content: [{ type: "text", text: String(out).slice(0, 200_000) }] };
  }

  if (kind === "tool") {
    const r = await loopbackFetch(port, `/api/tools/${encodeURIComponent(slug)}/invoke`,
      { params: args || {} },
      { timeoutMs, mcpTag: `${clientTag}:tool:${slug}` });
    if (r.status === 202) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool ${slug} requires human approval. Invocation: ${r.json?.invocationId || "?"}` }],
      };
    }
    if (!r.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool ${slug} failed (HTTP ${r.status}): ${r.json?.error || r.text || "unknown"}` }],
      };
    }
    const out = r.json?.output ?? r.json ?? {};
    return {
      content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }],
    };
  }

  if (kind === "skill") {
    const r = await loopbackFetch(port, `/api/skills/${encodeURIComponent(slug)}/run`,
      { input: args || {}, query: extractQuery(args) },
      { timeoutMs, mcpTag: `${clientTag}:skill:${slug}` });
    if (!r.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Skill ${slug} failed (HTTP ${r.status}): ${r.json?.error || r.text || "unknown"}` }],
      };
    }
    const out = r.json?.output ?? r.json?.result ?? r.json ?? {};
    return {
      content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }],
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: `Unknown MCP kind: ${kind}` }],
  };
}
