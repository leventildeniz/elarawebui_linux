// local-server/lib/mcp/client.mjs
// Outbound MCP client: connects to remote MCP servers, probes their tool
// catalog, and executes tool calls. Short-lived per request (open → call → close).
// No SDK dependency — speaks JSON-RPC 2.0 over Streamable HTTP directly.
//
// DB layer + agent-manifest injection helpers.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const REQ_TIMEOUT_MS = 15_000;

function slugify(name) {
  return String(name || "server")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "server";
}

function jsonRpc(method, params, id = null) {
  return { jsonrpc: "2.0", id: id ?? Math.floor(Math.random() * 1e9), method, params };
}

// -------- Transport ----------------------------------------------------------

async function mcpFetch(server, rpcReq) {
  const headers = {
    "content-type": "application/json",
    // MCP Streamable HTTP spec: servers reject POST without this Accept header.
    accept: "application/json, text/event-stream",
  };
  const auth = server.auth_config || {};
  if (server.auth_type === "bearer" && auth.token) {
    headers.authorization = `Bearer ${auth.token}`;
  } else if (server.auth_type === "oauth" && auth.access_token) {
    headers.authorization = `Bearer ${auth.access_token}`;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(rpcReq),
      signal: ctl.signal,
      redirect: "error",
    });
    const ct = resp.headers.get("content-type") || "";
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, status: resp.status, reason: "unauthenticated", body: await resp.text().catch(() => "") };
    }
    if (!resp.ok) {
      return { ok: false, status: resp.status, reason: "http_error", body: await resp.text().catch(() => "") };
    }
    if (ct.includes("text/event-stream")) {
      // Parse SSE; take first data: JSON message.
      const raw = await resp.text();
      const line = raw.split(/\r?\n/).find((l) => l.startsWith("data:"));
      if (!line) return { ok: false, status: 502, reason: "empty_sse" };
      try { return { ok: true, data: JSON.parse(line.slice(5).trim()) }; }
      catch (e) { return { ok: false, status: 502, reason: "bad_sse_json", body: e.message }; }
    }
    const data = await resp.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, status: 0, reason: e.name === "AbortError" ? "timeout" : "network", body: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// -------- Public API ---------------------------------------------------------

async function mcpExecute(server, sessionFn) {
  if (server.transport === "stdio") {
    return new Promise((resolve) => {
      const cmd = server.url || "";
      if (!cmd) return resolve({ ok: false, reason: "no_command" });

      const child = spawn(cmd, [], {
        shell: true,
        windowsHide: true,
        env: { ...process.env }
      });

      const rl = createInterface({ input: child.stdout });
      const pending = new Map();
      let isFinished = false;
      let idCounter = 1;

      const cleanup = () => {
        if (isFinished) return;
        isFinished = true;
        rl.close();
        child.kill();
        for (const [id, [_, rej]] of pending) {
          rej(new Error("process closed"));
        }
        pending.clear();
      };

      child.on("error", (err) => {
        if (!isFinished) resolve({ ok: false, reason: "spawn_error", body: err.message });
        cleanup();
      });

      child.on("exit", (code) => {
        if (!isFinished) resolve({ ok: false, reason: "exit", body: `Exited with code ${code}` });
        cleanup();
      });

      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          if (msg.id && pending.has(msg.id)) {
            const [res, _] = pending.get(msg.id);
            pending.delete(msg.id);
            res({ ok: true, data: msg });
          }
        } catch (e) {
          // ignore non-json stdout
        }
      });

      const sendRpc = (method, params, isNotif = false) => {
        if (isNotif) {
          try { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); } catch(e){}
          return Promise.resolve({ ok: true });
        }
        return new Promise((res, rej) => {
          const id = idCounter++;
          pending.set(id, [res, rej]);
          try {
            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
          } catch(e) {
            return rej(e);
          }
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              rej(new Error("timeout"));
            }
          }, REQ_TIMEOUT_MS);
        });
      };

      sessionFn(sendRpc)
        .then((result) => {
          if (!isFinished) resolve(result);
          cleanup();
        })
        .catch((err) => {
          if (!isFinished) resolve({ ok: false, reason: "session_error", body: err.message });
          cleanup();
        });
    });
  } else {
    // HTTP transport fallback
    const sendRpc = async (method, params, isNotif = false) => {
      if (isNotif) return { ok: true };
      return await mcpFetch(server, jsonRpc(method, params));
    };
    return await sessionFn(sendRpc).catch(e => ({ ok: false, reason: "session_error", body: e.message }));
  }
}

export async function probeServer(server) {
  return await mcpExecute(server, async (sendRpc) => {
    // 1) initialize
    const init = await sendRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "elara-mcp-client", version: "0.1.0" },
    });
    if (!init.ok) return { ok: false, ...init };
    if (init.data?.error) return { ok: false, reason: "init_failed", body: init.data.error };

    await sendRpc("notifications/initialized", {}, true);

    // 2) tools/list
    const tools = await sendRpc("tools/list", {});
    if (!tools.ok) return { ok: false, ...tools };
    if (tools.data?.error) return { ok: false, reason: "tools_list_failed", body: tools.data.error };

    const list = tools.data?.result?.tools;
    if (!Array.isArray(list)) return { ok: false, reason: "no_tools_field", body: JSON.stringify(tools.data).slice(0, 500) };
    return { ok: true, tools: list, serverInfo: init.data?.result?.serverInfo || null };
  });
}

export async function callRemoteTool(server, toolName, args) {
  return await mcpExecute(server, async (sendRpc) => {
    // 1) initialize
    const init = await sendRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "elara-mcp-client", version: "0.1.0" },
    });
    if (!init.ok) return { ok: false, ...init };
    if (init.data?.error) return { ok: false, reason: "init_failed", body: init.data.error };

    await sendRpc("notifications/initialized", {}, true);

    // 2) tools/call
    const resp = await sendRpc("tools/call", { name: toolName, arguments: args || {} });
    if (!resp.ok) return { ok: false, ...resp };
    if (resp.data?.error) return { ok: false, reason: "rpc_error", error: resp.data.error };
    return { ok: true, result: resp.data?.result || null };
  });
}

// -------- DB helpers ---------------------------------------------------------

export async function listServers(pool) {
  const { rows } = await pool.query(
    `SELECT id, name, slug, url, transport, auth_type, auth_config, enabled, auto_inject,
            tools_cache, last_probe_at, last_status, last_error, created_at, updated_at
       FROM mcp_client_servers ORDER BY created_at ASC`,
  );
  return rows;
}

export async function getServer(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM mcp_client_servers WHERE id=$1`, [id]);
  return rows[0] || null;
}

export async function getServerBySlug(pool, slug) {
  const { rows } = await pool.query(`SELECT * FROM mcp_client_servers WHERE slug=$1`, [slug]);
  return rows[0] || null;
}

async function uniqueSlug(pool, base) {
  let candidate = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await getServerBySlug(pool, candidate);
    if (!existing) return candidate;
    candidate = `${base}-${n++}`;
  }
}

export async function createServer(pool, { name, url, transport = "http", auth_type = "none", auth_config = {}, auto_inject = false, owner_id = null, owner_name = null, visibility = 'private', shared_with = [] }) {
  if (!name) throw new Error("name required");
  if (transport !== "stdio" && (!url || !/^https?:\/\//i.test(url))) throw new Error("valid http(s) url required");
  if (transport === "stdio" && !url) throw new Error("command required for stdio transport");
  if (!["http", "sse", "stdio"].includes(transport)) throw new Error(`invalid transport: ${transport}`);
  if (!["none", "bearer", "oauth"].includes(auth_type)) throw new Error(`invalid auth_type: ${auth_type}`);
  const slug = await uniqueSlug(pool, slugify(name));
  const { rows } = await pool.query(
    `INSERT INTO mcp_client_servers (name, slug, url, transport, auth_type, auth_config, auto_inject, owner_id, owner_name, visibility, shared_with)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
    [name, slug, url, transport, auth_type, auth_config, !!auto_inject, owner_id, owner_name, visibility, JSON.stringify(shared_with)],
  );
  return rows[0];
}

export async function updateServer(pool, id, patch = {}) {
  const cur = await getServer(pool, id);
  if (!cur) throw new Error("server not found");
  const merged = {
    name: patch.name ?? cur.name,
    url: patch.url ?? cur.url,
    transport: patch.transport ?? cur.transport,
    auth_type: patch.auth_type ?? cur.auth_type,
    auth_config: patch.auth_config ?? cur.auth_config,
    enabled: patch.enabled ?? cur.enabled,
    auto_inject: patch.auto_inject ?? cur.auto_inject,
    visibility: patch.visibility ?? cur.visibility ?? 'private',
    shared_with: patch.sharedWith ?? patch.shared_with ?? cur.shared_with ?? [],
  };
  if (!["http", "sse", "stdio"].includes(merged.transport)) throw new Error(`invalid transport`);
  if (!["none", "bearer", "oauth"].includes(merged.auth_type)) throw new Error(`invalid auth_type`);
  const { rows } = await pool.query(
    `UPDATE mcp_client_servers SET name=$1, url=$2, transport=$3, auth_type=$4, auth_config=$5,
       enabled=$6, auto_inject=$7, visibility=$8, shared_with=$9::jsonb, updated_at=now() WHERE id=$10 RETURNING *`,
    [merged.name, merged.url, merged.transport, merged.auth_type, merged.auth_config,
     merged.enabled, merged.auto_inject, merged.visibility, JSON.stringify(merged.shared_with), id],
  );
  return rows[0];
}

export async function deleteServer(pool, id) {
  await pool.query(`DELETE FROM mcp_client_servers WHERE id=$1`, [id]);
}

export async function recordProbe(pool, id, result) {
  const status = result.ok ? "ready" : (result.reason === "unauthenticated" ? "unauthenticated" : "error");
  const err = result.ok ? null : (result.body || result.reason || "unknown");
  const tools = result.ok ? result.tools : null;
  await pool.query(
    `UPDATE mcp_client_servers
       SET last_probe_at=now(), last_status=$1, last_error=$2
       ${tools ? ", tools_cache=$3" : ""}
       WHERE id=${tools ? "$4" : "$3"}`,
    tools ? [status, err, JSON.stringify(tools), id] : [status, err, id],
  );
}

// -------- Agent manifest bridge ---------------------------------------------
// Returns list of "mcp:<slug>.<toolName>" tool descriptors for enabled servers
// with auto_inject=true. Called by agent-bridge when building ELARA_AGENT_TOOLS.

export async function collectInjectedTools(pool) {
  const { rows } = await pool.query(
    `SELECT slug, name, tools_cache FROM mcp_client_servers
      WHERE enabled=true AND auto_inject=true AND last_status='ready'`,
  );
  const out = [];
  for (const row of rows) {
    const tools = Array.isArray(row.tools_cache) ? row.tools_cache : [];
    for (const t of tools) {
      if (!t?.name) continue;
      out.push({
        name: `mcp:${row.slug}.${t.name}`,
        description: t.description || `Remote MCP tool from ${row.name}`,
        inputSchema: t.inputSchema || null,
        _mcpServerSlug: row.slug,
        _mcpToolName: t.name,
      });
    }
  }
  return out;
}

// Route "mcp:<slug>.<tool>" call to the right server.
export async function dispatchInjectedCall(pool, prefixedName, args) {
  const m = String(prefixedName || "").match(/^mcp:([^.]+)\.(.+)$/);
  if (!m) return { ok: false, reason: "not_mcp_prefixed" };
  const [, slug, toolName] = m;
  const server = await getServerBySlug(pool, slug);
  if (!server) return { ok: false, reason: "server_not_found", slug };
  if (!server.enabled) return { ok: false, reason: "server_disabled", slug };
  return callRemoteTool(server, toolName, args);
}
