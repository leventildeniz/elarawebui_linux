/**
 * RAG query telemetry — every retrieval-backed answer writes to PostgreSQL via /api/reporting/rag/query
 * so the reporting layer can answer "who queried what, against which space, and how much evidence came back".
 */

import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";

export type RagQueryEvent = {
  id: string;
  at: number;
  query: string;
  principal: string;
  principalId: string;
  agent: string;
  spaces: string[];
  blocked: number;
  docs: number;
  chunks: number;
  hit: boolean;
};

const EVT = "elara:rag-queries";

export async function logRagQuery(e: Omit<RagQueryEvent, "id" | "at">) {
  try {
    const res = await fetchApi("/reporting/rag/query", {
      method: "POST",
      body: JSON.stringify(e),
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(EVT, { detail: res }));
    }
  } catch (err) {
    console.warn("[logRagQuery] Telemetry write failed:", err);
  }
}

export function useRagQueries() {
  const [rows, setRows] = useState<RagQueryEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const sync = useCallback(() => {
    fetchApi("/reporting/rag")
      .then((res) => {
        if (res?.queries) {
          setRows(res.queries);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("[useRagQueries] Failed to fetch queries:", err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    sync();
    if (typeof window === "undefined") return;
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [sync]);

  const clear = useCallback(() => setRows([]), []);
  return { rows, clear, loading, refresh: sync };
}

/** Group a list into ranked buckets. */
export function rank<T>(
  items: T[],
  key: (t: T) => string,
  value: (t: T) => number = () => 1,
): { label: string; value: number; share: number }[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + value(it));
  }
  const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  return [...map.entries()]
    .map(([label, v]) => ({ label, value: v, share: Math.round((v / total) * 1000) / 10 }))
    .sort((a, b) => b.value - a.value);
}
