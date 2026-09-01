import { request } from "../core/client";

export interface KnowledgeSource {
  id: string;
  name: string;
  type: "file" | "url" | "drive" | "archive";
  chunks: number;
  progress: number;
  url?: string;
  username?: string;
  password?: string;
  mfaCode?: string;
  mfaEnabled?: boolean;
  cookie?: string;
  token?: string;
  tag?: string;
  preview?: string;
  notes?: string;
  crawlConfig?: any;
}

export interface KnowledgeCollection {
  id: string;
  chunks: number;
}

export interface KnowledgeBrand {
  brand: string;
  files: number;
  chunks: number;
}

export interface KnowledgeSearchResult {
  id: string;
  name: string;
  path: string;
  ext: string;
  size_bytes: number;
  rank: number;
}

export interface RetrievalRow {
  content: string;
  path: string;
  brand: string;
  ord: number;
  score: number;
  rerank_score: number;
}

export interface SyncJob {
  id: string;
  status: string;
  progress: number;
  total: number;
  stage?: string;
  scanned?: number;
  indexed?: number;
  skipped?: number;
  currentFile?: string;
  error?: string;
}

export const KnowledgeAPI = {
  // --- Read / List ---
  sources: () => request<{ ok: boolean; sources: KnowledgeSource[] }>(`/api/knowledge/sources`),
  collections: () => request<{ ok: boolean; items: KnowledgeCollection[] }>(`/api/knowledge/collections`),
  brands: () => request<{ ok: boolean; items: KnowledgeBrand[] }>(`/api/knowledge/brands`),
  libraryBrands: () => request<string[]>(`/api/knowledge/library-brands`),
  search: (params: any) => request<{ ok: boolean; results: KnowledgeSearchResult[] }>(`/api/knowledge/search?${new URLSearchParams(params)}`),
  chunkPreview: (params: any) => request<any>(`/api/knowledge/chunk-preview?${new URLSearchParams(params)}`),
  chunkReport: () => request<any>(`/api/knowledge/chunk-report`),
  brandAudit: (q: string) => request<any>(`/api/knowledge/brand-audit?q=${encodeURIComponent(q)}`),
  embeddingsHealth: () => request<any>(`/api/knowledge/embeddings/health`),

  // --- Ingest ---
  file: async (formData: FormData) => {
    // Using fetch directly for multipart/form-data to let the browser set the boundary
    const res = await fetch(`/api/knowledge/file`, {
      method: "POST",
      body: formData,
    });
    return res.json();
  },
  text: (data: any) => request<any>(`/api/knowledge/text`, { method: "POST", body: JSON.stringify(data) }),
  fetch: (data: any) => request<any>(`/api/knowledge/fetch`, { method: "POST", body: JSON.stringify(data) }),
  urlProbe: (data: any) => request<any>(`/api/knowledge/url-probe`, { method: "POST", body: JSON.stringify(data) }),
  indexDirectory: (data: any) => request<any>(`/api/knowledge/index-directory`, { method: "POST", body: JSON.stringify(data) }),
  updateBrand: (id: string, brand: string | null) => request<{ ok: boolean; updated: boolean }>(`/api/knowledge/source/${id}/brand`, { method: "PATCH", body: JSON.stringify({ brand }) }),
  updateCrawlConfig: (id: string, config: any) => request<{ ok: boolean }>(`/api/knowledge/source/${id}/crawl-config`, { method: "POST", body: JSON.stringify(config) }),

  // --- Synchronization ---
  sync: (data?: any) => request<{ ok: boolean; jobId: string; status: string }>(`/api/knowledge/sync`, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  syncEvents: (jobId: string) => `/api/knowledge/sync/${jobId}/events`,
  syncStatus: (jobId: string) => request<any>(`/api/knowledge/sync/${jobId}`),
  syncLog: (jobId: string) => request<string>(`/api/knowledge/sync/${jobId}/log`),
  syncCancel: (jobId: string) => request<{ ok: boolean }>(`/api/knowledge/sync/${jobId}/cancel`, { method: "POST" }),
  syncJobs: () => request<any>(`/api/knowledge/sync-jobs`),
  syncSource: (data: any) => request<{ ok: boolean }>(`/api/knowledge/sync-source`, { method: "POST", body: JSON.stringify(data) }),

  // --- Retrieval ---
  retrieve: (data: any) => request<{ ok: boolean; rows: RetrievalRow[]; meta: any }>(`/api/knowledge/retrieve`, { method: "POST", body: JSON.stringify(data) }),
  ragProbe: (data: any) => request<any>(`/api/rag/probe`, { method: "POST", body: JSON.stringify(data) }),
  ragSettings: {
    get: () => request<any>(`/api/rag/settings`),
    set: (settings: any) => request<any>(`/api/rag/settings`, { method: "POST", body: JSON.stringify(settings) }),
  },
  ragStatus: () => request<any>(`/api/rag/status`),
  ragHealth: () => request<any>(`/api/rag/health`),
  ragIntentTelemetry: () => request<any>(`/api/rag/intent-telemetry`),

  // --- Maintenance (Admin) ---
  embeddingsBackfill: () => request<any>(`/api/knowledge/embeddings/backfill`, { method: "POST" }),
  markPending: (data: any) => request<any>(`/api/knowledge/embeddings/mark-pending`, { method: "POST", body: JSON.stringify(data) }),
  libraryPath: (path: string) => request<any>(`/api/knowledge/embeddings/library-path`, { method: "POST", body: JSON.stringify({ path }) }),
  validate: () => request<any>(`/api/knowledge/validate`, { method: "POST" }),
  cleanup: (data: any) => request<any>(`/api/knowledge/cleanup`, { method: "POST", body: JSON.stringify(data) }),
  purge: (data: any) => request<any>(`/api/knowledge/purge`, { method: "POST", body: JSON.stringify(data) }),
  urlPurgeAll: (data: any) => request<any>(`/api/knowledge/url-purge-all`, { method: "POST", body: JSON.stringify(data) }),
  urlRechunkAll: (data: any) => request<any>(`/api/knowledge/url-rechunk-all`, { method: "POST", body: JSON.stringify(data) }),
  checkpointUrlPurge: (data: any) => request<any>(`/api/knowledge/checkpoint-url-purge`, { method: "POST", body: JSON.stringify(data) }),
  retryEmbeddings: () => request<any>(`/api/rag/retry-embeddings`, { method: "POST" }),
  repairFts: () => request<any>(`/api/rag/repair-fts`, { method: "POST" }),
  dedupeChunks: () => request<any>(`/api/rag/dedupe-chunks`, { method: "POST" }),
  brandBackfill: () => request<any>(`/api/rag/brand-backfill`, { method: "POST" }),
  nukeReindex: () => request<any>(`/api/rag/nuke-reindex`, { method: "POST" }),
  diagnoseCorpus: () => request<any>(`/api/rag/diagnose-corpus`),
  diagnoseQuery: () => request<any>(`/api/rag/diagnose-query`),
  diagnoseHtml: () => request<any>(`/api/rag/diagnose-html`),
  diagnoseJoin: () => request<any>(`/api/rag/diagnose-join`),
  selfAudit: () => request<any>(`/api/rag/self-audit`),
  brandAliases: {
    get: () => request<any>(`/api/rag/brand-aliases`),
    set: (data: any) => request<any>(`/api/rag/brand-aliases`, { method: "POST", body: JSON.stringify(data) }),
    reenrich: () => request<any>(`/api/rag/brand-aliases/reenrich`, { method: "POST" }),
  },
};
