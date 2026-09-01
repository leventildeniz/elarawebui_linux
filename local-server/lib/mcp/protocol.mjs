// local-server/lib/mcp/protocol.mjs
// Minimal MCP Streamable HTTP JSON-RPC 2.0 handler.
// Implements: initialize, tools/list, tools/call, ping.
// Spec: https://modelcontextprotocol.io/specification/2025-06-18

import { buildMcpToolCatalog, parseMcpToolName } from "./catalog.mjs";
import { dispatchMcpCall } from "./dispatch.mjs";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = { name: "elara-mcp", version: "1.0.0" };

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error: err };
}

/**
 * Handle a single JSON-RPC request.
 * @returns {Promise<{response: object|null, method: string, toolName?: string}>}
 *   response=null → notification (no response)
 */
export async function handleMcpRpc({ pool, port, namespace, req, clientTag = "mcp" }) {
  const id = req?.id ?? null;
  const method = String(req?.method || "");

  // Notifications (no response body). MCP spec: initialized notification.
  if (id === undefined || id === null) {
    if (method === "notifications/initialized" || method === "initialized") {
      return { response: null, method };
    }
    // Unknown notification — swallow.
    return { response: null, method };
  }

  try {
    switch (method) {
      case "initialize": {
        return {
          method,
          response: rpcResult(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: MCP_SERVER_INFO,
            instructions:
              `Elara MCP server. Namespace: "${namespace}". ` +
              `Tools are named "${namespace}.<kind>.<slug>" where kind is agent, tool, or skill. ` +
              `Call tools/list to discover; each tool exposes an inputSchema.`,
          }),
        };
      }

      case "ping": {
        return { method, response: rpcResult(id, {}) };
      }

      case "tools/list": {
        const catalog = await buildMcpToolCatalog(pool, namespace);
        const tools = catalog.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return { method, response: rpcResult(id, { tools }) };
      }

      case "tools/call": {
        const { name, arguments: args } = req.params || {};
        if (!name) return { method, response: rpcError(id, -32602, "tools/call requires 'name'") };
        const parsed = parseMcpToolName(name);
        if (!parsed) {
          return {
            method, toolName: name,
            response: rpcError(id, -32602, `Invalid tool name: ${name}`),
          };
        }
        // Ensure the tool is currently enabled (may have been disabled since list).
        const { rows } = await pool.query(
          `SELECT enabled FROM mcp_exposures WHERE kind=$1 AND slug=$2`,
          [parsed.kind, parsed.slug],
        );
        if (!rows.length || rows[0].enabled === false) {
          return {
            method, toolName: name,
            response: rpcError(id, -32601, `Tool ${name} is not exposed`),
          };
        }
        const result = await dispatchMcpCall({
          pool, port,
          kind: parsed.kind, slug: parsed.slug,
          args: args || {},
          clientTag,
        });
        return { method, toolName: name, response: rpcResult(id, result) };
      }

      case "resources/list":
      case "prompts/list":
        return { method, response: rpcResult(id, { [method.split("/")[0]]: [] }) };

      default:
        return { method, response: rpcError(id, -32601, `Method not found: ${method}`) };
    }
  } catch (e) {
    return {
      method,
      response: rpcError(id, -32000, e?.message || "internal error"),
    };
  }
}
