import { useCallback, useEffect, useState } from "react";
import type { GenGuardRule, PolicyRule } from "./security-store";

/**
 * Firewall-style evaluation core for GenGuard (INPUT chain) and the
 * Policy Engine (ROUTING/OUTPUT chain).
 *
 * Semantics, deliberately modelled on a packet filter:
 *  - every rule carries an explicit sequence number (10, 20, 30 … gaps on
 *    purpose so an operator can slot a rule between two others);
 *  - rules are evaluated top-down and the FIRST match wins — the remaining
 *    rules are never consulted;
 *  - if nothing matches, the chain's default policy applies.
 */

export type PolicyAction = "allow" | "deny" | "redact" | "route" | "challenge" | "log";

export const policyActions: PolicyAction[] = [
  "allow",
  "deny",
  "redact",
  "route",
  "challenge",
  "log",
];

export const actionLabel: Record<PolicyAction, string> = {
  allow: "ALLOW · pass the request through",
  deny: "DENY · block and raise an audit alarm",
  redact: "REDACT · strip the matched span, continue",
  route: "ROUTE · pin the request to a target",
  challenge: "CHALLENGE · require operator approval",
  log: "LOG · observe only, no enforcement",
};

export const actionTone: Record<PolicyAction, string> = {
  allow: "emerald",
  deny: "ruby",
  redact: "amethyst",
  route: "sapphire",
  challenge: "topaz",
  log: "sapphire",
};

export type ChainId = "input" | "routing";

export const chainMeta: Record<ChainId, { label: string; hint: string }> = {
  input: {
    label: "INPUT chain",
    hint: "Runs before inference — prompt injection, jailbreak and sensitive-input defence.",
  },
  routing: {
    label: "ROUTING / OUTPUT chain",
    hint: "Runs on the resolved request and the model response — routing, spend and redaction.",
  },
};

/* --------------------------------------------------------------- ordering */

export type Ordered = { id: string; seq: number };

/** Infer an action for rules written before the firewall model existed. */
export function inferAction(then: string): PolicyAction {
  const t = (then || "").toLowerCase();
  if (t.includes("redact")) return "redact";
  if (t.includes("halt") || t.includes("block") || t.includes("deny") || t.includes("reject"))
    return "deny";
  if (t.includes("route") || t.includes("→")) return "route";
  if (t.includes("approve") || t.includes("challenge")) return "challenge";
  if (t.includes("allow") || t.includes("permit")) return "allow";
  return "log";
}

/** Give every rule a stable seq (10, 20, 30 …) and a concrete action. */
export function normalisePolicyRules(rules: PolicyRule[]): PolicyRule[] {
  return [...rules]
    .map((r, i) => ({
      ...r,
      seq: typeof r.seq === "number" && r.seq > 0 ? r.seq : (i + 1) * 10,
      action: (r.action as PolicyAction) ?? inferAction(r.thenAction),
    }))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export function normaliseGuardRules(rules: GenGuardRule[]): GenGuardRule[] {
  return [...rules]
    .map((r, i) => ({
      ...r,
      seq: typeof r.seq === "number" && r.seq > 0 ? r.seq : (i + 1) * 10,
      action: (r.action as PolicyAction) ?? "deny",
    }))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/** Next free sequence number for a chain (last + 10). */
export function nextSeq(rules: Ordered[]): number {
  const max = rules.reduce((m, r) => Math.max(m, r.seq ?? 0), 0);
  return max + 10;
}

/**
 * Swap a rule with its neighbour and return the (id, seq) patches so the
 * caller can persist them. Renumbers the whole chain to keep the 10-step grid.
 */
export function reorder<T extends Ordered>(
  rules: T[],
  id: string,
  dir: -1 | 1,
): { id: string; seq: number }[] {
  const ordered = [...rules].sort((a, b) => a.seq - b.seq);
  const i = ordered.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return [];
  const swapped = [...ordered];
  const a = swapped[i]!;
  const b = swapped[j]!;
  swapped[i] = b;
  swapped[j] = a;
  return swapped.map((r, k) => ({ id: r.id, seq: (k + 1) * 10 }));
}

/* --------------------------------------------------------- default policy */

const DEFAULT_KEY = (chain: ChainId) => `sovereign.security.chain-default.${chain}`;

export function readChainDefault(chain: ChainId): PolicyAction {
  if (typeof window === "undefined") return chain === "input" ? "allow" : "allow";
  const raw = window.localStorage.getItem(DEFAULT_KEY(chain));
  return (raw as PolicyAction) || "allow";
}

/** Implicit last rule of a chain — the packet filter's policy target. */
export function useChainDefault(chain: ChainId) {
  const [action, setAction] = useState<PolicyAction>("allow");
  useEffect(() => setAction(readChainDefault(chain)), [chain]);
  const update = useCallback(
    (next: PolicyAction) => {
      setAction(next);
      try {
        window.localStorage.setItem(DEFAULT_KEY(chain), next);
      } catch {
        /* quota */
      }
    },
    [chain],
  );
  return { action, setAction: update };
}

/* -------------------------------------------------------------- matching */

export type EvalContext = {
  /** the prompt / request body */
  text: string;
  /** the model response, when simulating the output leg */
  output: string;
  intent: string;
  target: string;
  cost: number;
};

export const emptyContext: EvalContext = {
  text: "",
  output: "",
  intent: "coding",
  target: "forge-coder",
  cost: 0,
};

const splitList = (v: string) =>
  v
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/** GenGuard match: any blacklist term in the input, or any regex on the output. */
export function matchGuard(rule: GenGuardRule, ctx: EvalContext): string | null {
  const text = ctx.text.toLowerCase();
  for (const term of splitList(rule.inputBlacklist)) {
    if (term && text.includes(term.toLowerCase())) return `input contains "${term}"`;
  }
  if (ctx.output) {
    for (const pattern of splitList(rule.outputPatterns)) {
      const re = safeRegex(pattern);
      if (re && re.test(ctx.output)) return `output matches /${pattern}/`;
    }
  }
  return null;
}

/**
 * Tiny expression matcher for the routing chain.
 * Supported clauses (joined with `and`):
 *   always
 *   intent = coding            target != bedrock
 *   cost > 50                  cost <= 2
 *   text contains "secret"     output contains pii
 *   text matches /sk-[a-z]+/
 */
export function matchExpression(expr: string, ctx: EvalContext): string | null {
  const source = (expr || "").trim();
  if (!source) return null;
  const clauses = source
    .split(/\s+and\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);
  const reasons: string[] = [];

  for (const clause of clauses) {
    if (/^always$/i.test(clause)) {
      reasons.push("always");
      continue;
    }

    const m = clause.match(/^([a-z_]+)\s*(>=|<=|!=|=|>|<|contains|matches)\s*(.+)$/i);
    if (!m) return null;
    const field = (m[1] ?? "").toLowerCase();
    const op = (m[2] ?? "").toLowerCase();
    const rawValue = (m[3] ?? "").trim().replace(/^["'/]|["'/]$/g, "");

    const strValue = (() => {
      switch (field) {
        case "text":
        case "prompt":
          return ctx.text;
        case "output":
        case "response":
          return ctx.output;
        case "intent":
          return ctx.intent;
        case "target":
        case "model":
          return ctx.target;
        case "cost":
          return String(ctx.cost);
        default:
          return "";
      }
    })();

    let ok = false;
    if (op === "contains") ok = strValue.toLowerCase().includes(rawValue.toLowerCase());
    else if (op === "matches") {
      const re = safeRegex(rawValue);
      ok = Boolean(re && re.test(strValue));
    } else if (op === "=") ok = strValue.toLowerCase() === rawValue.toLowerCase();
    else if (op === "!=") ok = strValue.toLowerCase() !== rawValue.toLowerCase();
    else {
      const left = Number(strValue);
      const right = Number(rawValue);
      if (Number.isNaN(left) || Number.isNaN(right)) return null;
      ok =
        op === ">"
          ? left > right
          : op === "<"
            ? left < right
            : op === ">="
              ? left >= right
              : left <= right;
    }

    if (!ok) return null;
    reasons.push(clause);
  }

  return reasons.length ? reasons.join(" and ") : null;
}

/* ------------------------------------------------------------- evaluation */

export type TraceRow = {
  seq: number;
  id: string;
  name: string;
  status: "skipped" | "no-match" | "match" | "unreached";
  action: PolicyAction;
  reason: string;
};

export type ChainVerdict = {
  action: PolicyAction;
  matchedId: string | null;
  matchedName: string;
  trace: TraceRow[];
};

/** First-match-wins walk over an ordered chain. */
export function evaluateChain(
  rules: { id: string; name: string; seq?: number; enabled: boolean; action?: PolicyAction }[],
  match: (rule: never, ctx: EvalContext) => string | null,
  ctx: EvalContext,
  fallback: PolicyAction,
): ChainVerdict {
  const trace: TraceRow[] = [];
  let verdict: ChainVerdict | null = null;

  for (const rule of [...rules].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    const base = { seq: rule.seq ?? 0, id: rule.id, name: rule.name, action: rule.action ?? "log" };
    if (verdict) {
      trace.push({ ...base, status: "unreached", reason: "chain already terminated" });
      continue;
    }
    if (!rule.enabled) {
      trace.push({ ...base, status: "skipped", reason: "rule disabled" });
      continue;
    }
    const reason = match(rule as never, ctx);
    if (reason) {
      trace.push({ ...base, status: "match", reason });
      verdict = {
        action: base.action,
        matchedId: rule.id,
        matchedName: rule.name,
        trace,
      };
    } else {
      trace.push({ ...base, status: "no-match", reason: "condition not satisfied" });
    }
  }

  return (
    verdict ?? {
      action: fallback,
      matchedId: null,
      matchedName: "default policy",
      trace,
    }
  );
}
