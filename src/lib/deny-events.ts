import { useCallback, useEffect, useState } from "react";

/**
 * Deny-list event spine.
 *
 * The Orchestrator Bridge deny lists (agents / tools / skills / MCP clients)
 * publish every mutation here. The audit journal folds these into its stream
 * and the live debug console renders them on the `deny` channel, so a policy
 * change is observable in both governance surfaces.
 */

export type DenyCategory = "agent" | "tool" | "skill" | "mcp" | "workflow";
export type DenyAction =
  | "deny.add"
  | "deny.remove"
  | "deny.clear"
  | "signature.enabled"
  | "signature.disabled"
  | "signature.signed"
  | "signature.verified"
  | "signature.warned"
  | "signature.denied";

export type DenyEvent = {
  id: string;
  at: number;
  category: DenyCategory;
  action: DenyAction;
  target: string;
  label: string;
  actor: string;
  detail: string;
};

const KEY = "elara.deny.events.v1";
const EVT = "elara:deny-event";
const LIMIT = 500;

let seq = 0;

function read(): DenyEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DenyEvent[]) : [];
  } catch {
    return [];
  }
}

function write(events: DenyEvent[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(events.slice(0, LIMIT)));
  } catch {
    /* quota — keep in-memory only */
  }
}

export function listDenyEvents(): DenyEvent[] {
  return read();
}

function resolveCurrentActor(): string {
  if (typeof window === "undefined") return "admin";
  try {
    const userRaw = window.localStorage.getItem("sovereign.user");
    if (userRaw) {
      const u = JSON.parse(userRaw);
      if (u.username) return u.username;
      if (u.name) return u.name;
    }
    const op = window.sessionStorage.getItem("sovereign.operator");
    if (op) return op;
  } catch {
    /* ignore */
  }
  return "admin";
}

export function emitDeny(input: {
  category: DenyCategory;
  action: DenyAction;
  target: string;
  label?: string;
  actor?: string;
  detail?: string;
}): DenyEvent {
  const event: DenyEvent = {
    id: `dny_${Date.now().toString(36)}_${(seq++).toString(36)}`,
    at: Date.now(),
    category: input.category,
    action: input.action,
    target: input.target,
    label: input.label || input.target,
    actor: input.actor || resolveCurrentActor(),
    detail:
      input.detail ||
      (input.action === "deny.add"
        ? `${input.category} "${input.target}" blocked at the orchestrator bridge`
        : input.action === "deny.remove"
          ? `${input.category} "${input.target}" restored to permitted`
          : input.action === "deny.clear"
            ? `${input.category} deny list cleared · category fully permitted`
            : `${input.category} ${input.action} · ${input.target}`),
  };
  if (typeof window !== "undefined") {
    write([event, ...read()]);
    window.dispatchEvent(new CustomEvent<DenyEvent>(EVT, { detail: event }));
  }
  return event;
}

/** Subscribe to newly emitted deny events. */
export function onDenyEvent(fn: (e: DenyEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => fn((e as CustomEvent<DenyEvent>).detail);
  window.addEventListener(EVT, handler as EventListener);
  return () => window.removeEventListener(EVT, handler as EventListener);
}

export function clearDenyEvents() {
  if (typeof window === "undefined") return;
  write([]);
  window.dispatchEvent(new Event(`${EVT}:purge`));
}

export function useDenyEvents() {
  const [events, setEvents] = useState<DenyEvent[]>([]);
  useEffect(() => {
    setEvents(read());
    const off = onDenyEvent((e) => setEvents((prev) => [e, ...prev].slice(0, LIMIT)));
    const onPurge = () => setEvents([]);
    window.addEventListener(`${EVT}:purge`, onPurge);
    return () => {
      off();
      window.removeEventListener(`${EVT}:purge`, onPurge);
    };
  }, []);
  const purge = useCallback(() => clearDenyEvents(), []);
  return { events, purge };
}
