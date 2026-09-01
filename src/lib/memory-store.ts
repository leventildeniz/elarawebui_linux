import { seedNow } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";

/**
 * Memory subsystem state — working set, episodic traces, semantic facts and
 * the retention / compaction policy that governs them. Persisted locally.
 */

export type Jewel = "sapphire" | "emerald" | "amethyst" | "topaz" | "ruby";

export type MemoryScope = "global" | "workspace" | "agent" | "operator";

export type WorkingItem = {
  id: string;
  thread_id?: string;
  label: string;
  origin: string;
  tokens: number;
  pinned: boolean;
  tone: Jewel;
};

export type EpisodicTrace = {
  id: string;
  at: number;
  actor: string;
  summary: string;
  thread: string;
  tokens: number;
  outcome: "resolved" | "handover" | "failed";
};

export type SemanticFact = {
  id: string;
  key: string;
  value: string;
  scope: MemoryScope;
  confidence: number;
  source: string;
  updatedAt: number;
  locked: boolean;
};

export type MemoryPolicy = {
  contextWindow: number;
  compactAt: number;
  keepLastTurns: number;
  episodicRetentionDays: number;
  autoPromoteFacts: boolean;
  promoteThreshold: number;
  dedupe: boolean;
  redactSecrets: boolean;
  embedOnWrite: boolean;
  summarizer: string;
};

export type MemoryState = {
  working: WorkingItem[];
  episodic: EpisodicTrace[];
  facts: SemanticFact[];
  policy: MemoryPolicy;
};

const KEY = "elara.memory.v1";
const EVT = "elara:memory";

export const memoryScopes: { id: MemoryScope; label: string; tone: Jewel }[] = [
  { id: "global", label: "Global", tone: "sapphire" },
  { id: "workspace", label: "Workspace", tone: "emerald" },
  { id: "agent", label: "Agent", tone: "amethyst" },
  { id: "operator", label: "Operator", tone: "topaz" },
];
    
const uid = (p: string) => `${p}.${Math.random().toString(36).slice(2, 9)}`;

export function useMemoryStore() {
  const [state, setState] = useState<MemoryState>({
    working: [],
    episodic: [],
    facts: [],
    policy: {
      contextWindow: 8192,
      compactAt: 75,
      keepLastTurns: 6,
      episodicRetentionDays: 90,
      autoPromoteFacts: false,
      promoteThreshold: 0.8,
      dedupe: true,
      redactSecrets: true,
      embedOnWrite: false,
      summarizer: "",
    }
  });

  const sync = useCallback(async () => {
    try {
      const data = await fetchApi("/api/memory");
      if (!data?.ok) return;

      const policy: MemoryPolicy = {
        contextWindow: data.policy?.context_window ?? 8192,
        compactAt: data.policy?.compact_at ?? 75,
        keepLastTurns: data.policy?.keep_last_turns ?? 6,
        episodicRetentionDays: data.policy?.episodic_retention_days ?? 90,
        autoPromoteFacts: data.policy?.auto_promote_facts ?? false,
        promoteThreshold: data.policy?.promote_threshold ?? 0.8,
        dedupe: data.policy?.dedupe ?? true,
        redactSecrets: data.policy?.redact_secrets ?? true,
        embedOnWrite: data.policy?.embed_on_write ?? false,
        summarizer: data.policy?.summarizer || "",
      };

      const working: WorkingItem[] = (data.working || []).map((w: any) => ({
        id: w.id,
        thread_id: w.thread_id,
        label: w.label,
        origin: w.origin,
        tokens: w.tokens,
        pinned: !!w.pinned,
        tone: w.tone as Jewel,
      }));

      const episodic: EpisodicTrace[] = (data.episodic || []).map((e: any) => ({
        id: e.id,
        at: new Date(e.at).getTime(),
        actor: e.actor,
        summary: e.summary,
        thread: e.thread,
        tokens: e.tokens,
        outcome: e.outcome,
      }));

      const facts: SemanticFact[] = (data.facts || []).map((f: any) => ({
        id: f.id,
        key: f.key,
        value: f.value,
        scope: f.scope as MemoryScope,
        confidence: Number(f.confidence),
        source: f.source,
        updatedAt: new Date(f.updated_at).getTime(),
        locked: !!f.locked,
      }));

      setState({ working, episodic, facts, policy });
    } catch (e) {
      console.error("Failed to sync memory", e);
    }
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [sync]);

  const togglePin = useCallback(
    async (id: string) => {
      const item = state.working.find((w) => w.id === id);
      if (!item) return;
      await fetchApi(`/api/memory/working/${id}/pin`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: !item.pinned }),
      });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [state.working],
  );

  const dropWorking = useCallback(
    async (id: string) => {
      await fetchApi(`/api/memory/working/${id}`, { method: "DELETE" });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [],
  );

  const clearEpisodic = useCallback(async () => {
    await fetchApi(`/api/memory/episodic`, { method: "DELETE" });
    window.dispatchEvent(new CustomEvent(EVT));
  }, []);

  const promote = useCallback(
    async (trace: EpisodicTrace) => {
      await fetchApi("/api/memory/facts", {
        method: "POST",
        body: JSON.stringify({
          id: uid("f"),
          key: `episode.${trace.thread}`,
          value: trace.summary,
          scope: "workspace",
          confidence: 0.8,
          source: `episodic/${trace.id}`,
          locked: false,
        }),
      });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [],
  );

  const addFact = useCallback(
    async (fact: Omit<SemanticFact, "id" | "updatedAt">) => {
      await fetchApi("/api/memory/facts", {
        method: "POST",
        body: JSON.stringify({
          id: uid("f"),
          key: fact.key,
          value: fact.value,
          scope: fact.scope,
          confidence: fact.confidence,
          source: fact.source,
          locked: fact.locked,
        }),
      });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [],
  );

  const patchFact = useCallback(
    async (id: string, patch: Partial<SemanticFact>) => {
      await fetchApi(`/api/memory/facts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [],
  );

  const removeFact = useCallback(
    async (id: string) => {
      await fetchApi(`/api/memory/facts/${id}`, { method: "DELETE" });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [],
  );

  const patchPolicy = useCallback(
    async (patch: Partial<MemoryPolicy>) => {
      const payload: any = {};
      if (patch.contextWindow !== undefined) payload.context_window = patch.contextWindow;
      if (patch.compactAt !== undefined) payload.compact_at = patch.compactAt;
      if (patch.keepLastTurns !== undefined) payload.keep_last_turns = patch.keepLastTurns;
      if (patch.episodicRetentionDays !== undefined) payload.episodic_retention_days = patch.episodicRetentionDays;
      if (patch.autoPromoteFacts !== undefined) payload.auto_promote_facts = patch.autoPromoteFacts;
      if (patch.promoteThreshold !== undefined) payload.promote_threshold = patch.promoteThreshold;
      if (patch.dedupe !== undefined) payload.dedupe = patch.dedupe;
      if (patch.redactSecrets !== undefined) payload.redact_secrets = patch.redactSecrets;
      if (patch.embedOnWrite !== undefined) payload.embed_on_write = patch.embedOnWrite;
      if (patch.summarizer !== undefined) payload.summarizer = patch.summarizer;

      await fetchApi("/api/memory/policy", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [],
  );

  const resetPolicy = useCallback(async () => {
    await fetchApi("/api/memory/policy/reset", { method: "POST" });
    window.dispatchEvent(new CustomEvent(EVT));
  }, []);

  return {
    ...state,
    togglePin,
    dropWorking,
    clearEpisodic,
    promote,
    addFact,
    patchFact,
    removeFact,
    patchPolicy,
    resetPolicy,
  };
}
