import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Deterministic date/time formatting.
 * Locale- and timezone-dependent output differs between the server render and
 * the browser, which produces hydration mismatches. These helpers pin both.
 */
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const DATETIME_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export const fmtDate = (t: number | string | Date) => DATE_FMT.format(new Date(t));
export const fmtDateTime = (t: number | string | Date) => DATETIME_FMT.format(new Date(t));
export const fmtTime = (t: number | string | Date) => TIME_FMT.format(new Date(t));

/**
 * Hour-rounded clock used for demo seed timestamps so the server render and the
 * client hydration produce identical values.
 */
export const seedNow = () => Math.floor(Date.now() / 3_600_000) * 3_600_000;
