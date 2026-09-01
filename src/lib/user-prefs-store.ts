import { useCallback, useEffect, useState } from "react";
import type { SelfServiceKey, UserTemplate } from "@/lib/user-template-store";

/**
 * Personal model preferences for the signed-in operator.
 *
 * These never widen a template: a value only reaches the runtime when the
 * bound template both allows self-service (`userCanModify`) and flags that
 * single key in `userEditable`. Everything else stays inherited.
 */
export type UserPrefs = {
  personaPrompt: string;
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  thinkEnabled: boolean;
  streaming: boolean;
  stopSequences: string;
  /** Memory knobs — only ever tighter than the bound template's ceiling. */
  memoryCompactAt: number;
  memoryKeepLastTurns: number;
  /** Keys the user has actually taken over. */
  touched: Partial<Record<SelfServiceKey, boolean>>;
};

const KEY = "elara.userPrefs.v1";
const EVT = "elara:userPrefs";

export const emptyPrefs = (): UserPrefs => ({
  personaPrompt: "",
  temperature: 0.4,
  topP: 0.9,
  topK: 40,
  maxTokens: 4096,
  thinkEnabled: false,
  streaming: true,
  stopSequences: "",
  memoryCompactAt: 72,
  memoryKeepLastTurns: 8,
  touched: {},
});

function readAll(): Record<string, UserPrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, UserPrefs>) : {};
  } catch {
    return {};
  }
}

export function readPrefs(accountId: string): UserPrefs {
  return { ...emptyPrefs(), ...(readAll()[accountId] ?? {}) };
}

export function writePrefs(accountId: string, prefs: UserPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [accountId]: prefs }));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(EVT));
}

export function useUserPrefs(accountId: string | undefined) {
  const [prefs, setPrefs] = useState<UserPrefs>(emptyPrefs);

  useEffect(() => {
    if (!accountId) return;
    const sync = () => setPrefs(readPrefs(accountId));
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [accountId]);

  const save = useCallback(
    (next: UserPrefs) => {
      if (!accountId) return;
      setPrefs(next);
      writePrefs(accountId, next);
    },
    [accountId],
  );

  return { prefs, setPrefs, save };
}

/** True only when the template explicitly hands this knob to the user. */
export function canEdit(template: UserTemplate | undefined, key: SelfServiceKey) {
  return Boolean(template?.userCanModify && template.userEditable?.[key]);
}

/** Value the runtime should use: personal override when armed, else template. */
export function effectiveValue<K extends keyof Omit<UserPrefs, "touched">>(
  template: UserTemplate | undefined,
  prefs: UserPrefs,
  key: K,
  selfKey: SelfServiceKey,
  fallback: UserPrefs[K],
): UserPrefs[K] {
  if (canEdit(template, selfKey) && prefs.touched[selfKey]) return prefs[key];
  return fallback;
}

/** Template ceiling for a delegated memory knob — the user may only go below it. */
export function memoryCeiling(
  template: UserTemplate | undefined,
  key: "memoryCompactAt" | "memoryKeepLastTurns",
): number {
  const fallback = key === "memoryCompactAt" ? 95 : 32;
  return template?.params?.[key] ?? fallback;
}
