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
import { ToolActivityBlock } from "@/components/sovereign/tool-activity";
import { ToolApprovalCard } from "@/components/sovereign/tool-approval-card";
import {
  buildCapabilities,
  emptyActivity,
  hasCapabilities,
  reduceActivity,
  simulateOrchestrate,
  type OrchestrateRequest,
  type ToolActivity,
} from "@/lib/orchestrate-stream";
import { buildWireMessages, encodeAttachments } from "@/lib/attachment-encode";
import {
  MessageActions,
  TelemetryStrip,
  type Telemetry,
} from "@/components/sovereign/message-actions";
import { toast } from "sonner";
import { compactContextWithModel } from "@/lib/context-compact.functions";
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
  proposals?: Proposal[];
  approval?: boolean;
  files?: Attachment[];
  thinking?: string;
  telemetry?: Telemetry;
  streaming?: boolean;
  compaction?: Compaction;
  agent?: MsgAgent;
  retrieval?: Retrieval;
  /** Live orchestration trace (tool_execution / tool_status / agent_loop / approval). */
  activity?: ToolActivity;
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
  /** Cancels the in-flight orchestration stream. */
  const orchCancel = useRef<(() => void) | null>(null);
  /** Turn context parked while a high-risk invocation waits for approval. */
  const resume = useRef<{ base: Msg[]; agent: StudioAgent | undefined; query: string } | null>(null);
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
  useEffect(() => stopTimer, []);

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
    if (!stick.current) return;
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el || !stick.current) return;
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  });
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

  /** Simulated streaming run: reasoning trace first, then the answer. */
  const runAgent = (
    base: Msg[],
    agent?: StudioAgent | undefined,
    query = "",
    activity?: ToolActivity,
  ) => {
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
    const ragBrands = agent ? agent.ragBrands : [];
    /** agent keywords + inherited pack brand keywords, in force for this turn */
    const aliases = resolveAliases(agent, capabilityPackList);
    const scope = narrowScopeToSpace(
      resolveScope(
        [(active?.context ?? "").trim(), query || lastUserText(base)].filter(Boolean).join(" "),
        spaceAccess.spaces,
        spaceAccess.ctx,
      ),
      /* a space-bound librarian narrows the scope; it never widens it */
      agent?.ragSpaceId,
      spaceAccess.spaces,
    );
    /* Attempted reach into a space the caller cannot read → audited deny. */
    if (agent?.ragSpaceId && !scope.searched.length) {
      const bound = spaceAccess.spaces.find((sp) => sp.id === agent.ragSpaceId);
      emitDeny({
        category: "agent",
        action: "deny.add",
        target: agent.id,
        label: agent.name,
        detail: `Retrieval blocked — ${bound?.name ?? agent.ragSpaceId} is closed to this principal.`,
      });
    }
    const retrieval =
      identity?.rag && speaker
        ? buildRetrieval(
            { id: speaker.id, ragBrands } as StudioAgent,
            query || lastUserText(base),
            scope,
            corpusFor(scope),
            aliases,
          )
        : undefined;
    if (retrieval && speaker) {
      const me = currentAccount();
      logRagQuery({
        query: (query || lastUserText(base)).slice(0, 240),
        principal: me?.name ?? "operator",
        principalId: me?.id ?? spaceAccess.ctx.userId,
        agent: speaker.name,
        spaces: scope.searched.filter((s) => s.hit).map((s) => s.name),
        blocked: scope.blocked.length,
        docs: retrieval.citations.length,
        chunks: retrieval.kept,
        hit: scope.routedBy === "keyword",
      });
    }
    const pinned = (active?.context ?? "").trim();
    const turnText = [pinned, query || lastUserText(base)].filter(Boolean).join("\n\n");
    logPlannerRun({
      question: turnText,
      tools: [...(retrieval ? ["vector.search"] : []), ...(webSearch ? ["web.search"] : [])],
      // composer sigils are the real capability pipes: ! skill · # mcp
      skills: [...turnText.matchAll(/(?:^|\s)!([a-z0-9][\w.-]*)/gi)].map((m) =>
        m[1]!.toLowerCase(),
      ),
      mcp: [...turnText.matchAll(/(?:^|\s)#([a-z0-9][\w.-]*)/gi)].map(
        (m) => `mcp.${m[1]!.toLowerCase()}`,
      ),
      grounded: Boolean(retrieval && retrieval.citations.length),
    });
    stopTimer();
    setStreaming(true);
    const start = Date.now();
    const think = effort === "none" ? "" : agentThinkingText;
    const thinkMs = thinkDuration[effort];
    let firstTokenMs = 0;
    let thinkChars = 0;
    let answerChars = 0;

    const tick = () => {
      const elapsed = Date.now() - start;
      if (think && elapsed < thinkMs) {
        thinkChars = Math.min(think.length, Math.round((elapsed / thinkMs) * think.length));
        setMessages([
          ...base,
          {
            role: "agent",
            text: "",
            thinking: think.slice(0, thinkChars),
            streaming: true,
            ...(activity ? { activity } : {}),
            ...(identity ? { agent: identity } : {}),
          },
        ]);
        return;
      }
      if (!firstTokenMs) firstTokenMs = elapsed;
      answerChars = Math.min(agentReplyText.length, answerChars + 16);
      const text = agentReplyText.slice(0, answerChars);
      const done = answerChars >= agentReplyText.length;
      const telemetry: Telemetry = {
        firstTokenMs,
        totalMs: elapsed,
        tokens: Math.max(1, Math.round(text.length / 4)),
        model: activeModel?.name ?? model,
        effort,
      };
      setMessages([
        ...base,
        {
          role: "agent",
          text,
          thinking: think,
          telemetry,
          streaming: !done,
          ...(activity ? { activity } : {}),
          ...(identity ? { agent: identity } : {}),
          ...(done && retrieval ? { retrieval } : {}),
          ...(done ? { proposals: proposalSeed, approval: true } : {}),
        },
      ]);
      if (done) {
        stopTimer();
        setStreaming(false);
        const next = queued.current;
        queued.current = null;
        if (next) setTimeout(() => void dispatch(next, []), 220);
      }
    };

    timer.current = setInterval(tick, 40);
  };

  /** A capability the orchestrator refuses to run unattended. */
  const highRisk = (name: string) => /(restart|reboot|delete|drop|wipe|destroy|shutdown)/i.test(name);

  /**
   * Multi-turn orchestration pass. Renders the SSE contract
   * (`tool_execution` → `tool_status` → `agent_loop` / `approval_required`)
   * before the assistant answer streams in.
   */
  /**
   * Request body for `POST /api/chat/orchestrate`.
   * `messages` is the OpenAI multimodal transcript: a turn carrying an image
   * ships an array of typed blocks (`text` + `image_url`), never a plain string.
   */
  const orchestrateBody = (
    base: Msg[],
    agent: StudioAgent | undefined,
    query: string,
    caps: ReturnType<typeof buildCapabilities>,
  ): OrchestrateRequest => ({
    message: query,
    messages: buildWireMessages(base, active?.context),
    capabilities: caps,
    ...(active?.id ? { threadId: active.id } : {}),
    ...(active?.context ? { context: active.context } : {}),
    ...(agent ? { agentId: agent.id } : {}),
  });

  const runOrchestration = (
    base: Msg[],
    agent: StudioAgent | undefined,
    query: string,
    caps: ReturnType<typeof buildCapabilities>,
  ) => {
    setStreaming(true);
    let act = emptyActivity();
    const paint = (streamingNow = true) =>
      setMessages([...base, { role: "agent", text: "", streaming: streamingNow, activity: act }]);
    paint();
    /* Live wiring swaps `simulateOrchestrate` for
       `streamOrchestrate(orchestrateBody(base, agent, query, caps), …)`. */
    void orchestrateBody;

    const gated = [...caps.tools, ...caps.skills].find(highRisk);
    orchCancel.current = simulateOrchestrate(
      caps,
      (e) => {
        act = reduceActivity(act, e);
        if (e.kind === "agent_loop") {
          paint();
          runAgent(base, agent, query, act);
          return;
        }
        if (e.kind === "approval_required") {
          resume.current = { base, agent, query };
          setStreaming(false);
          paint(false);
          return;
        }
        paint();
      },
      gated ? { approvalFor: gated } : {},
    );
  };

  /** Operator verdict on a halted high-risk invocation. */
  const decideApproval = (index: number, decision: "approve" | "reject") => {
    const msg = messages[index];
    const act = msg?.activity;
    if (!msg || !act?.approval) return;
    const toolName = act.approval.toolName;
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
    runAgent(base, ctx?.agent, ctx?.query ?? "", next);
  };

  const dispatch = async (text: string, atts: Attachment[], mentions: Mention[] = []) => {
    const t = text.trim();
    if (!t && !atts.length) return;
    const label = t;

    /* Blob URLs die on reload and cannot leave the browser — bake every
       attachment into a base64 data URL before it enters the thread. */
    const encoded = atts.length ? await encodeAttachments(atts) : [];

    const base: Msg[] = [
      ...((active?.messages ?? []) as Msg[]),
      { role: "user", text: label, files: encoded },
    ];
    /* The file rail of the thread is fed from the same encoded set. */
    if (encoded.length) setFiles([...files, ...encoded]);
    setMessages(base);
    if (active) autoTitle(active.id, label);
    const mentioned = mentions.find((m) => m.kind === "agent");
    const agent = mentioned ? agents.find((a) => a.id === mentioned.id) : undefined;
    /* `/tool`, `!skill` and `#mcp` picks travel as the turn's capability envelope. */
    const caps = buildCapabilities(mentions);
    if (hasCapabilities(caps)) runOrchestration(base, agent, t, caps);
    else runAgent(base, agent, t);
  };

  const stop = () => {
    orchCancel.current?.();
    orchCancel.current = null;
    stopTimer();
    setStreaming(false);
    const last = messages[messages.length - 1];
    if (last?.role === "agent") {
      setMessages([
        ...messages.slice(0, -1),
        { ...last, streaming: false, text: `${last.text}\n\n_Stopped by operator._` },
      ]);
    }
  };

  const send = (text: string, mentions: Mention[] = []) => {
    const t = text.trim();
    if (!t && !attachments.length) return;
    if (streaming) {
      setPending(t);
      setValue("");
      return;
    }
    void dispatch(t, attachments, mentions);
    setValue("");
    setWebSearch(false);
    clear();
  };

  const retry = (index: number) => {
    const base = messages.slice(0, index) as Msg[];
    const prior = messages[index]?.agent;
    const agent = prior ? agents.find((a) => a.id === prior.id) : undefined;
    setMessages(base);
    runAgent(base, agent, lastUserText(base));
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
    runAgent(base, undefined, text);
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
      const brief = await compactContextWithModel({
        data: {
          title: active?.title ?? "Session",
          model,
          effort,
          turns: folded.filter((m) => m.text.trim()).map((m) => ({ role: m.role, text: m.text })),
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
      onPurge={() => {
        stop();
        setMessages([]);
        setFiles([]);
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
              {messages.map((m, i) =>
                m.compaction ? (
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
                          <p className="whitespace-pre-wrap text-[17px] font-medium leading-[1.72] tracking-[-0.01em] text-foreground">
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
                        {m.activity && <ToolActivityBlock activity={m.activity} />}
                        {m.activity?.approval && (
                          <div className="mb-6">
                            <ToolApprovalCard
                              approval={m.activity.approval}
                              onDecision={(d) => decideApproval(i, d)}
                            />
                          </div>
                        )}
                        {m.thinking && (
                          <ThinkingBlock
                            text={m.thinking}
                            active={!!m.streaming && !m.text}
                            {...(m.telemetry ? { elapsedMs: m.telemetry.firstTokenMs } : {})}
                          />
                        )}
                        <RichMessage text={m.text} />
                        {m.streaming && (
                          <motion.span
                            className="ml-0.5 inline-block h-4 w-[7px] bg-sapphire/80 align-middle"
                            animate={{ opacity: [1, 0.15, 1] }}
                            transition={{ duration: 0.9, repeat: Infinity }}
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

                    {m.approval && (
                      <div className="mt-6">
                        <MetaForgeApprovalCard {...metaForgeApprovalSeed} />
                      </div>
                    )}

                    {m.proposals && (
                      <div className="mt-6 space-y-4">
                        {m.proposals.map((p, pi) => (
                          <ProposalCard key={p.id} proposal={p} index={pi} />
                        ))}
                      </div>
                    )}
                  </motion.div>
                ),
              )}
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
                      stop();
                      if (t) setTimeout(() => void dispatch(t, attachments), 60);
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
