import type { ChatFile, ChatMessage, ChatThread } from "@/lib/chat-store";

/**
 * Chat persistence transport.
 *
 * The desk (localStorage) stays the offline cache and the instant-paint source;
 * this module is the authority when the backend answers. Every call fails
 * *soft*: a network error or a non-2xx response returns `null`, the store keeps
 * the local copy, and the UI never blocks on the API.
 */

const BASE = "/api";

/** Wire shape of a thread row. Kept flat so the backend can map it 1:1 to SQL. */
export type ThreadDTO = {
  id: string;
  title: string;
  pinned: boolean;
  color: ChatThread["color"];
  createdAt: number;
  context?: string;
  branchedFrom?: string;
  titleLocked?: boolean;
  files?: ChatFile[];
  messages?: ChatMessage[];
};

export const toDTO = (t: ChatThread): ThreadDTO => ({
  id: t.id,
  title: t.title,
  pinned: t.pinned,
  color: t.color,
  createdAt: t.createdAt,
  ...(t.context ? { context: t.context } : {}),
  ...(t.branchedFrom ? { branchedFrom: t.branchedFrom } : {}),
  ...(t.titleLocked ? { titleLocked: true } : {}),
  files: t.files ?? [],
  messages: t.messages ?? [],
});

export const fromDTO = (d: ThreadDTO): ChatThread => ({
  id: d.id,
  title: d.title ?? "New chat",
  pinned: !!d.pinned,
  color: d.color ?? "none",
  createdAt: d.createdAt ?? Date.now(),
  messages: d.messages ?? [],
  files: d.files ?? [],
  ...(d.context ? { context: d.context } : {}),
  ...(d.branchedFrom ? { branchedFrom: d.branchedFrom } : {}),
  ...(d.titleLocked ? { titleLocked: true } : {}),
});

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...init,
    });
    if (!res.ok) return null;
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** GET /api/chat/threads — full history of the signed-in principal. */
export async function apiListThreads(): Promise<ChatThread[] | null> {
  const body = await call<{ threads?: ThreadDTO[] } | ThreadDTO[]>("/threads");
  if (!body) return null;
  const rows = Array.isArray(body) ? body : (body.threads ?? []);
  return rows.map(fromDTO);
}

/** POST /api/chat/threads — create. */
export async function apiCreateThread(t: ChatThread) {
  return call<ThreadDTO>("/threads", { method: "POST", body: JSON.stringify(toDTO(t)) });
}

/** PATCH /api/chat/threads/:id — title, pin, colour, context. */
export async function apiPatchThread(id: string, patch: Partial<ThreadDTO>) {
  return call<ThreadDTO>(`/threads/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** PUT /api/chat/threads/:id/messages — replace the transcript of a thread. */
export async function apiPutMessages(id: string, messages: ChatMessage[]) {
  return call<{ ok: true }>(`/threads/${encodeURIComponent(id)}/messages`, {
    method: "PUT",
    body: JSON.stringify({ messages }),
  });
}

/** PUT /api/chat/threads/:id/files — replace the file rail of a thread. */
export async function apiPutFiles(id: string, files: ChatFile[]) {
  return call<{ ok: true }>(`/threads/${encodeURIComponent(id)}/files`, {
    method: "PUT",
    body: JSON.stringify({ files }),
  });
}

/** DELETE /api/chat/threads/:id */
export async function apiDeleteThread(id: string) {
  return call<{ ok: true }>(`/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
}
