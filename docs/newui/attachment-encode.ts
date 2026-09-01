import type { Attachment } from "@/components/sovereign/composer";

/**
 * Attachment encoding plane.
 *
 * The composer holds attachments as `blob:` object URLs — cheap for preview,
 * useless for persistence (they die on reload) and useless for the model (the
 * backend cannot fetch a browser blob). Before a turn is dispatched every
 * attachment is baked into a `data:<mime>;base64,…` URL so it can be
 * (a) written into the thread and survive a reload, and
 * (b) sent to `/api/chat/orchestrate` in OpenAI multimodal content format.
 */

/** Hard ceiling per attachment — larger files are referenced, not inlined. */
export const INLINE_LIMIT_BYTES = 8 * 1024 * 1024;

const isDataUrl = (u?: string) => !!u && u.startsWith("data:");

/** Read any blob/object URL into a base64 data URL. */
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

/**
 * Bake every attachment of a turn into a persistable data URL.
 * Oversized files keep their object URL and are flagged `inline: false`.
 */
export async function encodeAttachments(list: Attachment[]): Promise<Attachment[]> {
  return Promise.all(
    list.map(async (a) => {
      if (!a.url || isDataUrl(a.url)) return a;
      if (a.size > INLINE_LIMIT_BYTES) return a;
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
 *
 * Text-only turns stay a plain string (cheapest wire shape). As soon as one
 * attachment is present the turn becomes an array of typed blocks, which is
 * what vision-capable models require:
 *
 *   [{ type: "text", text: "…" },
 *    { type: "image_url", image_url: { url: "data:image/jpeg;base64,…" } }]
 */
export function buildUserContent(text: string, files: Attachment[] = []): string | ChatContentPart[] {
  const usable = files.filter((f) => isDataUrl(f.url));
  if (!usable.length) return text;

  const parts: ChatContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });

  for (const f of usable) {
    const url = f.url as string;
    if (f.kind === "image") {
      parts.push({ type: "image_url", image_url: { url } });
      continue;
    }
    if (f.kind === "audio") {
      const base64 = url.slice(url.indexOf(",") + 1);
      parts.push({
        type: "input_audio",
        input_audio: { data: base64, format: audioFormat(f.mime, f.name) },
      });
      continue;
    }
    parts.push({ type: "file", file: { filename: f.name, file_data: url } });
  }

  /* A block array must never be empty — models reject a contentless turn. */
  if (!parts.some((p) => p.type === "text")) {
    parts.unshift({ type: "text", text: text || "Analyse the attached file(s)." });
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
