// GenGuard — Input/Output safety filter that runs in the API client (middleware layer).
// All blocked attempts are sealed into the in-memory audit log + posted to LogsAPI.

import { LogsAPI } from "@/lib/api-client";
import { createLocalId } from "@/lib/id";

export interface GuardConfig {
  enabled: boolean;
  inputBlacklist: string[];
  outputPatterns: string[]; // regex sources
  sensitivity: "low" | "medium" | "high";
  instructionsFile?: { name: string; content: string; updatedAt: string } | null;
  localFilePath?: string;
}

export interface GuardEvent {
  id: string;
  ts: string;
  direction: "input" | "output";
  matched: string;
  excerpt: string;
  user?: string;
}

const KEY = "genguard.config";
const EVTS_KEY = "genguard.events";

export const DEFAULT_GUARD: GuardConfig = {
  enabled: true,
  inputBlacklist: [
    "ignore previous", "reverse", "ters yaz", "base64",
    "encode", "spell out", "decode", "system prompt",
  ],
  outputPatterns: [
    "/etc/passwd", "/etc/shadow", "\\.env", "BEGIN RSA PRIVATE KEY",
    "sk-[A-Za-z0-9]{20,}", "AKIA[0-9A-Z]{16}", "password\\s*[:=]\\s*\\S+",
  ],
  sensitivity: "medium",
  instructionsFile: null,
  localFilePath: "",
};

export function loadGuard(): GuardConfig {
  if (typeof window === "undefined") return DEFAULT_GUARD;
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : DEFAULT_GUARD; }
  catch { return DEFAULT_GUARD; }
}
export function saveGuard(cfg: GuardConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}
export function loadEvents(): GuardEvent[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(EVTS_KEY) || "[]"); } catch { return []; }
}
function pushEvent(ev: GuardEvent) {
  const all = [ev, ...loadEvents()].slice(0, 500);
  localStorage.setItem(EVTS_KEY, JSON.stringify(all));
  LogsAPI.push({
    agent: "genguard", level: "warn",
    message: `${ev.direction}_blocked`,
    meta: { matched: ev.matched, excerpt: ev.excerpt },
  });
}

export class GuardViolation extends Error {
  constructor(public matched: string, public direction: "input" | "output") {
    super(`GenGuard ${direction} blocked: ${matched}`);
  }
}

export function checkInput(text: string, user?: string): void {
  const cfg = loadGuard();
  if (!cfg.enabled) return;
  const lower = text.toLowerCase();
  const hit = cfg.inputBlacklist.find((kw) => kw && lower.includes(kw.toLowerCase()));
  if (hit) {
    pushEvent({
      id: createLocalId(), ts: new Date().toISOString(),
      direction: "input", matched: hit, excerpt: text.slice(0, 200), user,
    });
    throw new GuardViolation(hit, "input");
  }
}

export function checkOutput(text: string, user?: string): string {
  const cfg = loadGuard();
  if (!cfg.enabled) return text;
  let scrubbed = text;
  for (const pat of cfg.outputPatterns) {
    if (!pat) continue;
    let re: RegExp;
    try { re = new RegExp(pat, "gi"); } catch { continue; }
    if (re.test(scrubbed)) {
      pushEvent({
        id: createLocalId(), ts: new Date().toISOString(),
        direction: "output", matched: pat, excerpt: scrubbed.slice(0, 200), user,
      });
      scrubbed = scrubbed.replace(re, "[█ REDACTED BY GENGUARD █]");
    }
  }
  return scrubbed;
}
