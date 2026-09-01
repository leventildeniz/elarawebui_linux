// Sovereign AI OS — API Core Client
// Handles port resolution, connectivity guards, and the base request mechanism.

export type ChatTraceLevel = "info" | "warn" | "error";
export interface ChatTraceEvent {
  traceId: string;
  stage: string;
  ts: number;
  level: ChatTraceLevel;
  detail: Record<string, unknown>;
}
const CHAT_TRACE_KEY = "elara.chat.trace";
const CHAT_TRACE_MAX = 100;

export function createChatTraceId(): string {
  return `chat-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function recordChatTrace(traceId: string, stage: string, detail: Record<string, unknown> = {}, level: ChatTraceLevel = "info") {
  if (typeof window === "undefined" || !traceId) return;
  const evt: ChatTraceEvent = { traceId, stage, ts: Date.now(), level, detail };
  try {
    const prev = JSON.parse(sessionStorage.getItem(CHAT_TRACE_KEY) || "[]") as ChatTraceEvent[];
    sessionStorage.setItem(CHAT_TRACE_KEY, JSON.stringify([...prev, evt].slice(-CHAT_TRACE_MAX)));
  } catch { /* storage unavailable */ }
  const verbose = (() => { try { return localStorage.getItem("chat.trace.verbose") === "1"; } catch { return false; } })();
  if (level === "error") console.error(`[chat:trace] ${traceId} ${stage}`, detail);
  else if (level === "warn") console.warn(`[chat:trace] ${traceId} ${stage}`, detail);
  else if (verbose) console.info(`[chat:trace] ${traceId} ${stage}`, detail);
}

export function getChatTrace(traceId?: string): ChatTraceEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(sessionStorage.getItem(CHAT_TRACE_KEY) || "[]") as ChatTraceEvent[];
    return traceId ? all.filter((e) => e.traceId === traceId) : all;
  } catch { return []; }
}

export const BRIDGE_HTTP_PORT = "3005";
export const BRIDGE_HTTPS_PORT = "10443";

export function isHttpsPage(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

export function bridgeScheme(): "http" | "https" { 
  return isHttpsPage() ? "https" : "http"; 
}

export function bridgePort(): string { 
  return isHttpsPage() ? BRIDGE_HTTPS_PORT : BRIDGE_HTTP_PORT; 
}

export const BRIDGE_OVERRIDE_KEY = "bridge.override";
export const BRIDGE_MDNS_KEY = "bridge.mdns_hosts";

export function defaultMdnsHosts(): string[] {
  if (typeof window === "undefined") return [];
  const host = window.location.hostname?.toLowerCase() ?? "";
  if (!host) return [];
  if (host.endsWith(".local")) return [host];
  return [];
}

export function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function getMdnsHosts(): string[] {
  const raw = safeGet(BRIDGE_MDNS_KEY);
  if (!raw) return defaultMdnsHosts();
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : defaultMdnsHosts();
}

export function setMdnsHosts(hosts: string[] | null) {
  if (!hosts || hosts.length === 0) safeSet(BRIDGE_MDNS_KEY, null);
  else safeSet(BRIDGE_MDNS_KEY, hosts.map((h) => h.trim()).filter(Boolean).join(","));
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host);
}

export function isIpHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return host.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  return host.includes(":") && /^[0-9a-f:]+$/i.test(host);
}

export function isCloudPreviewHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.toLowerCase();
  return /(^|\.)lovableproject\.com$|(^|\.)lovable\.app$|(^|\.)lovable\.dev$/.test(h);
}

export function getBridgeOverride(): string | null {
  return safeGet(BRIDGE_OVERRIDE_KEY);
}

export function isBridgeUnreachableContext(): boolean {
  if (!isCloudPreviewHost()) return false;
  return !getBridgeOverride();
}

export class BridgeUnreachableError extends Error {
  constructor() {
    super("Bridge skipped on cloud preview (no LAN reachability without override)");
    this.name = "BridgeUnreachableError";
  }
}

export const normalizeUrl = (raw: string): string | null => {
  const v = raw.trim().replace(/\/+$/, "");
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return `http://${v}`.replace(/\/+$/, "");
  return v;
};

export function setBridgeOverride(url: string | null) {
  const v = url ? normalizeUrl(url) : null;
  safeSet(BRIDGE_OVERRIDE_KEY, v ? ensurePort(v) : null);
}

function ensurePort(url: string): string {
  try {
    const u = new URL(url);
    if (!u.port) u.port = u.protocol === "https:" ? BRIDGE_HTTPS_PORT : BRIDGE_HTTP_PORT;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url;
  }
}

export function getBridgeCandidates(): string[] {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return [normalizeUrl(envUrl) || ""];
  const override = getBridgeOverride();
  if (override) return [override];
  if (isCloudPreviewHost()) return [];
  return [''];
}

export function resolveApiBaseUrl(): string {
  const list = getBridgeCandidates();
  const url = list[0] !== undefined
    ? list[0]
    : `${bridgeScheme()}://${typeof window !== "undefined" ? window.location.hostname : ""}:${bridgePort()}`;
  return url;
}

const BREAKER_COOLDOWN_MS = 8000;
const breakerDeadUntil = new Map<string, number>();

function isAlive(base: string) {
  const until = breakerDeadUntil.get(base) ?? 0;
  return Date.now() > until;
}

function markBridgeDown(base: string, err: unknown) {
  if (base === "") return;
  const name = (err as { name?: string })?.name || "";
  const msg = String((err as { message?: string })?.message || err || "").toLowerCase();
  if (name === "AbortError" || name === "TimeoutError" || msg.includes("timeout") || msg.includes("aborted")) {
    // transient
  } else {
    breakerDeadUntil.set(base, Date.now() + BREAKER_COOLDOWN_MS);
  }
}

function markBridgeWorking(base: string) {
  breakerDeadUntil.delete(base);
}

function signalWithTimeout(signal: Signal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  if (!signal) return controller.signal;
  signal.addEventListener("abort", () => controller.abort());
  return controller.signal;
}

function actorHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const h: Record<string, string> = {};
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const u = JSON.parse(raw) as { username?: string; sessionId?: string; role?: string };
      if (u?.username) h["x-user"] = u.username;
      if (u?.sessionId) h["x-session-id"] = u.sessionId;
      if (u?.role) h["x-user-role"] = u.role;
    }
  } catch { /* ignore */ }
  try {
    h["x-user-now"] = new Date().toISOString();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) h["x-user-tz"] = tz;
  } catch { /* ignore */ }
  return h;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 0;
  const timeoutMs = opts.timeoutMs ?? 60000;
  if (isBridgeUnreachableContext()) {
    throw new BridgeUnreachableError();
  }
  const allCandidates = getBridgeCandidates();
  const isHealthProbe = path.includes("/health");
  const candidates = isHealthProbe ? allCandidates : allCandidates.filter(isAlive);
  const effective = candidates.length ? candidates : allCandidates;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const base of effective) {
      try {
        const res = await fetch(`${base}${path}`, {
          ...init,
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
            ...actorHeaders(),
            ...(init.headers ?? {}),
          },
          signal: signalWithTimeout(init.signal, timeoutMs),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status >= 400 && res.status < 500) {
            markBridgeWorking(base);
            throw new Error(`API ${res.status} ${res.statusText}: ${body}`);
          }
          lastErr = new Error(`API ${res.status} ${res.statusText}: ${body}`);
          continue;
        }
        markBridgeWorking(base);
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      } catch (e) {
        lastErr = e;
        markBridgeDown(base, e);
        if (init.signal?.aborted) throw e;
      }
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchBridge(
  path: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 60000;
  if (isBridgeUnreachableContext()) {
    throw new BridgeUnreachableError();
  }
  const allCandidates = getBridgeCandidates();
  const candidates = allCandidates.filter(isAlive);
  const effective = candidates.length ? candidates : allCandidates;
  let lastErr: unknown;
  for (const base of effective) {
    try {
      const url = `${base}${path}`;
      const res = await fetch(url, {
        ...init,
        mode: "cors",
        signal: signalWithTimeout(init.signal, timeoutMs),
      });
      if (res.ok) {
        markBridgeWorking(base);
        return res;
      }
      lastErr = new Error(`API ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e;
      markBridgeDown(base, e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
