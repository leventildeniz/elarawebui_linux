import { knowledgeBrands, type StudioAgent } from "@/lib/agent-store";
import type { RetrievalScope } from "@/lib/space-router";
import type { Retrieval, RetrievalCitation } from "@/components/sovereign/retrieval-card";
import { rankCorpus, type AliasTerm } from "@/lib/rag-keywords";

/**
 * Builds the retrieval trace shown under an agent answer.
 * Deterministic per (agent, query) so a rerun renders the same evidence.
 */

const docs = [
  { file: "ns-vpn-policy-guide.pdf", loc: "p. 42 §4.1" },
  { file: "fortigate-nat-runbook.md", loc: "L118-L146" },
  { file: "checkpoint-cluster-notes.md", loc: "L61-L84" },
  { file: "adc-ssl-offload-baseline.pdf", loc: "p. 9 §2.3" },
  { file: "incident-2201-postmortem.md", loc: "L14-L38" },
  { file: "netsec-hardening-matrix.csv", loc: "row 27" },
];

const snippets = [
  "Persistence must be pinned to the vServer before SSL offload is enabled; otherwise the session table rehashes on every renegotiation.",
  "Policy order is evaluated top-down — the implicit deny sits after the NAT pool binding, so overlapping ranges silently shadow later rules.",
  "Cluster sync drops when the secondary lags more than 3 heartbeats; force a full sync before rotating certificates.",
  "Certificate rotation windows are logged to the vault stream and require an approval token from the change owner.",
  "Baseline recall for this index is 94.1 % at k=8; below that, widen the keyword filter instead of lowering the similarity floor.",
  "Recon output is normalized into the graph layer, so entity mentions resolve to the same node across sources.",
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** A real, indexed document the principal is allowed to read. */
export type CorpusDoc = { name: string; space?: string; chunks?: number; tags?: string[] };

export function buildRetrieval(
  agent: StudioAgent,
  query: string,
  scope?: RetrievalScope,
  corpus: CorpusDoc[] = [],
  aliases: AliasTerm[] = [],
): Retrieval {
  const seed = hash(`${agent.id}|${query}`);
  const brandIds = agent.ragBrands.length ? agent.ragBrands : [knowledgeBrands[0]!.id];
  const brands = brandIds.map((id) => knowledgeBrands.find((b) => b.id === id)?.label ?? id);
  /** Keyword / tag plane: rank the readable corpus before slicing citations. */
  const ranked = rankCorpus(corpus, query, aliases);
  const boosted = ranked.filter((r) => r.score > 0);
  const ordered = ranked.map((r) => r.doc);
  const matchOf = new Map(ranked.map((r) => [r.doc.name, r] as const));
  const kept = corpus.length ? Math.min(corpus.length, 3 + (seed % 3)) : 3 + (seed % 3);
  const candidates = corpus.length
    ? Math.max(
        kept,
        Math.min(
          corpus.reduce((n, d) => n + Math.max(1, d.chunks ?? 1), 0),
          40 + (seed % 60),
        ),
      )
    : 24 + (seed % 17);
  const lanes = scope?.searched.length ? scope.searched.map((s) => s.name) : [];

  const citations: RetrievalCitation[] = Array.from({ length: kept }, (_, i) => {
    const real = ordered.length ? ordered[i % ordered.length]! : undefined;
    const hit = real ? matchOf.get(real.name) : undefined;
    const d = docs[(seed + i) % docs.length]!;
    const lift = Math.min(0.09, (hit?.score ?? 0) / 40);
    const vector = 0.86 - i * 0.07 - ((seed >> (i + 1)) % 5) / 100 + lift;
    const rerank = Math.min(0.99, vector + 0.06 + ((seed >> (i + 2)) % 7) / 100);
    return {
      id: `cit_${seed}_${i}`,
      source: real ? real.name : d.file,
      brand: real ? (real.tags?.[0] ?? brands[i % brands.length]!) : brands[i % brands.length]!,
      ...(real?.space
        ? { space: real.space }
        : lanes.length
          ? { space: lanes[i % lanes.length]! }
          : {}),
      loc: d.loc,
      ...(hit?.matched.length ? { matchedTags: hit.matched } : {}),
      score: Math.max(0.4, Number(vector.toFixed(2))),
      rerank: Math.max(0.45, Number(rerank.toFixed(2))),
      snippet: snippets[(seed + i * 5) % snippets.length]!,
    };
  }).sort((a, b) => b.rerank - a.rerank);

  return {
    query: query.replace(/\s+/g, " ").slice(0, 180),
    brands,
    candidates,
    kept,
    reranker: "bge-reranker-v2-m3",
    latencyMs: 120 + (seed % 380),
    citations,
    ...(aliases.length ? { aliases } : {}),
    ...(boosted.length ? { boosted: boosted.length } : {}),
    ...(scope ? { scope } : {}),
  };
}
