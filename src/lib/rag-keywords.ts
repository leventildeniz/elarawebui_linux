import type { CapabilityPack } from "@/lib/capability-store";
import type { CorpusDoc } from "@/lib/rag-preview";

/**
 * Keyword / alias plane of retrieval.
 *
 * Three signals feed the same set:
 *  · the agent's own KEYWORDS / ALIAS field (Knowledge / RAG tab),
 *  · the brand keywords inherited from every capability pack bound to the agent,
 *  · the tags the uploader typed on each document in RAG Documents.
 *
 * Aliases never widen the permission boundary — spaces / brands stay the hard
 * filter. They only *boost* documents whose tags or names match, so the right
 * evidence surfaces first.
 */

export type AliasTerm = { term: string; from: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .trim();

const split = (s: string) =>
  s
    .split(/[,\n;]+/)
    .map((t) => norm(t))
    .filter((t) => t.length > 1);

/** Agent keywords + every bound pack's brand keywords, deduped, source-tagged. */
export function resolveAliases(
  agent: { ragKeywords?: string; packs?: string[] } | undefined,
  packs: CapabilityPack[] = [],
): AliasTerm[] {
  const out: AliasTerm[] = [];
  const seen = new Set<string>();
  const push = (term: string, from: string) => {
    if (!term || seen.has(term)) return;
    seen.add(term);
    out.push({ term, from });
  };

  for (const t of split(agent?.ragKeywords ?? "")) push(t, "agent");

  const bound = (agent?.packs ?? []).map(norm);
  for (const p of packs) {
    if (!bound.includes(norm(p.name)) && !bound.includes(norm(p.id))) continue;
    for (const k of p.brandKeywords ?? []) push(norm(k), p.name);
  }
  return out;
}

export type ScoredDoc = { doc: CorpusDoc; score: number; matched: string[] };

/**
 * Rank the readable corpus for a question.
 * Document tags carry the most weight — they are human-curated metadata.
 */
export function rankCorpus(
  corpus: CorpusDoc[],
  query: string,
  aliases: AliasTerm[] = [],
): ScoredDoc[] {
  const q = norm(query);
  const qWords = new Set(q.split(/\s+/).filter((w) => w.length > 2));
  const aliasSet = aliases.map((a) => a.term);
  /** alias terms the question itself mentions — those weigh double */
  const liveAliases = new Set(aliasSet.filter((a) => q.includes(a)));

  return corpus
    .map((doc) => {
      const tags = (doc.tags ?? []).map(norm);
      const name = norm(doc.name);
      const matched: string[] = [];
      let score = 0;

      for (const tag of tags) {
        if (qWords.has(tag) || q.includes(tag)) {
          score += 3;
          matched.push(tag);
        } else if (liveAliases.has(tag)) {
          score += 2.5;
          matched.push(tag);
        } else if (aliasSet.includes(tag)) {
          score += 1.5;
          matched.push(tag);
        }
      }
      for (const w of qWords) if (name.includes(w)) score += 1;
      for (const a of liveAliases) if (name.includes(a)) score += 0.75;

      return { doc, score, matched: [...new Set(matched)] };
    })
    .sort((a, b) => b.score - a.score || a.doc.name.localeCompare(b.doc.name));
}
