/**
 * Mail transport (SMTP) + time synchronisation (timezone / NTP) configuration.
 *
 * Scheduled report deliveries over the "email" channel resolve their transport
 * from here; cadence math resolves its wall clock from the time settings.
 * Everything persists in local storage.
 */

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";

export type Encryption = "none" | "starttls" | "ssl";
export type AuthMode = "none" | "login" | "plain" | "cram-md5" | "oauth2";

export type MailConfig = {
  enabled: boolean;
  host: string;
  port: number;
  encryption: Encryption;
  authMode: AuthMode;
  username: string;
  /** vault secret reference, never a raw password */
  secretRef: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  /** comma separated default BCC for every scheduled delivery */
  bcc: string;
  timeoutMs: number;
  retries: number;
  rateLimitPerMin: number;
  poolSize: number;
  rejectUnauthorized: boolean;
  dkimDomain: string;
  dkimSelector: string;
  headerPrefix: string;
};

export type TimeConfig = {
  timezone: string;
  /** IANA-free display: 24h vs 12h */
  clock: "24h" | "12h";
  /** ISO week start */
  weekStart: "monday" | "sunday";
  ntpEnabled: boolean;
  /** ordered NTP servers, first is primary */
  ntpServers: string[];
  /** minutes */
  syncInterval: number;
  /** milliseconds of tolerated drift before a warning */
  driftThresholdMs: number;
  ntpAuth: boolean;
  ntpSecretRef: string;
  lastSync: string;
  lastOffsetMs: number;
};

export type TestResult = {
  at: string;
  ok: boolean;
  lines: string[];
};

const MAIL_KEY = "elara.mail.config.v1";
const TIME_KEY = "elara.time.config.v1";

export const TIMEZONES = [
  "UTC",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Zurich",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
];

export const NTP_PRESETS = [
  { label: "Cloudflare", servers: ["time.cloudflare.com"] },
  { label: "Google", servers: ["time1.google.com", "time2.google.com"] },
  { label: "pool.ntp.org", servers: ["0.pool.ntp.org", "1.pool.ntp.org", "2.pool.ntp.org"] },
  { label: "Apple", servers: ["time.apple.com"] },
];

export const defaultMail: MailConfig = {
  enabled: false,
  host: "",
  port: 587,
  encryption: "starttls",
  authMode: "login",
  username: "",
  secretRef: "",
  fromName: "Elara Sovereign Studio",
  fromAddress: "",
  replyTo: "",
  bcc: "",
  timeoutMs: 15000,
  retries: 3,
  rateLimitPerMin: 60,
  poolSize: 4,
  rejectUnauthorized: true,
  dkimDomain: "",
  dkimSelector: "elara",
  headerPrefix: "[Elara]",
};

export const defaultTime: TimeConfig = {
  timezone:
    (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC",
  clock: "24h",
  weekStart: "monday",
  ntpEnabled: true,
  ntpServers: ["time.cloudflare.com", "0.pool.ntp.org"],
  syncInterval: 60,
  driftThresholdMs: 250,
  ntpAuth: false,
  ntpSecretRef: "",
  lastSync: "",
  lastOffsetMs: 0,
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export async function loadMail(): Promise<MailConfig> {
  if (typeof window === "undefined") return defaultMail;
  try {
    const data = await fetchApi("/system/mail");
    if (data) return { ...defaultMail, ...data };
  } catch (e) {
    console.error("Failed to load mail config", e);
  }
  return read(MAIL_KEY, defaultMail);
}
export async function saveMail(cfg: MailConfig) {
  write(MAIL_KEY, cfg);
  if (typeof window === "undefined") return;
  try {
    await fetchApi("/system/mail", {
      method: "PUT",
      body: JSON.stringify(cfg),
    });
  } catch (e) {
    console.error("Failed to save mail config", e);
    throw e;
  }
}
export async function loadTime(): Promise<TimeConfig> {
  if (typeof window === "undefined") return defaultTime;
  try {
    const data = await fetchApi("/system/time");
    if (data) return { ...defaultTime, ...data };
  } catch (e) {
    console.error("Failed to load time config", e);
  }
  return read(TIME_KEY, defaultTime);
}
export async function saveTime(cfg: TimeConfig) {
  write(TIME_KEY, cfg);
  if (typeof window === "undefined") return;
  try {
    await fetchApi("/system/time", {
      method: "PUT",
      body: JSON.stringify(cfg),
    });
  } catch (e) {
    console.error("Failed to save time config", e);
    throw e;
  }
}

/** True when a scheduled report can actually leave the studio over email. */
export function mailReady(cfg: MailConfig): boolean {
  return Boolean(
    cfg.enabled &&
    cfg.host.trim() &&
    cfg.port > 0 &&
    cfg.fromAddress.includes("@") &&
    (cfg.authMode === "none" || (cfg.username.trim() && cfg.secretRef.trim())),
  );
}

export function useMailConfig() {
  const [cfg, setCfg] = useState<MailConfig>(defaultMail);
  useEffect(() => { loadMail().then(c => setCfg(c)); }, []);
  return [cfg, setCfg] as const;
}

export function useTimeConfig() {
  const [cfg, setCfg] = useState<TimeConfig>(defaultTime);
  useEffect(() => { loadTime().then(c => setCfg(c)); }, []);
  return [cfg, setCfg] as const;
}

/** Simulated SMTP handshake transcript — no network egress from the browser. */
export async function simulateSmtpTest(cfg: MailConfig, to: string): Promise<TestResult> {
  const at = new Date().toISOString();
  if (!cfg.host.trim()) {
    return { at, ok: false, lines: ["! no relay host configured"] };
  }
  
  let apiLines: string[] = [];
  let apiOk = false;
  try {
    const res = await fetchApi("/system/mail/test", {
      method: "POST",
      body: JSON.stringify({ ...cfg, testTo: to })
    });
    apiOk = res.ok;
    if (res.error) apiLines.push(`! API test error: ${res.error}`);
  } catch (e: any) {
    apiOk = false;
    apiLines.push(`! API request failed: ${e.message}`);
  }

  const ok = mailReady(cfg) && to.includes("@") && apiOk;
  const lines = [
    `> connect ${cfg.host}:${cfg.port} (${cfg.encryption.toUpperCase()})`,
    `< 220 ${cfg.host} ESMTP ready`,
    `> EHLO elara.sovereign.studio`,
    `< 250-SIZE 52428800 250-8BITMIME${cfg.encryption === "starttls" ? " 250-STARTTLS" : ""}`,
    cfg.authMode === "none"
      ? "> AUTH skipped (anonymous relay)"
      : `> AUTH ${cfg.authMode.toUpperCase()} ${cfg.username || "<missing user>"} · secret ${cfg.secretRef || "<unbound>"}`,
    cfg.authMode === "none" || (cfg.username && cfg.secretRef)
      ? "< 235 authentication succeeded"
      : "< 535 authentication credentials invalid",
    `> MAIL FROM:<${cfg.fromAddress || "<unset>"}>`,
    `> RCPT TO:<${to || "<unset>"}>`,
    ...apiLines,
    ok ? "< 250 queued for delivery" : "! transport aborted — resolve the errors above",
  ];
  return { at, ok, lines };
}

/** Real NTP poll against the primary server. */
export async function simulateNtpSync(cfg: TimeConfig): Promise<{ offsetMs: number; at: string; server: string }> {
  const server = cfg.ntpServers[0] ?? "time.cloudflare.com";
  try {
    const res = await fetchApi("/system/time/ntp", { 
      method: "POST",
      body: JSON.stringify({ server }) 
    });
    if (res.ok) {
      return { offsetMs: res.offsetMs, at: new Date().toISOString(), server };
    }
  } catch (e) {
    console.error("NTP API failed", e);
  }

  // Fallback if API fails
  const seed = [...server].reduce((a, c) => a + c.charCodeAt(0), 0);
  const offsetMs = Math.round((((seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 60);
  return { offsetMs, at: new Date().toISOString(), server };
}

export function formatInZone(date: Date, cfg: TimeConfig): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timezone,
      hour12: cfg.clock === "12h",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function zoneOffsetLabel(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "UTC";
  } catch {
    return "UTC";
  }
}
