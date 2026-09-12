import type { Attachment } from "@/components/sovereign/composer";

/**
 * Attachment encoding & hybrid storage plane.
 *
 * The composer holds attachments as `blob:` object URLs — cheap for preview,
 * useless for persistence (they die on reload) and useless for the model (the
 * backend cannot fetch a browser blob).
 *
 * Before a turn is dispatched, every attachment is:
 * (a) Uploaded to shared storage via `POST /api/chat/attachments` -> `/api/uploads/:id`
 * (b) Kept as lightweight reference in thread state and PostgreSQL (zero DB bloat)
 * (c) Delivered to the LLM backend where images/PDFs are resolved on-the-fly.
 */

/** Hard ceiling per attachment */
export const INLINE_LIMIT_BYTES = 50 * 1024 * 1024;

export const isDataUrl = (u?: string) => !!u && u.startsWith("data:");
export const isPersistedUrl = (u?: string) =>
  !!u && (u.startsWith("data:") || u.startsWith("/api/uploads/") || u.startsWith("http://") || u.startsWith("https://"));

/** Read any blob/object URL into a base64 data URL (fallback). */
export async function toDataUrl(url: string, mime?: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const typed = mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(typed);
    });
  } catch {
    return null;
  }
}

/** Upload a blob attachment to /api/chat/attachments and get a persistent /api/uploads/:id URL */
export async function uploadAttachmentToServer(
  url: string,
  name: string,
  mime?: string,
  threadId?: string,
): Promise<{ id: string; url: string } | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const typed = mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob;

    const formData = new FormData();
    formData.append("file", typed, name);
    if (threadId) formData.append("thread_id", threadId);

    const uploadRes = await fetch("/api/chat/attachments", {
      method: "POST",
      body: formData,
    });

    if (uploadRes.ok) {
      const data = await uploadRes.json();
      if (data?.file?.url) {
        return { id: data.file.id, url: data.file.url };
      }
      if (data?.url) {
        return { id: data.id, url: data.url };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Bake every attachment of a turn into a server-persisted URL (/api/uploads/:id) or Base64 fallback.
 */
export async function encodeAttachments(list: Attachment[], threadId?: string): Promise<Attachment[]> {
  return Promise.all(
    list.map(async (a) => {
      if (!a.url) return a;
      if (isPersistedUrl(a.url) && !a.url.startsWith("blob:")) return a;
      if (a.size > INLINE_LIMIT_BYTES) return a;

      // 1. Primary: Upload to shared storage server
      const uploaded = await uploadAttachmentToServer(a.url, a.name, a.mime, threadId);
      if (uploaded?.url) {
        return { ...a, id: uploaded.id || a.id, url: uploaded.url };
      }

      // 2. Fallback: Base64 data URL
      const data = await toDataUrl(a.url, a.mime);
      return data ? { ...a, url: data } : a;
    }),
  );
}

/* ------------------------------------------------- OpenAI multimodal content */

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export type WireMessage = {
  role: "user" | "assistant" | "system";
  content: string | ChatContentPart[];
};

const audioFormat = (mime?: string, name?: string) => {
  const fromMime = mime?.split("/")[1]?.replace("mpeg", "mp3").replace("x-m4a", "m4a");
  const fromName = name?.split(".").pop()?.toLowerCase();
  return (fromMime || fromName || "webm").split(";")[0] as string;
};

/**
 * Build the `content` of a user turn.
 */
export function buildUserContent(text: string, files: Attachment[] = []): string | ChatContentPart[] {
  const usable = files.filter((f) => isPersistedUrl(f.url));
  if (!usable.length) return text;

  const parts: ChatContentPart[] = [];

  for (const f of usable) {
    const url = f.url as string;
    if (f.kind === "image") {
      parts.push({ type: "image_url", image_url: { url } });
      continue;
    }
    if (f.kind === "audio") {
      if (url.startsWith("data:")) {
        const base64 = url.slice(url.indexOf(",") + 1);
        parts.push({
          type: "input_audio",
          input_audio: { data: base64, format: audioFormat(f.mime, f.name) },
        });
      } else {
        parts.push({ type: "file", file: { filename: f.name, file_data: url } });
      }
      continue;
    }
    parts.push({ type: "file", file: { filename: f.name, file_data: url } });
  }

  // Put text LAST, after attachments, for optimal LLM context attention
  if (text.trim()) {
    parts.push({ type: "text", text: text.trim() });
  } else if (!parts.some((p) => p.type === "text")) {
    parts.push({ type: "text", text: "Analyse the attached file(s)." });
  }

  return parts;
}

/** Whole-thread transcript in wire format, ready for `POST /api/chat/orchestrate`. */
export function buildWireMessages(
  history: { role: "user" | "agent"; text: string; files?: Attachment[] }[],
  pinnedContext?: string,
): WireMessage[] {
  const out: WireMessage[] = [];
  if (pinnedContext?.trim()) out.push({ role: "system", content: pinnedContext.trim() });
  for (const m of history) {
    out.push(
      m.role === "user"
        ? { role: "user", content: buildUserContent(m.text, m.files ?? []) }
        : { role: "assistant", content: m.text },
    );
  }
  return out;
}
