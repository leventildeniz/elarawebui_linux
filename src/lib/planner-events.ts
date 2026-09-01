import { useEffect, useState } from "react";

/**
 * Planner event spine.
 *
 * Every planner turn — shadow or active — publishes here. The audit journal
 * folds these into the `agents` stream so shadow telemetry is not trapped
 * inside the Planner page: an operator can prove what the planner *would*
 * have done, and which tools its scope blocked.
 */

export type PlannerEventAction =
  "planner.plan" | "planner.execute" | "planner.blocked" | "planner.scope";

export type PlannerEvent = {
  id: string;
  at: number;
  action: PlannerEventAction;
  planner: string;
  plannerName: string;
  /** which capability plane the planner governs */
  kind?: "tool" | "skill" | "mcp";
  mode: "shadow" | "active";
  tools: string[];
  blocked: string[];
  grounded: boolean;
  question: string;
  actor: string;
};

const KEY = "elara.planner.events.v1";
const EVT = "elara:planner-event";
const LIMIT = 500;

function read(): PlannerEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlannerEvent[]) : [];
  } catch {
    return [];
  }
}

export function listPlannerEvents(): PlannerEvent[] {
  return read();
}

export function emitPlannerEvent(e: Omit<PlannerEvent, "id" | "at">) {
  if (typeof window === "undefined") return;
  const event: PlannerEvent = {
    ...e,
    id: `pev.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify([event, ...read()].slice(0, LIMIT)));
  } catch {
    /* quota — event still broadcast in-memory */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: event }));
}

export function onPlannerEvent(fn: (e: PlannerEvent) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<PlannerEvent>).detail);
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}

export function usePlannerEvents() {
  const [events, setEvents] = useState<PlannerEvent[]>([]);
  useEffect(() => {
    setEvents(read());
    return onPlannerEvent((e) => setEvents((prev) => [e, ...prev].slice(0, LIMIT)));
  }, []);
  return events;
}
