import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Turn = z.object({
  role: z.enum(["user", "agent"]),
  text: z.string(),
});

const Input = z.object({
  title: z.string().default("Session"),
  model: z.string().default("sovereign-1"),
  effort: z.string().default("high"),
  turns: z.array(Turn).max(200),
  sessionId: z.string().optional(),
  threadId: z.string().optional(),
});

export type CompactionBrief = {
  lede: string;
  objective: string;
  decisions: string[];
  open: string[];
  next: string[];
  digest: string[];
  sections: { heading: string; items: { label: string; text: string }[] }[];
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["lede", "objective", "decisions", "open", "next", "digest", "sections"],
  properties: {
    lede: { type: "string" },
    objective: { type: "string" },
    decisions: { type: "array", items: { type: "string" } },
    open: { type: "array", items: { type: "string" } },
    next: { type: "array", items: { type: "string" } },
    digest: { type: "array", items: { type: "string" } },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "items"],
        properties: {
          heading: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "text"],
              properties: { label: { type: "string" }, text: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM = `You are Elara, the assistant inside Sovereign Studio, writing a context-compaction handover.
Read the folded transcript and produce a precise, technical continuation note — the kind Zed or a high-end IDE writes when it compacts a thread.
Rules:
- Write in first person, calm and factual. No marketing tone, no filler.
- "digest": 4-8 one-line facts preserved from the folded turns.
- "sections": numbered technical memory. Use headings such as "Scope & Intent", "Decisions & Direction", "Open Threads", "Runtime State". Each item has a short label (e.g. D1, T1, "Working brief") and a dense one-or-two sentence text.
- Wrap identifiers, file paths, commands and values in \`backticks\`.
- Never invent facts that are not in the transcript. If something is unknown, say so plainly.
- Output JSON only, matching the schema.`;

export const compactContextWithModel = createServerFn({ method: "POST" })
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<CompactionBrief> => {
    // API endpointimiz olan "/api/memory/compact" kısmına gideceğiz.
    // Ancak createServerFn (TanStack) sunucu tarafında (Node) çalıştığı için 
    // fetch URL'si olarak localhost portunu kullanmalıyız. Vite SSR dev veya prod portu 3005 varsayalım.
    const port = process.env['PORT'] || 3005;
    const baseUrl = `http://127.0.0.1:${port}`;

    const res = await fetch(`${baseUrl}/api/memory/compact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-id": data.sessionId || "",
      },
      body: JSON.stringify({
        title: data.title,
        model: data.model,
        effort: data.effort,
        turns: data.turns,
        threadId: data.threadId || "unknown" 
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Sovereign Compaction failed (${res.status}). ${detail}`);
    }

    const parsed = await res.json();
    return parsed as CompactionBrief;
  });
