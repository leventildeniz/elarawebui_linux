import { createFileRoute } from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  FileText,
  Minimize2,
  Pencil,
  Pin,
  Send,
  Split,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { FileHoverPreview } from "@/components/sovereign/file-preview";
import { ImageViewer } from "@/components/sovereign/image-viewer";

import { Shell } from "@/components/sovereign/shell";
import { ProposalCard, type Proposal } from "@/components/sovereign/proposal-card";
import { MetaForgeApprovalCard } from "@/components/sovereign/metaforge-approval-card";
import {
  Composer,
  useComposerAttachments,
  type Attachment,
  type Effort,
  type Mention,
} from "@/components/sovereign/composer";
import { RichMessage } from "@/components/sovereign/rich-message";
import { RetrievalCard, type Retrieval } from "@/components/sovereign/retrieval-card";
import { EntityAvatar } from "@/components/sovereign/identity";
import { useAgents, type StudioAgent } from "@/lib/agent-store";
import { useModels } from "@/lib/model-store";
import { useEngine } from "@/lib/engine-store";
import { buildRetrieval, type CorpusDoc } from "@/lib/rag-preview";
import { resolveAliases } from "@/lib/rag-keywords";
import { useCapabilities } from "@/lib/capability-store";
import { useSpaceAccess } from "@/lib/knowledge-space-store";
import { useKnowledge } from "@/lib/knowledge-store";
import { logRagQuery } from "@/lib/rag-analytics-store";
import { logPlannerRun } from "@/lib/planner-store";
import { currentAccount } from "@/lib/group-store";
import { emitDeny } from "@/lib/deny-events";
import { narrowScopeToSpace, resolveScope, type RetrievalScope } from "@/lib/space-router";
import {
  CompactionCard,
  CompactingCard,
  type Compaction,
} from "@/components/sovereign/compaction-card";

import { ThinkingBlock } from "@/components/sovereign/thinking-block";
import {
  MessageActions,
  TelemetryStrip,
  type Telemetry,
} from "@/components/sovereign/message-actions";
import { toast } from "sonner";
import { compactContextWithModel } from "@/lib/context-compact.functions";
import { fetchApi } from "@/lib/api"; // Keep fetchApi just in case
import { ToolActivityBlock } from "@/components/sovereign/tool-activity";
import { ToolApprovalCard } from "@/components/sovereign/tool-approval-card";
import {
  buildCapabilities,
  emptyActivity,
  hasCapabilities,
  reduceActivity,
  streamOrchestrate,
  type Capabilities,
  type ToolActivity,
} from "@/lib/orchestrate-stream";
import { buildWireMessages, encodeAttachments } from "@/lib/attachment-encode";
import { useChats } from "@/lib/chat-store";
import {
  agentReplyText,
  agentThinkingText,
  chatGreeting,
  chatSuggestions,
  metaForgeApprovalSeed,
  proposalSeed,
} from "@/mocks";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sovereign Chat — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Sovereign Chat: a calm, spacious studio surface for orchestrating AI agents, models and workflows.",
      },
      { property: "og:title", content: "Sovereign Chat — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "A calm, spacious studio surface for orchestrating AI agents and workflows.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SovereignChat,
});

type Msg = {
  role: "user" | "agent";
  text: string;
  hidden?: boolean;
  proposals?: Proposal[];
  approval?: boolean | { invocationId: string; toolName: string; reason: string; decided?: "approve" | "reject" };
  forge_plan?: any;
  activity?: ToolActivity;
  files?: Attachment[];
  thinking?: string;
  telemetry?: Telemetry;
  streaming?: boolean;
  compaction?: Compaction;
  agent?: MsgAgent;
  retrieval?: Retrieval;
};

type MsgAgent = {
  id: string;
  name: string;
  seed: string;
  style: string;
  jewel: string;
  rag: boolean;
  /** identity kind — an invoked agent, or the plain model answering */
  kind?: "agent" | "model";
};

const tokensOf = (m: Msg) => Math.ceil(((m.text?.length ?? 0) + (m.thinking?.length ?? 0)) / 4);

const lastUserText = (list: Msg[]) =>
  [...list].reverse().find((m) => m.role === "user")?.text ?? "";

const thinkDuration: Record<Effort, number> = { none: 0, low: 900, medium: 1800, high: 3000 };

function SovereignChat() {
  const {
    ready,
    active,
    setMessages: persistMessages,
    setFiles: persistFiles,
    autoTitle,
    setContext,
    branch,
  } = useChats();
  /** Zen mode — chrome collapses, only the transcript and composer remain. */
  const [zen, setZen] = useState(false);
  /** Thread-level pinned context editor. */
  const [ctxOpen, setCtxOpen] = useState(false);
  const [ctxDraft, setCtxDraft] = useState("");
  /** One-turn web search augmentation. */
  const [webSearch, setWebSearch] = useState(false);
  /** Routing Mode chosen by user */
  const [routingMode, setRoutingMode] = useState<string>("failover");
  /** Index of the user message currently being edited inline. */
  const [editing, setEditing] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const { agents } = useAgents();
  const { models, defaultId } = useModels();
  const { config: engineConfig } = useEngine();
  /** RAG permission boundary of the signed-in principal — drives space routing. */
  const spaceAccess = useSpaceAccess();
  /** Indexed documents of the RAG library — the actual corpus behind the answer. */
  const knowledge = useKnowledge();
  /** Capability packs — their brand keywords are inherited by bound agents. */
  const { packs: capabilityPackList } = useCapabilities();

  /** Indexed sources that live inside the routed (and readable) spaces. */
  const corpusFor = (scope: RetrievalScope): CorpusDoc[] => {
    const lanes = new Map(scope.searched.map((s) => [s.id, s.name] as const));
    return knowledge.sources
      .filter((s) => s.status === "indexed" && (!s.space || lanes.has(s.space)))
      .map((s) => ({
        name: s.name,
        ...(s.space && lanes.get(s.space) ? { space: lanes.get(s.space)! } : {}),
        chunks: s.chunks,
        ...(s.tags?.length ? { tags: s.tags } : {}),
      }));
  };

  /** Entity-level retrieval switch, overridden by the engine's global RAG mode. */
  const ragOn = (a: { rag: boolean }) =>
    engineConfig.ragMode === "always" ? true : engineConfig.ragMode === "never" ? false : a.rag;
  const [value, setValue] = useState("");
  const [dragging, setDragging] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [effort, setEffort] = useState<Effort>("high");
  const [model, setModel] = useState("sovereign-1");
  const enabledModels = models.filter((m) => m.enabled);
  /** the model currently selected in the composer — drives the reply identity */
  const activeModel =
    enabledModels.find((m) => m.id === model) ??
    enabledModels.find((m) => m.id === defaultId) ??
    enabledModels[0];
  const [pending, setPending] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const { attachments, addFiles, remove, clear } = useComposerAttachments();

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const queued = useRef<string | null>(null);
  const archive = useRef<Msg[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = (active?.messages ?? []) as Msg[];
  const files = (active?.files ?? []) as Attachment[];
  const setMessages = (next: Msg[]) => active && persistMessages(active.id, next);
  const setFiles = (next: Attachment[]) => active && persistFiles(active.id, next);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  // FETCH ABORT CONTROLLER'I EKLİYORUZ
  const abortCtrl = useRef<AbortController | null>(null);
  const orchCancel = useRef<(() => void) | null>(null);
  const resume = useRef<{ base: Msg[]; agent: StudioAgent | undefined; query: string } | null>(null);

  useEffect(() => {
    return () => {
      stopTimer();
      if (abortCtrl.current) abortCtrl.current.abort();
    };
  }, []);

  useEffect(() => {
    if (!zen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zen]);

  useEffect(() => {
    setCtxDraft(active?.context ?? "");
    setCtxOpen(false);
    setEditing(null);
  }, [active?.id, active?.context]);

  /** Follow the stream unless the operator deliberately scrolled up. */
  const stick = useRef(true);
  const atBottom = () => {
    const el = scrollRef.current;
    return !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  /** Growing content must never break the follow — only user intent does. */
  const onScroll = () => {
    if (atBottom()) stick.current = true;
  };
  const onWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) stick.current = false;
    else if (atBottom()) stick.current = true;
  };
  const onKeyNav = (e: React.KeyboardEvent) => {
    if (["PageUp", "ArrowUp", "Home"].includes(e.key)) stick.current = false;
    if (e.key === "End") stick.current = true;
  };
  useEffect(() => {
    if (!stick.current || !streaming) return;
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el || !stick.current) return;
      if (Math.abs(el.scrollTop - el.scrollHeight) > 2) {
        el.scrollTop = el.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [messages, streaming]);
  /** Late layout (cards, code blocks) settles after the stream ends. */
  useEffect(() => {
    if (streaming || !stick.current) return;
    const ids = [260, 700].map((d) =>
      setTimeout(() => {
        const el = scrollRef.current;
        if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }, d),
    );
    return () => ids.forEach(clearTimeout);
  }, [streaming, messages.length]);

  const activeRunId = useRef<number>(0);

  /** Simulated streaming run: reasoning trace first, then the answer. */
  const runAgent = async (base: Msg[], agent?: StudioAgent | undefined, query = "", activity?: ToolActivity) => {
    console.log("[UI] runAgent tetiklendi! Base mesaj sayısı:", base.length, "Agent:", agent?.name);
    
    const runId = Date.now();
    activeRunId.current = runId;
    
    const speaker = agent ?? activeModel;
    const identity: MsgAgent | undefined = speaker
      ? {
          id: speaker.id,
          name: speaker.name,
          seed: speaker.avatar.seed,
          style: speaker.avatar.style,
          jewel: speaker.avatar.jewel,
          rag: ragOn(speaker),
          kind: agent ? "agent" : "model",
        }
      : undefined;

    stopTimer();
    setStreaming(true);

    let aiMsg: Msg = {
      role: "agent",
      text: "",
      thinking: "",
      streaming: true,
      ...(identity ? { agent: identity } : {}),
      ...(activity ? { activity } : {}),
    };
    
    setMessages([...base, aiMsg]);

    // Yeni fetch işlemi başlarken eskisini iptal et ve yeni bir controller oluştur
    if (abortCtrl.current) abortCtrl.current.abort();
    abortCtrl.current = new AbortController();

    console.log("[UI] Backend'e fetch atılıyor...");
    try {
      const res = await fetch("/api/chat/orchestrate", {
        method: "POST",
        signal: abortCtrl.current.signal,
        headers: {
          "Content-Type": "application/json",
          "x-session-id": typeof window !== "undefined" ? sessionStorage.getItem("sovereign.operator") || "" : ""
        },
        body: JSON.stringify({
          thread_id: active?.id,
          messages: buildWireMessages(base as any, active?.context),
          model: (agent?.modelId && agent.modelId !== "system_default") ? agent.modelId : (activeModel?.id ?? model),
          agent_id: agent?.id,
          // Ekstra Tool ve MCP çağrılarını backend'e paslıyoruz
          capabilities: {
             skills: [...query.matchAll(/(?:^|\s)!([a-z0-9][\w.-]*)/gi)].map(m => m[1] ? m[1].toLowerCase() : ""),
             mcp: [...query.matchAll(/(?:^|\s)#([a-z0-9][\w.-]*)/gi)].map(m => m[1] ? `mcp.${m[1].toLowerCase()}` : ""),
             tools: [...query.matchAll(/(?:^|\s)\/([a-z0-9][\w.-]*)/gi)].map(m => m[1] ? m[1].toLowerCase() : "")
          }
        }),
      });

      console.log(`[UI] Fetch sonucu: ${res.status} ${res.statusText}`);
      if (!res.ok) throw new Error(`Engine returned ${res.status}`);
      if (!res.body) throw new Error("No readable stream body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) {
          done = true;
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        let lines = buffer.split('\n');
        // Son eleman tam bir satır olmayabilir (henüz \n gelmemiştir), onu buffer'da tut
        buffer = lines.pop() || "";
        
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data: ")) continue;
          
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") {
            done = true;
            break;
          }
          
          if (!dataStr) continue;

          try {
            const parsed = JSON.parse(dataStr);

            // 1. Düşünme balonu (Thinking phase)
            if (parsed.type === "think" && parsed.delta) {
              aiMsg.thinking = (aiMsg.thinking || "") + parsed.delta;
            } 
            // 2. Mesaj metni (Text phase)
            else if (parsed.delta) {
              aiMsg.text = (aiMsg.text || "") + parsed.delta;
            }

            // 3. RAG Sonuçları (Retrieval)
            if (parsed.rag) {
              aiMsg.retrieval = {
                 citations: parsed.rag.sources || [],
                 kept: parsed.rag.sources?.length || 0,
                 query: parsed.rag.debug?.queryClean || query,
                 brands: parsed.rag.fallback?.brands || [],
                 candidates: parsed.rag.debug?.probe?.top1 || parsed.rag.sources?.length || 0,
                 reranker: parsed.rag.reranker?.used ? "bge-reranker-v2-m3" : "none",
                 latencyMs: parsed.rag.debug?.probe?.ms || 0
              };
            }

            // 4. MetaForge Kartı (Proposals)
            if (parsed.forge_plan) {
              aiMsg.forge_plan = parsed.forge_plan;
              if (parsed.forge_plan.plan?.create) {
                aiMsg.proposals = parsed.forge_plan.plan.create.map((c: any) => ({
                  id: c.slug,
                  title: c.name || c.slug,
                  summary: c.description || c.intent || "No description",
                  model: "forge_master",
                  cost: c.cost || "~$0.01 / 1k req",
                  confidence: c.confidence || 0.90,
                  tone: "amethyst"
                }));
              }
            }

            // 5. Telemetri Verileri
            if (parsed.latency) {
              aiMsg.telemetry = {
                firstTokenMs: parsed.latency.ttftMs || parsed.latency.thinkMs || 0,
                totalMs: parsed.latency.totalMs,
                tokens: parsed.latency.tokensOut || 1,
                model: activeModel?.name ?? model,
                effort,
              };
            }
          } catch (err) {
            // Partial/Invalid JSON chunk yut
          }
        }
        
        // Arayüzü ilerlemeyle senkronize et
        if (activeRunId.current === runId) {
          setMessages([...base, { ...aiMsg }]);
        }
      }
    } catch (err: any) {
      if (activeRunId.current !== runId) return; // Superceded
      
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
         aiMsg.text += `\n\n_Stopped by operator._`;
         if (aiMsg.activity) aiMsg.activity.phase = "done";
      } else {
         aiMsg.text += `\n\n⚠️ Chat Error: ${err.message}`;
      }
      setMessages([...base, { ...aiMsg }]);
    } finally {
      if (activeRunId.current === runId) {
        aiMsg.streaming = false;
        setMessages([...base, { ...aiMsg }]);
        setStreaming(false);

        const next = queued.current;
        queued.current = null;
        if (next) setTimeout(() => dispatch(next, []), 220);
      }
    }
  };

  const orchestrateBody = (
    base: Msg[],
    agent: StudioAgent | undefined,
    query: string,
    caps: ReturnType<typeof buildCapabilities>,
    resumeId?: string,
    isWebSearch: boolean = false
  ) => {
    // Merge agent's predefined tools and skills into capabilities
    const finalTools = new Set(caps.tools);
    const finalSkills = new Set(caps.skills);
    const finalMcp = new Set(caps.mcp);

    if (agent) {
      agent.tools.forEach(t => finalTools.add(t));
      agent.skills.forEach(s => finalSkills.add(s));
    }

    return {
      message: query,
      messages: buildWireMessages(base as any, active?.context),
      model: (agent?.modelId && agent.modelId !== "system_default") ? agent.modelId : (activeModel?.id ?? model),
      web_search: isWebSearch,
      useRag: agent ? ragOn(agent) : ragOn(activeModel as any),
      routing_mode: routingMode,
      effort: effort,
      capabilities: {
        tools: Array.from(finalTools),
        skills: Array.from(finalSkills),
        mcp: Array.from(finalMcp),
      },
      ...(active?.id ? { threadId: active.id, thread_id: active.id } : {}),
      ...(active?.context ? { context: active.context } : {}),
      ...(agent ? { agentId: agent.id, agent_id: agent.id } : {}),
      ...(resumeId ? { resumeInvocationId: resumeId } : {}),
    };
  };

  const runOrchestration = (
    base: Msg[],
    agent: StudioAgent | undefined,
    query: string,
    caps: ReturnType<typeof buildCapabilities>,
    resumeId?: string,
    isWebSearch: boolean = false
  ) => {
    const speaker = agent ?? activeModel;
    console.log("[runOrchestration] agent:", agent, "activeModel:", activeModel, "speaker:", speaker);
    const identity: MsgAgent | undefined = speaker
      ? {
          id: speaker.id,
          name: speaker.name,
          seed: speaker.avatar?.seed,
          style: speaker.avatar?.style,
          jewel: speaker.avatar?.jewel,
          rag: ragOn(speaker as any),
          kind: agent ? "agent" : "model",
        }
      : undefined;

    setStreaming(true);
    const runId = Date.now();
    activeRunId.current = runId;

    let act = resumeId && messages.length > 0 ? messages[messages.length - 1]?.activity || emptyActivity() : emptyActivity();
    let answer = "";
    let thinking = "";
    let finalTelemetry: Telemetry | undefined = undefined;
    let forgePlan: any = undefined;
    const paint = (streamingNow = true) => {
      if (activeRunId.current !== runId) return; // Superceded
      setMessages([
        ...base,
        {
          role: "agent",
          text: answer,
          streaming: streamingNow,
          activity: act,
          ...(thinking ? { thinking } : {}),
          ...(forgePlan ? { forge_plan: forgePlan } : {}),
          ...(identity ? { agent: identity } : {}),
          ...(finalTelemetry ? { telemetry: finalTelemetry } : {})
        },
      ]);
    };
    paint();

    const ac = new AbortController();
    orchCancel.current = () => {
      // Abort firlatilmadan once son bir kez ekrani kapat!
      if (activeRunId.current === runId) {
        act.phase = "done";
        paint(false);
      }
      ac.abort();
    };
    void streamOrchestrate(
      orchestrateBody(base, agent, query, caps, resumeId, isWebSearch) as any,
      (e) => {
        if (activeRunId.current !== runId) return; // Eğer iptal edildiysek stream'den gelenleri ignore et
        act = reduceActivity(act, e);
        if (e.kind === "out") {
          answer += e.text;
          paint();
          return;
        }
        if (e.kind === "think") {
          thinking += e.text;
          paint();
          return;
        }
        if (e.kind === "telemetry") {
          finalTelemetry = {
            firstTokenMs: e.latency.ttftMs || 0,
            totalMs: e.latency.totalMs,
            tokens: e.latency.tokensOut || 1,
            model: e.latency.modelOut || activeModel?.name || model,
            effort,
          };
          paint(false);
          return;
        }
        if (e.kind === "approval_required") {
          resume.current = { base, agent, query };
          setStreaming(false);
          paint(false);
          return;
        }
        if (e.kind === "forge_plan") {
          forgePlan = e.plan;
          paint(true);
          return;
        }
        if (e.kind === "error") {
          answer += `\n\n_Orchestration error — ${e.message}_`;
          setStreaming(false);
          paint(false);
          return;
        }
        if (e.kind === "done") {
          setStreaming(false);
          paint(false);
          return;
        }
        paint();
      },
      ac.signal
    ).catch((err: any) => {
      if (activeRunId.current !== runId) return; // Superceded
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        answer += `\n\n_Stopped by operator._`;
        act.phase = "done"; // Baloncugu ve uc noktayi zorla kapat
      } else {
        answer += `\n\n⚠️ Chat Error: ${err.message}`;
      }
      setStreaming(false);
      paint(false);
    }).finally(() => {
      if (activeRunId.current === runId) {
        setStreaming(false);
        paint(false);
        const next = queued.current;
        queued.current = null;
        if (next) setTimeout(() => dispatch(next, []), 220);
      }
    });
  };

  const decideApproval = async (index: number, decision: "approve" | "reject") => {
    const msg = messages[index];
    const act = msg?.activity;
    if (!msg || !act?.approval) return;
    const toolName = act.approval.toolName;
    const invocationId = act.approval.invocationId;

    try {
      await fetch("/api/chat/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invocationId,
          decision,
          threadId: active?.id,
        }),
      });
    } catch {
      // ignore
    }

    const next: ToolActivity = {
      ...act,
      approval: { ...act.approval, decided: decision },
      runs: act.runs.map((r) =>
        r.name === toolName
          ? { ...r, status: decision === "approve" ? ("completed" as const) : ("denied" as const) }
          : r,
      ),
      phase: decision === "approve" ? "loop" : "done",
      iteration: decision === "approve" ? act.iteration + 1 : act.iteration,
    };
    const ctx = resume.current;
    resume.current = null;
    if (decision === "reject") {
      setMessages([
        ...messages.slice(0, index),
        {
          ...msg,
          activity: next,
          streaming: false,
          text: `_Invocation \`${toolName}\` rejected by operator — the orchestration was rolled back._`,
        },
      ]);
      return;
    }
    const base = ctx?.base ?? (messages.slice(0, index) as Msg[]);
    setMessages([...base, { ...msg, activity: next, streaming: true }]);
    runOrchestration(base, ctx?.agent, ctx?.query ?? "", { tools: [], skills: [], mcp: [] }, invocationId);
  };

  const dispatch = async (text: string, atts: Attachment[], mentions: Mention[] = [], isWebSearch: boolean = false) => {
    const t = text.trim();
    if (!t && !atts.length) return;
    const label = t;

    const encoded = atts.length ? await encodeAttachments(atts) : [];

    const base: Msg[] = [
      ...((active?.messages ?? []) as Msg[]),
      { role: "user", text: label, files: encoded },
    ];
    if (encoded.length) setFiles([...files, ...encoded]);
    setMessages(base);
    if (active) autoTitle(active.id, label);
    const mentioned = mentions.find((m) => m.kind === "agent");
    const agent = mentioned ? agents.find((a) => a.id === mentioned.id) : undefined;

    const caps = buildCapabilities(mentions);

    // BÜTÜN TRAFİK ARTIK OTONOM ORKESTRASYONA (Meta-Forge) GİDER!
    // Modelin cebinde her zaman "sys_get_directory" vb. araçlar olduğu için,
    // hasCapabilities veya isWebSearch false olsa dahi model otonomiye (runOrchestration) sahip olmalıdır.
    runOrchestration(base, agent, t, caps, undefined, isWebSearch);
  };

  const stop = (isManual = true) => {
    // Sadece eğer sistem gerçekten "streaming" (meşgul) durumundaysa veya manuel olarak basıldıysa iptal et.
    if (!streaming && isManual !== true) {
        return;
    }

    if (isManual === true) {
        console.log("🛑 [UI] Operator pressed Stop! Explicit cancel dispatching...");
        // Kullanıcı bizzat fareyle tıkladığında veya "Send now" ile eziyorsa Explicit Cancel gönder.
        if (active?.id) {
            fetch("/api/chat/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ thread_id: active.id })
            }).catch(() => {});
        }
    }

    orchCancel.current?.();
    orchCancel.current = null;
    stopTimer();
    setStreaming(false);
    if (abortCtrl.current) {
       abortCtrl.current.abort();
       abortCtrl.current = null;
    }
  };

  const send = (text: string, mentions: Mention[] = []) => {
    const t = text.trim();
    if (!t && !attachments.length) return;
    if (streaming) {
      // Eskiden olduğu gibi "HELD" (Queue) arayüzünü çıkarmak için:
      setPending(t);
      setValue("");
      return;
    }
    
    // Geçerli state snapshot'ını alıp gönderiyoruz ki race condition olmasın.
    const isWebSearchActive = webSearch;
    dispatch(t, attachments, mentions, isWebSearchActive);
    
    setValue("");
    // setWebSearch(false); <-- ARTIK KENDİ KENDİNE KAPANMAYACAK! Kullanıcı açık bıraktıysa hep açık kalır.
    clear();
  };

  const retry = (index: number) => {
    const base = messages.slice(0, index) as Msg[];
    const prior = messages[index]?.agent;
    const agent = prior ? agents.find((a) => a.id === prior.id) : undefined;
    
    // YENİ WIRING KONTROLÜ: Eğer geçmişteki capability'leri bulabiliyorsak onu çalıştır
    // Basitçe: Retry işlemi sırasında mention'lar saklanmadığı için `runAgent`'a düşüyoruz.
    setMessages(base);
    // Eski stop mantığı
    stopTimer();
    setStreaming(false);
    if (abortCtrl.current) {
       abortCtrl.current.abort();
       abortCtrl.current = null;
    }
    orchCancel.current?.();
    orchCancel.current = null;

    // Retry işlemi için Universal Orchestration (Akıllı Motor) kullanıyoruz.
    runOrchestration(base, agent, lastUserText(base), { tools: [], skills: [], mcp: [] }, undefined, webSearch);
  };

  /** Rewrite an operator turn in place and re-run the thread from that point. */
  const submitEdit = (index: number) => {
    const text = editDraft.trim();
    setEditing(null);
    if (!text) return;
    const prev = messages[index];
    const base = [
      ...messages.slice(0, index),
      { ...(prev ?? { role: "user" as const, text: "" }), text },
    ] as Msg[];
    setMessages(base);
    
    // Edit (Pencil) işlemi için Universal Orchestration (Akıllı Motor) kullanıyoruz.
    runOrchestration(base, undefined, text, { tools: [], skills: [], mcp: [] }, undefined, webSearch);
  };

  /** Fork the thread just after a turn — the original stays untouched. */
  const branchAt = (index: number) => {
    if (!active) return;
    branch(active.id, index + 1);
    toast.success("Branched into a new thread");
  };

  const empty = messages.length === 0;

  // Greeting resolves after hydration so the signed-in principal — not a mock —
  // is the one addressed, with the salutation tracking local time of day.
  const [greeting, setGreeting] = useState(chatGreeting.title);
  useEffect(() => {
    const acct = currentAccount();
    const first = (acct?.name || acct?.username || "operator").trim().split(/\s+/)[0];
    const h = new Date().getHours();
    const part =
      h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    setGreeting(`${part}, ${first}.`);
  }, []);

  const contextTokens = messages.reduce((sum, m) => sum + tokensOf(m), 0);

  /** Fold older turns into a model-written handover placed at the end of the thread. */
  const compactContext = async () => {
    const foldable = messages.filter((m) => !m.compaction);
    const keepCount = foldable.length > 2 ? 2 : foldable.length > 1 ? 1 : 0;
    const folded = keepCount ? foldable.slice(0, -keepCount) : foldable;
    const kept = keepCount ? foldable.slice(-keepCount) : [];
    archive.current = messages;
    const digest = folded
      .filter((m) => m.text.trim())
      .slice(-6)
      .map(
        (m) =>
          `${m.role === "user" ? "you" : "elara"} · ${m.text.replace(/\s+/g, " ").slice(0, 140)}${
            m.text.length > 140 ? "…" : ""
          }`,
      );
    const userTurns = folded.filter((m) => m.role === "user" && m.text.trim());
    const agentTurns = folded.filter((m) => m.role === "agent" && m.text.trim());
    const line = (m: Msg, n = 120) =>
      `${m.text.replace(/\s+/g, " ").slice(0, n)}${m.text.length > n ? "…" : ""}`;
    const handover = {
      lede: folded.length
        ? `I've folded ${folded.length} earlier turn${folded.length === 1 ? "" : "s"} into this note so we keep the thread without carrying the whole transcript. Here's where we stand.`
        : "Nothing needed folding yet — the window is already light, so this is just a checkpoint of where we stand.",
      objective: userTurns.length
        ? `You came in asking about ${line(userTurns[0]!, 180)}`
        : "No explicit objective was stated before this point, so I'm treating the last exchange as the working brief.",
      decisions: agentTurns.slice(-3).map((m) => line(m)),
      open: userTurns
        .slice(1)
        .slice(-3)
        .map((m) => line(m)),
      next: [
        kept.length
          ? `Pick up from the ${kept.length} turn${kept.length === 1 ? "" : "s"} kept verbatim below.`
          : "Pick up from a clean window — tell me if the target shifted.",
        "Say the word and I'll restore the full transcript.",
      ],
    };
    const tokensBefore = messages.reduce((s, m) => s + tokensOf(m), 0);
    const tokensAfter =
      kept.reduce((s, m) => s + tokensOf(m), 0) + Math.ceil(digest.join(" ").length / 4);
    const topic = (m: Msg | undefined, n = 150) => (m ? line(m, n) : "");
    const memory = {
      title: `${(active?.title ?? "Session").toUpperCase()} — TECHNICAL COMPACTED MEMORY`,
      sections: [
        {
          heading: "Scope & Intent",
          items: [
            {
              label: "Working brief",
              text: userTurns.length ? topic(userTurns[0], 220) : "No explicit brief recorded.",
            },
            {
              label: "Turns folded",
              text: `${folded.length} turn${folded.length === 1 ? "" : "s"} distilled, ${kept.length} kept verbatim in the live window.`,
            },
          ],
        },
        {
          heading: "Decisions & Direction",
          items: agentTurns.slice(-4).map((m, i) => ({
            label: `D${i + 1}`,
            text: line(m, 200),
          })),
        },
        {
          heading: "Open Threads",
          items: userTurns
            .slice(1)
            .slice(-4)
            .map((m, i) => ({ label: `T${i + 1}`, text: line(m, 200) })),
        },
        {
          heading: "Runtime State",
          items: [
            { label: "Model", text: `\`${model}\` · effort \`${effort}\`` },
            {
              label: "Context",
              text: `\`${tokensBefore}\` tokens → \`${tokensAfter}\` tokens after compaction.`,
            },
            { label: "Recovery", text: "Full transcript archived — `restore` rehydrates it." },
          ],
        },
      ].filter((s) => s.items.length > 0),
    };
    const anchor: Msg = {
      role: "agent",
      text: "",
      compaction: {
        handover,
        memory,
        turns: folded.length,
        kept: kept.length,
        tokensBefore,
        tokensAfter,
        at: Date.now(),
        digest: digest.length ? digest : ["Nothing to fold — the live window is already minimal."],
      },
    };

    setCompacting(true);
    try {
      const sessionId = typeof window !== "undefined" ? sessionStorage.getItem("sovereign.operator") || "" : "";

      const brief = await compactContextWithModel({
        data: {
          title: active?.title ?? "Session",
          model,
          effort,
          turns: folded.filter((m) => m.text.trim()).map((m) => ({ role: m.role, text: m.text })),
          sessionId: sessionId,
          threadId: active?.id
        },
      });
      anchor.compaction = {
        ...anchor.compaction!,
        digest: brief.digest.length ? brief.digest : anchor.compaction!.digest,
        handover: {
          lede: brief.lede,
          objective: brief.objective,
          decisions: brief.decisions,
          open: brief.open,
          next: brief.next,
        },
        memory: brief.sections.length ? { title: memory.title, sections: brief.sections } : memory,
      };
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Model handover failed — kept the local summary.",
      );
    }
    setCompacting(false);
    setMessages([...kept, anchor]);
    setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 180);
  };

  const restoreContext = () => {
    if (archive.current) {
      setMessages(archive.current);
      archive.current = null;
    }
  };

  const composer = (
    <Composer
      value={value}
      onChange={setValue}
      onSend={(mentions) => send(value, mentions)}
      attachments={attachments}
      addFiles={addFiles}
      removeAttachment={remove}
      streaming={streaming}
      onStop={stop}
      contextTokens={contextTokens}
      zen={zen}
      onZenToggle={() => setZen((v) => !v)}
      pinnedContext={active?.context ?? ""}
      onPinContext={() => setCtxOpen((v) => !v)}
      webSearch={webSearch}
      onWebSearchToggle={() => setWebSearch((v) => !v)}
      onEffortChange={setEffort}
      onModelChange={setModel}
      onRoutingChange={setRoutingMode}
      onPurge={() => {
        stop(false); // isManual = false
        // Abort catch block'unun eski mesajları (base) geri yüklemesini önlemek için
        // silme işlemini event loop'ta sonraya bırakıyoruz (50ms).
        setTimeout(() => {
          setMessages([]);
          setFiles([]);
        }, 50);
        setValue("");
        clear();
      }}
      onCompactContext={compactContext}
    />
  );

  if (!ready) {
    return (
      <Shell>
        <div className="h-full bg-[var(--canvas-deep)]" />
      </Shell>
    );
  }

  const surface = (
    <div className="flex h-full min-h-0">
      <div
        className="relative flex h-full min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        onPaste={(e) => {
          // The composer textarea handles its own paste; only catch pastes outside it.
          if ((e.target as HTMLElement)?.closest("textarea")) return;
          const f = Array.from(e.clipboardData.files);
          if (f.length) addFiles(f);
        }}
      >
        <AnimatePresence>
          {dragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-[14px] border border-dashed border-sapphire/60 bg-sapphire/5 backdrop-blur-[2px]"
            >
              <span className="font-mono text-[12px] uppercase tracking-[0.22em] text-sapphire">
                drop files to attach
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* scrollable content region */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={onWheel}
          onKeyDown={onKeyNav}
          onTouchMove={onScroll}
          className="relative z-10 min-h-0 flex-1 overflow-y-auto"
        >
          {empty ? (
            <motion.div
              key="zen"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto flex min-h-full w-full max-w-[760px] flex-col items-center justify-center px-6 pb-4 pt-12 text-center"
            >
              <h1 className="font-display text-[38px] font-semibold leading-[1.1] tracking-[-0.035em] text-foreground">
                {greeting}
              </h1>

              <p className="platinum-data mt-3 text-[12.5px] font-medium tracking-[0.12em] opacity-55">
                {chatGreeting.status}
              </p>

              <div className="mt-9 flex flex-wrap items-center justify-center gap-2">
                {chatSuggestions.map((s, i) => (
                  <motion.button
                    key={s}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 + i * 0.08, duration: 0.3 }}
                    onClick={() => send(s)}
                    className="rounded-full bg-raised/50 px-4 py-2 text-[13.5px] font-medium text-muted-foreground/85 transition-colors hover:bg-raised hover:text-foreground"
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="mx-auto w-full max-w-[760px] space-y-14 px-6 pb-14 pt-20">
              {messages.map((m, i) => {
                if (m.hidden || m.text?.startsWith("[SYSTEM_NOTE]")) return null;
                return m.compaction ? (
                  <CompactionCard
                    key={i}
                    c={m.compaction}
                    onRestore={archive.current ? restoreContext : undefined}
                  />
                ) : (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {m.role === "agent" && m.agent ? (
                      <div className="mb-2.5 flex items-center gap-2">
                        <EntityAvatar
                          seed={m.agent.seed}
                          label={m.agent.name}
                          style={m.agent.style as never}
                          jewel={m.agent.jewel as never}
                          size={22}
                          className="rounded-[7px]"
                        />
                        <span
                          className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.24em]"
                          style={{ color: `var(--${m.agent.jewel})` }}
                        >
                          {m.agent.name}
                        </span>
                        <span
                          className="rounded-full px-1.5 py-[1px] font-mono text-[9px] font-semibold uppercase tracking-[0.18em]"
                          style={
                            m.agent.rag
                              ? {
                                  color: "var(--emerald)",
                                  background:
                                    "color-mix(in oklab, var(--emerald) 14%, transparent)",
                                  boxShadow: "0 0 10px -4px var(--emerald)",
                                }
                              : {
                                  color: "var(--muted-foreground)",
                                  background:
                                    "color-mix(in oklab, var(--muted-foreground) 10%, transparent)",
                                }
                          }
                        >
                          rag
                        </span>
                      </div>
                    ) : (
                      <div className="mb-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/55">
                        {m.role === "user" ? "you" : "elara"}
                      </div>
                    )}
                    {m.role === "user" ? (
                      <>
                        {!!m.files?.length && (
                          <div className="mb-3 flex flex-wrap gap-2.5">
                            {m.files.map((f) =>
                              f.kind === "image" && f.url ? (
                                <FileHoverPreview key={f.id} file={f}>
                                  <button
                                    type="button"
                                    onClick={() => f.url && setViewerUrl(f.url)}
                                    title={f.name}
                                    className="block overflow-hidden rounded-[12px] border border-white/[0.07] transition-[box-shadow,border-color] hover:border-white/[0.14] hover:shadow-[0_0_24px_-12px_rgba(255,255,255,0.15)]"
                                  >
                                    <img
                                      src={f.url}
                                      alt={f.name}
                                      className="max-h-[180px] max-w-[260px] object-cover"
                                    />
                                  </button>
                                </FileHoverPreview>
                              ) : (
                                <FileHoverPreview key={f.id} file={f}>
                                  <div className="flex items-center gap-2.5 rounded-[12px] border border-white/[0.07] bg-raised/35 px-3 py-2.5">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-white/[0.07] bg-canvas">
                                      <FileText
                                        className="h-4 w-4 text-sapphire"
                                        strokeWidth={1.6}
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <div
                                        className="max-w-[220px] truncate text-[13px] text-foreground/90"
                                        title={f.name}
                                      >
                                        {f.name}
                                      </div>
                                      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/55">
                                        {(f.name.split(".").pop() ?? "file").toUpperCase()}
                                      </div>
                                    </div>
                                  </div>
                                </FileHoverPreview>
                              ),
                            )}
                          </div>
                        )}

                        {editing === i ? (
                          <div className="obsidian-slab rounded-[14px] p-3">
                            <textarea
                              value={editDraft}
                              autoFocus
                              onChange={(e) => setEditDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  submitEdit(i);
                                }
                                if (e.key === "Escape") setEditing(null);
                              }}
                              rows={3}
                              className="w-full resize-none bg-transparent text-[16px] font-medium leading-[1.65] text-foreground focus:outline-none"
                            />
                            <div className="mt-2 flex items-center justify-end gap-2">
                              <button
                                onClick={() => setEditing(null)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground/80 transition-colors hover:bg-raised/70"
                              >
                                <X className="h-3.5 w-3.5" strokeWidth={1.7} /> Cancel
                              </button>
                              <button
                                onClick={() => submitEdit(i)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-sapphire/40 bg-sapphire/15 px-2.5 py-1.5 text-[12px] font-medium text-sapphire transition-colors hover:bg-sapphire/25"
                              >
                                <Check className="h-3.5 w-3.5" strokeWidth={1.7} /> Re-run
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap break-words text-[17px] font-medium leading-[1.72] tracking-[-0.01em] text-foreground">
                            {m.text}
                          </p>
                        )}
                        <div className="flex items-center gap-0.5">
                          <MessageActions text={m.text} onRetry={() => retry(i + 1)} />
                          <button
                            aria-label="Edit message"
                            title="Edit & re-run"
                            onClick={() => {
                              setEditDraft(m.text);
                              setEditing(i);
                            }}
                            className="mt-4 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:bg-raised/70 hover:text-foreground"
                          >
                            <Pencil className="h-[14px] w-[14px]" strokeWidth={1.7} />
                          </button>
                          <button
                            aria-label="Branch from here"
                            title="Branch thread from here"
                            onClick={() => branchAt(i)}
                            className="mt-4 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:bg-raised/70 hover:text-amethyst"
                          >
                            <Split className="h-[14px] w-[14px]" strokeWidth={1.7} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {m.telemetry && <TelemetryStrip t={m.telemetry} live={!!m.streaming} />}
                        {m.thinking && (
                          <ThinkingBlock
                            text={m.thinking}
                            active={!!m.streaming && (!m.activity || m.activity.phase !== "done")}
                            {...(m.telemetry ? { elapsedMs: m.telemetry.firstTokenMs } : {})}
                          />
                        )}
                        {m.activity && m.activity.runs && m.activity.runs.length > 0 && (
                          <ToolActivityBlock activity={m.streaming ? m.activity : { ...m.activity, phase: "done" }} />
                        )}
                        {typeof m.approval === "object" && m.approval !== null && !m.approval.decided && (
                          <ToolApprovalCard approval={m.approval as any} onDecision={(d) => decideApproval(i, d)} />
                        )}
                        <RichMessage text={m.text} />
                        {m.streaming && (!m.activity || m.activity.phase !== "done") && (
                          <span
                            className="ml-0.5 inline-block h-4 w-[7px] bg-sapphire/80 align-middle animate-pulse"
                          />
                        )}
                        {!m.streaming && m.retrieval && <RetrievalCard r={m.retrieval} />}
                        {!m.streaming && m.text && (
                          <div className="flex items-center gap-0.5">
                            <MessageActions text={m.text} onRetry={() => retry(i)} />
                            <button
                              aria-label="Branch from here"
                              title="Branch thread from here"
                              onClick={() => branchAt(i)}
                              className="mt-4 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:bg-raised/70 hover:text-amethyst"
                            >
                              <Split className="h-[14px] w-[14px]" strokeWidth={1.7} />
                            </button>
                          </div>
                        )}
                      </>
                    )}

                    {m.approval === true && !m.forge_plan && (
                      <div className="mt-6">
                        <MetaForgeApprovalCard {...metaForgeApprovalSeed} />
                      </div>
                    )}

                    {m.forge_plan && !m.streaming && (
                      <motion.div
                        initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        className="mt-6"
                      >
                        <MetaForgeApprovalCard
                          id={m.forge_plan.id?.replace("mf.plan.", "mf.cap.") || "mf.proposal"}
                          title={`New capability: ${m.forge_plan.intent || "adaptive fleet router"}`}
                          description="MetaForge synthesized a new capability. Approving adds it to the skill catalog and wires it into the orchestration layer; rejecting archives the draft."
                          facts={[
                            { label: "scope", value: "orchestration" },
                            { label: "risk", value: "low" },
                            { label: "rollback", value: "instant" },
                            { label: "author", value: m.forge_plan.requestedBy && !m.forge_plan.requestedBy.includes("00000000") && m.forge_plan.requestedBy !== "system" ? m.forge_plan.requestedBy : (currentAccount()?.username || currentAccount()?.name || "admin") },
                          ]}
                          open={true}
                          status={(m.forge_plan.status as any) || "pending"}
                          onApprove={async () => {
                            try {
                              const res = await fetchApi(`/api/meta-forge/plans/${m.forge_plan.id}/apply`, {
                                method: "POST"
                              });
                              if (res?.ok) {
                                toast.success("MetaForge plan approved and applied!");
                                
                                // Direct dismiss: previous messages are marked idle, forge_plan card disappears smoothly
                                const updatedMessages = messages.map(msg => {
                                  if (msg === m) {
                                    return { ...msg, streaming: false, forge_plan: undefined };
                                  }
                                  return { ...msg, streaming: false };
                                });
                                setMessages(updatedMessages);

                                // Wake up the model silently without rendering an ugly user bubble
                                const appliedList = (m.forge_plan?.plan?.create || []).map((c: any) => `${c.kind}: "${c.name || c.slug}" (${c.slug})`).join(', ');
                                const approvalMsg = `[SYSTEM_NOTE] The MetaForge plan (${m.forge_plan.id}) has been APPROVED and applied by the user. Created artifacts: [${appliedList}]. The new capabilities and workflows are now registered in the system. Please proceed with answering or completing the user's request using the actual registered names.`;
                                const baseForOrch: Msg[] = [
                                  ...updatedMessages,
                                  { role: "user", text: approvalMsg, hidden: true }
                                ];
                                runOrchestration(baseForOrch, undefined, approvalMsg, { tools: [], skills: [], mcp: [] }, undefined, webSearch);
                              }
                              else toast.error("MetaForge failed to apply.");
                            } catch(e: any) {
                              toast.error(`Error: ${e.message}`);
                            }
                          }}
                          onReject={async () => {
                            try {
                              await fetchApi(`/api/meta-forge/plans/${m.forge_plan.id}/reject`, {
                                method: "POST",
                                body: JSON.stringify({ reason: "User rejected from chat interface." })
                              });
                              toast("MetaForge plan rejected.");
                              
                              const updatedMessages = messages.map(msg => {
                                if (msg === m) {
                                  return { ...msg, streaming: false, forge_plan: undefined };
                                }
                                return { ...msg, streaming: false };
                              });
                              setMessages(updatedMessages);
                            } catch(e: any) {
                              toast.error(`Error: ${e.message}`);
                            }
                          }}
                        />
                      </motion.div>
                    )}

                    {m.proposals && (
                      <div className="mt-6 space-y-4">
                        {m.proposals.map((p, pi) => (
                          <ProposalCard key={p.id} proposal={p} index={pi} />
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })}
              <AnimatePresence>{compacting && <CompactingCard />}</AnimatePresence>
              <div ref={endRef} className="h-px w-full" />
            </div>
          )}
        </div>

        {/* bottom-anchored command bar */}
        <div className="relative z-20 shrink-0 px-6 pb-4 pt-1">
          <div
            className="pointer-events-none absolute inset-x-0 bottom-full h-6"
            style={{
              background:
                "linear-gradient(to top, var(--canvas), color-mix(in oklab, var(--canvas) 0%, transparent))",
            }}
          />
          <div className="mx-auto w-full max-w-[760px]">
            <AnimatePresence>
              {pending !== null && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="obsidian-slab mb-2.5 flex items-center gap-3 rounded-[14px] px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground/80">
                    <span className="mr-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-topaz">
                      held
                    </span>
                    {pending}
                  </span>
                  <button
                    onClick={() => {
                      queued.current = pending;
                      setPending(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground/85 transition-colors hover:bg-raised/70"
                  >
                    <Timer className="h-3.5 w-3.5" strokeWidth={1.6} /> Queue
                  </button>
                  <button
                    onClick={() => {
                      const t = pending;
                      setPending(null);
                      // DİKKAT: isManual = true olmalı ki arka plandaki /api/chat/cancel tetiklensin!
                      stop(true);
                      
                      // Eski işlemin kapanması için çok kısa bir an (150ms) bekleyip yeni mesajı dispatch et.
                      if (t) {
                          setTimeout(() => dispatch(t, attachments), 150);
                      }
                      clear();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sapphire/40 bg-sapphire/15 px-2.5 py-1.5 text-[12.5px] font-medium text-sapphire transition-colors hover:bg-sapphire/25"
                  >
                    <Send className="h-3.5 w-3.5" strokeWidth={1.6} /> Send now
                  </button>
                  <button
                    onClick={() => setPending(null)}
                    aria-label="Discard message"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ruby/35 bg-ruby/10 px-2.5 py-1.5 text-[12.5px] font-medium text-ruby transition-colors hover:bg-ruby/20"
                    title="Discard message"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} /> Discard
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {ctxOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="obsidian-slab mb-2.5 rounded-[14px] px-4 py-3"
                >
                  <div className="mb-2 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-amethyst">
                    <Pin className="h-3 w-3" strokeWidth={1.8} /> thread context
                  </div>
                  <textarea
                    value={ctxDraft}
                    onChange={(e) => setCtxDraft(e.target.value)}
                    rows={3}
                    placeholder="Standing instructions for this thread only — tone, brand, constraints."
                    className="w-full resize-none bg-transparent text-[13.5px] leading-[1.6] text-foreground/90 placeholder:text-muted-foreground/45 focus:outline-none"
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        if (active) setContext(active.id, "");
                        setCtxDraft("");
                        setCtxOpen(false);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground/80 transition-colors hover:bg-raised/70"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} /> Clear
                    </button>
                    <button
                      onClick={() => {
                        if (active) setContext(active.id, ctxDraft);
                        setCtxOpen(false);
                        toast.success("Thread context pinned");
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amethyst/40 bg-amethyst/15 px-2.5 py-1.5 text-[12px] font-medium text-amethyst transition-colors hover:bg-amethyst/25"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={1.7} /> Pin
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {composer}
            <div className="mt-1.5 flex items-center justify-center gap-3 text-[11px] text-muted-foreground/30">
              <span>Model can make mistakes · shift+enter for newline</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const withViewer = (
    <>
      {surface}
      <ImageViewer
        src={viewerUrl ?? ""}
        alt={files.find((f) => f.url === viewerUrl)?.name ?? "image"}
        open={!!viewerUrl}
        onClose={() => setViewerUrl(null)}
      />
    </>
  );

  if (zen) {
    return <div className="fixed inset-0 z-50 bg-[var(--canvas-deep)]">{withViewer}</div>;
  }

  return <Shell>{withViewer}</Shell>;
}
