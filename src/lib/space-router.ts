import type { KnowledgeSpace, SpaceCtx } from "@/lib/knowledge-space-store";
import { canReadSpace } from "@/lib/knowledge-space-store";

/**
 * Space routing — how a natural-language question is mapped onto the RAG
 * permission boundary before a single chunk is read.
 *
 * Two passes:
 *  1. AUTHORISE — keep only spaces the principal may read (sovereign = all).
 *     Everything else is recorded as `blocked`, so the answer can say
 *     "marketing exists but is closed to you" without leaking its content.
 *  2. ROUTE — score the surviving spaces against the question (name, slug and
 *     description tokens, plus a small tr/en synonym table). Hits win; when
 *     nothing hits, every readable space is searched.
 */

export type ScopedSpace = { id: string; name: string; hit: boolean };

export type RetrievalScope = {
  searched: ScopedSpace[];
  blocked: string[];
  routedBy: "keyword" | "all";
};

/** Extra words that should steer a question towards a space. */
const SYNONYMS: Record<string, string[]> = {
  technical: [
    "teknik",
    "technical",
    "runbook",
    "vendor",
    "config",
    "engineering",
    "doküman",
    "dokuman",
  ],
  marketing: ["pazarlama", "marketing", "brand", "kampanya", "campaign", "deck", "collateral"],
  shared: ["shared", "ortak", "genel", "company", "şirket", "sirket"],
  legal: ["legal", "hukuk", "sözleşme", "sozlesme", "contract"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c");

function score(space: KnowledgeSpace, q: string): number {
  const text = norm(q);
  const words = [
    ...norm(space.name).split(/\s+/),
    norm(space.slug),
    ...(SYNONYMS[space.slug] ?? []).map(norm),
    ...norm(space.description)
      .split(/\s+/)
      .filter((w) => w.length > 5),
  ].filter((w) => w.length > 2);
  let n = 0;
  for (const w of new Set(words)) if (text.includes(w)) n++;
  return n;
}

export function resolveScope(
  query: string,
  spaces: KnowledgeSpace[],
  ctx: SpaceCtx,
): RetrievalScope {
  const readable = spaces.filter((s) => canReadSpace(s, ctx));
  const blocked = spaces.filter((s) => !readable.includes(s)).map((s) => s.name);

  const scored = readable.map((s) => ({ space: s, n: score(s, query) }));
  const hits = scored.filter((x) => x.n > 0);
  const chosen = hits.length ? hits : scored;

  return {
    searched: chosen
      .sort((a, b) => b.n - a.n)
      .map(({ space, n }) => ({ id: space.id, name: space.name, hit: n > 0 })),
    blocked,
    routedBy: hits.length ? "keyword" : "all",
  };
}

/**
 * Space-bound agents: intersect the routed scope with the agent's own space.
 * The agent can only ever remove spaces from the caller's readable set — if
 * the caller cannot read the bound space, the result is an empty search and
 * the space is reported as blocked instead of silently widened.
 */
export function narrowScopeToSpace(
  scope: RetrievalScope,
  spaceId: string | undefined,
  spaces: KnowledgeSpace[],
): RetrievalScope {
  if (!spaceId) return scope;
  const bound = spaces.find((s) => s.id === spaceId);
  const searched = scope.searched.filter((s) => s.id === spaceId);
  return {
    searched: searched.map((s) => ({ ...s, hit: true })),
    blocked: searched.length
      ? scope.blocked
      : [...new Set([...scope.blocked, bound?.name ?? spaceId])],
    routedBy: "keyword",
  };
}
