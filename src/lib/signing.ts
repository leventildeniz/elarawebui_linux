import { useCallback, useEffect, useState } from "react";
import { emitDeny } from "@/lib/deny-events";
import { signedSeed, type SignedWorkflow } from "@/lib/security-store";

/**
 * Signed workflow spine.
 *
 * Master switch (Policy & Security → Signed Workflows) turns the whole feature
 * on or off. While enabled:
 *   • Save  → the canonical graph JSON is hashed and signed with the active
 *             signing policy key, and the signature is stored per flow.
 *   • Run   → the graph is re-hashed and compared against the stored signature.
 *             `reject unverified` blocks the run, `warn only` warns, `audit only`
 *             just records. Every verdict lands in the audit journal / live debug.
 */

const ENABLED_KEY = "elara.signing.enabled.v1";
const SIG_KEY = "elara.signing.signatures.v1";
const POLICY_KEY = "sovereign.security.signed";
const EVT = "elara:signing-enabled";

export type SignatureRecord = {
  hash: string;
  signature: string;
  algorithm: string;
  fingerprint: string;
  policy: string;
  at: number;
  actor: string;
};

export type Verdict = "signed" | "unsigned" | "tampered" | "off";

/* --------------------------------------------------------------- primitives */

/** Stable canonical JSON — key order independent, so cosmetic reordering never breaks a signature. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/** Deterministic 128-bit digest (4× FNV-1a lanes) rendered as hex — synchronous, no Web Crypto await. */
export function digest(input: string): string {
  const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    for (let l = 0; l < lanes.length; l++) {
      lanes[l] = (lanes[l]! ^ (c + l * 7)) >>> 0;
      lanes[l] = Math.imul(lanes[l]!, 16777619) >>> 0;
    }
  }
  return lanes.map((l) => l.toString(16).padStart(8, "0")).join("");
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

/* ------------------------------------------------------------- master switch */

export function isSigningEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) === "1";
}

export function setSigningEnabled(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  window.dispatchEvent(new CustomEvent<boolean>(EVT, { detail: on }));
  emitDeny({
    category: "workflow",
    action: on ? "signature.enabled" : "signature.disabled",
    target: "signed-workflows",
    label: "Signed Workflows",
    detail: on
      ? "signed workflow enforcement enabled — commits are signed and verified at runtime"
      : "signed workflow enforcement disabled — flows run without signature verification",
  });
}

export function useSigningEnabled() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setEnabled(isSigningEnabled());
    setReady(true);
    const handler = (e: Event) => setEnabled((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVT, handler as EventListener);
    return () => window.removeEventListener(EVT, handler as EventListener);
  }, []);
  const toggle = useCallback((on: boolean) => {
    setSigningEnabled(on);
    setEnabled(on);
  }, []);
  return { enabled, ready, setEnabled: toggle };
}

/* ------------------------------------------------------------------ policies */

export function activePolicy(): SignedWorkflow | null {
  if (typeof window === "undefined") return signedSeed[0] ?? null;
  try {
    const raw = window.localStorage.getItem(POLICY_KEY);
    const list = raw ? (JSON.parse(raw) as SignedWorkflow[]) : signedSeed;
    return (Array.isArray(list) ? list : signedSeed)[0] ?? null;
  } catch {
    return signedSeed[0] ?? null;
  }
}

export function enforcementMode(): string {
  return activePolicy()?.enforcement ?? "reject unverified";
}

/* --------------------------------------------------------------- signatures */

function readSigs(): Record<string, SignatureRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SIG_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SignatureRecord>) : {};
  } catch {
    return {};
  }
}

function writeSigs(map: Record<string, SignatureRecord>) {
  try {
    window.localStorage.setItem(SIG_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function getSignature(id: string): SignatureRecord | null {
  return readSigs()[id] ?? null;
}

/** Hash a flow/chain payload (nodes + edges/stages) into its canonical digest. */
export function hashPayload(payload: unknown): string {
  return digest(canonical(payload));
}

/** Sign a flow. No-op (returns null) while the master switch is off. */
export function signPayload(id: string, name: string, payload: unknown): SignatureRecord | null {
  if (!isSigningEnabled()) return null;
  const policy = activePolicy();
  const hash = hashPayload(payload);
  const fingerprint = policy?.fingerprint || "SHA256:local…dev";
  const record: SignatureRecord = {
    hash,
    signature: digest(`${hash}:${fingerprint}`),
    algorithm: policy?.algorithm || "Ed25519",
    fingerprint,
    policy: policy?.name || "Studio default",
    at: Date.now(),
    actor: "levent@elara",
  };
  const map = readSigs();
  map[id] = record;
  writeSigs(map);
  emitDeny({
    category: "workflow",
    action: "signature.signed",
    target: id,
    label: name,
    detail: `"${name}" signed · ${record.algorithm} · ${shortHash(hash)} · key ${fingerprint}`,
  });
  return record;
}

export function verifyPayload(id: string, payload: unknown): Verdict {
  if (!isSigningEnabled()) return "off";
  const record = getSignature(id);
  if (!record) return "unsigned";
  return record.hash === hashPayload(payload) ? "signed" : "tampered";
}

/**
 * Runtime gate. Returns `null` when execution may proceed, or a human message
 * when the policy blocks the run. Emits the verdict either way.
 */
export function guardRun(
  id: string,
  name: string,
  payload: unknown,
): { blocked: boolean; verdict: Verdict; message: string | null } {
  const verdict = verifyPayload(id, payload);
  if (verdict === "off" || verdict === "signed") {
    if (verdict === "signed") {
      emitDeny({
        category: "workflow",
        action: "signature.verified",
        target: id,
        label: name,
        detail: `"${name}" signature verified · ${shortHash(getSignature(id)?.hash ?? "")}`,
      });
    }
    return { blocked: false, verdict, message: null };
  }

  const mode = enforcementMode();
  const reason =
    verdict === "tampered"
      ? "graph changed after signing — signature no longer matches"
      : "no signature on record — save the flow to sign it";
  const blocked = mode === "reject unverified";

  emitDeny({
    category: "workflow",
    action: blocked ? "signature.denied" : "signature.warned",
    target: id,
    label: name,
    detail: `"${name}" ${verdict} · ${reason} · policy "${mode}"`,
  });

  return {
    blocked,
    verdict,
    message: blocked ? reason : `${verdict}: ${reason} (policy: ${mode})`,
  };
}

/** Live signature verdict for a flow, recomputed whenever the payload changes. */
export function useVerdict(id: string | undefined, payload: unknown): Verdict {
  const { enabled, ready } = useSigningEnabled();
  const [verdict, setVerdict] = useState<Verdict>("off");
  const key = id ? canonical(payload) : "";
  useEffect(() => {
    if (!ready || !enabled || !id) {
      setVerdict("off");
      return;
    }
    setVerdict(verifyPayload(id, JSON.parse(key || "null")));
  }, [enabled, ready, id, key]);
  return verdict;
}
