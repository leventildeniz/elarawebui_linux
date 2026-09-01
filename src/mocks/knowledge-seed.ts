import type { KnowledgeState } from "@/lib/knowledge-store";

export const builtinWebhooks: { label: string; slug: string }[] = [
  { label: "Telegram", slug: "telegram" },
  { label: "MS Teams", slug: "teams" },
  { label: "WhatsApp", slug: "whatsapp" },
  { label: "Signal", slug: "signal" },
  { label: "Generic", slug: "generic" },
];

export const defaultKnowledge: KnowledgeState = {
  autoIngestion: false,
  autoReEnrich: false,
  batchSize: 500,
  embedModel: "default",
  health: {
    chunks: 0,
    ftsNull: 0,
    embedOk: 0,
    embedPending: 0,
    inProgress: 0,
    stale: 0,
    embedError: 0,
    parseOk: 0,
    parseLow: 0,
  },
  sources: [],
  webhooks: builtinWebhooks.map((w) => ({
    id: w.slug,
    label: w.label,
    slug: w.slug,
    enabled: false,
    secret: "",
    urlOverride: "",
    builtin: true,
    ingestToRag: true,
  })),
  brandAliases: [],
};
