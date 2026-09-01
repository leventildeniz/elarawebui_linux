import { useCallback, useEffect, useState } from "react";
import { readAccounts } from "./group-store";
import { loadMail, mailReady } from "./mail-store";

/**
 * Notification relay for the human-in-the-loop gates.
 *
 * The studio never blocks on a mail server: every notice is written to a local
 * outbox with its transport verdict, so an operator can always see whether a
 * reviewer was actually paged.
 */

export type NoticeKind = "approval" | "forge";
export type NoticeState = "sent" | "queued" | "blocked" | "muted";

export type Notice = {
  id: string;
  kind: NoticeKind;
  subject: string;
  to: string[];
  body: string;
  at: number;
  state: NoticeState;
  reason?: string;
};

export type NotifyPrefs = {
  /** page approvers when a request lands in the queue */
  approvals: boolean;
  /** page approvers when a Meta-Forge plan needs a verdict */
  forge: boolean;
  /** only notify at or above this risk band */
  minRisk: "low" | "medium" | "high" | "critical";
  /** always copy these addresses (comma separated) */
  cc: string;
  /** subject line template — {subject} {gate} */
  subjectTpl: string;
  /** opening line of the notice — {approver} {requester} {gate} */
  intro: string;
  /** closing signature line */
  signature: string;
  /** per-group opt-in, keyed by group name — pages that group's approvers */
  groups: Record<string, boolean>;
};

export const defaultNotifyPrefs: NotifyPrefs = {
  approvals: false,
  forge: false,
  minRisk: "medium",
  cc: "",
  subjectTpl: "Action required · {subject}",
  intro:
    "A {gate} item is waiting for your verdict in Elara Sovereign Studio. Review it before the window closes.",
  signature: "Elara Sovereign Studio · automated approver notice",
  groups: {},
};

/** Fill {token} placeholders from a flat map. */
export function renderTpl(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

const PREF_KEY = "elara.notify.prefs.v1";
const OUT_KEY = "elara.notify.outbox.v1";
export const NOTIFY_EVT = "elara:notify";

const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

export function loadPrefs(): NotifyPrefs {
  if (typeof window === "undefined") return defaultNotifyPrefs;
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    return raw
      ? { ...defaultNotifyPrefs, ...(JSON.parse(raw) as NotifyPrefs) }
      : defaultNotifyPrefs;
  } catch {
    return defaultNotifyPrefs;
  }
}

export function savePrefs(next: NotifyPrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREF_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(NOTIFY_EVT));
}

export function readOutbox(): Notice[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OUT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Notice[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(list: Notice[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OUT_KEY, JSON.stringify(list.slice(0, 60)));
    window.dispatchEvent(new CustomEvent(NOTIFY_EVT));
  } catch {
    /* ignore */
  }
}

export function clearOutbox() {
  writeOutbox([]);
}

/** Map approver usernames to mailboxes; empty list = shared pool broadcast. */
export function resolveRecipients(usernames: string[], cc: string): string[] {
  const accounts = readAccounts();
  const direct = usernames.length
    ? usernames
        .map((u) => accounts.find((a) => a.username === u)?.email)
        .filter((e): e is string => Boolean(e))
    : accounts.filter((a) => a.status === "active").map((a) => a.email);
  const extra = cc
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
  return Array.from(new Set([...direct, ...extra]));
}

export type NoticeDraft = {
  kind: NoticeKind;
  subject: string;
  body: string;
  /** approver usernames — empty means the shared pool */
  approvers?: string[];
  /** extra mailboxes (directory group distribution lists) */
  mailTo?: string[];
  /** requester group name — enables that group's own notice opt-in */
  group?: string;
  risk?: "low" | "medium" | "high" | "critical";
};

/**
 * Single entry point for gate notifications. Returns the recorded notice so
 * callers can surface the transport verdict inline.
 */
export async function notifyApprovers(draft: NoticeDraft): Promise<Notice> {
  const prefs = loadPrefs();
  const gateOn = draft.kind === "approval" ? prefs.approvals : prefs.forge;
  const enabled = gateOn || Boolean(draft.group && prefs.groups?.[draft.group]);
  const mail = await loadMail();
  const to = Array.from(
    new Set([...resolveRecipients(draft.approvers ?? [], prefs.cc), ...(draft.mailTo ?? [])]),
  );

  let state: NoticeState = "sent";
  let reason: string | undefined;

  if (!enabled) {
    state = "muted";
    reason = "email notices are off for this gate and group";
  } else if (draft.risk && RISK_RANK[draft.risk] < RISK_RANK[prefs.minRisk]) {
    state = "muted";
    reason = `below the ${prefs.minRisk} risk threshold`;
  } else if (!mailReady(mail)) {
    state = "blocked";
    reason = "SMTP relay is not configured — see Settings › Mail";
  } else if (to.length === 0) {
    state = "blocked";
    reason = "no approver mailbox could be resolved";
  }

  const gate = draft.kind === "approval" ? "approval queue" : "meta-forge";
  const vars = { subject: draft.subject, gate, risk: draft.risk ?? "n/a" };

  const notice: Notice = {
    id: `ntf.${Math.random().toString(16).slice(2, 8)}`,
    kind: draft.kind,
    subject: `${mail.headerPrefix || "[Elara]"} ${renderTpl(prefs.subjectTpl, vars)}`.trim(),
    to,
    body: [renderTpl(prefs.intro, vars), "", draft.body, "", prefs.signature].join("\n").trim(),
    at: Date.now(),
    state,
    ...(reason ? { reason } : {}),
  };

  writeOutbox([notice, ...readOutbox()]);
  return notice;
}

export function useNotifyPrefs() {
  const [prefs, setPrefs] = useState<NotifyPrefs>(defaultNotifyPrefs);
  useEffect(() => {
    const sync = () => setPrefs(loadPrefs());
    sync();
    window.addEventListener(NOTIFY_EVT, sync);
    return () => window.removeEventListener(NOTIFY_EVT, sync);
  }, []);
  const update = useCallback((patch: Partial<NotifyPrefs>) => {
    const next = { ...loadPrefs(), ...patch };
    savePrefs(next);
    setPrefs(next);
  }, []);
  return { prefs, update };
}

export function useOutbox() {
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(() => {
    const sync = () => setItems(readOutbox());
    sync();
    window.addEventListener(NOTIFY_EVT, sync);
    return () => window.removeEventListener(NOTIFY_EVT, sync);
  }, []);
  return items;
}
