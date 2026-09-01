// Chat protocol parser — turns model-emitted tool_call / skill_call blocks,
// bang-slug shortcuts, and naked JSON envelopes into a single typed DTO so
// the chat dispatcher can route them to the right execution lane:
//
//   { kind: "tool",         id,    params }   → Forge/RBI tools
//   { kind: "skill",        slug,  params }   → Skills Engine (autonomous)
//   { kind: "python_agent", script, query  }  → Local Python bridge
//
// Every parser also returns the source text range so the chat renderer can
// strip the raw protocol block from the assistant bubble.

export type ProtocolCall =
  | { kind: "tool"; id: string; params: Record<string, unknown>; raw: string }
  | { kind: "skill"; slug: string; params: Record<string, unknown>; raw: string }
  | { kind: "python_agent"; script: string; query: string; raw: string };

const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,49}$/i;
const PY_SCRIPT_RE = /^[\p{L}\p{N}_\-./]+\.py$/u;

function asParams(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

/** Normalize an arbitrary slug/id into either a skill slug or a tool id. */
function classifyHandle(handle: string): { kind: "skill" | "tool"; key: string } {
  const trimmed = String(handle || "").trim();
  if (trimmed.startsWith("!")) return { kind: "skill", key: trimmed.slice(1) };
  // Heuristic: dotted/colon ids are tool ids (forge.* / rbi.* / harvest_url),
  // plain a-z slug ALSO defaults to skill when it matches slug pattern.
  if (SKILL_SLUG_RE.test(trimmed) && !trimmed.includes(".") && !trimmed.includes(":")) {
    return { kind: "skill", key: trimmed.toLowerCase() };
  }
  return { kind: "tool", key: trimmed };
}

function tryParseJson(s: string): unknown | null {
  try { return JSON.parse(s); } catch { return null; }
}

function envelopeToCall(env: unknown, raw: string): ProtocolCall | null {
  if (!env || typeof env !== "object") return null;
  const o = env as Record<string, unknown>;

  // skill_call shape: { skill: "...", params: {...} }
  if (typeof o.skill === "string" && o.skill.trim()) {
    const slug = o.skill.trim().replace(/^!/, "").toLowerCase();
    if (SKILL_SLUG_RE.test(slug)) return { kind: "skill", slug, params: asParams(o.params), raw };
  }

  // tool_call shape: { tool: "...", params: {...} }
  if (typeof o.tool === "string" && o.tool.trim()) {
    const cls = classifyHandle(o.tool);
    if (cls.kind === "skill") return { kind: "skill", slug: cls.key.toLowerCase(), params: asParams(o.params), raw };
    return { kind: "tool", id: cls.key, params: asParams(o.params), raw };
  }

  // python_agent shape: { script: "x.py", query: "..." } or { agent, query }
  const script = typeof o.script === "string" ? o.script
    : typeof o.agent === "string" ? o.agent : "";
  if (script && PY_SCRIPT_RE.test(script.trim())) {
    const query = typeof o.query === "string" ? o.query
      : typeof o.input === "string" ? o.input
      : typeof (asParams(o.params).query) === "string" ? String(asParams(o.params).query) : "";
    return { kind: "python_agent", script: script.trim(), query, raw };
  }

  return null;
}

/**
 * Extract all protocol calls from a model-produced text buffer.
 * Recognises:
 *   - fenced ```tool_call / ```skill_call / ```python_agent blocks
 *   - top-level naked JSON envelopes containing tool / skill / script keys
 *   - @[script.py] python agent triggers
 */
export function extractProtocolCalls(text: string): ProtocolCall[] {
  const out: ProtocolCall[] = [];
  if (!text || typeof text !== "string") return out;

  // 1) Fenced blocks (tool_call | skill_call | python_agent)
  const fenceRe = /```(tool_call|skill_call|python_agent)\s*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const raw = m[0];
    const env = tryParseJson(m[2].trim());
    const call = envelopeToCall(env, raw);
    if (call) out.push(call);
  }

  // 2) Naked JSON envelopes — match `{...}` lines that contain a tool/skill key.
  //    Keep it conservative: only treat objects that start at a line boundary
  //    and contain "tool":"..." / "skill":"..." / "script":"..." patterns.
  const nakedRe = /(^|\n)\s*(\{[\s\S]*?\})\s*(?=\n|$)/g;
  let n: RegExpExecArray | null;
  while ((n = nakedRe.exec(text)) !== null) {
    const candidate = n[2];
    if (!/"(?:tool|skill|script|agent)"\s*:/.test(candidate)) continue;
    // Skip if it was already captured inside a fenced block above.
    if (out.some((c) => c.raw.includes(candidate))) continue;
    const env = tryParseJson(candidate);
    const call = envelopeToCall(env, n[0]);
    if (call) out.push(call);
  }

  // 3) @[script.py] explicit python agent trigger
  const atRe = /@\[\s*([\p{L}\p{N}_\-./]+\.py)\s*\]/gu;
  let a: RegExpExecArray | null;
  while ((a = atRe.exec(text)) !== null) {
    const script = a[1];
    if (PY_SCRIPT_RE.test(script)) {
      out.push({ kind: "python_agent", script, query: "", raw: a[0] });
    }
  }

  return out;
}

/**
 * Strip every recognised protocol envelope from the assistant text so the
 * chat bubble renders prose only. Preserves surrounding paragraphs.
 */
export function stripProtocolBlocks(text: string): string {
  if (!text) return text;
  const calls = extractProtocolCalls(text);
  let out = text;
  // Sort by raw length descending so we never break partial matches.
  for (const c of [...calls].sort((x, y) => y.raw.length - x.raw.length)) {
    if (c.kind === "python_agent") {
      // Mention vs trigger: ajan adını okunabilir bırak (`@[ddos_sentry.py]`
      // → `ddos_sentry`). Gerçek dispatch zaten ProtocolCall üstünden ayrı
      // kanalda işleniyor; bubble metninde ismi silmeye gerek yok.
      const bare = c.script.replace(/\.py$/i, "").replace(/^.*[\\/]/, "");
      out = out.split(c.raw).join(bare);
    } else {
      out = out.split(c.raw).join("");
    }
  }
  // Collapse 3+ blank lines created by removal.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Streaming sırasında modelin YARIM yazdığı protokol bloğunu önden gizler.
 * Henüz kapanmamış ```skill_call / ```tool_call / ```python_agent fence'ini
 * ve yarım `{ "tool": ... }` / `{ "skill": ... }` envelope'unu kullanıcıya
 * göstermeden yerine sade bir bekleme placeholder'ı koyar.
 */
export function maskInflightProtocol(text: string): string {
  if (!text) return text;
  let out = stripProtocolBlocks(text);
  const openFence = out.match(/```(?:tool_call|skill_call|python_agent)\b[\s\S]*$/);
  if (openFence) {
    out = out.slice(0, openFence.index).replace(/\s+$/, "");
    return (out + (out ? "\n\n" : "") + "⚙ skill hazırlanıyor…").trim();
  }
  const openJson = out.match(/(^|\n)\s*\{[^{}]*"(?:tool|skill|script|agent)"\s*:[^{}]*$/);
  if (openJson) {
    out = out.slice(0, openJson.index).replace(/\s+$/, "");
    return (out + (out ? "\n\n" : "") + "⚙ skill hazırlanıyor…").trim();
  }
  return out;
}

/** Stable JSON stringify for dedup keys. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
}

export function callDedupKey(c: ProtocolCall): string {
  if (c.kind === "tool") return `tool::${c.id}::${stableStringify(c.params)}`;
  if (c.kind === "skill") return `skill::${c.slug}::${stableStringify(c.params)}`;
  return `py::${c.script}::${c.query}`;
}

// ---------------------------------------------------------------------------
// FAZ 1 — Dispatch Mutex (in-process, TTL 30s)
// Aynı turda aynı (capability, params) için tetiklenen tekrarlı çağrıları
// tek bir Promise'a havale eder. Anayasaya göre sol chat ekranı bir daha
// donmasın, aynı skill iki kere koşmasın.
// ---------------------------------------------------------------------------

const MUTEX_TTL_MS = 30_000;
const inflightDispatch = new Map<string, { p: Promise<unknown>; at: number }>();

export function makeDispatchKey(capabilityId: string, params: unknown, turnId?: string): string {
  return `${capabilityId}::${stableStringify(params)}::${turnId ?? "_"}`;
}

export async function dispatchWithMutex<T>(
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  // TTL kapsamında biten/expire olan girişleri temizle.
  for (const [k, v] of inflightDispatch) {
    if (now - v.at > MUTEX_TTL_MS) inflightDispatch.delete(k);
  }
  const hit = inflightDispatch.get(key);
  if (hit) return hit.p as Promise<T>;
  const p = factory().finally(() => {
    // İcra bitince hemen sil; başka tur tekrar koşabilsin.
    inflightDispatch.delete(key);
  });
  inflightDispatch.set(key, { p, at: now });
  return p;
}
