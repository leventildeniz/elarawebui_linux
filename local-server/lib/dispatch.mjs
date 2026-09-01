// =============================================================================
// dispatch.mjs — Faz 3
// Tek giriş: dispatchUserTurn({ text, threadId, username, sessionId })
//   Sıra: explicit (!slug | @[file]) -> vector match -> LLM router fallback.
// Bu dosya yalnızca KARAR verir; gerçek infazı (skill run / tool call / chat)
// caller yapar. Karar `runs` tablosuna yazılır.
// =============================================================================

import { randomUUID } from "node:crypto";
import {
  findCapabilityBySlug,
  findCapabilityByToolRef,
  listCapabilities,
} from "./capability-registry.mjs";

let _pool = null;
export function initDispatcher(pool) { _pool = pool; }

const EXPLICIT_SLUG_RE = /(?:^|\s)!([a-z0-9][a-z0-9-_]{1,79})\b/i;
const EXPLICIT_TOOL_RE = /@\[([^\]]{1,200})\]/;

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(t => t && t.length > 1);
}

// Weighted lexical scorer — pgvector geçene kadar köprü.
// • Name match çok güçlü (×3.0), tag orta (×1.5), description zayıf (×1.0).
// • Exact name eşleşmesi varsa +0.4 bonus (örn. "Translate" → translate skill).
// • Skor 0..1 aralığına clamp. Eşiği yüksek tutmak yanlış tetiklemeyi azaltır.
function scoreCapability(tokens, cap) {
  if (!tokens.length) return 0;
  const name = String(cap.name || "").toLowerCase();
  const desc = String(cap.description || "").toLowerCase();
  const tags = (cap.tags || []).map(t => String(t).toLowerCase());
  const joined = `${name} ${tags.join(" ")} ${desc}`.trim();
  if (!joined) return 0;

  let weighted = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (name.includes(t)) weighted += 3.0;
    else if (tags.some(tag => tag.includes(t))) weighted += 1.5;
    else if (desc.includes(t)) weighted += 1.0;
  }
  // Normalize by tokens * max weight so a query fully covered by name → 1.0.
  let score = weighted / (tokens.length * 3.0);

  // Exact name boost.
  const phrase = tokens.join(" ");
  if (name === phrase) score = Math.min(1, score + 0.4);

  return Math.max(0, Math.min(1, score));
}

async function vectorMatch(text, { threshold = 0.55, gap = 0.15 } = {}) {
  const tokens = tokenize(text);
  if (!tokens.length) return null;
  const caps = await listCapabilities({ enabledOnly: true });
  if (!caps.length) return null;
  const scored = caps
    .map(c => ({ cap: c, score: scoreCapability(tokens, c) }))
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  // Confidence gap: top1 must beat top2 by `gap`, else fall back to LLM router
  // so the operator decides instead of us picking a near-tie wrong skill.
  if (scored.length > 1 && (scored[0].score - scored[1].score) < gap) return null;
  return scored[0];
}

async function recordRun({ kind, capabilityId, threadId, username, sessionId, source, input }) {
  if (!_pool) return null;
  const id = randomUUID();
  try {
    await _pool.query(
      `INSERT INTO runs(id,kind,capability_id,thread_id,username,session_id,status,source,input)
         VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$8)`,
      [id, kind, capabilityId, threadId || null, username || null, sessionId || null, source, input || {}]
    );
  } catch (e) {
    console.warn(`[dispatch] runs insert failed: ${e.message}`);
    return null;
  }
  return id;
}

export async function dispatchUserTurn({ text, threadId, username, sessionId } = {}) {
  const q = String(text || "").trim();
  const base = { text: q, threadId, username, sessionId };

  // 1) Explicit !slug
  const slugM = q.match(EXPLICIT_SLUG_RE);
  if (slugM) {
    const cap = await findCapabilityBySlug(slugM[1]);
    if (cap) {
      const runId = await recordRun({
        kind: cap.kind, capabilityId: cap.id,
        threadId, username, sessionId,
        source: "explicit", input: { ...base, marker: `!${slugM[1]}` },
      });
      return { source: "explicit", capability: cap, runId, intent: { kind: cap.kind, mode: "execution" } };
    }
  }

  // 2) Explicit @[tool]
  const toolM = q.match(EXPLICIT_TOOL_RE);
  if (toolM) {
    const cap = await findCapabilityByToolRef(toolM[1]);
    if (cap) {
      const runId = await recordRun({
        kind: cap.kind, capabilityId: cap.id,
        threadId, username, sessionId,
        source: "explicit", input: { ...base, marker: `@[${toolM[1]}]` },
      });
      return { source: "explicit", capability: cap, runId, intent: { kind: cap.kind, mode: "execution" } };
    }
  }

  // 3) Weighted lexical match (TODO: capabilities.embedding kolonu + pgvector
  // sorgusu geldiğinde burası gerçek vector match'e geçecek).
  const vec = await vectorMatch(q);
  if (vec && vec.cap) {
    const runId = await recordRun({
      kind: vec.cap.kind, capabilityId: vec.cap.id,
      threadId, username, sessionId,
      source: "vector", input: { ...base, score: vec.score },
    });
    return { source: "vector", capability: vec.cap, score: vec.score, runId, intent: { kind: vec.cap.kind, mode: "execution" } };
  }

  // 4) LLM router fallback (caller'a bırakılır)
  const runId = await recordRun({
    kind: "chat", capabilityId: null,
    threadId, username, sessionId,
    source: "llm-router", input: base,
  });
  return { source: "llm-router", capability: null, runId, intent: { kind: "chat", mode: "fallback" } };
}

export async function finishRun(runId, { status, output = null, error = null } = {}) {
  if (!_pool || !runId) return;
  try {
    await _pool.query(
      `UPDATE runs SET status=$2, output=$3, error=$4,
                       finished_at=now(),
                       duration_ms=GREATEST(0,(EXTRACT(EPOCH FROM (now()-started_at))*1000)::int)
         WHERE id=$1`,
      [runId, status, output, error]
    );
  } catch (e) {
    console.warn(`[dispatch] finishRun failed: ${e.message}`);
  }
}
