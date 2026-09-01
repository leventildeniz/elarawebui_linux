/**
 * Scheduled report deliveries.
 *
 * A schedule binds a report template + period (+ optional operator) to a
 * cadence and a delivery channel (mail group, object storage / warehouse, or
 * an immediate local download). Definitions and the delivery log persist in
 * local storage; due schedules fire from a single ticker in the UI.
 */

import { useEffect, useState } from "react";
import { scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
import type { Period } from "@/lib/report-store";
import type { TemplateId } from "@/lib/report-templates";

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

const KEY = "elara.report.schedules.v1";
const LOG_KEY = "elara.report.deliveries.v1";

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
    const delta = (s.weekday - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + delta);
    if (d <= from) d.setDate(d.getDate() + 7);
    return d.toISOString();
  }
  d.setDate(Math.min(28, Math.max(1, s.dayOfMonth)));
  if (d <= from) d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

export function cadenceLabel(s: Schedule) {
  if (s.cadence === "hourly") return `Hourly · :${s.time.split(":")[1]}`;
  if (s.cadence === "daily") return `Daily · ${s.time}`;
  if (s.cadence === "weekly") return `Weekly · ${WEEK[s.weekday]} ${s.time}`;
  if (s.cadence === "monthly") return `Monthly · day ${s.dayOfMonth} ${s.time}`;
  return `Once · ${s.time}`;
}

export function relative(iso: string) {
  if (!iso) return "never";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  const unit = m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

function seed(): Schedule[] {
  const base: Omit<Schedule, "nextRun">[] = [
    {
      id: "sch.exec",
      name: "Executive rollup",
      templateId: "executive",
      period: "30d",
      format: "PDF",
      delivery: "email",
      recipients: "leadership@sovereign.studio, board@sovereign.studio",
      destination: "mail://leadership",
      cadence: "weekly",
      time: "07:00",
      weekday: 1,
      dayOfMonth: 1,
      enabled: true,
      lastRun: "",
      status: "healthy",
    },
    {
      id: "sch.ops",
      name: "Operator activity & cost",
      templateId: "operator-roster",
      period: "7d",
      format: "PDF",
      delivery: "email",
      recipients: "finops@sovereign.studio",
      destination: "mail://finops",
      cadence: "daily",
      time: "06:30",
      weekday: 1,
      dayOfMonth: 1,
      enabled: true,
      lastRun: "",
      status: "healthy",
    },
    {
      id: "sch.cost",
      name: "Cost ledger extract",
      templateId: "cost",
      period: "30d",
      format: "CSV",
      delivery: "storage",
      recipients: "finops",
      destination: "s3://sovereign-finops/reports",
      cadence: "monthly",
      time: "02:00",
      weekday: 1,
      dayOfMonth: 1,
      enabled: true,
      lastRun: "",
      status: "healthy",
    },
  ];
  return base.map((b) => ({ ...b, nextRun: nextRunFrom(b) }));
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("elara:schedules"));
}

export function readSchedules(): Schedule[] {
  return read<Schedule[]>(KEY, seed());
}
export function writeSchedules(list: Schedule[]) {
  write(KEY, list);
}
export function readDeliveries(): Delivery[] {
  return read<Delivery[]>(LOG_KEY, []);
}
export function logDelivery(d: Omit<Delivery, "id">) {
  const list = [
    { ...d, id: `dlv.${Date.now()}.${Math.random().toString(36).slice(2, 7)}` },
    ...readDeliveries(),
  ];
  write(LOG_KEY, list.slice(0, 60));
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
  /* A delivery belongs to the desk that scheduled it. */
  return stampOwner({ ...base, nextRun: nextRunFrom(base) }, "private");
}

export function useSchedules() {
  const ctx = useOwnerCtx();
  const [list, setList] = useState<Schedule[]>([]);
  const [log, setLog] = useState<Delivery[]>([]);
  useEffect(() => {
    const sync = () => {
      setList(readSchedules());
      setLog(readDeliveries());
    };
    sync();
    window.addEventListener("elara:schedules", sync);
    return () => window.removeEventListener("elara:schedules", sync);
  }, []);
  const visible = scopeOwned(list, ctx);
  return { list: visible, allSchedules: list, ctx, log, setList };
}
