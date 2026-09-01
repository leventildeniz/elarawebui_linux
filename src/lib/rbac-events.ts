import { useEffect, useState } from "react";

/**
 * RBAC event spine.
 *
 * Every grant, revoke, role mutation and enforcement flip publishes here so the
 * audit journal and the live debug console can observe access-control changes
 * exactly like orchestrator-bridge deny mutations.
 */

export type RbacAction =
  | "rbac.grant"
  | "rbac.revoke"
  | "rbac.role.create"
  | "rbac.role.delete"
  | "rbac.role.update"
  | "rbac.action.grant"
  | "rbac.action.revoke"
  | "rbac.enforce"
  | "rbac.preview"
  | "rbac.denied";

export type RbacEvent = {
  id: string;
  at: number;
  action: RbacAction;
  role: string;
  target: string;
  actor: string;
  detail: string;
};

const KEY = "elara.rbac.events.v1";
const EVT = "elara:rbac-event";
const LIMIT = 500;

let seq = 0;

function read(): RbacEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RbacEvent[]) : [];
  } catch {
    return [];
  }
}

function write(events: RbacEvent[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(events.slice(0, LIMIT)));
  } catch {
    /* quota — memory only */
  }
}

export function listRbacEvents(): RbacEvent[] {
  return read();
}

export function emitRbac(input: {
  action: RbacAction;
  role: string;
  target: string;
  detail?: string;
  actor?: string;
}): RbacEvent {
  const event: RbacEvent = {
    id: `rbc_${Date.now().toString(36)}_${(seq++).toString(36)}`,
    at: Date.now(),
    action: input.action,
    role: input.role,
    target: input.target,
    actor: input.actor || "levent@elara",
    detail: input.detail || `${input.action} · ${input.role} → ${input.target}`,
  };
  if (typeof window !== "undefined") {
    write([event, ...read()]);
    window.dispatchEvent(new CustomEvent<RbacEvent>(EVT, { detail: event }));
  }
  return event;
}

export function onRbacEvent(fn: (e: RbacEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => fn((e as CustomEvent<RbacEvent>).detail);
  window.addEventListener(EVT, handler as EventListener);
  return () => window.removeEventListener(EVT, handler as EventListener);
}

export function useRbacEvents() {
  const [events, setEvents] = useState<RbacEvent[]>([]);
  useEffect(() => {
    setEvents(read());
    return onRbacEvent((e) => setEvents((prev) => [e, ...prev].slice(0, LIMIT)));
  }, []);
  return events;
}
