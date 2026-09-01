import type { Mention } from "@/components/sovereign/composer";
import type { WireMessage } from "@/lib/attachment-encode";

/**
 * Multi-turn orchestration transport.
 *
 * The backend streams a single SSE channel from `POST /api/chat/orchestrate`.
 * Everything the chat surface renders while the agent works — capability
 * preparation, per-tool status, agent loop iterations, human approval gates —
 * arrives as frames on that channel. This module owns the wire contract; the
 * UI only consumes the normalized `OrchestrateEvent` union.
 */

/** Capability selection sent with the turn (composer `/tool`, `!skill`, `#mcp`). */
export type Capabilities = {
  tools: string[];
  skills: string[];
  mcp: string[];
};

/** Composer mentions → the capability envelope the orchestrator expects. */
export function buildCapabilities(mentions: Mention[]): Capabilities {
  const tools = new Set<string>();
  const skills = new Set<string>();
  const mcp = new Set<string>();
  for (const m of mentions) {
    if (m.kind === "tool") tools.add(m.id);
    else if (m.kind === "mcp") mcp.add(m.id.startsWith("mcp.") ? m.id : `mcp.${m.id}`);
    else if (m.kind === "skill") skills.add(m.id);
  }
  return { tools: [...tools], skills: [...skills], mcp: [...mcp] };
}

export const hasCapabilities = (c: Capabilities) => c.tools.length > 0 || c.skills.length > 0 || c.mcp.length > 0;

/* ------------------------------------------------------------------ events */

export type ToolStatus = "pending" | "running" | "completed" | "failed" | "denied";

export type OrchestrateEvent =
  /** LLM decided to run tools — capabilities are being prepared. */
  | { kind: "tool_execution"; tools: { name: string }[] }
  /** Per-tool lifecycle tick. */
  | { kind: "tool_status"; name: string; status: ToolStatus; detail?: string; ms?: number }
  /** Tool results handed back to the model; a new reasoning turn begins. */
  | { kind: "agent_loop"; iteration: number }
  /** High-risk invocation blocked — the stream halts until a human decides. */
  | {
      kind: "approval_required";
      invocationId: string;
      toolName: string;
      reason: string;
    }
  | { kind: "approval_required"; invocationId: string; toolName: string; reason: string }
  /** Assistant reasoning/think delta. */
  | { kind: "think"; text: string }
  /** Assistant answer delta. */
  | { kind: "out"; text: string }
  /** Telemetry emitted at the end. */
  | { kind: "telemetry"; latency: { ttftMs: number; totalMs: number; tokensOut: number; modelOut?: string } }
  | { kind: "forge_plan"; plan: any }
  | { kind: "error"; message: string }
  | { kind: "done" };

/** Normalize a raw SSE `data:` payload into an `OrchestrateEvent`. */
export function parseOrchestrateFrame(raw: string): OrchestrateEvent | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const phase = typeof data["phase"] === "string" ? (data["phase"] as string) : "";
  const type = typeof data["type"] === "string" ? (data["type"] as string) : "";

  if (data["forge_plan"]) {
    return { kind: "forge_plan", plan: data["forge_plan"] };
  }

  if (phase === "tool_execution") {
    const list = Array.isArray(data["tools"]) ? (data["tools"] as { name?: string }[]) : [];
    return { kind: "tool_execution", tools: list.map((t) => ({ name: String(t?.name ?? "tool") })) };
  }
  if (type === "tool_status") {
    return {
      kind: "tool_status",
      name: String(data["name"] ?? "tool"),
      status: (data["status"] as ToolStatus) ?? "running",
      ...(typeof data["detail"] === "string" ? { detail: data["detail"] } : {}),
      ...(typeof data["ms"] === "number" ? { ms: data["ms"] } : {}),
    };
  }
  if (phase === "agent_loop") {
    return { kind: "agent_loop", iteration: Number(data["iteration"] ?? 1) };
  }
  if (phase === "approval_required") {
    return {
      kind: "approval_required",
      invocationId: String(data["invocationId"] ?? ""),
      toolName: String(data["toolName"] ?? "tool"),
      reason: String(data["reason"] ?? "This invocation requires human approval."),
    };
  }
  if (type === "think") {
    return { kind: "think", text: String(data["delta"] ?? data["text"] ?? "") };
  }
  if (type === "out") {
    return { kind: "out", text: String(data["text"] ?? data["delta"] ?? "") };
  }
  if (data["latency"]) {
    return { kind: "telemetry", latency: data["latency"] as any };
  }
  if (type === "error") return { kind: "error", message: String(data["message"] ?? "stream error") };
  if (type === "done" || phase === "done") return { kind: "done" };
  return null;
}

/* ------------------------------------------------------- activity view model */

export type ToolRun = {
  name: string;
  status: ToolStatus;
  detail?: string;
  ms?: number;
  startedAt: number;
};

export type ToolActivity = {
  /** `prepare` → spinner only · `running` → per-tool rows · `loop` → model re-reading */
  phase: "prepare" | "running" | "loop" | "done";
  iteration: number;
  runs: ToolRun[];
  approval?: { invocationId: string; toolName: string; reason: string; decided?: "approve" | "reject" };
};

export const emptyActivity = (): ToolActivity => ({ phase: "prepare", iteration: 1, runs: [] });

/** Fold one event into the activity block rendered inside the agent bubble. */
export function reduceActivity(a: ToolActivity, e: OrchestrateEvent): ToolActivity {
  switch (e.kind) {
    case "tool_execution":
      return {
        ...a,
        phase: "prepare",
        runs: e.tools.map((t) => ({ name: t.name, status: "pending" as const, startedAt: Date.now() })),
      };
    case "tool_status": {
      const runs = a.runs.some((r) => r.name === e.name)
        ? a.runs.map((r) =>
            r.name === e.name
              ? {
                  ...r,
                  status: e.status,
                  ...(e.detail ? { detail: e.detail } : {}),
                  ...(e.status === "running"
                    ? {}
                    : { ms: e.ms ?? Date.now() - r.startedAt }),
                }
              : r,
          )
        : [...a.runs, { name: e.name, status: e.status, startedAt: Date.now() }];
      return { ...a, phase: "running", runs };
    }
    case "agent_loop":
      return { ...a, phase: "loop", iteration: e.iteration };
    case "approval_required":
      return {
        ...a,
        phase: "running",
        approval: {
          invocationId: e.invocationId,
          toolName: e.toolName,
          reason: e.reason,
        },
      };
    case "done":
      return { ...a, phase: "done" };
    default:
      return a;
  }
}

/* ------------------------------------------------------------------ transport */

export type OrchestrateRequest = {
  message: string;
  messages?: WireMessage[];
  threadId?: string;
  model?: string;
  capabilities: Capabilities;
  context?: string;
  agentId?: string;
  resumeInvocationId?: string;
};

/**
 * POST the turn and read the SSE body frame by frame.
 * Fully client-safe: the endpoint lives on the orchestration backend.
 */
export async function streamOrchestrate(
  body: OrchestrateRequest,
  onEvent: (e: OrchestrateEvent) => void,
  signal?: AbortSignal,
  endpoint = "/api/chat/orchestrate",
): Promise<void> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    onEvent({ kind: "error", message: `orchestrate failed — ${res.status}` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const ev = parseOrchestrateFrame(payload);
        if (ev) onEvent(ev);
      }
    }
  }
  onEvent({ kind: "done" });
}

/**
 * Local driver used until the orchestrator is wired in. Emits the exact frame
 * sequence the backend contract specifies so the UI path is identical.
 */
export function simulateOrchestrate(
  capabilities: Capabilities,
  onEvent: (e: OrchestrateEvent) => void,
  opts: { approvalFor?: string } = {},
): () => void {
  const names = [...capabilities.tools, ...capabilities.skills];
  if (!names.length) return () => {};
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

  let t = 260;
  at(t, () => onEvent({ kind: "tool_execution", tools: names.map((name) => ({ name })) }));
  names.forEach((name) => {
    t += 420;
    const gated = opts.approvalFor === name;
    at(t, () => onEvent({ kind: "tool_status", name, status: "running" }));
    t += 900;
    at(t, () =>
      gated
        ? onEvent({
            kind: "approval_required",
            invocationId: `inv_${Math.random().toString(16).slice(2, 10)}`,
            toolName: name,
            reason: "This tool is high risk and requires human approval before it can run.",
          })
        : onEvent({ kind: "tool_status", name, status: "completed" }),
    );
  });
  if (!opts.approvalFor) {
    t += 420;
    at(t, () => onEvent({ kind: "agent_loop", iteration: 2 }));
  }
  return () => timers.forEach(clearTimeout);
}
