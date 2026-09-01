import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import {
  Send, Plus, Download, FileDown, Mic, Paperclip,
  Copy, RefreshCw, Trash2, Edit3, Loader2, AlertCircle, FileText, X, Network,
  Sparkles, Globe, Bot, Camera, Square, Volume2, VolumeX, Image as ImageIcon, Phone, Cpu,
  Brain, Eraser, Terminal, ChevronDown, ShieldCheck, Wrench, ThumbsUp, ThumbsDown, Info, Zap,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LiveCall } from "@/components/live-call";
import { useVoice, detectLang } from "@/lib/voice-store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import { flushSync } from "react-dom";
import { ChatAPI, LogsAPI, UploadsAPI, AgentsAPI, SystemAPI, ProvidersAPI, AppSettingsAPI, TemplatesAPI, ForgeAPI, SkillsAPI, RagDebugAPI, resolveApiBaseUrl, actorHeaders, createChatTraceId, recordChatTrace, getChatTrace, type ChatTraceEvent, type ChatMessage, type ChatThread, type UploadMeta, type ModelDTO, type AiProviderDTO, type AiRoutingPolicy, type TemplateDTO, type ActionDef, type SkillDef, type RagSource, type RagPayload, type RagDebugResult } from "@/lib/api-client";

type ChatAgentOption = {
  id: string;
  agentName: string;
  role: string;
  status: "active" | "idle" | "error";
  description: string;
};

function upsertMessageById<T extends ChatMessage>(rows: T[], msg: T): T[] {
  return rows.some((m) => m.id === msg.id) ? rows.map((m) => (m.id === msg.id ? msg : m)) : [...rows, msg];
}

function dedupeMessages<T extends ChatMessage>(rows: T[]): T[] {
  const seenIds = new Set<string>();
  const out: T[] = [];
  for (const msg of rows) {
    if (seenIds.has(msg.id)) continue;
    seenIds.add(msg.id);
    const prev = out[out.length - 1];
    if (prev && prev.thread_id === msg.thread_id && prev.role === msg.role && prev.content === msg.content && (prev.model ?? "") === (msg.model ?? "")) {
      continue;
    }
    out.push(msg);
  }
  return out;
}
import { SkillRunDrawer } from "@/components/skill-action-drawer";
import { SkillUsageCard } from "@/components/skill-usage-card";
import { Link } from "@tanstack/react-router";
import { getEnabledTools } from "./_app.tools";
import { checkInput, checkOutput, GuardViolation } from "@/lib/safety";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import jsPDF from "jspdf";
import { ensureUnicodeFont } from "@/lib/pdf-fonts";
import { getUUID } from "@/lib/uuid";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useUsers } from "@/lib/users-store";
import { useSystem } from "@/lib/system-store";
import { avatarFor } from "@/lib/avatars";
import { useModelIdentity } from "@/lib/model-identity-store";
import { ChatComposer, type ChatComposerHandle } from "@/components/chat-composer";
import { ChatThreadList } from "@/components/chat-thread-list";
import { ChatDebugOverlay } from "@/components/chat-debug-overlay";
import { expandEmojiShortcodes } from "@/lib/emoji";
import { useRbac } from "@/lib/rbac";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/** Strip vendor/quant/parameter suffixes for a clean brand display.
 *  e.g. "elara-72b-local" → "ELARA", "qwen2.5:72b-instruct" → "QWEN2.5". */
function prettyModelName(raw: string | null | undefined): string {
  if (!raw) return "";
  const head = String(raw).split(/[:/\\]/)[0];
  const brand = head.split("-")[0];
  return (brand || head || String(raw)).toUpperCase();
}

function buildThreadMd(title: string, messages: ChatMessage[], viewerName: string): string {
  const exportedAt = new Date();
  const models = Array.from(new Set(messages.map(m => m.model).filter(Boolean))) as string[];
  const prettyModels = Array.from(new Set(models.map(prettyModelName).filter(Boolean)));
  const tokens = messages.reduce((s, m) => s + (m.tokens ?? 0), 0);
  const userLabel = (viewerName || "user").toUpperCase();
  const front = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `exported_at: ${exportedAt.toISOString()}`,
    `messages: ${messages.length}`,
    `tokens: ${tokens}`,
    prettyModels.length ? `models: [${prettyModels.map(m => JSON.stringify(m)).join(", ")}]` : null,
    "---",
    "",
    `# ${title}`,
    "",
    `_Exported ${exportedAt.toLocaleString()} · ${messages.length} message(s)_`,
    "",
  ].filter(Boolean).join("\n");

  const body = messages.map(m => {
    const role = m.role === "user" ? userLabel : m.role === "assistant" ? "ASSISTANT" : "SYSTEM";
    const ts = new Date(m.created_at).toLocaleString();
    const meta = [m.model && `model: \`${prettyModelName(m.model)}\``, typeof m.tokens === "number" && `tokens: \`${m.tokens}\``]
      .filter(Boolean).join(" · ");
    return `## ${role} — ${ts}${meta ? `\n\n${meta}` : ""}\n\n${m.content || ""}\n`;
  }).join("\n---\n\n");

  return front + body;
}

/** Robust clipboard write — falls back to a hidden textarea + execCommand
    when navigator.clipboard is blocked (e.g. inside the Lovable preview iframe). */
async function copyToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? "");
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/** Gesture-safe text download — synchronous within click handler, DOM-attached
    anchor, delayed URL revoke so the browser can actually start the download. */
function downloadTextFile(text: string, filename: string) {
  const value = String(text ?? "");
  if (!value) { toast.error("Empty content — nothing to download"); return; }
  const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadThreadMd(title: string, messages: ChatMessage[], viewerName: string) {
  const md = buildThreadMd(title, messages, viewerName);
  // UTF-8 BOM ensures Notepad / legacy editors detect Turkish characters.
  const blob = new Blob(["\uFEFF", md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${title.replace(/[^a-z0-9]+/gi, "_")}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Strip markdown decoration but keep readable structure for PDF rendering. */
function mdToPlain(src: string): string {
  return src
    .replace(/```[a-z]*\n?([\s\S]*?)```/gi, (_m, code) => `\n${code.trim()}\n`)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\r/g, "");
}

async function downloadThreadPdf(title: string, messages: ChatMessage[], viewerName: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const fontFamily = await ensureUnicodeFont(doc); // "NotoSans" | "Roboto" | "helvetica"
  const margin = 42;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;
  const userLabel = (viewerName || "user").toUpperCase();

  const ensureRoom = (need: number) => {
    if (y + need > pageH - margin) { doc.addPage(); y = margin; }
  };

  // Title
  doc.setFont(fontFamily, "bold"); doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  for (const line of doc.splitTextToSize(title, maxW) as string[]) {
    ensureRoom(22); doc.text(line, margin, y); y += 22;
  }

  // Subtitle / metadata
  doc.setFont(fontFamily, "normal"); doc.setFontSize(9); doc.setTextColor(120);
  const models = Array.from(new Set(messages.map(m => m.model).filter(Boolean))) as string[];
  const prettyModels = Array.from(new Set(models.map(prettyModelName).filter(Boolean)));
  const tokens = messages.reduce((s, m) => s + (m.tokens ?? 0), 0);
  const subtitle = [
    `Exported ${new Date().toLocaleString()}`,
    `${messages.length} message(s)`,
    tokens ? `${tokens} tokens` : null,
    prettyModels.length ? `model: ${prettyModels.join(", ")}` : null,
  ].filter(Boolean).join(" · ");
  ensureRoom(14); doc.text(subtitle, margin, y); y += 18;

  // Separator
  doc.setDrawColor(220); doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y); y += 14;
  doc.setTextColor(0);

  for (const m of messages) {
    ensureRoom(28);
    // Role banner
    const isUser = m.role === "user";
    doc.setFillColor(isUser ? 230 : 240, isUser ? 240 : 235, isUser ? 255 : 248);
    doc.rect(margin, y - 11, maxW, 18, "F");
    doc.setFont(fontFamily, "bold"); doc.setFontSize(10);
    doc.setTextColor(isUser ? 30 : 90, isUser ? 80 : 60, isUser ? 200 : 30);
    const role = isUser ? userLabel : m.role === "assistant" ? "ASSISTANT" : "SYSTEM";
    const head = `${role}  ·  ${new Date(m.created_at).toLocaleString()}${m.model ? `  ·  ${prettyModelName(m.model)}` : ""}`;
    doc.text(head, margin + 6, y + 2);
    y += 18;

    // Body
    doc.setFont(fontFamily, "normal"); doc.setFontSize(10.5);
    doc.setTextColor(25, 25, 25);
    const cleaned = mdToPlain(m.content || "");
    for (const para of cleaned.split(/\n{2,}/)) {
      const lines = doc.splitTextToSize(para, maxW) as string[];
      for (const line of lines) {
        ensureRoom(14);
        doc.text(line, margin, y);
        y += 14;
      }
      y += 4;
    }
    y += 8;
  }
  doc.save(`${title.replace(/[^a-z0-9]+/gi, "_")}.pdf`);
}

export const Route = createFileRoute("/_app/chat")({ component: ChatPage });

const ACCEPT = ".pdf,.pcap,.pcapng,.log,.py,.js,.ts,.tsx,.jsx,.doc,.docx,.txt,.xls,.xlsx,.xlx,.csv,.vsd,.vsdx,.json,.yaml,.yml,.md";

const LANG_BY_EXT: Record<string, string> = {
  ".py": "python", ".js": "javascript", ".ts": "typescript", ".tsx": "tsx", ".jsx": "jsx",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".md": "markdown",
};

type Mode = "local" | "deepdive" | "websearch";
interface ToolTrace { id: string; tool: string; params?: unknown; output?: string; error?: string; ts: number; }
interface ThinkingStep { id: string; label: string; detail?: string; kind: "agent" | "tool" | "provider" | "router" | "system"; ts: number; }
type LatencyMeta = { thinkMs: number | null; ragMs: number; totalMs: number; tokensOut: number; ttftMs?: number | null; localGenMs?: number | null; tokPerSec?: number | null; thinkLeak?: boolean; promptTokens?: number | null };
type AgentRagDiag = {
  qForRetrieval?: string | null; queryRewritten?: string | null;
  ftsRows?: number | null; ftsTop?: number | null; ftsError?: string | null; embedError?: string | null;
  topCoverage?: number | null;
  vectorRowsByBrand?: Record<string, number> | null; ftsRowsByBrand?: Record<string, number> | null;
  rejectedTop?: Array<{ path?: string; ord?: number; brand?: string | null; score?: number; rerank_score?: number; rerank_mix?: number }> | null;
  bindingFileIds?: string[]; agentBrands?: string[]; packKeywords?: string[];
  libraryMatch?: string | null; explicitBrandLock?: string | null; effectiveBrandsArg?: string[] | null;
  agentKeywords?: string[];
};
type ForgePlanItem = { kind: string; slug: string; name?: string; description?: string; source?: string; risk?: string; reason?: string };
type ForgePlanPayload = { id: string | null; intent: string; plan: { reuse: ForgePlanItem[]; create: ForgePlanItem[] }; status: string; requestedBy?: string };
type ForgePlanPartial = { intent?: string | null; create: Array<{ kind: string; slug: string; name?: string | null; description?: string | null; risk?: string | null }>; startedAt: number };
type SourcedMessage = ChatMessage & { source?: string; thinking?: ThinkingStep[]; traces?: ToolTrace[]; ragSources?: RagSource[]; ragNotice?: string | null; ragKeywords?: string[]; ragRetriever?: string | null; ragSkipped?: boolean; ragIntent?: string | null; ragMode?: string | null; ragTop1?: number | null; ragTau?: number | null; ragMargin?: number | null; ragReranker?: { used: boolean; ms?: number; model?: string | null; reason?: string | null; lastError?: string | null } | null; ragConfidence?: { score: number; label: "high" | "mid" | "low"; signals: { topScore: number; topGap: number; sourceCount: number } } | null; ragQueryRewritten?: string | null; ragFallback?: { kind: "in_library_miss" | "out_of_library"; brand?: string | null; brands?: string[] } | null; ragDebug?: RagDebugResult | null; ragAgentDiag?: AgentRagDiag | null; ragRawReason?: string | null; ragDefensiveDropped?: number | null; skillRunId?: string; latency?: LatencyMeta; streamPhase?: string; streamStage?: string; agentRouted?: { agentName: string; script: string; matchedToken?: string; score?: number }; forgePlan?: ForgePlanPayload; forgePlanPartial?: ForgePlanPartial };


function normalizeModelText(src: string): string {
  return String(src || "")
    .replace(/\$\\(?:right)?arrow\$/gi, "→")
    .replace(/\\(?:right)?arrow\b/gi, "→")
    .replace(/\$\\Rightarrow\$/g, "⇒")
    .replace(/\\Rightarrow\b/g, "⇒");
}

// Protocol parser lives in src/lib/chat-protocol — it normalises tool_call /
// skill_call / @[script.py] / naked JSON envelopes into a single DTO so chat
// can autonomously dispatch them.
import { extractProtocolCalls, stripProtocolBlocks, maskInflightProtocol, callDedupKey, dispatchWithMutex, makeDispatchKey, type ProtocolCall } from "@/lib/chat-protocol";

// FAZ 1 — Run→Chat enjeksiyonu: SkillsAPI.run sonucunu (status + summary)
// kullanıcının göreceği balona system-note olarak basar. LLM follow-up
// turunda aynı bağlamı görür.
async function injectSkillRunResult<M extends ChatMessage>(
  runId: string,
  slug: string,
  setMessages: React.Dispatch<React.SetStateAction<M[]>>,
  threadId: string,
  replaceCardId?: string,
): Promise<void> {
  try {
    const [{ SkillsAPI }, { summarizeUnknownOutput }] = await Promise.all([
      import("@/lib/api-client"),
      import("@/components/skill-action-drawer"),
    ]);
    const detail = await SkillsAPI.getRun(runId);
    const d = detail as unknown as Record<string, unknown>;
    const status = String((d?.status as string | undefined) ?? "unknown");
    const summaryField = typeof d?.summary === "string" ? (d.summary as string).trim() : "";
    const output = (d?.output ?? d?.result ?? d?.context ?? null) as unknown;

    // Build human-readable lines. NEVER dump raw JSON to chat — the inline
    // `<details>` Run Report (gated by skillRunId) already exposes structured proof.
    const lines: string[] = [];
    if (summaryField) {
      lines.push(summaryField);
    } else if (output && typeof output === "object") {
      const o = output as { summary?: string; results?: Array<Record<string, unknown>> };
      if (typeof o.summary === "string" && o.summary.trim()) {
        lines.push(o.summary.trim());
      } else if (Array.isArray(o.results) && o.results.length > 0) {
        for (const r of o.results.slice(0, 5)) {
          const rr = r as { pair?: string; rate?: number; asof?: string; source?: string; city?: string; temperature_c?: number; title?: string; summary?: string; url?: string };
          if (rr.pair && rr.rate != null) {
            lines.push(`• ${rr.pair} · ${Number(rr.rate).toLocaleString("en-US", { maximumFractionDigits: 4 })}${rr.asof ? ` (${rr.asof})` : ""}${rr.source ? ` — ${rr.source}` : ""}`);
          } else if (rr.city && rr.temperature_c != null) {
            lines.push(`• ${rr.city} · ${rr.temperature_c}°C${rr.summary ? ` — ${rr.summary}` : ""}`);
          } else if (rr.title || rr.summary) {
            const link = rr.url ? ` [↗](${rr.url})` : "";
            lines.push(`• ${rr.title || "—"}${rr.summary ? ` — ${String(rr.summary).slice(0, 160)}` : ""}${link}`);
          }
        }
      }
    }
    if (lines.length === 0) {
      lines.push(output == null ? "Completed." : summarizeUnknownOutput(output));
    }

    const body = [`🛡️ **!${slug}** · status: \`${status}\``, ...lines].join("\n\n");
    const cardId = replaceCardId || `skill-result-${runId}`;
    setMessages((m) => {
      const exists = m.some((x) => x.id === cardId);
      if (exists) {
        return m.map((x) => x.id === cardId
          ? ({ ...x, content: body, skillRunId: runId } as unknown as M)
          : x);
      }
      return [
        ...m,
        {
          id: cardId,
          thread_id: threadId,
          role: "assistant" as const,
          content: body,
          created_at: new Date().toISOString(),
          skillRunId: runId,
        } as unknown as M,
      ];
    });
  } catch {
    // Trace yeterli; chat'e ek noise basma.
  }
}


function ChatPage() {
  const { t: chatT, locale } = useI18n();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [active, setActive] = useState<string | null>(() => {
    try { return typeof window !== "undefined" ? localStorage.getItem("chat.active") : null; }
    catch { return null; }
  });
  const [messages, setMessages] = useState<SourcedMessage[]>([]);
  const [attachments, setAttachments] = useState<UploadMeta[]>([]);
  const composerRef = useRef<ChatComposerHandle>(null);
  // Tek omurga: chat akışı SADECE `streaming` state'i + `busyRef` sync-guard
  // üzerinden yürür. `preparing` / `sendInFlightRef` gibi paralel boolean'lar
  // kaldırıldı — birden fazla state'i senkron tutmaya çalışmak UI lock'lara
  // yol açıyordu. busyRef = senkron kapı (re-click yutar), streaming = UI.
  const [streaming, setStreaming] = useState(false);
  const busyRef = useRef(false);
  const ensuringThreadRef = useRef<Promise<string> | null>(null);

  // Debug overlay flag — `?debug=chat` URL'i veya localStorage["elara_chat_debug"]="1"
  // ile açılır. Mevcut state machine'e DOKUNMAZ, sadece okur.
  const [debugOverlayEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const url = new URL(window.location.href);
      // URL flag'i bir kerelik açar AMA persist eder; bir daha açmaya gerek yok.
      if (url.searchParams.get("debug") === "chat") {
        try { localStorage.setItem("elara_chat_debug", "1"); } catch { /* */ }
        return true;
      }
      return localStorage.getItem("elara_chat_debug") === "1";
    } catch { return false; }
  });





  // busyRef'i debug overlay okuyabilsin diye window'a opt-in yansıt — sadece
  // overlay açıkken. Polling: chat:streaming event'i ile senkron, fallback raf.
  useEffect(() => {
    if (!debugOverlayEnabled || typeof window === "undefined") return;
    const w = window as unknown as { __elaraChat?: { busy?: boolean } };
    w.__elaraChat = w.__elaraChat || {};
    let raf = 0;
    const tick = () => {
      if (w.__elaraChat) w.__elaraChat.busy = busyRef.current;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [debugOverlayEnabled]);

  const handleDeleteMessage = useCallback((id: string) => {
    // Optimistic UI + DB hard-delete. UUID değilse (legacy tmp-* mesajları)
    // sadece local state'ten düşür — DB'de yok zaten.
    setMessages(prev => prev.filter(x => x.id !== id));
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) { void ChatAPI.deleteMessage(id).catch(e => console.warn("[deleteMessage]", e)); }
  }, []);
  const handleEditMessage = useCallback((id: string, c: string) => {
    setMessages(prev => prev.map(x => x.id === id ? { ...x, content: c } : x));
  }, []);
  // Regenerate: find the previous USER message before the clicked assistant
  // message and re-send it. Drop the old assistant reply optimistically so the
  // new stream replaces it instead of stacking. Falls back to composer-fill
  // when no source user message exists (legacy/orphaned messages).
  const messagesRef = useRef<SourcedMessage[]>([]);
  const sendRef = useRef<((text?: string) => Promise<void>) | null>(null);
  const handleRegenerateMessage = useCallback((id: string) => {
    const list = messagesRef.current;
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return; // unknown id — do nothing (never dump the id into the composer)
    const target = list[idx];
    let userText: string | null = null;
    let assistantIdToDrop: string | null = null;
    if (target.role === "user") {
      // Re-send the same user prompt as-is.
      userText = target.content;
    } else {
      // Walk backwards from the assistant message for the originating user prompt.
      for (let i = idx - 1; i >= 0; i--) {
        if (list[i].role === "user") { userText = list[i].content; break; }
      }
      assistantIdToDrop = target.id;
    }
    if (!userText || !userText.trim()) return;
    if (assistantIdToDrop) {
      setMessages(prev => prev.filter(x => x.id !== assistantIdToDrop));
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assistantIdToDrop);
      if (isUuid) { void ChatAPI.deleteMessage(assistantIdToDrop).catch(() => {}); }
    }
    void sendRef.current?.(userText);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [deepDive, setDeepDive] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [appAgents, setAppAgents] = useState<ChatAgentOption[]>([]);
  const [pickedAgents, setPickedAgents] = useState<string[]>([]);
  const [localModels, setLocalModels] = useState<ModelDTO[]>([]);
  const [aiProviders, setAiProviders] = useState<AiProviderDTO[]>([]);
  const [routing, setRouting] = useState<AiRoutingPolicy>({ mode: "failover", allowUserOverride: true, rules: [] });
  const [pickedProviders, setPickedProviders] = useState<string[]>([]);
  const [userTemplate, setUserTemplate] = useState<TemplateDTO | null>(null);
  const [forgeActions, setForgeActions] = useState<ActionDef[]>([]);
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [toolSlugs, setToolSlugs] = useState<Set<string>>(() => new Set());
  const [activeSkillRun, setActiveSkillRun] = useState<string | null>(null);

  const [debugTraceId, setDebugTraceId] = useState<string | null>(null);
  const [debugTrace, setDebugTrace] = useState<ChatTraceEvent[]>([]);
  const [debugCopyFallback, setDebugCopyFallback] = useState<string | null>(null);
  const [debugCopyStatus, setDebugCopyStatus] = useState<string | null>(null);
  const [debugPanelOpen, setDebugPanelOpen] = useState<boolean>(false);
  const fallbackTaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (debugCopyFallback && fallbackTaRef.current) { try { fallbackTaRef.current.focus(); fallbackTaRef.current.select(); } catch {} } }, [debugCopyFallback]);
  const refreshDebugTrace = useCallback((traceId: string | null = debugTraceId) => {
    if (!traceId) return;
    setDebugTrace(getChatTrace(traceId));
  }, [debugTraceId]);
  const buildDebugTracePayload = useCallback((traceId: string) => {
    const backendUrl = `${resolveApiBaseUrl()}/api/debug/chat/${traceId}`;
    const curl = `curl -s ${backendUrl}`;
    const events = getChatTrace(traceId);
    return JSON.stringify({ traceId, backendUrl, curl, copiedAt: new Date().toISOString(), bytesHint: events.length, events }, null, 2);
  }, []);
  const buildFullTracePayload = useCallback(async (traceId: string) => {
    const backendUrl = `${resolveApiBaseUrl()}/api/debug/chat/${traceId}`;
    const curl = `curl -s ${backendUrl}`;
    const frontendEvents = getChatTrace(traceId);
    let backend: { ok: boolean; events?: unknown[]; error?: string; status?: number } = { ok: false };
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(new Error("backend trace timeout 1500ms")), 1500);
      const res = await fetch(backendUrl, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      window.clearTimeout(timer);
      if (!res.ok) {
        backend = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      } else {
        const j = await res.json().catch(() => null) as { events?: unknown[] } | null;
        backend = { ok: true, status: res.status, events: Array.isArray(j?.events) ? j!.events : [] };
      }
    } catch (e) {
      backend = { ok: false, error: String((e as Error).message || e) };
    }
    return JSON.stringify({
      traceId,
      copiedAt: new Date().toISOString(),
      backendUrl,
      curl,
      frontend: { count: frontendEvents.length, events: frontendEvents },
      backend,
    }, null, 2);
  }, []);
  const copyDebugText = useCallback(async (label: string, text: string) => {
    // 1) Modern clipboard (HTTPS / localhost)
    try {
      await navigator.clipboard.writeText(text);
      setDebugCopyFallback(null);
      setDebugCopyStatus(`${label} kopyalandı · ${text.length} byte`);
      toast.success(`${label} kopyalandı (${text.length} byte)`);
      return true;
    } catch { /* fall through */ }
    // 2) execCommand fallback (Dell / plain HTTP / .local)
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        setDebugCopyFallback(null);
        setDebugCopyStatus(`${label} kopyalandı (execCommand) · ${text.length} byte`);
        toast.success(`${label} kopyalandı (${text.length} byte)`);
        return true;
      }
    } catch { /* fall through */ }
    // 3) Visible textarea fallback — auto-focus & select
    setDebugCopyFallback(text);
    setDebugCopyStatus(`${label} could not auto-copy; the box below is selected — press Ctrl+C / Cmd+C.`);
    toast.error(`Clipboard refused; ${label} printed to the box (Ctrl+C).`);
    return false;
  }, []);
  const copyFullTrace = useCallback(async (traceId: string) => {
    setDebugCopyStatus("Loading backend trace…");
    const text = await buildFullTracePayload(traceId);
    let frontendCount = 0; let backendCount: number | string = "?";
    try {
      const parsed = JSON.parse(text);
      frontendCount = parsed?.frontend?.count ?? 0;
      backendCount = parsed?.backend?.ok ? (parsed.backend.events?.length ?? 0) : `unreachable: ${parsed?.backend?.error ?? "?"}`;
    } catch {}
    const ok = await copyDebugText(`Full trace (frontend ${frontendCount} + backend ${backendCount})`, text);
    return ok;
  }, [buildFullTracePayload, copyDebugText]);
  useEffect(() => {
    SkillsAPI.list().then(setSkills).catch(() => {});
    // Tool slugs (action_library) — used by the `!slug` parser to distinguish
    // tools from skills and avoid routing tool calls to /api/skills/*/run.
    fetch(`${resolveApiBaseUrl()}/api/capabilities?kind=tool`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        const caps = (j && Array.isArray(j.capabilities)) ? j.capabilities : [];
        const slugs = new Set<string>();
        for (const c of caps) {
          const s = String(c?.slug || "").toLowerCase();
          if (s) slugs.add(s);
        }
        setToolSlugs(slugs);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!debugTraceId) return;
    refreshDebugTrace(debugTraceId);
    // Streaming sırasında polling KAPALI — re-render baskısı yok.
    // Akış bittikten sonra 4sn'de bir tazele (1.5sn ana-thread'i boğuyordu).
    if (streaming) return;
    const id = window.setInterval(() => refreshDebugTrace(debugTraceId), 4000);
    return () => window.clearInterval(id);
  }, [debugTraceId, streaming, refreshDebugTrace]);
  const { user: chatUser } = useAuth();
  useRbac();
  const agentsLabel = chatT("chat.agents_label");
  const toolsLabel = chatT("chat.tools_label");
  const visibleLocalModels = useMemo(() => {
    const userModels = chatUser?.allowedModels ?? [];
    const tplModels = (userTemplate as { allowedModels?: string[] } | null)?.allowedModels ?? [];
    const canOverride = chatUser?.canOverrideModel !== false;
    let effective: string[] | null = null;
    if (userModels.length && canOverride) effective = userModels;
    else if (tplModels.length) effective = userModels.length ? userModels.filter(m => tplModels.includes(m)) : tplModels;
    else if (userModels.length) effective = userModels;
    if (chatUser?.role === "Admin") return localModels;
    return effective ? localModels.filter(m => effective!.includes(m.id)) : localModels;
  }, [localModels, chatUser?.allowedModels, chatUser?.canOverrideModel, chatUser?.role, userTemplate]);
  // Kullanıcı composer'dan model override seçtiyse onu kullan; yoksa DB default'a düş.
  // Tek-tur override — refresh'te DB default'a sıfırlanır (default tek mercii kalsın).
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const canOverrideModel = chatUser?.canOverrideModel !== false || chatUser?.role === "Admin";
  const activeModelEntry = useMemo(() => {
    const override = canOverrideModel && selectedModelId
      ? visibleLocalModels.find((m) => m.id === selectedModelId)
      : null;
    return override ?? visibleLocalModels.find((m) => m.isDefault) ?? visibleLocalModels[0];
  }, [visibleLocalModels, selectedModelId, canOverrideModel]);
  const activeModel = activeModelEntry?.id ?? "";
  const activeModelName = useMemo(
    () => activeModelEntry?.modelName || activeModel.split(/[\\/]/).filter(Boolean).pop() || activeModel,
    [activeModelEntry, activeModel],
  );
  const activeModelProfile = useMemo(() => {
    const template = activeModelEntry?.templateFamily?.trim() || "auto";
    const stopCount = Array.isArray(activeModelEntry?.stopSequences) ? activeModelEntry.stopSequences.length : 0;
    const safety = activeModelEntry?.runtimeSafety ?? {};
    const safetyCount = Object.values(safety).filter((v) => v !== null && v !== undefined && v !== "").length;
    return { template, stopCount, safetyCount, ragEnabled: activeModelEntry?.ragEnabled !== false };
  }, [activeModelEntry]);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Active assistant message id during streaming. SetMessages batch'i async;
  // closure capture yerine bu ref'i okumak placeholder-vs-persisted race'ini öldürür.
  const assistantIdRef = useRef<string | null>(null);
  // Persisted swap erken gelirse (placeholder henüz commit edilmemiş) burada beklet.
  const pendingPersistedIdRef = useRef<string | null>(null);
  // Stream delta buffer — token başına setMessages yerine ~50ms throttled flush.
  const deltaBufferRef = useRef<string>("");
  const flushTimerRef = useRef<number | null>(null);
  // Chat-side dedup for protocol calls — anchored to the lifetime of the page
  // so the same skill/tool/agent envelope is never dispatched twice even if
  // the model emits it across multiple stream chunks or re-renders.
  const executedProtocolKeysRef = useRef<Set<string>>(new Set());

  // Vision: pasted/captured images held client-side as data URLs (sent inline with the prompt).
  const [images, setImages] = useState<{ id: string; dataUrl: string; name: string }[]>([]);
  // Camera capture
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  // Voice recording
  const [recording, setRecording] = useState(false);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveRafRef = useRef<number | null>(null);
  // Auto read TTS
  const [autoRead, setAutoRead] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setAutoRead(localStorage.getItem("chat.autoRead") === "1");
  }, []);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("chat.autoRead", autoRead ? "1" : "0"); }, [autoRead]);
  // Live Call modal
  const [liveCallOpen, setLiveCallOpen] = useState(false);
  const [toolDetail, setToolDetail] = useState<ActionDef | null>(null);
  const voice = useVoice();
  // Device permissions
  const [perms, setPerms] = useState<{ cam: boolean; mic: boolean }>({ cam: false, mic: false });
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) {
      setPerms({ cam: true, mic: true }); return;
    }
    (async () => {
      try {
        const cam = await navigator.permissions.query({ name: "camera" as PermissionName }).catch(() => null);
        const mic = await navigator.permissions.query({ name: "microphone" as PermissionName }).catch(() => null);
        setPerms({
          cam: !cam || cam.state !== "denied",
          mic: !mic || mic.state !== "denied",
        });
      } catch { setPerms({ cam: true, mic: true }); }
    })();
  }, []);

  // Forge actions — load once. Periyodik polling kapalı; chat trafiğini meşgul etmez.
  useEffect(() => {
    let alive = true;
    ForgeAPI.list({ kind: "action" })
      .then((rows) => { if (alive) setForgeActions(rows); })
      .catch(() => { /* bridge offline — ignore */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("chat:pinnedAgent");
      if (!raw) return;
      const pinned = JSON.parse(raw) as { id: string; name: string };
      sessionStorage.removeItem("chat:pinnedAgent");
      setPickedAgents((cur) => (cur.includes(pinned.id) ? cur : [...cur, pinned.id]));
      const out = sessionStorage.getItem("chat:agentOutput");
      if (out) {
        sessionStorage.removeItem("chat:agentOutput");
        const cur = composerRef.current?.getText() ?? "";
        if (!cur) composerRef.current?.setText(`Agent "${pinned.name}" output:\n\n\`\`\`\n${out}\n\`\`\`\n\n`);
      }
      toast.success(`Agent "${pinned.name}" pinned`);
    } catch { /* ignore */ }
  }, []);

  const addImageFromBlob = async (blob: Blob, name: string) => {
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    setImages((prev) => [...prev, { id: `img-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, dataUrl, name }]);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); await addImageFromBlob(f, f.name || `pasted-${Date.now()}.png`); }
      }
    }
  };

  // ---------- Camera ----------
  const openCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        const insecure = typeof window !== "undefined" && !window.isSecureContext;
        throw new Error(insecure
          ? "Browser blocks the camera in insecure contexts (HTTPS or localhost required)."
          : "This browser/iframe does not allow camera access (allow=\\\"camera\\\" may be missing).");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => { if (cameraVideoRef.current) { cameraVideoRef.current.srcObject = stream; cameraVideoRef.current.play().catch(()=>{}); } }, 50);
    } catch (e) {
      const err = e as DOMException;
      const msg = err.name === "NotAllowedError" ? "Camera permission denied. Allow it from browser settings."
        : err.name === "NotFoundError" ? "Camera not found."
        : err.name === "NotReadableError" ? "Camera is in use by another application."
        : err.message;
      setError(`Camera error: ${msg}`);
      toast.error(`Camera: ${msg}`);
    }
  };
  const closeCamera = () => {
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
  };
  const snapPhoto = async () => {
    const v = cameraVideoRef.current; if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 640; canvas.height = v.videoHeight || 480;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, "image/png"));
    if (blob) await addImageFromBlob(blob, `camera-${Date.now()}.png`);
    closeCamera();
  };

  // ---------- Voice ----------
  const drawWave = () => {
    const c = waveCanvasRef.current; const a = analyserRef.current;
    if (!c || !a) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const W = c.width, H = c.height;
    const data = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(data);
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "#3aa8ff"); grad.addColorStop(1, "#67e8f9");
    ctx.lineWidth = 2; ctx.strokeStyle = grad; ctx.shadowColor = "#3aa8ff"; ctx.shadowBlur = 8;
    ctx.beginPath();
    const slice = W / data.length;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0;
      const y = (v * H) / 2;
      const x = i * slice;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    waveRafRef.current = requestAnimationFrame(drawWave);
  };
  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        const insecure = typeof window !== "undefined" && !window.isSecureContext;
        throw new Error(insecure
          ? "Browser blocks the microphone in insecure contexts (HTTPS or localhost required)."
          : "This browser/iframe does not allow microphone access (allow=\\\"microphone\\\" may be missing).");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (audioCtxRef.current) { audioCtxRef.current.close().catch(()=>{}); audioCtxRef.current = null; }
        if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (active) {
          try {
            const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
            const meta = await UploadsAPI.upload(file, active);
            setAttachments(a => [...a, meta]);
            toast.success("Voice note attached");
          } catch (e) { setError(`Voice upload failed: ${(e as Error).message}`); }
        }
      };
      mediaRecRef.current = rec;
      // analyser for visualizer
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new AC();
      audioCtxRef.current = ac;
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser(); an.fftSize = 1024;
      src.connect(an); analyserRef.current = an;
      rec.start();
      setRecording(true);
      requestAnimationFrame(drawWave);
    } catch (e) {
      const err = e as DOMException;
      const msg = err.name === "NotAllowedError" ? "Microphone permission denied. Allow it from browser settings."
        : err.name === "NotFoundError" ? "Microphone not found."
        : err.name === "NotReadableError" ? "Microphone is in use by another application."
        : err.message;
      setError(`Mic error: ${msg}`);
      toast.error(`Mic: ${msg}`);
    }
  };
  const stopRecording = () => {
    mediaRecRef.current?.stop();
    setRecording(false);
  };

  // Hard cleanup on unmount: kill camera, mic recorder, AudioContext, wave RAF and in-flight stream.
  useEffect(() => {
    return () => {
      try { abortRef.current?.abort(); } catch { /* */ }
      try { cameraStreamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* */ }
      cameraStreamRef.current = null;
      try { if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") mediaRecRef.current.stop(); } catch { /* */ }
      try { audioCtxRef.current?.close(); } catch { /* */ }
      audioCtxRef.current = null;
      if (waveRafRef.current) { try { cancelAnimationFrame(waveRafRef.current); } catch { /* */ } waveRafRef.current = null; }
      try { if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); } catch { /* */ }
    };
  }, []);

  // Auto TTS
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoRead || streaming) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || !last.content) return;
    if (lastSpokenRef.current === last.id) return;
    lastSpokenRef.current = last.id;
    try {
      voice.speak(mdToPlain(last.content).slice(0, 4000), detectLang(last.content));
    } catch { /* */ }
  }, [autoRead, streaming, messages, voice]);
  const stopSpeaking = () => voice.cancel();


  useEffect(() => {
    AgentsAPI.list()
      .then((rows) => setAppAgents(rows.map((a) => {
        const meta = (a.meta ?? {}) as Record<string, unknown>;
        return {
          id: a.id,
          agentName: a.name,
          role: typeof meta.role === "string" ? (meta.role as string) : "general",
          status: a.status,
          description: typeof meta.description === "string" ? (meta.description as string) : "",
        };
      })))
      .catch(() => setAppAgents([]));
    // Silent fallback — bridge offline shouldn't paint a red banner.
    // Keep last known list (empty array on first load); user already sees
    // "Bridge Connection Error" from listThreads if 3005 is down.
    SystemAPI.listModels()
      .then((rows) => { if (Array.isArray(rows) && rows.length) setLocalModels(rows); })
      .catch((e) => { console.warn("[chat] listModels failed:", (e as Error).message); });
    ProvidersAPI.list().then((r) => setAiProviders(r.filter(p => p.kind === "llm"))).catch(() => setAiProviders([]));
    AppSettingsAPI.get<AiRoutingPolicy>("ai.routing").then((v) => { if (v) setRouting({ mode: v.mode || "failover", allowUserOverride: v.allowUserOverride !== false, rules: Array.isArray(v.rules) ? v.rules : [] }); }).catch(()=>{});
  }, []);

  // Load the assigned template (its provider permissions stack with the user's)
  useEffect(() => {
    const tplId = chatUser?.templateId;
    if (!tplId) { setUserTemplate(null); return; }
    TemplatesAPI.list().then(list => setUserTemplate(list.find(t => t.id === tplId) ?? null)).catch(()=>{});
  }, [chatUser?.templateId]);

  // Compose effective allowed providers — memoized to keep stable references across keystrokes.
  const isAdminUser = chatUser?.role === "Admin";
  const overrideEnabled = useMemo(() => {
    const userCanOverride = chatUser ? chatUser.canOverrideProvider !== false : true;
    const tplCanOverride = userTemplate ? userTemplate.canOverrideProvider !== false : true;
    return routing.allowUserOverride !== false && userCanOverride && tplCanOverride;
  }, [chatUser, userTemplate, routing.allowUserOverride]);

  const activeProviders = useMemo(() => {
    const userAllowed = chatUser?.allowedProviders ?? [];
    const tplAllowed = userTemplate?.allowedProviders ?? [];
    return aiProviders.filter((p) => {
      if (!p.isActive) return false;
      if (userAllowed.length && !userAllowed.includes(p.id)) return false;
      if (tplAllowed.length && !tplAllowed.includes(p.id)) return false;
      return true;
    });
  }, [aiProviders, chatUser?.allowedProviders, userTemplate?.allowedProviders]);

  const visibleAppAgents = useMemo(() => {
    const tplAllowedAgents = userTemplate?.agents ?? [];
    const userAllowedAgents = chatUser?.allowedAgents ?? [];
    let list = appAgents;
    if (!isAdminUser && tplAllowedAgents.length) list = list.filter(a => tplAllowedAgents.includes(a.agentName) || tplAllowedAgents.includes(a.id));
    if (!isAdminUser && userAllowedAgents.length) list = list.filter(a => userAllowedAgents.includes(a.agentName) || userAllowedAgents.includes(a.id));
    return list;
  }, [appAgents, userTemplate?.agents, chatUser?.allowedAgents, isAdminUser]);

  const visibleForgeActions = useMemo(() => {
    const tplAllowedTools = userTemplate?.allowedTools ?? [];
    const userAllowedTools = chatUser?.allowedTools ?? [];
    let list = forgeActions;
    if (!isAdminUser && tplAllowedTools.length) list = list.filter(a => tplAllowedTools.includes(a.id));
    if (!isAdminUser && userAllowedTools.length) list = list.filter(a => userAllowedTools.includes(a.id));
    return list;
  }, [forgeActions, userTemplate?.allowedTools, chatUser?.allowedTools, isAdminUser]);

  const fanoutMode = pickedProviders.length > 1;
  const computedMode: Mode | "fanout" = fanoutMode
    ? "fanout"
    : (deepDive ? "deepdive" : webSearch ? "websearch" : pickedProviders.length === 1 ? "deepdive" : "local");
  const mode: Mode = (computedMode === "fanout" ? "deepdive" : computedMode) as Mode;

  useEffect(() => {
    // Cache-first hydration so the sidebar list never flashes empty when the
    // bridge is briefly offline (operator complaint: "chats disappeared and
    // came back"). Fresh server data overwrites the cache once it arrives.
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("chat.threads") : null;
      if (raw) {
        const cached = JSON.parse(raw) as ChatThread[];
        if (Array.isArray(cached) && cached.length > 0) {
          setThreads(cached);
          setActive(prev => (prev && cached.some(t => t.id === prev)) ? prev : (cached[0]?.id ?? null));
        }
      }
    } catch { /* corrupt cache, ignore */ }
    ChatAPI.listThreads()
      .then((t) => {
        setThreads(t);
        setActive(prev => (prev && t.some(x => x.id === prev)) ? prev : (t[0]?.id ?? null));
      })
      .catch((e) => {
        // Do NOT wipe the visible list on transient bridge errors — keep the
        // cached threads on screen and just surface the error banner.
        setError(`Bridge Connection Error: ${e.message}`);
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem("chat.threads", JSON.stringify(threads)); } catch { /* quota */ }
    }, 1500);
    return () => clearTimeout(t);
  }, [threads]);

  // Persist active thread id so menu navigation restores the same conversation.
  useEffect(() => {
    try {
      if (active) localStorage.setItem("chat.active", active);
      else localStorage.removeItem("chat.active");
    } catch { /* quota */ }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    // Cache-first: paint last known messages immediately so an offline bridge
    // never makes old chats look "empty".
    let hadCache = false;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(`chat.msgs.${active}`) : null;
      if (raw) {
        const cached = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(cached)) {
          hadCache = cached.length > 0;
          setMessages(dedupeMessages(cached));
        }
      } else {
        setMessages([]);
      }
    } catch { setMessages([]); }
    ChatAPI.listMessages(active)
      .then((rows) => {
        // Don't wipe a populated cache with an empty server response — likely
        // the bridge returned [] before hydration finished.
        if (hadCache && (!Array.isArray(rows) || rows.length === 0)) return;
        setMessages(dedupeMessages(rows));
      })
      .catch((e) => {
        // Keep cached content on transient bridge errors.
        if (!hadCache) setMessages([]);
        console.warn("[chat] listMessages failed:", (e as Error).message);
      });
    setAttachments([]);
  }, [active]);

  // Mirror messages into a ref for handleRegenerateMessage (stable callback).
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Debounced persist — avoid stringifying entire history on every streamed token.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(`chat.msgs.${active}`, JSON.stringify(dedupeMessages(messages))); } catch { /* quota */ }
    }, 400);
    return () => clearTimeout(t);
  }, [messages, active]);

  const newThread = async () => {
    const localTh: ChatThread = {
      id: `local-${getUUID()}`,
      title: `Chat ${threads.length + 1}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Optimistic add (works even if server is offline)
    setThreads((prev) => [localTh, ...prev]); setActive(localTh.id); setMessages([]);
    try {
      const t = await ChatAPI.createThread(localTh.title);
      setThreads((prev) => prev.map((x) => x.id === localTh.id ? t : x));
      setActive(t.id);
    } catch { /* keep local */ }
  };

  const deleteThread = async (id: string) => {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (active === id) {
      setActive(() => {
        const remaining = threads.filter((t) => t.id !== id);
        return remaining[0]?.id ?? null;
      });
      setMessages([]);
    }
    localStorage.removeItem(`chat.msgs.${id}`);
    try { await ChatAPI.deleteThread(id); } catch { /* */ }
  };

  const handleFiles = async (files: FileList | File[]) => {
    if (!active) { setError("Open or create a thread first."); return; }
    for (const f of Array.from(files)) {
      try {
        const meta = await UploadsAPI.upload(f, active);
        setAttachments((a) => [...a, meta]);
        LogsAPI.push({ thread_id: active, agent: "chat", level: "info", message: "attachment_uploaded", meta: { name: meta.filename, ext: meta.ext, size: meta.size } });
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };

  const send = async (textOverride?: string) => {
    // Senkron kapı: aynı turn'de re-click / race / regenerate çakışmalarını yutar.
    // streaming state'i async, busyRef ise click anında set olur — bu yüzden ikisi
    // birlikte tek kurallı kilit oluşturur. Hiçbir kod yolu UI'ı kilitli bırakamaz
    // çünkü finally bloğu her durumda serbest bırakır.
    if (busyRef.current) return;
    const input = textOverride ?? composerRef.current?.getText() ?? "";
    if (!input.trim()) return;
    busyRef.current = true;
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    window.dispatchEvent(new CustomEvent("chat:streaming", { detail: { active: true } }));
    try {
    const traceId = createChatTraceId();
    setDebugTraceId(traceId);
    setDebugTrace([]);
    setDebugCopyFallback(null);
    setDebugCopyStatus(null);
    recordChatTrace(traceId, "submit.clicked", { chars: input.trim().length, active });
    let ensuredThreadId = active;
    const isDbThread = (id: string | null): id is string => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isDbThread(ensuredThreadId)) {
      const localId = `local-${getUUID()}`;
      const localTh: ChatThread = {
        id: localId,
        title: input.trim().slice(0, 48) || `Chat ${threads.length + 1}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setThreads((prev) => [localTh, ...prev]);
      setActive(localId);
      setMessages([]);
      ensuredThreadId = localId;
      try {
        const t = await ChatAPI.createThread(localTh.title);
        setThreads((prev) => prev.map((x) => x.id === localId ? t : x));
        setActive(t.id);
        ensuredThreadId = t.id;
      } catch (e) {
        setError(`Thread create failed: ${(e as Error).message}`);
        return;
      }
    }
    const threadId: string = ensuredThreadId;
    console.info("[chat:submit] sealed", { threadId, chars: input.trim().length });
    recordChatTrace(traceId, "thread.ready", { threadId });
    setError(null);

    // Agent direct-dispatch — @[file.py] free text
    // User-typed @[...] tokens bypass the LLM and hit /api/agents/:id/run.
    // Dynamic: agent file is resolved against the live appAgents list (DB-driven),
    // no slug is hardcoded. Unknown file → inline hint, no LLM call.
    const agentMatch = input.trim().match(/^@\[\s*([\p{L}\p{N}_.\-/]+\.py)\s*\]\s*([\s\S]*)$/u);
    if (agentMatch) {
      const fileRaw = agentMatch[1].trim();
      const fileLow = fileRaw.toLowerCase();
      const baseLow = fileLow.replace(/\.py$/, "");
      const agent = appAgents.find((a) => {
        const n = String(a.agentName || "").toLowerCase();
        return n === fileLow || n === baseLow || n.replace(/\.py$/, "") === baseLow;
      });
      const agentQuery = agentMatch[2].trim();
      const userMsgId = getUUID();
      const userMsg: ChatMessage = {
        id: userMsgId, thread_id: threadId, role: "user",
        content: input, created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, userMsg]); composerRef.current?.clearText();
      ChatAPI.persistMessage({ id: userMsgId, thread_id: threadId, role: "user", content: userMsg.content, model: activeModel });
      if (!agent) {
        const hint: ChatMessage = {
          id: `agent-unknown-${Date.now()}`, thread_id: threadId, role: "assistant",
          content: `🤖 Unknown agent · \`@[${fileRaw}]\` — not registered in app_agents. Open Agents tab to add it.`,
          created_at: new Date().toISOString(),
        };
        setMessages((m) => [...m, hint]);
        return;
      }
      const placeholderId = getUUID();
      const placeholder: ChatMessage = {
        id: placeholderId, thread_id: threadId, role: "assistant",
        content: `⚙ Dispatching \`@[${agent.agentName}]\`…`,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, placeholder]);
      try {
        const params: Record<string, unknown> = agentQuery
          ? { query: agentQuery, input: agentQuery, text: agentQuery }
          : {};
        console.info("[chat:agent-dispatch:stream]", { agentId: agent.id, agentName: agent.agentName, textLen: agentQuery.length });

        let streamed = "";
        let started = false;
        await AgentsAPI.runStream(agent.id, params, agentQuery || undefined, {
          signal: ctrl.signal,
          threadId,
          userMessageId: userMsgId,
          userContent: userMsg.content,
          assistantMessageId: placeholderId,
          model: activeModel,
          onThinking: (info) => {
            const phase = info?.phase || "rag_probing";
            setMessages((m) => m.map((x) => x.id === placeholderId
              ? ({ ...x, content: started ? x.content : "", streamPhase: phase } as SourcedMessage)
              : x));
          },
          onDelta: (chunk) => {
            if (!started) {
              started = true;
              setMessages((m) => m.map((x) => x.id === placeholderId ? { ...x, content: "", streamPhase: undefined } as SourcedMessage : x));
            }
            streamed += chunk;
            setMessages((m) => m.map((x) => x.id === placeholderId ? { ...x, content: streamed } : x));
          },
          onError: (msg) => {
            console.error("[chat:agent-onError]", { agent: agent.agentName, msg });
            setMessages((m) => m.map((x) => x.id === placeholderId ? {
              ...x, content: (streamed || `❌ Agent failed · \`@[${agent.agentName}]\``) + `\n\n\`${msg}\``,
            } : x));
          },
          onDone: (info) => {
            console.info("[chat:agent-onDone]", { agent: agent.agentName, ok: info.ok, error: info.error, agent_error: info.agent_error, streamedLen: streamed.length, stderrTail: info.stderr?.slice(-400) });
            const finalBody = info.ok
              ? (streamed.trim() || "_(agent returned empty stdout)_")
              : `❌ Agent failed · \`@[${agent.agentName}]\`\n\n\`${info.agent_error?.text || info.error || "unknown error"}\`${info.stderr ? `\n\n\`\`\`\n${info.stderr.slice(-800)}\n\`\`\`` : ""}`;
            const trace: ToolTrace = {
              id: `tr-${Date.now()}`,
              tool: `@[${agent.agentName}]`,
              params: { query: agentQuery },
              output: streamed.slice(-2000),
              ts: Date.now(),
            };
            const rag = info.rag;
            const agentRagSources = rag && rag.enabled && Array.isArray(rag.sources) ? rag.sources.map((s) => ({
              index: s.index, name: s.name, path: s.path ?? "", ord: s.ord ?? 0,
              page: s.page ?? null, pageEnd: s.pageEnd ?? null,
              score: s.score ?? 0, brand: s.brand ?? null,
              accessLevel: s.accessLevel ?? "Viewer",
            })) : [];
            const ragPatch: Partial<SourcedMessage> = rag && rag.enabled ? {
              ragSources: agentRagSources,
              ragSkipped: rag.decision !== "inject",
              ragMode: rag.mode || null,
              ragTop1: typeof rag.top1 === "number" ? Math.round(rag.top1 * 100) : null,
              ragTau: typeof rag.tau === "number" ? Math.round(rag.tau * 100) : null,
              ragReranker: rag.rerankInfo ? {
                used: !!rag.rerankInfo.used,
                ms: rag.rerankInfo.ms,
                model: rag.rerankInfo.model ?? null,
                reason: rag.rerankInfo.reason ?? null,
                lastError: null,
              } : null,
              ragConfidence: rag.confidence || null,
              ragQueryRewritten: rag.queryRewritten || null,
              ragFallback: agentRagSources.length > 0 ? null : (rag.fallback || null),
              ragNotice: rag.decision === "inject"
                ? null
                : rag.error
                  ? `Agent RAG error · ${rag.reason || rag.error}`
                : rag.fallback?.brand
                  ? `Model knowledge · ${rag.fallback.brand} not found in library`
                  : rag.fallback?.kind === "out_of_library"
                    ? "Out of library scope"
                    : `Library miss · ${rag.reason || "no_hit"}`,
              ragRetriever: "agent-rag",
              ragIntent: "agent",
              ragAgentDiag: rag.diag ?? null,
              ragRawReason: rag.rawReason ?? rag.reason ?? rag.error ?? null,
              ragDefensiveDropped: typeof rag.defensiveDropped === "number" ? rag.defensiveDropped : null,
            } : {};
            const telemetryPatch: Partial<SourcedMessage> = info.telemetry ? {
              latency: {
                thinkMs: info.telemetry.thinkMs ?? null,
                ragMs: info.telemetry.ragMs ?? 0,
                totalMs: info.telemetry.totalMs ?? info.latencyMs ?? 0,
                tokensOut: info.telemetry.tokensOut ?? 0,
              },
            } : {};
            setMessages((m) => m.map((x) => x.id === placeholderId ? {
              ...x, content: finalBody, traces: [...(x.traces ?? []), trace], ...ragPatch, ...telemetryPatch,
            } : x));
            // Persist agent reply to DB (2026-06-01) — server-side agent-run
            // route does not insert into chat_messages, so without this the
            // agent stdout disappears on thread switch / page refresh.
            if (threadId && finalBody) {
              try { ChatAPI.persistMessage({ id: placeholderId, thread_id: threadId, role: "assistant", content: finalBody, model: activeModel }); }
              catch (e) { console.warn("[chat:agent-persist]", e); }
            }

            // RAG Debug probe — agent meta yetersizse de gerçek retrieval kararını göster.
            // Read-only, LOCAL'i tetiklemez. Sessizce fail edebilir.
            if (agentQuery) {
              void RagDebugAPI.probe(agentQuery, "Admin").then((dbg) => {
                setMessages((m) => m.map((x) => x.id === placeholderId ? { ...(x as SourcedMessage), ragDebug: dbg } : x));
              }).catch(() => { /* sessiz */ });
            }
          },
        });
      } catch (e) {
        const msg = (e as Error).message || String(e);
        setMessages((m) => m.map((x) => x.id === placeholderId ? {
          ...x, content: `❌ Agent dispatch failed · \`@[${agent.agentName}]\`\n\n\`${msg}\``,
        } : x));
        setError(`Agent failed · @[${agent.agentName}]: ${msg}`);
      }
      return;
    }


    // Skills Engine — !slug param=value param2="value 2"
    const skillMatch = input.trim().match(/^!([a-z0-9_-]{2,40})\s*(.*)$/i);
    if (skillMatch) {
      const slug = skillMatch[1].toLowerCase();
      const rest = skillMatch[2];
      // Gate: only dispatch to /api/skills if this slug is actually a skill.
      // Tools must go through an agent's manifest, agents are invoked via @[file.py].
      const slugIsSkill = skills.some((s) => String(s.slug || "").toLowerCase() === slug);
      const slugIsTool = toolSlugs.has(slug);
      const slugIsAgent = appAgents.some((a) => {
        const n = String(a.agentName || "").toLowerCase().replace(/\.py$/, "");
        return n === slug;
      });
      if (!slugIsSkill) {
        if (slugIsTool) {
          const userMsg: ChatMessage = {
            id: `tmp-${Date.now()}`, thread_id: threadId, role: "user",
            content: input, created_at: new Date().toISOString(),
          };
          const hint: ChatMessage = {
            id: `tool-hint-${Date.now()}`, thread_id: threadId, role: "assistant",
            content: `🔧 \`!${slug}\` is a **tool**, not a skill. Tools are invoked by agents via their \`# @tools:\` manifest. Address an agent that owns it, e.g. \`@[copy_smith.py] ${rest || "..."}\``,
            created_at: new Date().toISOString(),
          };
          setMessages((m) => [...m, userMsg, hint]); composerRef.current?.clearText();
          return;
        }
        if (slugIsAgent) {
          const userMsg: ChatMessage = {
            id: `tmp-${Date.now()}`, thread_id: threadId, role: "user",
            content: input, created_at: new Date().toISOString(),
          };
          const hint: ChatMessage = {
            id: `agent-hint-${Date.now()}`, thread_id: threadId, role: "assistant",
            content: `🤖 \`!${slug}\` is an **agent**, not a skill. Address it with \`@[${slug}.py] ${rest || "..."}\``,
            created_at: new Date().toISOString(),
          };
          setMessages((m) => [...m, userMsg, hint]); composerRef.current?.clearText();
          return;
        }
        // Unknown slug → silent fallthrough to LLM (don't fire /api/skills 404).
      } else {
        const params: Record<string, unknown> = {};
        const argRe = /(\w+)=(?:"([^"]*)"|(\S+))/g;
        let m: RegExpExecArray | null;
        let residual = rest;
        while ((m = argRe.exec(rest))) {
          const v = m[2] ?? m[3];
          params[m[1]] = /^-?\d+(?:\.\d+)?$/.test(v) ? Number(v) : v;
          residual = residual.replace(m[0], " ");
        }
        const positional = residual.replace(/\s+/g, " ").trim();
        if (positional && params.query === undefined) {
          params.query = positional;
          params.input = positional;
        }
        const userMsg: ChatMessage = {
          id: `tmp-${Date.now()}`, thread_id: threadId, role: "user",
          content: input, created_at: new Date().toISOString(),
        };
        setMessages((m) => [...m, userMsg]); composerRef.current?.clearText();
        try {
          const turnKey = makeDispatchKey(`skill:${slug}`, params, threadId);
          const r = await dispatchWithMutex(turnKey, () => SkillsAPI.run(slug, params, threadId));
          const cardId = `skill-result-${r.runId}`;
          const card: ChatMessage = {
            id: cardId, thread_id: threadId, role: "assistant",
            content: `⚙ Running \`!${slug}\` … _(status: ${r.status})_`,
            created_at: new Date().toISOString(),
          };
          setMessages((m) => [...m, card]);
          setTimeout(() => { void injectSkillRunResult(r.runId, slug, setMessages, threadId, cardId); }, 1500);
        } catch (e) {
          setError(`Skill failed: ${(e as Error).message}`);
        }
        return;
      }
    }

    // FAZ 2: Regex/keyword tabanlı niyet tahmini kaldırıldı.
    // Sadece explicit `!slug` prefix'i hızlı tetikleme yapar; diğer her şey
    // LLM + DETM-GATE'e (FAZ 3) gider. Eski FX/weather/loose-token bypass'ı
    // false-positive üretiyordu ve eğitilmemiş "intent oracle"dı.
    const lowered = input.toLowerCase();
    const bangMatch = lowered.match(/(?:^|\s)!([a-z0-9][a-z0-9-]{1,63})(\s*\([\s\S]*\))?/);
    const bangSlug = bangMatch ? bangMatch[1] : null;
    const bangHasParens = !!(bangMatch && bangMatch[2]);
    const skillCandidate = bangSlug
      ? skills.find((s) => String(s.slug || "").toLowerCase() === bangSlug)
      : null;
    const isToolSlug = !!(bangSlug && toolSlugs.has(bangSlug));
    // Tool wins when parens are present OR slug isn't a known skill.
    const routeAsTool = isToolSlug && (bangHasParens || !skillCandidate);

    if (routeAsTool) {
      const userMsg: ChatMessage = {
        id: `tmp-${Date.now()}`, thread_id: threadId, role: "user",
        content: input, created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, userMsg]); composerRef.current?.clearText();
      const info: ChatMessage = {
        id: `tool-info-${Date.now()}`, thread_id: threadId, role: "assistant",
        content: `🔧 \`!${bangSlug}\` is a **tool**, not a skill. Tools are invoked by agents through their \`# @tools:\` manifest. Address an agent that owns this tool, e.g. \`@[copy_smith.py] ${input}\`.`,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, info]);
      return;
    }

    if (skillCandidate) {
      const userMsg: ChatMessage = {
        id: `tmp-${Date.now()}`, thread_id: threadId, role: "user",
        content: input, created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, userMsg]); composerRef.current?.clearText();
      const placeholder: ChatMessage = {
        id: `skill-placeholder-${Date.now()}`, thread_id: threadId, role: "assistant",
        content: `⚙ Auto-dispatching \`!${skillCandidate.slug}\`…`,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, placeholder]);
      try {
        const params: Record<string, unknown> = { query: input, input };
        const turnKey = makeDispatchKey(`skill:${skillCandidate.slug}`, params, threadId);
        const r = await dispatchWithMutex(turnKey, () => SkillsAPI.run(skillCandidate.slug, params, threadId));
        setMessages((m) => m.map((x) => x.id === placeholder.id ? {
          ...x,
          content: `⚙ Running \`!${skillCandidate.slug}\` … _(status: ${r.status})_`,
        } : x));
        // Run→Chat injection: update the same placeholder bubble with the readable result.
        setTimeout(() => { void injectSkillRunResult(r.runId, skillCandidate.slug, setMessages, threadId, placeholder.id); }, 1500);
      } catch (e) {
        const msg = (e as Error).message || String(e);
        setMessages((m) => m.map((x) => x.id === placeholder.id ? {
          ...x,
          content: `❌ Skill failed · !${skillCandidate.slug}\n\n\`${msg}\``,
        } : x));
        setError(`Skill failed · !${skillCandidate.slug}: ${msg}`);
      }
      return;
    }


    const modelForRequest = activeModel || activeModelEntry?.modelName || "runtime-default";

    // GenGuard — input check before anything reaches the model.
    try { checkInput(input); }
    catch (e) {
      if (e instanceof GuardViolation) {
        setError(`🛡 GenGuard: Security Protocol Violation — "${e.matched}"`);
        return;
      }
      throw e;
    }

    const attachNote = attachments.length
      ? `\n\n[attachments: ${attachments.map(a => a.filename).join(", ")}]`
      : "";
    const imgNote = images.length
      ? `\n\n[images: ${images.length} inline — vision model engaged]`
      : "";
    const userMsgId = getUUID();
    const userMsg: ChatMessage = {
      id: userMsgId, thread_id: threadId, role: "user",
      content: input + attachNote + imgNote, created_at: new Date().toISOString(),
    };
    setMessages((m) => upsertMessageById(m, userMsg)); composerRef.current?.clearText(); setAttachments([]);
    const sentImages = images; setImages([]);
    // DB persist (best-effort) so messages survive cache wipe / thread switch.
    ChatAPI.persistMessage({ id: userMsgId, thread_id: threadId, role: "user", content: userMsg.content, model: activeModel });

    // Vision fallback: route to vision-capable model when images are present.
    const visionModel = modelForRequest;

    LogsAPI.push({ thread_id: threadId, agent: "chat", level: "info", message: "user_message_sent", meta: { traceId, images: sentImages.length, model: visionModel } });

    const initialAssistantId = getUUID();
    assistantIdRef.current = initialAssistantId;
    pendingPersistedIdRef.current = null;
    deltaBufferRef.current = "";
    if (flushTimerRef.current !== null) { window.clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    const initialThinking: ThinkingStep[] = [];
    const ts0 = Date.now();
    initialThinking.push({ id: `th-${ts0}-mode`, kind: "router", label: `Mode → ${fanoutMode ? "fanout" : mode}`, detail: pickedProviders.length ? `providers: ${pickedProviders.join(", ")}` : `policy: ${routing.mode}`, ts: ts0 });
    const enabledTools = getEnabledTools(visibleForgeActions);
    if (enabledTools.length) initialThinking.push({ id: `th-${ts0}-tools`, kind: "system", label: `Tool arsenal · ${enabledTools.length} sealed${isAdminUser ? " · admin" : userTemplate ? ` · template "${userTemplate.name}"` : ""}`, detail: enabledTools.slice(0, 12).map(t => t.id).join(", "), ts: ts0 });
    if (skills.length) initialThinking.push({ id: `th-${ts0}-skills`, kind: "system", label: `Skills armory · ${skills.length} sealed procedures`, detail: skills.slice(0, 12).map(s => `!${s.slug}`).join(", "), ts: ts0 });

    // flushSync: placeholder STATE'E commit edilmeden streamChat'i başlatma.
    // Backend "persisted" SSE frame'i ms cinsinden gelebiliyor; placeholder
    // henüz commit edilmemişse swap kayboluyor → balon boş kalıyor (eski bug).
    flushSync(() => {
      setMessages((m) => [
        ...m,
        { id: initialAssistantId, thread_id: threadId, role: "assistant", content: "", created_at: new Date().toISOString(), thinking: initialThinking, traces: [] },
      ]);
    });

    // Buffered delta flush — token başına setMessages yerine ~50ms throttled.
    let firstDeltaLogged = false;
    const flushDeltaBuffer = () => {
      flushTimerRef.current = null;
      const buf = deltaBufferRef.current;
      if (!buf) return;
      deltaBufferRef.current = "";
      const targetId = assistantIdRef.current;
      const pendingSwapFrom = pendingPersistedIdRef.current ? initialAssistantId : null;
      const pendingSwapTo = pendingPersistedIdRef.current;
      setMessages((prev) => {
        let matched = false;
        const next = prev.map((m) => {
          // Pending persisted swap'i fırsat bulduğumuz an uygula (kayıp olmaz).
          if (pendingSwapFrom && pendingSwapTo && m.id === pendingSwapFrom) {
            matched = true;
            return { ...m, id: pendingSwapTo, content: m.content + buf };
          }
          if (m.id === targetId) { matched = true; return { ...m, content: m.content + buf }; }
          return m;
        });
        // Race fallback: hiçbir mesaj eşleşmediyse son assistant bubble'a yaz.
        // (Persisted swap arasında id kaymışsa veya placeholder henüz görünmüyorsa)
        if (!matched) {
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              try { console.warn("[chat/delta] fallback-to-last-assistant", { targetId, pendingSwapTo, initialAssistantId, matchedId: next[i].id, bufChars: buf.length }); } catch { /* */ }
              next[i] = { ...next[i], content: next[i].content + buf };
              break;
            }
          }
        }
        return next;
      });
      if (pendingSwapFrom && pendingSwapTo) pendingPersistedIdRef.current = null;
    };
    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(flushDeltaBuffer, 50);
    };


    // RAG-only parse/dispatch gate (state-based, no regex/whitelist):
    // backend `inject` kararı verdiyse asistan çıktısı sadece düz cevaptır —
    // protocol parser ve skill/tool dispatch o turn için kapatılır.
    let ragUsedThisTurn = false;
    // Smalltalk gate: backend "selam"/"naber" turnünde rag.intent='smalltalk' +
    // mode='*bypass*' gönderir. Model bazen serbest dolaşan `!slug` veya
    // `@[script.py]` token'ı uydurur — bunlar smalltalk'ta tool/agent chip'i
    // OLMAMALI. Aksi halde UI'da "Raw · !researcher" gibi sahte trace çıkar.
    // Detay: mem://session/2026-06-02-chat-smalltalk-debug-handoff.md
    let smalltalkThisTurn = false;
    // ctrl + streaming + chat:streaming event'i artık send() en başında set
    // ediliyor (outer try/finally). Burada sadece stream akışına giriyoruz.
    try {
      const result = await ChatAPI.streamChat({

        traceId,
        userMessageId: userMsgId,
        threadId, model: visionModel,
        mode: fanoutMode ? "fanout" : mode,
        providerId: !fanoutMode && pickedProviders.length === 1 ? pickedProviders[0] : null,
        providerIds: fanoutMode ? pickedProviders : null,
        agents: pickedAgents.filter((id) => {
          if (id === "meta-forge-master") return true;
          const agent = appAgents.find((a) => a.id === id);
          return String(agent?.agentName || "").toLowerCase().includes("meta-forge");
        }),
        username: chatUser?.username ?? null,
        messages: (() => {
          const enabled = enabledTools;
          const profileLine = chatUser
            ? `You are operating inside the trusted envelope of user "${chatUser.username}" (role: ${chatUser.role}${userTemplate?.name ? `, capability profile: ${userTemplate.name}` : ""}). ${chatUser.role === "Admin" ? "As Admin you have unrestricted access to every sealed tool and agent in the arsenal." : "You may ONLY invoke tools listed below — they are the ones sealed to this user's profile in PostgreSQL. Do not attempt or suggest any tool outside this list."}`
            : "You operate as an anonymous caller — restrict yourself to globally-published tools only.";
          const profileSystem = {
            role: "system" as const,
            content:
              profileLine +
              (userTemplate?.systemPrompt ? `\n\n[Profile directive]\n${userTemplate.systemPrompt}` : ""),
          };
          const toolHint = enabled.length === 0 ? null : {
            role: "system" as const,
            content:
              "You have access to the following sealed tools from the Forge action library. " +
              "When a user request matches a tool's purpose, autonomously decide to invoke it by responding with a JSON block: " +
              "```tool_call\\n{\"tool\":\"<id>\",\"params\":{...}}\\n```\\n" +
              "Tools:\\n" +
              enabled.map((a) => `- ${a.id} · ${a.name} — ${a.description || "(no description)"} · params: [${a.params.map((p) => `${p.key}:${p.type}${p.default !== undefined ? `=${JSON.stringify(p.default)}` : ""}`).join(", ")}]`).join("\\n"),
          };
          const skillsHint = skills.length === 0 ? null : {
            role: "system" as const,
            content:
              "PROTOCOL SEGMENTATION (strict):\n" +
              "• Skills are executed only when the user explicitly starts the turn with !slug. Do not autonomously emit skill_call for ordinary requests.\n" +
              "• If the user asks to create, write, design, build, or propose a new skill/tool/agent/pack, do not run an existing skill; leave the turn for Meta-Forge planning.\n" +
              "• For explicit Skills, use the ```skill_call``` format. NEVER write !slug inside tool_call.\n" +
              "• Use ```tool_call``` format for Forge tools.\n" +
              "• Use `@[script.py]` tag for local Python agents.\n\n" +
              "Only after an explicit user !slug request, ANNOUNCE briefly which one you'll use (e.g. \"triggering !audit-vip\") and then trigger it by emitting EXACTLY one fenced block:\n" +
              "```skill_call\n{\"skill\":\"<slug>\",\"params\":{\"query\":\"...\"}}\n```\n" +
              "Skills:\n" +
              skills.map(s => {
                const head = `- !${s.slug} · ${s.name} — ${s.description || ""} · risk:${s.risk_level}${s.requires_approval ? " · requires approval" : ""}`;
                const body = (s.instructions || "").trim();
                return body ? `${head}\n  Instructions:\n${body.split("\n").map(l => "    " + l).join("\n")}` : head;
              }).join("\n"),
          };
          const base = [
            ...messages,
            { ...userMsg, content: userMsg.content + (sentImages.length ? `\n\n${sentImages.map(i=>i.dataUrl).join("\n")}` : "") } as ChatMessage,
          ].map((m) => ({ role: m.role, content: m.content }));
          const head: { role: "system"; content: string }[] = [profileSystem];
          if (toolHint) head.push(toolHint);
          if (skillsHint) head.push(skillsHint);
          return [...head, ...base];
        })(),
        signal: ctrl.signal,
        onMeta: (meta) => {
          const targetId = assistantIdRef.current;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== targetId) return m;
            const next = { ...m } as SourcedMessage;
            if (meta.source) next.source = meta.source;
            const step: ThinkingStep = {
              id: `th-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
              kind: meta.source?.startsWith("websearch") ? "tool" : "provider",
              label: meta.providerName ? `Provider → ${meta.providerName}` : meta.source ? `Source → ${meta.source}` : "Routing decision",
              detail: meta.model || undefined,
              ts: Date.now(),
            };
            next.thinking = [...(m.thinking ?? []), step];
            return next;
          }));
        },
        onDelta: (chunk) => {
          const safe = checkOutput(chunk);
          if (!firstDeltaLogged) {
            firstDeltaLogged = true;
            try { console.info("[chat/delta] first", { chars: safe.length, targetId: assistantIdRef.current, initialAssistantId, pendingId: pendingPersistedIdRef.current }); } catch { /* */ }
          }
          // Throttled flush: token başına setMessages YOK; buffer + 50ms.
          deltaBufferRef.current += safe;
          // Boyut-tabanlı hard cap: render thread yavaşlamış olsa bile buffer
          // 8 KB'yi geçemez. Geçerse anında flush (timer iptal + senkron çağrı).
          if (deltaBufferRef.current.length >= 8000) {
            if (flushTimerRef.current !== null) { window.clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            flushDeltaBuffer();
          } else {
            scheduleFlush();
          }
        },

        onSources: (rag: RagPayload) => {
          const modeText = typeof rag.mode === "string" ? rag.mode : "";
          const explicitBypass =
            rag.intent === "smalltalk" &&
            (/bypass/i.test(modeText) || /semantic-meta/i.test(modeText));
          const bypassed = explicitBypass;
          if (bypassed) smalltalkThisTurn = true;
          const norm: RagSource[] = bypassed ? [] : (Array.isArray(rag.sources)
            ? rag.sources.map((s, i) => typeof s === "string"
                ? { index: i + 1, name: s, path: s, ord: 0, page: null, pageEnd: null, score: 0, brand: null, accessLevel: "—" }
                : s)
            : []);
          if (!bypassed && norm.length > 0) ragUsedThisTurn = true;
          const targetId = assistantIdRef.current;

          setMessages((prev) => prev.map((m) => m.id === targetId
            ? {
                ...m,
                ragSources: norm,
                ragNotice: norm.length > 0 ? null : (rag.notice ?? null),
                ragKeywords: bypassed ? [] : (rag.searchedKeywords ?? []),
                ragRetriever: bypassed ? null : (rag.retriever ?? null),
                ragSkipped: bypassed,
                ragIntent: rag.intent ?? (bypassed ? "smalltalk" : null),
                ragMode: rag.mode ?? null,
                ragTop1: bypassed ? null : (typeof rag.top1 === "number" ? Math.round(rag.top1 * 100) : null),
                ragTau: bypassed ? null : (typeof rag.tau === "number" ? rag.tau : null),
                ragMargin: bypassed ? null : (typeof rag.margin === "number" ? rag.margin : null),
                ragReranker: bypassed ? null : (rag.reranker ?? null),
                ragConfidence: bypassed ? null : (rag.confidence ?? null),
                ragQueryRewritten: bypassed ? null : (rag.queryRewritten ?? null),
                ragFallback: (bypassed || norm.length > 0) ? null : (rag.fallback ?? null),
                ragAgentDiag: bypassed ? null : ((rag.diag as AgentRagDiag | undefined) ?? null),
                ragRawReason: bypassed ? null : (rag.rawReason ?? rag.reason ?? null),
                ragDefensiveDropped: bypassed ? null : (typeof rag.defensiveDropped === "number" ? rag.defensiveDropped : null),
              }
            : m));
        },
        onLatency: (l) => {
          const targetId = assistantIdRef.current;
          setMessages((prev) => prev.map((m) => m.id === targetId ? { ...m, latency: l } : m));
        },
        onPhase: (phase, payload) => {
          recordChatTrace(traceId, `phase.${phase}`, { phase });
          refreshDebugTrace(traceId);
          // Server'ın pre-generate ettiği kalıcı UUID — feedback (👍/👎)
          // bu id'ye yazılacak. flushSync ile placeholder zaten commit edildi,
          // ama yine de "bulunamazsa" pending'e yaz; bir sonraki delta flush
          // veya phase swap'i tamamlar — race güvenliği.
          if (phase === "persisted" && typeof payload?.assistantMessageId === "string") {
            const persistedId = String(payload.assistantMessageId);
            const oldId = assistantIdRef.current;
            assistantIdRef.current = persistedId;
            setMessages((prev) => {
              let swapped = false;
              const next = prev.map((m) => {
                if (m.id === oldId) { swapped = true; return { ...m, id: persistedId }; }
                return m;
              });
              if (!swapped) pendingPersistedIdRef.current = persistedId;
              try { console.info("[chat/phase] persisted", { oldId, persistedId, swapped }); } catch { /* */ }
              return next;
            });
            return;
          }

          if (phase === "tool_call.start" || phase === "tool_call.result") {
            // TUR-6 Phase C — render agent tool dispatches inline as ToolTrace.
            const tid = String(payload?.id ?? "");
            const slug = String(payload?.slug ?? "tool");
            const agentId = String(payload?.agentId ?? "");
            const targetIdTC = assistantIdRef.current;
            setMessages((prev) => prev.map((m) => {
              if (m.id !== targetIdTC) return m;
              const traces = [...(m.traces ?? [])];
              const idx = traces.findIndex((t) => t.id === tid);
              if (phase === "tool_call.start") {
                const entry: ToolTrace = {
                  id: tid || `tc-${Date.now()}`,
                  tool: `!${slug}${agentId ? ` · ${agentId}` : ""}`,
                  params: payload?.input,
                  output: "running…",
                  ts: Date.now(),
                };
                if (idx >= 0) traces[idx] = entry; else traces.push(entry);
              } else {
                const status = String(payload?.status ?? "");
                const isErr = status !== "success";
                const out = payload?.output;
                const outStr = out == null ? "" : (typeof out === "string" ? out : JSON.stringify(out, null, 2));
                const ms = Number(payload?.ms ?? 0);
                const label = `!${slug}${agentId ? ` · ${agentId}` : ""}${ms ? ` · ${ms}ms` : ""}${isErr ? ` · ${status}` : ""}`;
                const entry: ToolTrace = {
                  id: tid || `tc-${Date.now()}`,
                  tool: label,
                  params: payload?.input,
                  output: isErr ? undefined : outStr,
                  error: isErr ? String(payload?.error ?? status) : undefined,
                  ts: Date.now(),
                };
                if (idx >= 0) traces[idx] = entry; else traces.push(entry);
              }
              return { ...m, traces };
            }));
            return;
          }
          if (phase === "forge_plan_partial") {
            const intent = typeof payload?.intent === "string" ? payload.intent : null;
            const rawItem = (payload && typeof payload === "object" && "create_item" in payload)
              ? (payload as { create_item?: { kind?: string; slug?: string; name?: string | null; description?: string | null; risk?: string | null } }).create_item
              : undefined;
            const item = rawItem && typeof rawItem.kind === "string" && typeof rawItem.slug === "string"
              ? { kind: rawItem.kind, slug: rawItem.slug, name: rawItem.name ?? null, description: rawItem.description ?? null, risk: rawItem.risk ?? null }
              : null;
            if (!intent && !item) return;
            const targetIdFPP = assistantIdRef.current;
            const pendingIdFPP = pendingPersistedIdRef.current;
            setMessages((prev) => {
              let matched = false;
              const bump = (m: SourcedMessage): SourcedMessage => {
                matched = true;
                const cur: ForgePlanPartial = m.forgePlanPartial ?? { intent: null, create: [], startedAt: Date.now() };
                const nextIntent = intent ?? cur.intent ?? null;
                let nextCreate = cur.create;
                if (item && !cur.create.some((c) => c.kind === item.kind && c.slug === item.slug)) {
                  nextCreate = [...cur.create, item];
                }
                // Görünürlük bandajı: delta henüz düşmediyse balon boş kalmasın.
                const nextContent = (m.content && m.content.length > 0) ? m.content : "🔨 Meta-Forge planlıyor…";
                return { ...m, content: nextContent, forgePlanPartial: { intent: nextIntent, create: nextCreate, startedAt: cur.startedAt } };
              };

              const next = prev.map((m) => (m.id === targetIdFPP || (pendingIdFPP && m.id === pendingIdFPP)) ? bump(m) : m);
              if (matched) return next;
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].role === "assistant") { next[i] = bump(next[i]); break; }
              }
              return next;
            });
            return;
          }
          if (phase === "forge_plan") {
            const fp = payload as unknown as ForgePlanPayload;
            const targetIdFP = assistantIdRef.current;
            const pendingId = pendingPersistedIdRef.current;
            try { console.info("[forge_plan] frame", { targetIdFP, pendingId, planId: fp?.id }); } catch { /* */ }
            setMessages((prev) => {
              // Match against either the current ref (post-persisted-swap) or
              // pending id (persisted arrived before placeholder committed) or
              // fall back to the last assistant bubble — the plan frame can
              // land before the persisted-swap has propagated to state.
              let matched = false;
              const stamp = (m: SourcedMessage): SourcedMessage => {
                // Görünürlük bandajı: delta henüz düşmediyse balon boş kalmasın.
                const nextContent = (m.content && m.content.length > 0)
                  ? m.content
                  : "🔨 Meta-Forge otomatik planladı — kart aşağıda.";
                return { ...m, content: nextContent, forgePlan: fp };
              };
              const next = prev.map((m) => {
                if (m.id === targetIdFP || (pendingId && m.id === pendingId)) {
                  matched = true;
                  return stamp(m);
                }
                return m;
              });
              if (matched) return next;
              // Fallback: stamp the last assistant message.
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].role === "assistant") {
                  next[i] = stamp(next[i] as SourcedMessage);
                  break;
                }
              }
              return next;
            });
            return;
          }


          // 2026-07-06 — capability_proposed frame handler söküldü.
          // Eski Capability Agent hattı komple kaldırıldı; yaratma sorumluluğu
          // Meta-Forge (forge_preview/forge_plan/forge_run_prompt) frame'lerine
          // devredildi.




          if (phase === "agent_auto_route") {
            // Backend chose an agent before LOCAL ran. Stamp the bubble so the
            // user sees "answered by @Firewall_Oracle" without scanning logs.
            const agentName = String(payload?.agentName ?? "");
            const script = String(payload?.script ?? "");
            const matchedToken = typeof payload?.matchedToken === "string" ? payload.matchedToken : undefined;
            const score = typeof payload?.score === "number" ? payload.score : undefined;
            if (agentName || script) {
              const targetIdAR = assistantIdRef.current;
              setMessages((prev) => prev.map((m) => m.id === targetIdAR
                ? { ...m, agentRouted: { agentName: agentName || script, script, matchedToken, score } }
                : m));
            }
            return;
          }
          const targetId = assistantIdRef.current;
          const stageStr = typeof payload?.stage === "string" ? payload.stage : undefined;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== targetId) return m;
            if (phase === "local_warming") {
            const notice = (payload?.notice as string) || "Runtime is preparing the first token.";
              const step: ThinkingStep = { id: `th-warm-${Date.now()}`, kind: "system", label: "Runtime preparing first token", detail: notice, ts: Date.now() };
              return { ...m, streamPhase: phase, streamStage: stageStr ?? m.streamStage, thinking: [...(m.thinking ?? []), step] };
            }
            return { ...m, streamPhase: phase, streamStage: stageStr ?? m.streamStage };
          }));
        },
      });
      // Stream tamamlandı — buffer'da kalan son delta'ları flush et.
      if (flushTimerRef.current !== null) { window.clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      flushDeltaBuffer();
      refreshDebugTrace(traceId);
      const safeFull = checkOutput(result.text);
      // Parse every protocol envelope the model emitted (tool_call / skill_call
      // / @[script.py] / naked JSON). Dispatch them to the right execution
      // lane and dedup with executedProtocolKeysRef so a zombie loop is
      // impossible across re-renders.
      // RAG-only gate: backend inject verdiyse model çıktısı sadece cevaptır,
      // protocol envelope'lar (tool_call / skill_call / @[script.py]) dispatch
      // edilmez. Aksi halde RAG turn'lerinde "⚙ skill hazırlanıyor" ghost
      // çağrıları doğuyordu.
      const calls: ProtocolCall[] = (ragUsedThisTurn || smalltalkThisTurn) ? [] : extractProtocolCalls(safeFull);
      const userExplicitSkillDispatch = input.trim().startsWith("!");

      const fresh: ProtocolCall[] = [];
      for (const c of calls) {
        const key = callDedupKey(c);
        if (executedProtocolKeysRef.current.has(key)) continue;
        if (c.kind === "skill" && !userExplicitSkillDispatch) {
          executedProtocolKeysRef.current.add(key);
          continue;
        }
        executedProtocolKeysRef.current.add(key);
        fresh.push(c);
        if (c.kind === "skill") {
          // Autonomous skill icrası — manuel Run modalı YOK, doğrudan backend.
          try {
            const turnKey = makeDispatchKey(`skill:${c.slug}`, c.params, traceId);
            const r = await dispatchWithMutex(turnKey, () => SkillsAPI.run(c.slug, c.params as Record<string, unknown>, threadId));
            toast.success(`Skill executed · !${c.slug}`);
            setTimeout(() => { void injectSkillRunResult(r.runId, c.slug, setMessages, threadId); }, 1500);
          } catch (e) {
            toast.error(`Skill failed · !${c.slug}: ${(e as Error).message}`);
          }
        }
        // python_agent calls are handled server-side by the agent bridge.
      }
      setMessages((prev) => prev.map((m) => {
        if (m.id !== assistantIdRef.current) return m;
        const cleaned = (ragUsedThisTurn || smalltalkThisTurn) ? m.content : stripProtocolBlocks(m.content);
        const traces = fresh.map((c, i) => {
          const label = c.kind === "skill" ? `!${c.slug}` : c.kind === "tool" ? c.id : `@[${c.script}]`;
          const params = c.kind === "python_agent" ? { query: c.query } : c.params;
          return {
            id: `tr-${Date.now()}-${i}`,
            tool: label,
            params,
            output: JSON.stringify(params, null, 2),
            ts: Date.now(),
          } as ToolTrace;
        });
        const extraThink: ThinkingStep[] = fresh.map((c, i) => {
          const label = c.kind === "skill" ? `Skill auto-run → !${c.slug}`
            : c.kind === "tool" ? `Tool call → ${c.id}`
            : `Python agent → @[${c.script}]`;
          return { id: `th-call-${Date.now()}-${i}`, kind: "tool", label, detail: "model-issued · auto-dispatch", ts: Date.now() };
        });
        return {
          ...m,
          content: cleaned || m.content,
          source: result.source,
          traces: [...(m.traces ?? []), ...traces],
          thinking: [...(m.thinking ?? []), ...extraThink],
        };
      }));
      LogsAPI.push({ thread_id: threadId, agent: "chat", level: "info", message: "assistant_stream_complete", meta: { traceId, chars: safeFull.length, mode, source: result.source, toolCalls: calls.length, dispatched: fresh.length } });
      // Assistant persistence is owned by /api/chat/orchestrate. Client-side
      // fallback used to double-insert the final answer after navigation.
    } catch (e) {
      const raw = (e as Error).message || String(e);
      recordChatTrace(traceId, "stream.error", { error: raw }, "error");
      refreshDebugTrace(traceId);
      const msg = raw.includes("LOCAL first-token timeout")
        ? "POST sent and SSE accepted/bypass returned, but LOCAL produced no first token. Check the backend fallback/trace output."
        : raw.includes("LOCAL header timeout")
          ? "POST sent with bypass selected, but LOCAL returned no header. 127.0.0.1: runtime is locked or down."
          : raw.includes("Failed to fetch") || raw.includes("Could not connect") || raw.includes("timed out") || raw.includes("timeout")
            ? "Pipeline stream timed out — the RAG/LLM line did not answer. Offline assumption for the 3005 bridge was not printed."
            : raw;
      setError(msg);
      setMessages((prev) => prev.map((m) => m.id === assistantIdRef.current && !m.content
        ? { ...m, content: msg, source: "error", thinking: [...(m.thinking ?? []), { id: `th-${Date.now()}-err`, kind: "system", label: "Stream failed", detail: msg, ts: Date.now() }] }
        : m));
      LogsAPI.push({ thread_id: threadId, agent: "chat", level: "error", message: "stream_failed", meta: { traceId, error: msg } });
    }
    // inner try/catch sona erdi; outer finally aşağıda master-cleanup yapacak.
    } finally {
      // Master cleanup — her kod yolundan (early return, throw, abort, success)
      // SONRA tek noktadan tetiklenir. UI lock'unu garanti serbest bırakır.
      // Buffer'da bekleyen son delta'ları da boşalt (abort/throw senaryosu).
      if (flushTimerRef.current !== null) { window.clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      if (deltaBufferRef.current) {
        const buf = deltaBufferRef.current;
        deltaBufferRef.current = "";
        const tgt = assistantIdRef.current;
        setMessages((prev) => prev.map((m) => m.id === tgt ? { ...m, content: m.content + buf } : m));
      }
      busyRef.current = false;
      setStreaming(false);
      abortRef.current = null;
      // Tur sonu: id ref'lerini de sıfırla. Bir sonraki send() kendi initialAssistantId'sini
      // koyacak; eski tur'dan kalan referans bir sonraki turun ilk delta'sını yanlış balona
      // yazmasın (regression guard — Core rule ile uyumlu).
      assistantIdRef.current = null;
      pendingPersistedIdRef.current = null;
      window.dispatchEvent(new CustomEvent("chat:streaming", { detail: { active: false } }));
    }
  };

  // Stop: abort + UI'ı anında serbest bırak. Backend zaten requestAbort.signal
  // üzerinden temiz kapanışı tetikleyecek (catch → finally master-cleanup).
  const stop = () => {
    try { abortRef.current?.abort(); } catch { /* */ }
    // Master cleanup zaten finally'de düşecek; ekstra setStreaming(false)
    // çağrısı redundant ama UX için anında set ediyoruz (state batch).
    busyRef.current = false;
    setStreaming(false);
  };

  const openLiveCall = () => {
    if (!window.isSecureContext) toast.warning("HTTP over IP: a secure context may be required for the microphone; opening the panel anyway.");
    if (!active) {
      const localTh: ChatThread = {
        id: `local-${getUUID()}`,
        title: `Live Call ${threads.length + 1}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setThreads((prev) => [localTh, ...prev]);
      setActive(localTh.id);
      setMessages([]);
    }
    setLiveCallOpen(true);
  };

  // Keep sendRef pointing at the latest send() so handleRegenerateMessage can
  // call it without being recreated on every render.
  sendRef.current = send;

  return (
    <div
      className="flex h-full min-h-0 relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragOver(false);
        if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
      }}
    >
      <ChatDebugOverlay
        enabled={debugOverlayEnabled}
        streaming={streaming}
        activeTraceId={debugTraceId}
      />
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary flex items-center justify-center pointer-events-none">
          <p className="text-sm font-mono text-primary">Drop files to attach · {ACCEPT}</p>
        </div>
      )}

      <aside className="w-64 border-r border-border glass flex flex-col">
        <div className="p-3 border-b border-border">
          <Button onClick={newThread} className="w-full bg-gradient-primary text-primary-foreground" size="sm">
            <Plus className="h-4 w-4 mr-1" /> {chatT("chat.new")}
          </Button>
        </div>
        <ChatThreadList
          threads={threads}
          activeId={active}
          onActivate={setActive}
          onRename={(id: string, newTitle: string) => {
            setThreads(prev => prev.map(x => x.id === id
              ? { ...x, title: newTitle, updated_at: new Date().toISOString() }
              : x));
          }}
          onDelete={deleteThread}
        />
      </aside>

      {/* Vertical capability rail — Agents (minds) · Tools (Forge scripts) · Attach · Camera · Mic */}
      <nav className="w-12 border-r border-border bg-card/30 flex flex-col items-center py-3 gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <button title={`Agents (${visibleAppAgents.length})`}
              className="relative h-9 w-9 rounded flex items-center justify-center transition-all text-muted-foreground hover:text-cyan-400 hover:bg-accent/40">
              <Bot className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-72 p-0">
            <div className="px-3 py-2 border-b border-border bg-card/60 flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">{agentsLabel}</span>
              <Link to="/agents" className="ml-auto text-[10px] font-mono text-primary hover:underline">manage →</Link>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto space-y-1">
              {visibleAppAgents.length === 0 && <p className="text-[11px] font-mono text-muted-foreground px-1 py-2">No agents available in your template.</p>}
              {visibleAppAgents.map(a => {
                return (
                  <button key={a.id}
                    onClick={() => {
                      const cur = composerRef.current?.getText() ?? "";
                      const file = a.agentName.endsWith(".py") ? a.agentName : `${a.agentName}.py`;
                      const token = `@[${file}] `;
                      if (!cur.includes(token.trim())) {
                        composerRef.current?.setText(cur ? `${cur.replace(/\s*$/, "")} ${token}` : token);
                      }
                      setTimeout(() => composerRef.current?.focus?.(), 50);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded text-[11px] font-mono flex items-center gap-2 transition-all hover:bg-accent/40">
                    <Bot className="h-3 w-3 shrink-0" />
                    <span className="flex-1 truncate">{a.agentName}</span>
                    <span className="text-[9px] text-muted-foreground">{a.role}</span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button title={`Tools (${visibleForgeActions.length}) — Forge sealed`}
              className="relative h-9 w-9 rounded flex items-center justify-center text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10 transition-all">
              <Wrench className="h-4 w-4" />
              {visibleForgeActions.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 px-0.5 rounded-full text-[8px] font-mono bg-amber-500 text-black flex items-center justify-center">{visibleForgeActions.length}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-80 p-0">
            <div className="px-3 py-2 border-b border-border bg-card/60 flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400">{toolsLabel}</span>
              <a href="/forge" className="ml-auto text-[10px] font-mono text-primary hover:underline">manage →</a>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto space-y-1">
              {visibleForgeActions.length === 0 && <p className="text-[11px] font-mono text-muted-foreground px-1 py-2">No tools sealed to your profile.</p>}
              {visibleForgeActions.map(t => {
                const slug = t.slug || t.id;
                return (
                  <div key={t.id} className="group w-full px-2 py-1.5 rounded text-[11px] font-mono flex items-center gap-2 hover:bg-amber-500/10 transition-all">
                    <button type="button"
                      onClick={() => { const cur = composerRef.current?.getText() ?? ""; const pre = cur.trimEnd() ? cur.trimEnd() + " " : ""; composerRef.current?.setText(pre + `/${slug} `); composerRef.current?.focus(); }}
                      className="flex-1 flex items-center gap-2 text-left min-w-0">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                      <span className="flex-1 truncate">/{slug}</span>
                      <Badge variant="outline" className="text-[8px] font-mono px-1 py-0">{t.kind}</Badge>
                      {typeof t.priority === "number" && <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 text-amber-400 border-amber-500/40">P{t.priority}</Badge>}
                      {t.risk_level && t.risk_level !== "low" && <Badge variant="outline" className="text-[8px] font-mono px-1 py-0">{t.risk_level}</Badge>}
                      {t.is_system && <ShieldCheck className="h-3 w-3 text-emerald-400" />}
                    </button>
                    <button type="button" title="Tool details"
                      onClick={(e) => { e.stopPropagation(); setToolDetail(t); }}
                      className="opacity-60 hover:opacity-100 hover:text-amber-400 shrink-0">
                      <Info className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button title={`Skills (${skills.length}) — sealed procedures`}
              className="relative h-9 w-9 rounded flex items-center justify-center text-muted-foreground hover:text-fuchsia-400 hover:bg-fuchsia-500/10 transition-all">
              <Sparkles className="h-4 w-4" />
              {skills.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 px-0.5 rounded-full text-[8px] font-mono bg-fuchsia-500 text-white flex items-center justify-center">{skills.length}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-80 p-0">
            <div className="px-3 py-2 border-b border-border bg-card/60 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-fuchsia-400">Skills</span>
              <Link to="/skills" className="ml-auto text-[10px] font-mono text-primary hover:underline">{"manage →"}</Link>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto space-y-1">
              {skills.length === 0 && <p className="text-[11px] font-mono text-muted-foreground px-1 py-2">{"No skills available."}</p>}
              {skills.map(s => (
                <button key={s.id}
                  onClick={() => { const cur = composerRef.current?.getText() ?? ""; const pre = cur.trimEnd() ? cur.trimEnd() + " " : ""; composerRef.current?.setText(pre + `!${s.slug} `); composerRef.current?.focus(); }}
                  className="w-full text-left px-2 py-1.5 rounded text-[11px] font-mono flex items-center gap-2 hover:bg-fuchsia-500/10 transition-all">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="flex-1 truncate">!{s.slug}</span>
                  <Badge variant="outline" className="text-[8px] font-mono px-1 py-0">{s.risk_level}</Badge>
                  {s.requires_approval && <ShieldCheck className="h-3 w-3 text-amber-400" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <div className="w-6 h-px bg-border my-1" />

        <button onClick={() => fileRef.current?.click()} title={"Attach files"}
          className="h-9 w-9 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-accent/40 transition-all">
          <Paperclip className="h-4 w-4" />
        </button>
        <button onClick={openCamera} title={"Capture from camera"}
          className="h-9 w-9 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-accent/40 transition-all">
          <Camera className="h-4 w-4" />
        </button>
        <button onClick={recording ? stopRecording : startRecording}
          title={recording ? "Stop recording" : "Record voice note"}
          className={`h-9 w-9 rounded flex items-center justify-center transition-all ${recording ? "text-destructive bg-destructive/10 ring-1 ring-destructive/40 animate-pulse" : "text-muted-foreground hover:text-primary hover:bg-accent/40"}`}>
          {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
      </nav>

      <div className="flex-1 flex flex-col min-w-0 h-full min-h-0">
        {/* Header sits OUTSIDE the scroller — guaranteed fixed on long chats. */}
        <div className="border-b border-border p-3 flex items-center justify-between glass shrink-0">

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{threads.find((t) => t.id === active)?.title ?? "—"}</span>
            {visibleLocalModels.length > 1 ? (
              <Select
                value={activeModel || undefined}
                onValueChange={(v) => setSelectedModelId(v)}
                disabled={!canOverrideModel || streaming}
              >
                <SelectTrigger className="h-7 w-[220px] text-[10px] font-mono" title="Active model · this turn only">
                  <Cpu className="h-3 w-3 mr-1 text-primary" />
                  <SelectValue placeholder={activeModelName || "select model"} />
                </SelectTrigger>
                <SelectContent>
                  {visibleLocalModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="font-mono text-[11px]">
                      {m.modelName || m.id}{m.isDefault ? "  ★" : ""}{m.status !== "ready" ? `  · ${m.status}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline" className="text-[10px] font-mono">{activeModelName || "NO REAL MODEL"}</Badge>
            )}
            <Badge variant="outline" className="text-[10px] font-mono">tpl:{activeModelProfile.template}</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">stop:{activeModelProfile.stopCount}</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">safety:{activeModelProfile.safetyCount ? "model" : "global"}</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">RAG:{activeModelProfile.ragEnabled ? "on" : "off"}</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">{streaming ? "streaming…" : "idle"}</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">pg://local</Badge>
            {chatUser?.role === "Admin" && (
              <Badge className="text-[10px] font-mono bg-amber-500/15 text-amber-400 border border-amber-500/40">
                <ShieldCheck className="h-3 w-3 mr-1 inline" /> ADMIN · UNRESTRICTED
              </Badge>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost" size="sm"
              onClick={async () => {
                if (!confirm("Hard-delete every message in this chat from PostgreSQL? They will NOT come back on refresh.")) return;
                setMessages([]); setAttachments([]); setImages([]); composerRef.current?.clearText();
                setPickedAgents([]); setError(null);
                if (typeof window !== "undefined" && active) localStorage.removeItem(`chat.msgs.${active}`);
                if (active) {
                  try {
                    const r = await ChatAPI.clearMessages(active);
                    toast.success(`Context purged · ${r.deleted ?? 0} messages hard-deleted${r.kvFlushed ? " · LOCAL KV cache flushed" : ""}`);
                  } catch (e) {
                    toast.error("Purge failed: " + String((e as Error).message));
                  }
                }
                LogsAPI.push({ thread_id: active ?? undefined, agent: "chat", level: "info", message: "context_hard_purged", meta: { by: chatUser?.username ?? "anon" } });
              }}
              title={"Context Purge — hard-delete from PostgreSQL"}
              className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/40">
              <Eraser className="h-4 w-4 mr-1" />{"Purge"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadThreadPdf(threads.find(t=>t.id===active)?.title ?? "thread", messages, chatUser?.username ?? "user")}>
              <FileDown className="h-4 w-4 mr-1" />PDF
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadThreadMd(threads.find(t=>t.id===active)?.title ?? "thread", messages, chatUser?.username ?? "user")}>
              <Download className="h-4 w-4 mr-1" />MD
            </Button>
            <Button
              variant={debugPanelOpen ? "default" : "ghost"}
              size="sm"
              onClick={() => setDebugPanelOpen(v => !v)}
              title={debugTraceId ? `Debug panel (last trace: ${debugTraceId})` : "Debug panel — no trace yet"}
            >
              <Terminal className="h-4 w-4 mr-1" />Debug
            </Button>
          </div>
        </div>

        {error && (
          <div className="border-b border-destructive/40 bg-destructive/10 text-destructive px-4 py-2 text-xs flex items-center gap-2 font-mono">
            <AlertCircle className="h-3 w-3" /> {error}
          </div>
        )}

        {debugTraceId && (debugPanelOpen || error || streaming) && (
          <div className="border-b border-border bg-card/70 px-4 py-2 font-mono text-[10px]">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-primary" />
              <span className="font-bold uppercase tracking-widest text-primary">Debug Trace</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{debugTraceId}</code>
              <Badge variant="outline" className="text-[9px]">{debugTrace.length} event</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 px-2 text-[10px]"
                onClick={() => window.open(`${resolveApiBaseUrl()}/api/debug/chat/${debugTraceId}`, "_blank", "noopener,noreferrer")}
              >
                Backend
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => void copyFullTrace(debugTraceId)}
              >
                <Copy className="mr-1 h-3 w-3" /> Kopyala (full)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => void copyDebugText("Frontend trace", buildDebugTracePayload(debugTraceId))}
              >
                <Copy className="mr-1 h-3 w-3" /> Sadece frontend
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => window.open(`${resolveApiBaseUrl()}/api/debug/chat/${debugTraceId}?format=text`, "_blank", "noopener,noreferrer")}
              >
                Backend (text)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => void copyDebugText("Terminal komutu", `curl -s ${resolveApiBaseUrl()}/api/debug/chat/${debugTraceId}?format=text`)}
              >
                <Terminal className="mr-1 h-3 w-3" /> curl
              </Button>
            </div>
            {debugCopyStatus && <div className="mt-1 text-muted-foreground">{debugCopyStatus}</div>}
            {debugCopyFallback && (
              <Textarea
                ref={fallbackTaRef}
                value={debugCopyFallback}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                className="mt-2 h-28 resize-y border-border bg-background/80 text-[10px]"
              />
            )}
            <div className="mt-1 flex flex-wrap gap-1 text-muted-foreground">
              {debugTrace.slice(-10).map((evt) => (
                <span key={`${evt.ts}-${evt.stage}`} className={evt.level === "error" ? "text-destructive" : evt.level === "warn" ? "text-amber-400" : "text-muted-foreground"}>
                  {evt.stage}
                </span>
              ))}
              {debugTrace.length === 0 && <span>Trace bekleniyor: frontend submit → fetch dispatch → backend request.entered</span>}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-6">
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((m, idx) => (
                <MessageBubble
                  key={m.id}
                  m={m}
                  streaming={streaming && idx === messages.length - 1}
                  model={activeModel}
                  modelName={activeModelName}
                  onDelete={handleDeleteMessage}
                  onEdit={handleEditMessage}
                  onRegenerate={handleRegenerateMessage}
                />
              ))}
              <ScrollAnchor dep={messages.length} />
            </div>
          </div>
        </div>

        <div className="border-t border-border p-4 glass">
          <div className="max-w-5xl mx-auto space-y-2">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <AttachmentChip key={a.id} a={a} onRemove={() => setAttachments((x) => x.filter((y) => y.id !== a.id))} />
                ))}
              </div>
            )}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((img) => (
                  <div key={img.id} className="relative group/img border border-border rounded overflow-hidden">
                    <img src={img.dataUrl} alt={img.name} className="h-16 w-16 object-cover" />
                    <button
                      onClick={() => setImages(prev => prev.filter(x => x.id !== img.id))}
                      className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-background/80 text-destructive flex items-center justify-center opacity-0 group-hover/img:opacity-100">
                      <X className="h-3 w-3" />
                    </button>
                    <span className="absolute bottom-0 left-0 right-0 bg-background/70 text-[8px] font-mono px-1 truncate">{img.name}</span>
                  </div>
                ))}
                <Badge variant="outline" className="text-[10px] font-mono self-center">
                  <ImageIcon className="h-3 w-3 mr-1 inline" />
                  Vision: {deepDive ? "Remote 1.5 Pro" : "Llava (local)"}
                </Badge>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => { setDeepDive(v=>!v); if (!deepDive) setWebSearch(false); }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border transition-all ${deepDive?"border-primary text-primary bg-primary/10 shadow-[0_0_12px_hsl(var(--primary)/0.6)]":"border-border text-muted-foreground"}`}>
                <Sparkles className="h-3 w-3" /> DeepDive (Remote)
              </button>
              <button onClick={() => { setWebSearch(v=>!v); if (!webSearch) setDeepDive(false); }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border transition-all ${webSearch?"border-primary text-primary bg-primary/10 shadow-[0_0_12px_hsl(var(--primary)/0.6)]":"border-border text-muted-foreground"}`}>
                <Globe className="h-3 w-3" /> {"Web Search"}
              </button>
              <button onClick={() => { if (autoRead) stopSpeaking(); setAutoRead(v=>!v); }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border transition-all ${autoRead?"border-primary text-primary bg-primary/10 shadow-[0_0_12px_hsl(var(--primary)/0.6)]":"border-border text-muted-foreground"}`}
                title={"Auto-read assistant replies via local TTS"}>
                {autoRead ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />} {"Auto-Read"}
              </button>
              <button onClick={openLiveCall}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
                title={!perms.mic || !perms.cam ? "Live Call opens; warning shown if browser denies permission" : "Start Live Call (continuous voice + camera)"}>
                <Phone className="h-3 w-3" /> {"Live Call"}
              </button>
              <div className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border border-border">
                <span className="text-muted-foreground">{"Speed"}</span>
                {[0.8, 1.0, 1.25, 1.5].map(r => (
                  <button key={r} onClick={() => voice.setPlaybackRate(r)}
                    className={voice.playbackRate===r?"text-primary":"text-muted-foreground hover:text-primary"}>
                    {r}x
                  </button>
                ))}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border border-border text-muted-foreground hover:text-primary">
                    <Bot className="h-3 w-3" /> {"Agents"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>{"Local Agents"}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {visibleAppAgents.length === 0 && <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">{appAgents.length === 0 ? "None — add in Agents tab" : "No agents in your template"}</DropdownMenuLabel>}
                  {visibleAppAgents.map(a => (
                    <DropdownMenuItem key={a.id}
                      onClick={() => {
                        const cur = composerRef.current?.getText() ?? "";
                        const file = a.agentName.endsWith(".py") ? a.agentName : `${a.agentName}.py`;
                        const token = `@[${file}] `;
                        if (!cur.includes(token.trim())) {
                          composerRef.current?.setText(cur ? `${cur.replace(/\s*$/, "")} ${token}` : token);
                        }
                        setTimeout(() => composerRef.current?.focus?.(), 50);
                      }}>
                      {a.agentName} <span className="text-[9px] text-muted-foreground ml-2">{a.role}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {overrideEnabled && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border transition-all ${pickedProviders.length ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
                      title={"Choose one or more LLM providers (multi-select = fan-out)"}
                    >
                      <Cpu className="h-3 w-3" />
                      {pickedProviders.length === 0
                        ? `Provider · auto (${routing.mode})`
                        : pickedProviders.length === 1
                          ? `Provider · ${aiProviders.find(p=>p.id===pickedProviders[0])?.providerName ?? "?"}`
                          : `Fan-out · ${pickedProviders.length}`}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel>{"Active LLM Providers"}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {activeProviders.length === 0 && (
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
                        {"None active — Settings → AI Providers"}
                      </DropdownMenuLabel>
                    )}
                    {activeProviders.map(p => (
                      <DropdownMenuCheckboxItem
                        key={p.id}
                        checked={pickedProviders.includes(p.id)}
                        onCheckedChange={(v) => setPickedProviders(prev => v ? [...prev, p.id] : prev.filter(x=>x!==p.id))}
                      >
                        {p.providerName}
                        <span className="text-[9px] text-muted-foreground ml-2">{p.model || "default"}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[9px] text-muted-foreground font-normal">
                      {`Empty = policy (${routing.mode}) · 1 = only that · 2+ = parallel fan-out`}
                    </DropdownMenuLabel>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Badge variant="outline" className="text-[10px] font-mono ml-auto">
                {fanoutMode
                  ? `Fan-out · ${pickedProviders.length} providers`
                  : pickedProviders.length === 1
                    ? `Locked · ${aiProviders.find(p=>p.id===pickedProviders[0])?.providerName}`
                    : (images.length ? "Vision Mode" : deepDive ? "Powered by Remote (DeepDive)" : webSearch ? "Web Search Active" : "Local LLM")}
              </Badge>
            </div>
            <Card className={`glass transition-all ${recording?"ring-2 ring-cyan-400 shadow-[0_0_22px_rgba(58,168,255,0.6)]":(deepDive||webSearch||images.length)?"ring-1 ring-primary shadow-[0_0_18px_hsl(var(--primary)/0.45)]":""}`}>
              <CardContent className="p-2 flex items-end gap-2">
                <input ref={fileRef} type="file" multiple accept={ACCEPT + ",image/*"} hidden
                  onChange={(e) => {
                    if (!e.target.files) return;
                    const imgs = Array.from(e.target.files).filter(f => f.type.startsWith("image/"));
                    const others = Array.from(e.target.files).filter(f => !f.type.startsWith("image/"));
                    imgs.forEach(f => addImageFromBlob(f, f.name));
                    if (others.length) handleFiles(others);
                  }} />
                <Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} title={"Attach"}><Paperclip className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={openCamera} title={"Capture from camera"}>
                  <Camera className="h-4 w-4" />
                </Button>
                <Button
                  variant={recording ? "destructive" : "ghost"}
                  size="icon"
                  onClick={recording ? stopRecording : startRecording}
                  title={recording ? "Stop recording" : "Record voice note"}>
                  {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" title={`Agents · ${visibleAppAgents.length}`}
                      className="relative">
                      <Bot className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-72 p-0">
                    <div className="px-3 py-2 border-b border-border bg-card/60 flex items-center gap-2">
                      <Bot className="h-3.5 w-3.5 text-cyan-400" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">{agentsLabel}</span>
                      <Link to="/agents" className="ml-auto text-[10px] font-mono text-primary hover:underline">{"manage →"}</Link>
                    </div>
                    <div className="p-2 max-h-72 overflow-y-auto space-y-1">
                      {visibleAppAgents.length === 0 && <p className="text-[11px] font-mono text-muted-foreground px-1 py-2">{"No agents available."}</p>}
                      {visibleAppAgents.map(a => {
                        return (
                          <button key={a.id} type="button"
                          onClick={() => {
                              const cur = composerRef.current?.getText() ?? "";
                              const file = a.agentName.endsWith(".py") ? a.agentName : `${a.agentName}.py`;
                              const token = `@[${file}] `;
                              if (!cur.includes(token.trim())) {
                                composerRef.current?.setText(cur ? `${cur.replace(/\s*$/, "")} ${token}` : token);
                              }
                              setTimeout(() => composerRef.current?.focus?.(), 50);
                            }}
                            className="w-full text-left px-2 py-1.5 rounded text-[11px] font-mono flex items-center gap-2 transition-all hover:bg-accent/40">
                            <Bot className="h-3 w-3 shrink-0" />
                            <span className="flex-1 truncate">{a.agentName}</span>
                            <span className="text-[9px] text-muted-foreground">{a.role}</span>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" title={`Tools · ${visibleForgeActions.length}`}
                      className="relative hover:text-amber-400">
                      <Wrench className="h-4 w-4" />
                      {visibleForgeActions.length > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 px-0.5 rounded-full text-[8px] font-mono bg-amber-500 text-black flex items-center justify-center">{visibleForgeActions.length}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-80 p-0">
                    <div className="px-3 py-2 border-b border-border bg-card/60 flex items-center gap-2">
                      <Wrench className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400">{toolsLabel}</span>
                      <a href="/forge" className="ml-auto text-[10px] font-mono text-primary hover:underline">{"manage →"}</a>
                    </div>
                    <div className="p-2 max-h-72 overflow-y-auto space-y-1">
                      {visibleForgeActions.length === 0 && <p className="text-[11px] font-mono text-muted-foreground px-1 py-2">{"No tools sealed to your profile."}</p>}
                      {visibleForgeActions.map(t => {
                        const slug = t.slug || t.id;
                        return (
                          <div key={t.id} className="group w-full px-2 py-1.5 rounded text-[11px] font-mono flex items-center gap-2 hover:bg-amber-500/10 transition-all">
                            <button type="button"
                              onClick={() => { const cur = composerRef.current?.getText() ?? ""; const pre = cur.trimEnd() ? cur.trimEnd() + " " : ""; composerRef.current?.setText(pre + `/${slug} `); composerRef.current?.focus(); }}
                              className="flex-1 flex items-center gap-2 text-left min-w-0">
                              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                              <span className="flex-1 truncate">/{slug}</span>
                              <Badge variant="outline" className="text-[8px] font-mono px-1 py-0">{t.kind}</Badge>
                              {typeof t.priority === "number" && <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 text-amber-400 border-amber-500/40">P{t.priority}</Badge>}
                              {t.risk_level && t.risk_level !== "low" && <Badge variant="outline" className="text-[8px] font-mono px-1 py-0">{t.risk_level}</Badge>}
                              {t.is_system && <ShieldCheck className="h-3 w-3 text-emerald-400" />}
                            </button>
                            <button type="button" title="Tool details"
                              onClick={(e) => { e.stopPropagation(); setToolDetail(t); }}
                              className="opacity-60 hover:opacity-100 hover:text-amber-400 shrink-0">
                              <Info className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" title={`Skills · ${skills.length}`}
                      className="relative hover:text-fuchsia-400">
                      <Sparkles className="h-4 w-4" />
                      {skills.length > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 px-0.5 rounded-full text-[8px] font-mono bg-fuchsia-500 text-white flex items-center justify-center">{skills.length}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-80 p-0">
                    <div className="px-3 py-2 border-b border-border bg-card/60 flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-fuchsia-400">{"Skills"}</span>
                      <Link to="/skills" className="ml-auto text-[10px] font-mono text-primary hover:underline">{"manage →"}</Link>
                    </div>
                    <div className="p-2 max-h-72 overflow-y-auto space-y-1">
                      {skills.length === 0 && <p className="text-[11px] font-mono text-muted-foreground px-1 py-2">{"No skills available."}</p>}
                      {skills.map(s => (
                        <button key={s.id} type="button"
                          onClick={() => { const cur = composerRef.current?.getText() ?? ""; const pre = cur.trimEnd() ? cur.trimEnd() + " " : ""; composerRef.current?.setText(pre + `!${s.slug} `); composerRef.current?.focus(); }}
                          className="w-full text-left px-2 py-1.5 rounded text-[11px] font-mono flex items-center gap-2 hover:bg-fuchsia-500/10 transition-all">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                          <span className="flex-1 truncate">!{s.slug}</span>
                          <Badge variant="outline" className="text-[8px] font-mono px-1 py-0">{s.risk_level}</Badge>
                          {s.requires_approval && <ShieldCheck className="h-3 w-3 text-amber-400" />}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <ChatComposer
                  ref={composerRef}
                  disabled={!active || streaming}
                  streaming={streaming}
                  recording={recording}
                  waveCanvasRef={waveCanvasRef}
                  placeholder={"Type, paste an image (Ctrl+V), or drop files…  (Shift+Enter = new line)"}
                  onSend={(text) => { void send(text); }}
                  onStop={stop}
                  onPaste={handlePaste}
                />

              </CardContent>
            </Card>
            <p className="text-[10px] text-muted-foreground text-center font-mono">
              {"Local PostgreSQL · async persist · SSE stream via :3005 middleware"}
            </p>
          </div>
        </div>
      </div>

      <Dialog open={!!toolDetail} onOpenChange={(o) => { if (!o) setToolDetail(null); }}>
        <DialogContent className="max-w-2xl border-amber-500/30 bg-gradient-to-br from-background to-amber-950/10">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div
                className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ring-1 ring-amber-500/40 shadow-[0_0_20px_-5px] shadow-amber-500/40"
                style={{ background: `linear-gradient(135deg, ${toolDetail?.color || "#f59e0b"}, transparent)` }}
              >
                <Wrench className="h-5 w-5 text-amber-100" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="truncate">{toolDetail?.name}</span>
                  {toolDetail?.is_system && (
                    <Badge className="text-[9px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/40">
                      <ShieldCheck className="h-3 w-3 mr-1 inline" /> SEALED · SYS
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[9px] font-mono uppercase">{toolDetail?.kind}</Badge>
                </DialogTitle>
                {toolDetail?.description && (
                  <p className="text-[11px] font-mono text-muted-foreground mt-1.5 leading-snug">{toolDetail.description}</p>
                )}
              </div>
            </div>
          </DialogHeader>
          {toolDetail && (
            <div className="space-y-3 text-xs font-mono">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2 rounded border border-border/60 bg-card/40">
                {[
                  ["id", toolDetail.id],
                  ["category", toolDetail.category],
                  ["provider", toolDetail.provider],
                  ["handler", toolDetail.runtime?.handler],
                  ["op", toolDetail.runtime?.op || "—"],
                  ["params", `${Object.keys(toolDetail.params || {}).length} field${Object.keys(toolDetail.params || {}).length === 1 ? "" : "s"}`],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70 w-16 shrink-0">{k}</span>
                    <span className="truncate text-amber-300/90">{String(v ?? "—")}</span>
                  </div>
                ))}
              </div>
              <details className="group rounded border border-border/60 bg-card/40">
                <summary className="cursor-pointer px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-amber-400 flex items-center justify-between">
                  <span>{"Parameters Schema"}</span>
                  <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                </summary>
                <pre className="bg-background/60 border-t border-border rounded-b p-2 text-[10px] overflow-x-auto max-h-48 text-cyan-300/80">{JSON.stringify(toolDetail.params, null, 2)}</pre>
              </details>
              <details className="group rounded border border-border/60 bg-card/40">
                <summary className="cursor-pointer px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-amber-400 flex items-center justify-between">
                  <span>{"Runtime · Sealed Status"}</span>
                  <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                </summary>
                <pre className="bg-background/60 border-t border-border rounded-b p-2 text-[10px] overflow-x-auto max-h-48 text-emerald-300/80">{JSON.stringify(toolDetail.runtime, null, 2)}</pre>
              </details>
              <ToolBoundAgentsAndDryRun toolId={toolDetail.id} />
            </div>
          )}
          <DialogFooter>
            <a href="/forge" className="text-[10px] font-mono text-primary hover:underline self-center mr-auto inline-flex items-center gap-1">
              <Edit3 className="h-3 w-3" /> {"edit in Workshop →"}
            </a>
            <Button variant="ghost" onClick={() => setToolDetail(null)}>{"Close"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cameraOpen} onOpenChange={(o) => { if (!o) closeCamera(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{"Capture from camera"}</DialogTitle></DialogHeader>
          <div className="rounded overflow-hidden bg-black">
            <video ref={cameraVideoRef} className="w-full aspect-video" muted playsInline />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeCamera}>{"Cancel"}</Button>
            <Button onClick={snapPhoto} className="bg-gradient-primary text-primary-foreground">
              <Camera className="h-4 w-4 mr-1" /> {"Snap"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LiveCall
        open={liveCallOpen}
        onClose={() => setLiveCallOpen(false)}
        threadId={active}
        history={messages}
        model={activeModel}
        mode={mode}
        agents={pickedAgents}
        onUserUtterance={(text) => {
          if (!active) return;
          setMessages((m) => [...m, { id: `u-${Date.now()}`, thread_id: active, role: "user", content: text, created_at: new Date().toISOString() }]);
          ChatAPI.persistMessage({ thread_id: active, role: "user", content: text, model: activeModel });
        }}
        onAssistantReply={(text, source) => {
          if (!active) return;
          setMessages((m) => [...m, { id: `a-${Date.now()}`, thread_id: active, role: "assistant", content: text, created_at: new Date().toISOString(), source } as SourcedMessage]);
          ChatAPI.persistMessage({ thread_id: active, role: "assistant", content: text, model: activeModel });
        }}
      />
      <SkillRunDrawer
        runId={activeSkillRun}
        onClose={() => setActiveSkillRun(null)}
        onReport={(md) => {
          if (!active) return;
          const rid = activeSkillRun || undefined;
          setMessages((m) => [...m, { id: `report-${Date.now()}`, thread_id: active, role: "assistant", content: md, created_at: new Date().toISOString(), skillRunId: rid } as SourcedMessage]);
          ChatAPI.persistMessage({ thread_id: active, role: "assistant", content: md, model: activeModel });
        }}
      />
    </div>
  );
}

// Anchor that only re-runs scroll when message COUNT changes (not on every keystroke / token).
function StreamPhasePill({ phase, stage }: { phase: string; stage?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [phase]);
  // Stage-aware label: when the backend keepalive pings `preparing`, the
  // `stage` tag (policy/rag-search/local-enqueue/local-warming) tells the operator
  // which sub-step is actually live. Falls back to plain phase mapping.
  const stageLabel: Record<string, string> = {
    "policy":      "⚙ Resolving policy…",
    "rag-search":  "📚 Searching sealed library…",
    "local-enqueue": "⏳ Queued for LOCAL slot…",
    "local-warming": "⏳ Runtime preparing first token…",
  };
  const phaseLabel: Record<string, string> = {
    "searching-knowledge":  "📚 Searching knowledge base…",
    "rag_probing":          "📚 Searching sealed library…",
    "rag_done":             "🧠 Agent reasoning…",
    "spawning":             "⚙ Spawning agent…",
    "running":              "⚙ Agent running…",
    "thinking":             "🧠 Thinking…",
    "preparing":            "⚙ Preparing context…",
    "local_queue_enqueued":   "⏳ Queued for LOCAL slot…",
    "local_warming":          "⏳ Runtime preparing first token…",
    "local_busy":             "⚠ Runtime busy · watchdog tripped",
    "loop_guard":           "⚠ Loop guard tripped — stream stopped",
    "streaming":            "✍️ Responding…",
    "streaming-ready":      "✍️ Responding…",
  };
  // Queue wait is not warmup. On a 31B-q6 model this can simply be another
  // request holding the slot or the runtime prefill/first-token path. Do not
  // relabel it as cold-start; that made the UI look like a hidden warmup ran.
  const isLongEnqueue = phase === "local_queue_enqueued" && elapsed > 2;
  const label =
    (phase === "preparing" && stage && stageLabel[stage]) ||
    (isLongEnqueue ? "⏳ Waiting for runtime slot…" : phaseLabel[phase]) ||
    `· ${phase}${stage ? ` · ${stage}` : ""} ·`;
  return (
    <div className="mb-1 inline-flex flex-col gap-0.5">
      <div className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-primary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        <span>{label}</span>
        {elapsed >= 3 && <span className="opacity-60">· {elapsed}s</span>}
      </div>

      {elapsed >= 5 && (
        <span className="ml-1 text-[10px] font-mono text-muted-foreground/70 normal-case tracking-normal">
          First response can take 8–12s while the model warms up…
        </span>
      )}
    </div>
  );
}

function ScrollAnchor({ dep }: { dep: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [dep]);
  return <div ref={ref} />;
}

function ForgePlanCard({ initialPlan }: { initialPlan: ForgePlanPayload }) {
  const [plan, setPlan] = useState<ForgePlanPayload>(initialPlan);
  const [busy, setBusy] = useState<"apply" | "reject" | "rollback" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = async (action: "apply" | "reject" | "rollback") => {
    if (!plan.id) { setError("Plan id yok — kaydedilmedi."); return; }
    setBusy(action); setError(null);
    try {
      const r = await fetch(`${resolveApiBaseUrl()}/api/meta-forge/plans/${plan.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...actorHeaders() },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const nextStatus = action === "apply" ? "applied" : action === "reject" ? "rejected" : "rolled_back";
      setPlan((p) => ({ ...p, status: nextStatus }));
      toast.success(action === "apply" ? "Plan uygulandı" : action === "reject" ? "Plan reddedildi" : "Plan geri alındı");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error(`Meta-Forge ${action} başarısız`);
    } finally { setBusy(null); }
  };
  const status = plan.status;
  const isPending = status === "pending";
  const isApplied = status === "applied";
  const items = [
    ...plan.plan.reuse.map((r) => ({ ...r, mode: "reuse" as const })),
    ...plan.plan.create.map((c) => ({ ...c, mode: "create" as const })),
  ];
  return (
    <div className="mt-2 rounded-lg border border-primary/40 bg-primary/5 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/30 bg-primary/10">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-primary">
          <span>🔨 Meta-Forge Plan</span>
          <span className="px-1.5 py-0.5 rounded bg-background/60 text-[9px] normal-case tracking-normal">{status}</span>
        </div>
        <button className="text-[10px] text-muted-foreground hover:text-primary font-mono"
          onClick={() => setExpanded((v) => !v)}>{expanded ? "collapse" : "details"}</button>
      </div>
      <div className="px-3 py-2 space-y-2">
        <div className="text-xs text-muted-foreground italic">{plan.intent}</div>
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={`${it.mode}-${it.kind}-${it.slug}-${i}`} className="text-xs">
              <span className={`inline-block px-1.5 py-0.5 rounded font-mono text-[10px] mr-2 ${it.mode === "create" ? "bg-emerald-500/20 text-emerald-300" : "bg-blue-500/20 text-blue-300"}`}>
                {it.mode}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground mr-1">{it.kind}:</span>
              <span className="font-mono text-[11px]">{it.slug}</span>
              {it.name && <span className="ml-2 text-muted-foreground">· {it.name}</span>}
              {it.risk && <span className="ml-2 text-[10px] px-1 rounded bg-muted">{it.risk}</span>}
              {expanded && it.description && (
                <div className="mt-1 pl-6 text-[11px] text-muted-foreground">{it.description}</div>
              )}
              {expanded && it.mode === "create" && it.source && (
                <pre className="mt-1 ml-6 p-2 rounded bg-background/70 text-[10px] font-mono overflow-x-auto max-h-40 whitespace-pre-wrap">{it.source}</pre>
              )}
            </li>
          ))}
        </ul>
        {error && <div className="text-[11px] text-destructive font-mono">⚠ {error}</div>}
        <div className="flex gap-2 pt-1 border-t border-primary/20">
          {isPending && (
            <>
              <Button size="sm" variant="default" disabled={!!busy || !plan.id}
                onClick={() => call("apply")}>{busy === "apply" ? "Applying…" : "Approve & Apply"}</Button>
              <Button size="sm" variant="outline" disabled={!!busy || !plan.id}
                onClick={() => call("reject")}>{busy === "reject" ? "Rejecting…" : "Reject"}</Button>
            </>
          )}
          {isApplied && (
            <Button size="sm" variant="outline" disabled={!!busy}
              onClick={() => call("rollback")}>{busy === "rollback" ? "Rolling back…" : "Rollback"}</Button>
          )}
          {!isPending && !isApplied && (
            <span className="text-[11px] text-muted-foreground font-mono self-center">no actions available</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ForgePlanPartialCard({ partial }: { partial: ForgePlanPartial }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - partial.startedAt) / 1000));
  return (
    <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/20 bg-primary/10">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-primary">
          <span className="animate-pulse">🔨 Meta-Forge · planlıyor…</span>
          <span className="px-1.5 py-0.5 rounded bg-background/60 text-[9px] normal-case tracking-normal">{partial.create.length} item · {elapsed}s</span>
        </div>
      </div>
      <div className="px-3 py-2 space-y-2">
        {partial.intent && <div className="text-xs text-muted-foreground italic">{partial.intent}</div>}
        {partial.create.length === 0 ? (
          <div className="text-[11px] text-muted-foreground font-mono">Model JSON planı yazıyor…</div>
        ) : (
          <ul className="space-y-1">
            {partial.create.map((it, i) => (
              <li key={`${it.kind}-${it.slug}-${i}`} className="text-xs animate-in fade-in slide-in-from-left-1 duration-200">
                <span className="inline-block px-1.5 py-0.5 rounded font-mono text-[10px] mr-2 bg-emerald-500/20 text-emerald-300">create</span>
                <span className="font-mono text-[11px] text-muted-foreground mr-1">{it.kind}:</span>
                <span className="font-mono text-[11px]">{it.slug}</span>
                {it.name && <span className="ml-2 text-muted-foreground">· {it.name}</span>}
                {it.risk && <span className="ml-2 text-[10px] px-1 rounded bg-muted">{it.risk}</span>}
                {it.description && (
                  <div className="mt-1 pl-6 text-[11px] text-muted-foreground line-clamp-2">{it.description}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}




const MessageBubble = memo(function MessageBubble({ m, streaming, model, modelName, onDelete, onEdit, onRegenerate }: {
  m: SourcedMessage; streaming: boolean; model: string; modelName: string;
  onDelete: (id: string) => void; onEdit: (id: string, c: string) => void; onRegenerate: (content: string) => void;
}) {
  const { locale } = useI18n();
  // RAG debug panels (AGENT RAG DIAG + RAG DEBUG) — UI-only knob persisted in
  // localStorage, toggled from RAG control panel. Default OFF.
  const [showRagDebugPanels, setShowRagDebugPanels] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("chat.showRagDebugPanels") === "1";
  });
  useEffect(() => {
    const handler = (e: Event) => {
      setShowRagDebugPanels(Boolean((e as CustomEvent<boolean>).detail));
    };
    window.addEventListener("chat:showRagDebugPanels", handler);
    return () => window.removeEventListener("chat:showRagDebugPanels", handler);
  }, []);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [feedback, setFeedback] = useState<-1 | 0 | 1 | null>((m.feedback ?? null) as -1 | 0 | 1 | null);
  const { user } = useAuth();
  const { accounts } = useUsers();
  const { models } = useSystem();
  const identity = useModelIdentity();
  const account = accounts.find(a => a.username === user?.username);
  const modelEntry = models.find(x => x.id === model);
  const userAvatar = avatarFor(user?.username, account?.avatarUrl);
  const displayModel = modelEntry?.modelName || modelName || model;
  const modelAvatar = identity.resolve(displayModel, modelEntry?.avatarUrl);
  const isHintCard = typeof m.id === "string" && (m.id.startsWith("tool-hint-") || m.id.startsWith("agent-hint-"));
  const hasRagSources = (m.ragSources?.length ?? 0) > 0;
  const renderedContent = m.role === "assistant"
    ? normalizeModelText(expandEmojiShortcodes(hasRagSources ? (m.content || "") : (streaming ? maskInflightProtocol(m.content || "") : (isHintCard ? (m.content || "") : stripProtocolBlocks(m.content || "")))))
    : (m.content || "");
  const copyAll = async () => {
    const ok = await copyToClipboard(renderedContent);
    if (ok) toast.success("Copied"); else toast.error("Copy failed");
  };
  const downloadTxt = () => {
    downloadTextFile(renderedContent, `message-${m.id}.txt`);
  };
  const sendFeedback = async (score: 1 | -1) => {
    const next = feedback === score ? null : score;
    setFeedback(next);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id);
    if (!isUuid) return;
    try { await ChatAPI.feedbackMessage(m.id, next); }
    catch (e) { toast.error(`Feedback failed · ${(e as Error).message}`); setFeedback(feedback); }
  };
  return (
    <div className={`group flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
      {m.role === "assistant" && (
        <img src={modelAvatar} alt={displayModel} className="h-8 w-8 rounded shrink-0 glow" />
      )}
      <div className={`max-w-[80%] min-w-0 ${m.role === "user" ? "" : "flex-1"}`}>
        {m.role === "assistant" && (m.source || (m.thinking && m.thinking.length > 0) || (m.traces && m.traces.length > 0)) && (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {m.source && (
              <Badge variant="outline" className="text-[9px] font-mono">
                {m.source === "agent-manifest" ? "Direct manifest"
                  : m.source.startsWith("deepdive") ? "Powered by Remote (DeepDive)"
                  : m.source.startsWith("websearch") ? `Web Search · ${m.source.replace("websearch:","")}`
                  : m.source.startsWith("fanout") ? `Fan-out · ${m.source.replace("fanout:","")}`
                  : "Local LLM"}
              </Badge>
        )}

        {m.role === "assistant" && m.latency && (
          <div className="mb-1 text-[10px] font-mono text-muted-foreground flex flex-wrap gap-x-2">
            <span>⏱ TTFT: {m.latency.ttftMs ?? m.latency.thinkMs ?? "—"}ms</span>
            <span>· Gen: {m.latency.localGenMs ?? "—"}ms</span>
            <span>· RAG: {m.ragSkipped ? `skipped (${m.latency.ragMs}ms)` : `${m.latency.ragMs}ms`}</span>
            <span>· Total: {m.latency.totalMs}ms</span>
            <span>· prompt≈{m.latency.promptTokens ?? "—"} tok</span>
            <span>· out={m.latency.tokensOut} tok</span>
            {m.latency.tokPerSec != null && (
              <span className={m.latency.tokPerSec < 20 ? "text-amber-400" : "text-emerald-400"}>
                · {m.latency.tokPerSec} tok/s
              </span>
            )}
            {m.latency.thinkLeak && (
              <span className="text-rose-400">· ⚠ think-leak</span>
            )}
          </div>
        )}
        {m.role === "assistant" && m.agentRouted && (
          <div className="mb-1 flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 font-mono bg-cyan-500/10 text-cyan-300 border-cyan-500/40"
              title={`Auto-routed → ${m.agentRouted.script}${m.agentRouted.matchedToken ? ` · matched "${m.agentRouted.matchedToken}"` : ""}${typeof m.agentRouted.score === "number" ? ` · score ${m.agentRouted.score}` : ""}`}
            >
              🤖 Bilgi · @{m.agentRouted.agentName}
            </Badge>
          </div>
        )}
            {m.thinking && m.thinking.length > 0 && <ThinkingPanel steps={m.thinking} />}
            {m.traces && m.traces.length > 0 && <RawTraceButtons traces={m.traces} />}
          </div>
        )}
        {m.role === "assistant" && !m.content && m.streamPhase && (
          <StreamPhasePill phase={m.streamPhase} stage={m.streamStage} />
        )}
        <div className={`rounded-lg p-3 ${m.role === "user" ? "bg-primary text-primary-foreground" : "glass"}`}>
          {editing ? (
            <div className="space-y-2">
              <textarea className="w-full text-sm bg-background/40 border border-border rounded p-2 font-mono"
                rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(m.content); }}>{"Cancel"}</Button>
                <Button size="sm" onClick={() => { onEdit(m.id, draft); setEditing(false); }}>{"Save"}</Button>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed break-words [overflow-wrap:anywhere]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ inline, className, children, ...rest }: { inline?: boolean; className?: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
                    const match = /language-(\w+)/.exec(className || "");
                    const text = String(children).replace(/\n$/, "");
                    // react-markdown v9: `inline` prop kaldırıldı; içerikten türet.
                    const isInline = inline ?? (!match && !text.includes("\n"));
                    if (isInline) return <code className="px-1 py-0.5 rounded bg-muted font-mono text-[12px]" {...rest}>{children}</code>;
                    return (
                      <div className="my-2 rounded overflow-hidden border border-border not-prose">
                        <div className="flex items-center justify-between px-3 py-1 bg-card/60 text-[10px] font-mono uppercase tracking-widest">
                          <span>{match?.[1] || "code"}</span>
                          <div className="flex gap-1">
                            <button className="hover:text-primary" onClick={async () => {
                              const ok = await copyToClipboard(text);
                              if (ok) toast.success("Code copied"); else toast.error("Copy failed");
                            }}>copy</button>
                            <span className="opacity-30">|</span>
                            <button className="hover:text-primary" onClick={() => {
                              downloadTextFile(text, `snippet.${match?.[1] || "txt"}`);
                            }}>download</button>
                          </div>
                        </div>
                        <pre className="m-0 overflow-x-auto bg-background/70 p-3 text-xs leading-relaxed"><code>{text}</code></pre>
                      </div>
                    );
                  },
                }}
              >
                {renderedContent || (streaming && m.role === "assistant" ? "▍" : "")}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {m.role === "assistant" && m.forgePlan && (
          <ForgePlanCard initialPlan={m.forgePlan} />
        )}
        {m.role === "assistant" && !m.forgePlan && m.forgePlanPartial && (
          <ForgePlanPartialCard partial={m.forgePlanPartial} />
        )}
        {m.role === "assistant" && m.skillRunId && (
          <details className="mt-2 group rounded-md border border-border/60 bg-card/40">
            <summary className="cursor-pointer px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5"><FileText className="h-3 w-3" /> {"Details / Proof"} · Run Report</span>
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-border/60 p-2">
              <SkillUsageCard runId={m.skillRunId} />
            </div>
          </details>
        )}
        {showRagDebugPanels && m.role === "assistant" && m.ragSkipped && (() => {
          // Dynamic skip card — was hardcoded "Greeting" for every skip.
          // Source of truth: ragIntent / ragMode / ragNotice / ragRetriever.
          const intent = String(m.ragIntent || "").toLowerCase();
          const mode = String(m.ragMode || "").toLowerCase();
          const isAgent = intent === "agent" || m.ragRetriever === "agent-rag";
          const isSmalltalk = intent === "smalltalk" || /bypass/.test(mode);
          let tone: "emerald" | "amber" | "slate" = "slate";
          let title = "";
          let body = "";
          if (isSmalltalk) {
            tone = "emerald";
            title = "Semantic Intent: Greeting — RAG Suppressed";
            body = `Router decision = bypass · 0 queries to library, 0 documents to model${m.ragMode ? ` · mode=${m.ragMode}` : ""}`;
          } else if (isAgent) {
            tone = "amber";
            title = "Agent RAG · No confident library match";
            const bits: string[] = [];
            if (m.ragRawReason) bits.push(`reason=${m.ragRawReason}`);
            if (typeof m.ragTop1 === "number") bits.push(`top1=${m.ragTop1}%`);
            if (typeof m.ragTau === "number") bits.push(`τ=${m.ragTau}%`);
            if (m.ragMode) bits.push(`mode=${m.ragMode}`);
            body = m.ragNotice || `Agent ran without injected context${bits.length ? ` · ${bits.join(" · ")}` : ""}.`;
          } else {

            tone = "amber";
            title = "RAG Skipped — Library not consulted";
            const bits: string[] = [];
            if (typeof m.ragTop1 === "number") bits.push(`top1=${m.ragTop1}%`);
            if (typeof m.ragTau === "number") bits.push(`τ=${m.ragTau}%`);
            if (m.ragMode) bits.push(`mode=${m.ragMode}`);
            body = m.ragNotice || `Free-answer fallback${bits.length ? ` · ${bits.join(" · ")}` : ""}.`;
          }
          const ring = tone === "emerald"
            ? "border-emerald-500/40 bg-emerald-500/5"
            : tone === "amber"
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-slate-500/40 bg-slate-500/5";
          const text = tone === "emerald"
            ? "text-emerald-400"
            : tone === "amber"
              ? "text-amber-400"
              : "text-slate-300";
          const diag = isAgent ? (m.ragAgentDiag || null) : null;
          const rawReason = m.ragRawReason || null;
          return (
            <div className={`mt-2 rounded-md border ${ring} p-2`}>
              <div className={`flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest ${text}`}>
                <FileText className="h-3 w-3" />
                <span>{title}</span>
              </div>
              <p className="mt-1 text-[10px] font-mono text-muted-foreground">{body}</p>
              {isAgent && (
                <details className="mt-2 group" open>
                  <summary className={`cursor-pointer text-[10px] font-mono uppercase tracking-widest ${text} hover:opacity-90 inline-flex items-center gap-1.5`}>
                    <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                    Agent RAG Diag
                  </summary>
                  {!diag ? (
                    <div className="mt-1.5 rounded border border-rose-500/50 bg-rose-500/10 p-1.5 text-[10px] font-mono text-rose-300">
                      diag missing · backend rag.meta.diag boş döndü. Middleware'in eski build çalıştırdığını veya agent-run endpoint'in diag forward etmediğini gösterir. Kickstart: <code className="text-rose-200">launchctl kickstart -k gui/$UID/com.elara.middleware</code> + 8sn warmup, sonra yeni mesaj.
                    </div>
                  ) : (
                    <div className="mt-1.5 grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono text-muted-foreground">
                      <div><span className="opacity-60">reason</span> <span className="text-foreground">{rawReason || "(server null)"}</span></div>
                      <div><span className="opacity-60">mode</span> <span className="text-foreground">{m.ragMode || "-"}</span></div>
                      <div className="md:col-span-2"><span className="opacity-60">qForRetrieval</span> <span className="text-foreground">{diag.qForRetrieval || "-"}</span></div>
                      {diag.queryRewritten && <div className="md:col-span-2"><span className="opacity-60">rewritten</span> <span className="text-foreground">{diag.queryRewritten}</span></div>}
                      <div><span className="opacity-60">agentBrands</span> <span className="text-foreground">{diag.agentBrands?.length ? diag.agentBrands.join(", ") : "(none)"}</span></div>
                      <div><span className="opacity-60">effectiveBrandsArg</span> <span className="text-foreground">{diag.effectiveBrandsArg?.length ? diag.effectiveBrandsArg.join(", ") : "(none)"}</span></div>
                      <div><span className="opacity-60">libraryMatch</span> <span className="text-foreground">{diag.libraryMatch || "-"}</span></div>
                      <div><span className="opacity-60">explicitBrandLock</span> <span className="text-foreground">{diag.explicitBrandLock || "-"}</span></div>
                      <div><span className="opacity-60">packKeywords</span> <span className="text-foreground">{diag.packKeywords?.length ? diag.packKeywords.join(", ") : "(none)"}</span></div>
                      <div><span className="opacity-60">agentKeywords</span> <span className="text-foreground">{diag.agentKeywords?.length ? diag.agentKeywords.join(", ") : "(none)"}</span></div>
                      <div><span className="opacity-60">bindingFileIds</span> <span className="text-foreground">{diag.bindingFileIds?.length || 0}</span></div>
                      <div><span className="opacity-60">ftsRows</span> <span className="text-foreground">{diag.ftsRows ?? "-"}{typeof diag.ftsTop === "number" ? ` · top ${Math.round(diag.ftsTop * 100)}%` : ""}</span></div>
                      {diag.embedError && <div className="md:col-span-2 text-rose-400"><span className="opacity-60">embedError</span> {diag.embedError}</div>}
                      {diag.ftsError && <div className="md:col-span-2 text-rose-400"><span className="opacity-60">ftsError</span> {diag.ftsError}</div>}
                      {diag.vectorRowsByBrand && Object.keys(diag.vectorRowsByBrand).length > 0 && (
                        <div className="md:col-span-2"><span className="opacity-60">vectorRowsByBrand</span> <span className="text-foreground">{Object.entries(diag.vectorRowsByBrand).map(([b, c]) => `${b}=${c}`).join(", ")}</span></div>
                      )}
                      {diag.ftsRowsByBrand && Object.keys(diag.ftsRowsByBrand).length > 0 && (
                        <div className="md:col-span-2"><span className="opacity-60">ftsRowsByBrand</span> <span className="text-foreground">{Object.entries(diag.ftsRowsByBrand).map(([b, c]) => `${b}=${c}`).join(", ")}</span></div>
                      )}
                      {typeof m.ragDefensiveDropped === "number" && m.ragDefensiveDropped > 0 && (
                        <div className="md:col-span-2 text-amber-400"><span className="opacity-60">defensiveDropped</span> {m.ragDefensiveDropped} rows (FTS leak vs bindingFileIds)</div>
                      )}
                      {diag.rejectedTop && diag.rejectedTop.length > 0 && (
                        <div className="md:col-span-2 mt-1">
                          <div className="opacity-60 mb-0.5">rejectedTop</div>
                          {diag.rejectedTop.map((r, i) => (
                            <div key={i} className="text-foreground">#{i + 1} {r.brand || "?"} · score={typeof r.score === "number" ? r.score.toFixed(3) : "-"}{typeof r.rerank_score === "number" ? ` · rr=${r.rerank_score.toFixed(3)}` : ""} · {r.path?.split(/[\\/]/).pop() || "?"}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </details>
              )}

            </div>
          );
        })()}
        {showRagDebugPanels && m.role === "assistant" && m.ragDebug && (() => {
          const dbg = m.ragDebug;
          if (!dbg.ok || !dbg.probe) {
            return (
              <details className="mt-2 group rounded-md border border-rose-500/40 bg-rose-500/5">
                <summary className="cursor-pointer px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-rose-400 hover:text-rose-300 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5"><FileText className="h-3 w-3" /> RAG Debug · probe failed</span>
                  <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-rose-500/40 p-2 text-[10px] font-mono text-muted-foreground">
                  {dbg.error || "unknown error"}
                </div>
              </details>
            );
          }
          const p = dbg.probe;
          const injected = p.decision === "inject";
          const tone = injected ? "emerald" : "amber";
          const ring = injected ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5";
          const text = injected ? "text-emerald-400" : "text-amber-400";
          const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;
          const intentCol = dbg.refined?.kind && dbg.intent?.kind && dbg.refined.kind !== dbg.intent.kind
            ? `${dbg.intent.kind} → ${dbg.refined.kind}`
            : (dbg.intent?.kind || "?");
          return (
            <details className={`mt-2 group rounded-md border ${ring} min-w-0 max-w-full overflow-hidden`}>
              <summary className={`cursor-pointer px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest ${text} hover:opacity-90 flex items-center justify-between`}>
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  RAG Debug · {p.decision}{p.reason ? ` · ${p.reason}` : ""} · top1 {pct(p.top1)} / τ {pct(p.tau)}
                </span>
                <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
              </summary>
              <div className={`border-t ${tone === "emerald" ? "border-emerald-500/40" : "border-amber-500/40"} p-2 space-y-1.5`}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-0.5 text-[10px] font-mono text-muted-foreground">
                  <span>intent</span><span className="text-foreground truncate" title={intentCol}>{intentCol}</span>
                  <span>mode</span><span className="text-foreground truncate">{dbg.refined?.mode || dbg.intent?.mode || "—"}</span>
                  <span>top1</span><span className="text-foreground">{pct(p.top1)}</span>
                  <span>top4</span><span className="text-foreground">{pct(p.top4)}</span>
                  <span>margin</span><span className="text-foreground">{pct(p.margin)}</span>
                  <span>τ (tau)</span><span className="text-foreground">{pct(p.tau)}</span>
                  <span>fts rows</span><span className="text-foreground">{p.ftsRows ?? "—"}{p.ftsTop != null ? ` · top ${pct(p.ftsTop)}` : ""}</span>
                  <span>reranker</span><span className="text-foreground truncate">{p.reranker?.used ? `used · ${p.reranker.ms ?? "—"}ms` : (p.reranker?.reason || "off")}</span>
                  <span>probe ms</span><span className="text-foreground">{p.ms}</span>
                  <span>total ms</span><span className="text-foreground">{dbg.totalMs ?? "—"}</span>
                </div>
                {(p.qForRetrieval || p.queryRewritten) && (
                  <div className="border-t border-border/40 pt-1.5 space-y-0.5 text-[10px] font-mono min-w-0 [overflow-wrap:anywhere] break-all">
                    {p.queryRewritten && (
                      <div><span className="text-muted-foreground">rewritten ({p.queryRewriteMode || "—"}):</span> <span className="text-foreground">{p.queryRewritten}</span></div>
                    )}
                    {p.qForRetrieval && (
                      <div><span className="text-muted-foreground">qForRetrieval:</span> <span className="text-foreground">{p.qForRetrieval}</span></div>
                    )}
                  </div>
                )}

                {(p.ftsError || p.embedError) && (
                  <div className="border-t border-rose-500/30 pt-1.5 text-[10px] font-mono text-rose-400">
                    {p.embedError && <div>embedError: {p.embedError}</div>}
                    {p.ftsError && <div>ftsError: {p.ftsError}</div>}
                  </div>
                )}
                {p.rows && p.rows.length > 0 && (
                  <div className="border-t border-border/40 pt-1.5">
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">top {Math.min(5, p.rows.length)} rows</div>
                    <ul className="space-y-1">
                      {p.rows.slice(0, 5).map((r, i) => (
                        <li key={`${i}-${r.path}-${r.ord}`} className="text-[10px] font-mono">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[9px] px-1 py-0">{i + 1}</Badge>
                            <span className="truncate flex-1" title={r.path || r.file}>{r.file}</span>
                            {r.brand && <Badge variant="secondary" className="text-[9px] px-1 py-0">{r.brand}</Badge>}
                            {r.retriever && <Badge variant="outline" className="text-[9px] px-1 py-0">{r.retriever}</Badge>}
                            <span className="text-muted-foreground">#{r.ord}</span>
                            <span className="text-foreground tabular-nums">{Math.round((r.score || 0) * 100)}%</span>
                          </div>
                          {r.preview && (
                            <div className="pl-6 text-muted-foreground truncate" title={r.preview}>{r.preview}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.rows && p.rows.length === 0 && (
                  <p className="text-[10px] font-mono text-muted-foreground italic">No rows returned by probe.</p>
                )}
              </div>
            </details>
          );
        })()}
        {m.role === "assistant" && !m.ragSkipped && !hasRagSources && m.ragFallback && (
          <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2" title="Answered from model's training data, not verified against your library">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-amber-400">
              <FileText className="h-3 w-3" />
              <span>
                {m.ragFallback.kind === "in_library_miss"
                  ? `Model Knowledge · ${m.ragFallback.brand ?? "Topic"} not found in library`
                  : "Model Knowledge · Out of library scope"}
              </span>
            </div>
            <p className="mt-1 text-[10px] font-mono text-muted-foreground">
              {m.ragFallback.kind === "in_library_miss"
                ? "Library has docs for this brand, but no high-confidence chunk matched. Answer drawn from training data."
                : `Library scope: ${(m.ragFallback.brands ?? []).slice(0, 5).join(", ") || "—"}. Answer drawn from training data.`}
            </p>
          </div>
        )}
        {m.role === "assistant" && !m.ragSkipped && ((m.ragSources && m.ragSources.length > 0) || (m.ragNotice && typeof m.ragTop1 === "number" && m.ragTop1 > 0)) && (
          <div className="mt-2 rounded-md border border-border/60 bg-card/40 p-2">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1 flex-wrap">
              <FileText className="h-3 w-3 text-primary" />
              <span>{m.ragIntent === "agent" ? "Agent consulted" : "Sealed Library"} · {m.ragSources?.length ?? 0} {m.ragIntent === "agent" ? "document" : "citation"}{(m.ragSources?.length ?? 0) === 1 ? "" : "s"}</span>
              {typeof m.ragTop1 === "number" && (
                <Badge
                  variant={m.ragTop1 >= 55 ? "outline" : "destructive"}
                  className="text-[9px] px-1.5 py-0 font-mono"
                  title={`Top-1 cosine ${m.ragTop1}% · τ=${m.ragTau ?? "-"}%${typeof m.ragMargin === "number" ? ` · margin ${m.ragMargin}%` : ""}`}
                >
                  {m.ragTop1 >= 55 ? `top1 ${m.ragTop1}%` : `düşük güven · top1 ${m.ragTop1}%`}
                </Badge>
              )}
              {m.ragConfidence && (
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1.5 py-0 font-mono ${
                    m.ragConfidence.label === "high" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" :
                    m.ragConfidence.label === "mid"  ? "bg-amber-500/15 text-amber-300 border-amber-500/40" :
                                                       "bg-rose-500/15 text-rose-300 border-rose-500/40"
                  }`}
                  title={`Confidence ${m.ragConfidence.score} · topScore ${m.ragConfidence.signals.topScore} · topGap ${m.ragConfidence.signals.topGap} · sources ${m.ragConfidence.signals.sourceCount}`}
                >
                  ● {m.ragConfidence.score} · {m.ragConfidence.label}
                </Badge>
              )}
              {m.ragQueryRewritten && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1.5 py-0 font-mono bg-sky-500/10 text-sky-300 border-sky-500/40"
                  title={`HyDE: "${m.ragQueryRewritten}"`}
                >
                  HyDE
                </Badge>
              )}

              {m.ragReranker && (() => {
                const r = m.ragReranker;
                const modelShort = (r.model ?? "").replace(/^.*\//, "") || "rerank";
                if (r.used) {
                  return (
                    <Badge
                      variant="secondary"
                      className="text-[9px] px-1.5 py-0 font-mono bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                      title={`Reranked with ${r.model ?? "?"} · ${r.ms ?? 0}ms`}
                    >
                      ✓ RERANKED · {modelShort} · {r.ms ?? 0}ms
                    </Badge>
                  );
                }
                const reason = r.reason ?? "skipped";
                const label =
                  reason === "single_candidate" ? "rerank · skip (tek aday)" :
                  reason === "disabled" ? "rerank · disabled" :
                  reason === "worker_unavailable" ? "rerank · offline" :
                  reason === "not_attempted" ? "rerank · idle" :
                  `rerank · ${reason}`;
                const variant: "outline" | "destructive" = reason === "worker_unavailable" ? "destructive" : "outline";
                return (
                  <Badge
                    variant={variant}
                    className="text-[9px] px-1.5 py-0 font-mono"
                    title={`${r.model ?? "?"} · reason=${reason}${r.lastError ? ` · ${r.lastError}` : ""}${r.ms ? ` · ${r.ms}ms` : ""}`}
                  >
                    {label}
                  </Badge>
                );
              })()}
            </div>
            {m.ragKeywords && m.ragKeywords.length > 0 && (
              <p className="mb-1 text-[10px] font-mono text-muted-foreground">
                {"Searched library with keywords"}: {m.ragKeywords.join(", ")}{m.ragRetriever ? ` · ${m.ragRetriever}` : ""}
              </p>
            )}
            {m.ragSources && m.ragSources.length > 0 ? (
              <ul className="space-y-1">
                {m.ragSources.map((s) => (
                  <li key={`${s.index}-${s.path}`} className="flex items-center gap-2 text-[11px] font-mono">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">[#{s.index}]</Badge>
                    <span className="truncate flex-1" title={s.path}>{s.name}</span>
                    {s.page && <span className="text-muted-foreground">sayfa {s.page}{s.pageEnd && s.pageEnd !== s.page ? `-${s.pageEnd}` : ""}</span>}
                    <span className="text-muted-foreground">chunk #{s.ord}</span>
                    {s.brand && <Badge variant="secondary" className="text-[9px] px-1 py-0">{s.brand}</Badge>}
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{s.accessLevel}</Badge>
                    <span className={`text-[10px] tabular-nums ${s.score >= 50 ? "text-primary" : "text-muted-foreground"}`}>{s.score}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground italic">{m.ragNotice}</p>
            )}
          </div>
        )}
        <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyAll}><Copy className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(true)}><Edit3 className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" title={"Regenerate (re-send the previous user message)"} onClick={() => onRegenerate(m.id)}><RefreshCw className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={downloadTxt}><Download className="h-3 w-3" /></Button>
          {m.role === "assistant" && (
            <>
              <Button variant="ghost" size="icon"
                className={`h-6 w-6 ${feedback === 1 ? "text-emerald-400" : ""}`}
                title="Helpful" onClick={() => void sendFeedback(1)}>
                <ThumbsUp className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon"
                className={`h-6 w-6 ${feedback === -1 ? "text-rose-400" : ""}`}
                title="Not helpful" onClick={() => void sendFeedback(-1)}>
                <ThumbsDown className="h-3 w-3" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => onDelete(m.id)}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
      {m.role === "user" && (
        <img src={userAvatar} alt={user?.username ?? "user"} className="h-8 w-8 rounded shrink-0" />
      )}
    </div>
  );
});

function AttachmentChip({ a, onRemove }: { a: UploadMeta; onRemove: () => void }) {
  const isPcap = a.ext === ".pcap" || a.ext === ".pcapng";
  return (
    <div className="border border-border rounded-lg p-2 flex items-center gap-2 bg-card/40 max-w-sm">
      {isPcap ? <Network className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono truncate">{a.filename}</p>
        {isPcap ? (
          <PcapSummary a={a} />
        ) : (
          <p className="text-[10px] text-muted-foreground font-mono">{a.ext} · {(a.size/1024).toFixed(1)} KB</p>
        )}
      </div>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onRemove}><X className="h-3 w-3" /></Button>
    </div>
  );
}

function PcapSummary({ a }: { a: UploadMeta }) {
  // Lightweight client-side summary — real packet decode happens server-side later.
  const packets = Math.max(1, Math.round(a.size / 380));
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      <Badge variant="outline" className="text-[9px] font-mono">PCAP</Badge>
      <Badge variant="outline" className="text-[9px] font-mono">~{packets.toLocaleString()} pkts</Badge>
      <Badge variant="outline" className="text-[9px] font-mono">{(a.size/1024/1024).toFixed(2)} MB</Badge>
    </div>
  );
}

// ============================================================
// Thinking Process — collapsible reasoning chain
// ============================================================
function ThinkingPanel({ steps }: { steps: ThinkingStep[] }) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const kindColor = (k: ThinkingStep["kind"]) =>
    k === "agent" ? "text-cyan-400" :
    k === "tool" ? "text-amber-400" :
    k === "provider" ? "text-violet-400" :
    k === "router" ? "text-emerald-400" : "text-muted-foreground";
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono border border-border hover:border-primary text-muted-foreground hover:text-primary transition">
          <Brain className="h-2.5 w-2.5" /> {"Thinking"} · {steps.length}
          <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 border border-border rounded bg-background/40 p-2 space-y-1 max-w-md">
          {steps.map((s) => (
            <div key={s.id} className="text-[10px] font-mono leading-tight flex gap-2">
              <span className="text-muted-foreground shrink-0">{new Date(s.ts).toLocaleTimeString().slice(0,8)}</span>
              <span className={`shrink-0 uppercase tracking-wider ${kindColor(s.kind)}`}>[{s.kind}]</span>
              <span className="flex-1 break-all"><span className="text-foreground">{s.label}</span>{s.detail && <span className="text-muted-foreground"> · {s.detail}</span>}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================================
// Raw Tool Trace — popover surfacing the unfiltered tool output
// ============================================================
function RawTraceButtons({ traces }: { traces: ToolTrace[] }) {
  const { locale } = useI18n();
  return (
    <>
      {traces.map((t) => (
        <Popover key={t.id}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono border border-amber-500/40 text-amber-400 hover:bg-amber-500/10">
              <Terminal className="h-2.5 w-2.5" /> {"Raw"} · {t.tool}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-card/60 flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400">{"Tool Raw Trace"}</span>
              <button
                onClick={async () => {
                  const ok = await copyToClipboard(t.output ?? "");
                  if (ok) toast.success("Raw output copied"); else toast.error("Copy failed");
                }}
                className="text-[10px] font-mono text-muted-foreground hover:text-primary">{"copy"}</button>
            </div>
            <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
              <div>
                <p className="text-[9px] font-mono uppercase text-muted-foreground">tool</p>
                <p className="text-xs font-mono">{t.tool}</p>
              </div>
              {t.params !== undefined && (
                <div>
                  <p className="text-[9px] font-mono uppercase text-muted-foreground">params</p>
                  <pre className="text-[10px] font-mono bg-background/60 border border-border rounded p-2 whitespace-pre-wrap break-all">{JSON.stringify(t.params, null, 2)}</pre>
                </div>
              )}
              {t.output && (
                <div>
                  <p className="text-[9px] font-mono uppercase text-muted-foreground">raw output</p>
                  <pre className="text-[10px] font-mono bg-background/60 border border-border rounded p-2 whitespace-pre-wrap break-all">{t.output}</pre>
                </div>
              )}
              {t.error && (
                <div>
                  <p className="text-[9px] font-mono uppercase text-destructive">error</p>
                  <pre className="text-[10px] font-mono bg-destructive/10 border border-destructive/40 rounded p-2 whitespace-pre-wrap break-all">{t.error}</pre>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      ))}
    </>
  );
}

// re-export for tree-shake (silences unused import in some builds)
export { LANG_BY_EXT };

// ============================================================================
// ToolBoundAgentsAndDryRun — reverse-binding list + dry-run probe.
// Rendered inside the chat tool detail dialog.
// ============================================================================
function ToolBoundAgentsAndDryRun({ toolId }: { toolId: string }) {
  const [agents, setAgents] = useState<Array<{ id: string; name: string; status: string; priority?: number | null }>>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [dryRun, setDryRun] = useState<null | { ok: boolean; validation: { missing: string[]; extras: string[]; required: number; provided: number }; adapters: Array<{ id: string; name: string; ok: boolean; error?: string }> }>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadingAgents(true);
    setDryRun(null);
    ForgeAPI.agents(toolId).then((r) => { if (alive) { setAgents(r.items || []); setLoadingAgents(false); } });
    return () => { alive = false; };
  }, [toolId]);

  const runDry = async () => {
    setRunning(true);
    try {
      const r = await ForgeAPI.dryRun(toolId, {});
      setDryRun(r);
    } catch (e) {
      setDryRun({ ok: false, validation: { missing: [], extras: [], required: 0, provided: 0 }, adapters: [{ id: "?", name: String((e as Error).message || e), ok: false, error: "request failed" }] });
    } finally { setRunning(false); }
  };

  return (
    <>
      <div className="rounded border border-border/60 bg-card/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Bound to agents</span>
          <Badge variant="outline" className="text-[9px] font-mono">{loadingAgents ? "…" : agents.length}</Badge>
        </div>
        {!loadingAgents && agents.length === 0 && (
          <p className="text-[10px] text-muted-foreground">No agent has this tool in its whitelist.</p>
        )}
        {agents.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {agents.map((a) => (
              <Badge key={a.id} variant="outline" className="text-[9px] font-mono gap-1">
                <Bot className="h-2.5 w-2.5" />
                {a.name}
                {typeof a.priority === "number" && <span className="text-amber-400">P{a.priority}</span>}
                <span className={`h-1.5 w-1.5 rounded-full ${a.status === "active" ? "bg-emerald-400" : a.status === "error" ? "bg-red-400" : "bg-muted-foreground"}`} />
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="rounded border border-border/60 bg-card/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Dry-run · schema + adapter probe</span>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={runDry} disabled={running}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
            {running ? "probing…" : "Probe"}
          </Button>
        </div>
        {!dryRun && <p className="text-[10px] text-muted-foreground">Validates required params and pings every enabled adapter binding. No real call is made.</p>}
        {dryRun && (
          <div className="space-y-1.5 text-[10px]">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${dryRun.ok ? "bg-emerald-400" : "bg-red-400"}`} />
              <span className={dryRun.ok ? "text-emerald-400" : "text-red-400"}>{dryRun.ok ? "ready" : "blocked"}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">params {dryRun.validation.provided}/{dryRun.validation.required} required</span>
            </div>
            {dryRun.validation.missing.length > 0 && (
              <p className="text-amber-400">missing: {dryRun.validation.missing.join(", ")}</p>
            )}
            {dryRun.validation.extras.length > 0 && (
              <p className="text-muted-foreground">extras: {dryRun.validation.extras.join(", ")}</p>
            )}
            {dryRun.adapters.length === 0 && <p className="text-muted-foreground">no adapter bindings.</p>}
            {dryRun.adapters.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${a.ok ? "bg-emerald-400" : "bg-red-400"}`} />
                <span className="truncate flex-1">{a.name}</span>
                {a.error && <span className="text-red-400 truncate">{a.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

