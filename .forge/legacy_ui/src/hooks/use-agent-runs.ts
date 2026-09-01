// use-agent-runs.ts — Tek mercii canlı agent run snapshot'ı.
// Agents sayfası + Dashboard Command Center bu hook'a yaslanır → state sync
// garanti, çakışan ayrı poller yok. 1.5sn poll, document hidden iken durur.

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentsAPI, type LiveAgentRun } from "@/lib/api-client";

const POLL_MS = 1500;

export interface AgentRunsState {
  runs: LiveAgentRun[];
  counts: Record<string, number>;
  lastUpdate: number;
  refresh: () => Promise<void>;
  isLive: (agentId: string) => boolean;
  runsFor: (agentId: string) => LiveAgentRun[];
  cancel: (agentId: string, opts?: { runId?: string; graceMs?: number }) => Promise<void>;
}

export function useAgentRuns(enabled: boolean = true): AgentRunsState {
  const [runs, setRuns] = useState<LiveAgentRun[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lastUpdate, setLastUpdate] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const snap = await AgentsAPI.listRuns();
      setRuns(snap.runs || []);
      setCounts(snap.counts || {});
      setLastUpdate(snap.ts || Date.now());
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document === "undefined" || !document.hidden) {
        await refresh();
      }
      if (cancelled) return;
      timerRef.current = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, refresh]);

  const cancel = useCallback(
    async (agentId: string, opts?: { runId?: string; graceMs?: number }) => {
      await AgentsAPI.cancel(agentId, opts ?? {});
      // Optimistic mark — server will reflect on next poll.
      setRuns((prev) =>
        prev.map((r) =>
          (opts?.runId ? r.runId === opts.runId : r.agentId === agentId)
            ? { ...r, cancelRequested: true }
            : r,
        ),
      );
      void refresh();
    },
    [refresh],
  );

  const isLive = useCallback(
    (agentId: string) => (counts[agentId] || 0) > 0,
    [counts],
  );
  const runsFor = useCallback(
    (agentId: string) => runs.filter((r) => r.agentId === agentId),
    [runs],
  );

  return { runs, counts, lastUpdate, refresh, isLive, runsFor, cancel };
}
