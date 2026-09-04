/**
 * Scheduled report deliveries — PostgreSQL backed.
 *
 * A schedule binds a report template + period (+ optional operator) to a
 * cadence and a delivery channel (email, storage / warehouse, or manual download).
 * Data persists in PostgreSQL `schedules` and `schedule_deliveries` tables.
 */

import { useCallback, useEffect, useState } from "react";
import { scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
import type { Period } from "@/lib/report-store";
import type { TemplateId } from "@/lib/report-templates";
import { fetchApi } from "@/lib/api";

export type Cadence = "hourly" | "daily" | "weekly" | "monthly" | "once";
export type DeliveryChannel = "email" | "download" | "storage";
export type Format = "PDF" | "CSV" | "JSON";

export type Schedule = {
  id: string;
  name: string;
  templateId: TemplateId;
  period: Period;
  /** explicit window: when both are set they override `period` */
  rangeFrom?: string;
  rangeTo?: string;
  /** limit operator reports to the top N rows (0 = everyone) */
  topN?: number;
  /** ranking key for operator reports */
  sortBy?: "tokens" | "cost" | "runs" | "name";
  /** operator id for per-user templates */
  userId?: string;
  format: Format;
  delivery: DeliveryChannel;
  /** mail recipients or destination URI depending on channel */
  recipients: string;
  destination: string;
  cadence: Cadence;
  /** HH:MM local time */
  time: string;
  /** 0-6 for weekly */
  weekday: number;
  /** 1-28 for monthly */
  dayOfMonth: number;
  enabled: boolean;
  /** ISO of next planned fire */
  nextRun: string;
  lastRun: string;
  status: "healthy" | "warning" | "failed" | "idle";
} & Owned;

export type Delivery = {
  id: string;
  scheduleId: string;
  name: string;
  at: string;
  channel: DeliveryChannel;
  format: Format;
  target: string;
  outcome: "delivered" | "downloaded" | "failed";
  detail: string;
};

const EVT = "elara:schedules";
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function nextRunFrom(s: Omit<Schedule, "nextRun">, from = new Date()): string {
  const [hh, mm] = s.time.split(":").map((n) => Number(n) || 0);
  const d = new Date(from);
  d.setSeconds(0, 0);

  if (s.cadence === "hourly") {
    d.setMinutes(mm ?? 0);
    if (d <= from) d.setHours(d.getHours() + 1);
    return d.toISOString();
  }

  d.setHours(hh ?? 7, mm ?? 0);
  if (s.cadence === "daily" || s.cadence === "once") {
    if (d <= from) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (s.cadence === "weekly") {
    const delta = ((s.weekday ?? 1) - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + delta);
    if (d <= from) d.setDate(d.getDate() + 7);
    return d.toISOString();
  }
  d.setDate(Math.min(28, Math.max(1, s.dayOfMonth ?? 1)));
  if (d <= from) d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

export function cadenceLabel(s: Schedule) {
  if (s.cadence === "hourly") return `Hourly · :${s.time?.split(":")[1] || "00"}`;
  if (s.cadence === "daily") return `Daily · ${s.time || "08:00"}`;
  if (s.cadence === "weekly") return `Weekly · ${WEEK[s.weekday ?? 1]} ${s.time || "08:00"}`;
  if (s.cadence === "monthly") return `Monthly · day ${s.dayOfMonth ?? 1} ${s.time || "08:00"}`;
  return `Once · ${s.time || "08:00"}`;
}

export function relative(iso: string) {
  if (!iso) return "never";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  const unit = m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function emptySchedule(): Schedule {
  const base: Omit<Schedule, "nextRun"> = {
    id: `sch.${Date.now().toString(36)}`,
    name: "New delivery",
    templateId: "executive",
    period: "30d",
    topN: 0,
    sortBy: "tokens",
    format: "PDF",
    delivery: "email",
    recipients: "",
    destination: "mail://",
    cadence: "daily",
    time: "08:00",
    weekday: 1,
    dayOfMonth: 1,
    enabled: true,
    lastRun: "",
    status: "idle",
  };
  return stampOwner({ ...base, nextRun: nextRunFrom(base) }, "private");
}

// ---------------------------------------------------------------------------
// Async Database Operations
// ---------------------------------------------------------------------------

export async function fetchSchedules(): Promise<Schedule[]> {
  try {
    const list = await fetchApi("/reporting/schedules");
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error("[fetchSchedules] Failed to load schedules from PostgreSQL:", err);
    return [];
  }
}

export async function fetchDeliveries(): Promise<Delivery[]> {
  try {
    const list = await fetchApi("/reporting/deliveries");
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error("[fetchDeliveries] Failed to load deliveries from PostgreSQL:", err);
    return [];
  }
}

export async function saveSchedule(schedule: Schedule): Promise<boolean> {
  try {
    await fetchApi("/reporting/schedules", {
      method: "POST",
      body: JSON.stringify(schedule),
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(EVT));
    }
    return true;
  } catch (err) {
    console.error("[saveSchedule] Failed to save schedule:", err);
    return false;
  }
}

export async function deleteSchedule(id: string): Promise<boolean> {
  try {
    await fetchApi(`/reporting/schedules/${id}`, {
      method: "DELETE",
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(EVT));
    }
    return true;
  } catch (err) {
    console.error("[deleteSchedule] Failed to delete schedule:", err);
    return false;
  }
}

export async function logDelivery(d: Omit<Delivery, "id">) {
  try {
    await fetchApi("/reporting/deliveries", {
      method: "POST",
      body: JSON.stringify(d),
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(EVT));
    }
  } catch (err) {
    console.warn("[logDelivery] Failed to record delivery:", err);
  }
}

export function useSchedules() {
  const ctx = useOwnerCtx();
  const [list, setList] = useState<Schedule[]>([]);
  const [log, setLog] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);

  const sync = useCallback(async () => {
    try {
      const [schedules, deliveries] = await Promise.all([
        fetchSchedules(),
        fetchDeliveries(),
      ]);
      setList(schedules);
      setLog(deliveries);
      setLoading(false);
    } catch (err) {
      console.error("[useSchedules] Sync failed:", err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    sync();
    if (typeof window === "undefined") return;
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [sync]);

  const visible = scopeOwned(list, ctx);
  return { list: visible, allSchedules: list, ctx, log, setList, loading, refresh: sync };
}
