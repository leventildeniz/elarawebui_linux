/** /knowledge — vector forge inventory and sync journal placeholder data. */

export const tableInventory = [
  { name: "knowledge_chunks", rows: 151794, size: "3.12 GB", weight: 1 },
  { name: "knowledge_sources", rows: 0, size: "299.93 MB", weight: 0.1 },
  { name: "knowledge_edges", rows: 0, size: "257.80 MB", weight: 0.085 },
  { name: "knowledge_files", rows: 0, size: "171.67 MB", weight: 0.056 },
  { name: "knowledge_entities", rows: 0, size: "33.63 MB", weight: 0.012 },
  { name: "chat_messages", rows: 901, size: "1.08 MB", weight: 0.004 },
  { name: "runs", rows: 1789, size: "1016.0 KB", weight: 0.003 },
  { name: "agent_logs", rows: 2259, size: "992.0 KB", weight: 0.003 },
  { name: "agent_run_history", rows: 221, size: "840.0 KB", weight: 0.003 },
  { name: "skills", rows: 41, size: "488.0 KB", weight: 0.002 },
  { name: "agents", rows: 28, size: "464.0 KB", weight: 0.002 },
  { name: "vault_audit", rows: 491, size: "408.0 KB", weight: 0.002 },
  { name: "capability_packs", rows: 10, size: "288.0 KB", weight: 0.002 },
  { name: "app_user_prefs", rows: 1, size: "264.0 KB", weight: 0.002 },
  { name: "forge_plans", rows: 37, size: "256.0 KB", weight: 0.002 },
];

export type SyncJob = {
  id: string;
  kind: "embed" | "drain" | "ingest";
  state: "running" | "done" | "failed";
  when: string;
  items: string;
  done: number;
  total: number;
  source: string;
};

export const syncJobs: SyncJob[] = [
  {
    id: "job_8842",
    kind: "embed",
    state: "running",
    when: "2026-08-17 00:41",
    items: "612 / 1,024",
    done: 612,
    total: 1024,
    source: "netscaler-docs/",
  },
  {
    id: "job_8841",
    kind: "embed",
    state: "done",
    when: "2026-08-16 22:14",
    items: "1,024 / 1,024",
    done: 1024,
    total: 1024,
    source: "fortigate-kb/",
  },
  {
    id: "job_8840",
    kind: "drain",
    state: "done",
    when: "2026-08-16 21:02",
    items: "3 / 3",
    done: 3,
    total: 3,
    source: "error queue",
  },
  {
    id: "job_8836",
    kind: "embed",
    state: "failed",
    when: "2026-08-15 18:47",
    items: "412 / 1,000",
    done: 412,
    total: 1000,
    source: "vmware-pdfs/",
  },
  {
    id: "job_8829",
    kind: "ingest",
    state: "done",
    when: "2026-08-15 09:20",
    items: "118,402 chunks",
    done: 118402,
    total: 118402,
    source: "corpus bulk import",
  },
];

export const syncLiveLines = [
  "worker attached · batch 500 · concurrency 4",
  "pulling pending chunks from queue …",
  "embedding batch 1/3 · BAAI/bge-m3",
  "batch 1 committed · 512 vectors · 1.84s",
  "embedding batch 2/3 · BAAI/bge-m3",
  "hnsw index refresh · m=16 ef=64",
  "batch 2 committed · 100 vectors · 0.41s",
  "fts tsvector backfill · 612 rows",
];
