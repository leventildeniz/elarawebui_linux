import { useCallback, useEffect, useState } from "react";

/**
 * RAG query telemetry — every retrieval-backed answer writes one row here so
 * the reporting layer can answer "who queried what, against which space, and
 * how much evidence came back". Local until the retrieval layer gets a backend.
 */

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

const KEY = "elara.rag.queries.v1";
const EVT = "elara:rag-queries";
const CAP = 400;

function read(): RagQueryEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RagQueryEvent[]) : [];
  } catch {
    return [];
  }
}

function write(rows: RagQueryEvent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, CAP)));
  } catch {
    /* quota — telemetry is best effort */
  }
  window.dispatchEvent(new Event(EVT));
}

export function logRagQuery(e: Omit<RagQueryEvent, "id" | "at">) {
  const row: RagQueryEvent = {
    ...e,
    id: `rq.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
  };
  write([row, ...read()]);
}

export function useRagQueries() {
  const [rows, setRows] = useState<RagQueryEvent[]>([]);

  useEffect(() => {
    const sync = () => setRows(read());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const clear = useCallback(() => write([]), []);
  return { rows, clear };
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
