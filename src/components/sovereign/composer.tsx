import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Bot,
  Boxes,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  Image as ImageIcon,
  Maximize2,
  Mic,
  Minimize2,
  Paperclip,
  PhoneCall,
  Pin,
  Plus,
  Puzzle,
  Route,
  ScrollText,
  Search,
  Smile,
  Sparkles,
  Square,
  BrushCleaning,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useModels } from "@/lib/model-store";
import { useAgents } from "@/lib/agent-store";
import { useSkills } from "@/lib/skill-store";
import { useToolUniverse } from "@/lib/tool-universe";
import { useMcp } from "@/lib/mcp-store";
import { useSnippets } from "@/lib/snippet-store";
import { refKey, useRegistry } from "@/lib/registry-store";
import { routingModes, useProviders } from "@/lib/provider-store";
import { useAccess } from "@/lib/rbac-store";
import { EntityAvatar } from "@/components/sovereign/identity";
import { FileHoverPreview } from "@/components/sovereign/file-preview";

export type Attachment = {
  id: string;
  name: string;
  size: number;
  kind: "image" | "file" | "audio";
  mime?: string;
  url?: string | undefined;
};

export type Mention = {
  id: string;
  label: string;
  kind: "agent" | "tool" | "skill" | "mcp";
  tone: string;
};

/** Chat dispatch prefixes: @ agent · / tool · ! skill · # mcp */
export const mentionPrefix: Record<Mention["kind"], string> = {
  agent: "@",
  tool: "/",
  skill: "!",
  mcp: "#",
};

const prefixKind: Record<"@" | "/" | "!" | "#" | ">", Mention["kind"] | "snippet"> = {
  "@": "agent",
  "/": "tool",
  "!": "skill",
  "#": "mcp",
  ">": "snippet",
};

const toneText: Record<string, string> = {
  sapphire: "text-sapphire",
  emerald: "text-emerald",
  amethyst: "text-amethyst",
  topaz: "text-topaz",
  ruby: "text-ruby",
};

export function useComposerAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** Signatures already attached — guards against duplicate paste/drop events. */
  const seen = useRef(new Set<string>());
  const addFiles = (files: FileList | File[]) => {
    const fresh = Array.from(files).filter((f) => {
      const sig = `${f.name}|${f.size}|${f.lastModified}|${f.type}`;
      if (seen.current.has(sig)) return false;
      seen.current.add(sig);
      setTimeout(() => seen.current.delete(sig), 1500);
      return true;
    });
    const next = fresh.map((f) => ({
      id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      size: f.size,
      kind: (f.type.startsWith("image/")
        ? "image"
        : f.type.startsWith("audio/")
          ? "audio"
          : "file") as Attachment["kind"],
      mime: f.type || "application/octet-stream",
      url: typeof URL !== "undefined" ? URL.createObjectURL(f) : undefined,
    }));

    if (next.length) setAttachments((a) => [...a, ...next]);
  };
  const remove = (id: string) =>
    setAttachments((a) => {
      /* release the object URL of a chip that never got sent */
      const gone = a.find((x) => x.id === id);
      if (gone?.url && typeof URL !== "undefined") URL.revokeObjectURL(gone.url);
      return a.filter((x) => x.id !== id);
    });
  const clear = () => setAttachments([]);
  return { attachments, addFiles, remove, clear };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type MenuTab = "attachment" | "agent" | "tool" | "skill" | "mcp" | "snippet";

export type Effort = "none" | "low" | "medium" | "high";

const efforts: { id: Effort; hint: string }[] = [
  { id: "none", hint: "Instant, no reasoning" },
  { id: "low", hint: "Light reasoning pass" },
  { id: "medium", hint: "Balanced deliberation" },
  { id: "high", hint: "Deep, multi-step reasoning" },
];

const effortTone: Record<Effort, string> = {
  none: "text-muted-foreground/60",
  low: "text-emerald",
  medium: "text-topaz",
  high: "text-amethyst",
};

/** Compact context-window gauge shown in the composer toolbar. */
function ContextGauge({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const tone =
    pct >= 90
      ? "var(--ruby)"
      : pct >= 70
        ? "var(--topaz)"
        : pct >= 35
          ? "var(--sapphire)"
          : "var(--emerald)";
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(n >= 100_000 || n % 1000 === 0 ? 0 : 1)}k`
        : `${n}`;

  return (
    <span
      title={`Context: ${used.toLocaleString()} / ${total.toLocaleString()} tokens (${pct.toFixed(1)}%)`}
      className="ml-1.5 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-raised/50"
    >
      <span className="relative block h-1 w-14 overflow-hidden rounded-full bg-border/70">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
          style={{
            width: `${Math.max(pct, used > 0 ? 3 : 0)}%`,
            background: tone,
            boxShadow: `0 0 8px -1px ${tone}`,
          }}
        />
      </span>
      <span className="font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground/70">
        <span style={{ color: tone }}>{fmt(used)}</span>
        <span className="opacity-50">/{fmt(total)}</span>
      </span>
    </span>
  );
}

const EMOJI_PICKER_LIST = Array.from(new Set([
  // faces
  "🙂", "😊", "😉", "😎", "🤔", "😮", "😅", "😂", "🥳", "🤩", "😴", "😡", "🥶", "🤯", "🤠", "🫡",
  // gestures
  "👍", "👎", "👌", "🤌", "🤝", "🙌", "👏", "🫶", "🤞", "✌️", "🤟", "🤘", "👋", "🖖", "💪", "🙏",
  // people / roles
  "🧑‍💻", "👨‍🚀", "👩‍🔬", "🕵️", "🧙", "🧌", "🤖", "👾", "👽",
  // nature
  "🌌", "🌠", "🌙", "☀️", "🔥", "❄️", "💧", "☁️", "🌊", "⚡", "🌈", "🌿", "🍀", "🌵", "🌸", "🌺",
  // animals
  "🦅", "🦉", "🦇", "🐺", "🦊", "🦁", "🐉", "🐍", "🐙", "🦑", "🦋", "🐝", "🐜", "🦗",
  // food / drink
  "☕", "🍵", "🧋", "🍺", "🍷", "🍾", "🥃", "🍜", "🍕", "🍔", "🥗", "🍣", "🍱", "🍪", "🍫", "🍿",
  // objects / tech
  "💻", "🖥️", "⌨️", "🖱️", "🖨️", "📱", "📡", "🛰️", "🔭", "🔬", "🧬", "⚗️", "🧲", "🔋", "🔌", "💡", "🔦", "🕯️",
  // work / office
  "📎", "📌", "📍", "✂️", "🖊️", "🖋️", "📝", "📅", "📊", "📈", "📉", "📁", "📂", "🗂️", "🗃️", "📦",
  // security / sovereign
  "🔐", "🔒", "🔓", "🔑", "🗝️", "🛡️", "⚔️", "🚨", "🚔", "🛂", "🛃", "🗳️", "⚖️", "🏛️", "👑", "💎",
  // symbols
  "✅", "❌", "⭕", "🚫", "⚠️", "❗", "❓", "‼️", "⁉️", "➡️", "⬅️", "⬆️", "⬇️", "↗️", "↘️", "↙️", "↖️", "♻️", "🔁", "🔂", "▶️", "⏸️", "⏹️", "⏺️", "⏭️", "⏮️", "🔀", "🔃",
  // math / shapes
  "🔢", "➕", "➖", "✖️", "➗", "🟰", "∞", "≠", "≈", "✓", "✗", "★", "☆", "✦", "✧", "●", "○", "■", "□", "▲", "▼",
  // stars / sparkle
  "⭐", "🌟", "✨", "💫", "⚡", "🎇", "🎆", "🎊", "🎉", "🎖️", "🏆", "🥇", "🥈", "🥉",
  // transport / time
  "🚀", "🛸", "🚁", "🛩️", "🛫", "🛬", "⏰", "⏱️", "⌚", "🕰️", "⏳", "⌛",
  // music / media
  "🎵", "🎶", "🎼", "🎹", "🥁", "🎸", "🎺", "📣", "🔈", "🔊", "📢", "🎤", "🎧", "📹", "📷",
]));

export function Composer({
  value,
  onChange,
  onSend,
  attachments,
  addFiles,
  removeAttachment,
  onPurge,
  onCompactContext,
  streaming,
  onStop,
  onEffortChange,
  onModelChange,
  onRoutingChange,
  contextTokens = 0,
  zen = false,
  onZenToggle,
  pinnedContext = "",
  onPinContext,
  webSearch = false,
  onWebSearchToggle,
  activeModelId,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (mentions: Mention[]) => void;
  attachments: Attachment[];
  addFiles: (files: FileList | File[]) => void;
  removeAttachment: (id: string) => void;
  onPurge?: () => void;
  onCompactContext?: () => void;
  streaming?: boolean;
  onStop?: () => void;
  onEffortChange?: (e: Effort) => void;
  onModelChange?: (m: string) => void;
  onRoutingChange?: (mode: string) => void;
  /** Tokens already committed to the active thread's context. */
  contextTokens?: number;
  /** Zen mode toggle from the parent shell. */
  zen?: boolean;
  onZenToggle?: () => void;
  /** Thread-level pinned context for the toolbar indicator. */
  pinnedContext?: string;
  onPinContext?: () => void;
  /** Web search toggle for the current turn. */
  webSearch?: boolean;
  onWebSearchToggle?: () => void;
  /** Pass the active model ID from the parent to sync the context window gauge */
  activeModelId?: string | undefined;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<MenuTab>("attachment");
  const [search, setSearch] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const recognitionRef = useRef<any>(null); // For Speech Recognition
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [trigger, setTrigger] = useState<{
    kind: Mention["kind"] | "snippet";
    query: string;
    start: number;
  } | null>(null);
  const [effort, setEffort] = useState<Effort>("high");
  const [effortOpen, setEffortOpen] = useState(false);
  const { agents } = useAgents();
  const { skills } = useSkills();
  const tools = useToolUniverse();
  const { clients: mcpClients } = useMcp();
  const { snippets, add: addSnippet, remove: removeSnippet } = useSnippets();
  
  /** `#server` exposures offered by registered MCP clients. */
  const mcpTools = useMemo(() => {
    return mcpClients
      .filter((c) => c.enabled)
      .map((c) => ({
        id: `mcp.${(c as any).slug || c.id}`,
        name: c.name,
        meta: `${c.tools} tools`,
        tone: "topaz" as const,
      }));
  }, [mcpClients]);

  const registryData = useRegistry();
  const { models, defaultId } = useModels();
  const activeModels = models.filter((m: any) => m.enabled);
  const [modelId, setModelId] = useState<string | null>(null);
  const model = activeModels.find((m: any) => m.id === (modelId ?? activeModelId ?? defaultId)) ?? activeModels[0];
  const [effortSub, setEffortSub] = useState(false);
  const { providers, routing } = useProviders();
  const { sovereign } = useAccess();
  const [localRoutingMode, setLocalRoutingMode] = useState<string | null>(null);
  const llmProviders = providers.filter((p) => p.kind === "llm" && p.active);
  const [routeOpen, setRouteOpen] = useState(false);
  const [manualProvider, setManualProvider] = useState<string | null>(null);
  const canOverride = routing.allowUserOverride || sovereign;

  const currentMode = localRoutingMode ?? routing.mode;
  const activeMode = routingModes.find((m) => m.key === currentMode);
  const manualBlocked =
    currentMode === "manual_only" && !llmProviders.some((p) => p.id === manualProvider);

  const closeAllMenus = () => {
    setMenu(false);
    setEmoji(false);
    setEffortOpen(false);
    setEffortSub(false);
    setRouteOpen(false);
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeAllMenus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAllMenus();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const insertEmoji = (e: string) => {
    onChange(value + e);
    inputRef.current?.focus();
  };

  const addMention = (m: Mention) => {
    setMentions((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    if (trigger) {
      const token = `${mentionPrefix[m.kind]}${m.label} `;
      onChange(value.slice(0, trigger.start) + token);
      setTrigger(null);
    }
    setMenu(false);
    inputRef.current?.focus();
  };

  /** Insert a prompt snippet body, replacing the `>slug` trigger token. */
  const insertSnippet = (body: string) => {
    if (trigger) {
      onChange(`${value.slice(0, trigger.start)}${body} `);
      setTrigger(null);
    } else {
      onChange(value ? `${value.replace(/\s*$/, "")} ${body}` : body);
    }
    setMenu(false);
    inputRef.current?.focus();
  };

  /** Detect a trailing `@agent`, `/tool`, `!skill`, `#mcp` or `>snippet` token. */
  const syncTrigger = (next: string) => {
    if (!next.includes('@') && !next.includes('/') && !next.includes('!') && !next.includes('#') && !next.includes('>')) {
      if (trigger) setTrigger(null);
      return;
    }
    const match = /(^|\s)([@/!#>])([\w.-]*)$/.exec(next);
    if (!match) {
      setTrigger(null);
      return;
    }
    const sigil = match[2] as "@" | "/" | "!" | "#" | ">";
    const query = match[3] ?? "";
    const kind = prefixKind[sigil];
    setTrigger({ kind, query, start: next.length - 1 - query.length });
    setTab(kind);
    setEmoji(false);
    setMenu(true);
  };

  const send = () => {
    if (manualBlocked) {
      setRouteOpen(true);
      return;
    }
    onSend(mentions);
    setMentions([]);
    setTrigger(null);
  };

  const lists: Record<
    Exclude<MenuTab, "attachment" | "snippet">,
    readonly { id: string; name: string; meta: string; tone: string }[]
  > = useMemo(() => ({
    agent: (agents || []).filter(a => a && a.enabled).map(a => ({
      id: a.id,
      name: a.name || "",
      meta: `${(a.squad || "").toLowerCase()}${a.rag ? " · rag" : ""}`,
      tone: a.avatar?.jewel || "sapphire"
    })),
    tool: (tools || []).map(t => ({
      id: t.id,
      name: t.label || t.id || "",
      meta: t.source || "Native",
      tone: "amethyst"
    })),
    skill: (skills || []).filter(s => s && s.enabled).map(s => ({
      id: s.id,
      name: s.name || "",
      meta: s.type || "Python",
      tone: s.jewel || "emerald"
    })),
    mcp: mcpTools || [],
  }), [agents, tools, skills, mcpTools]);

  const pickQuery = (trigger?.query || search).trim().toLowerCase();
  const visibleSnippets = useMemo<typeof snippets>(() => snippets.filter((s) =>
    pickQuery
      ? s.name.toLowerCase().includes(pickQuery) || s.body.toLowerCase().includes(pickQuery)
      : true,
  ), [snippets, pickQuery]);

  const visibleList = useMemo<{ id: string; name: string; meta: string; tone: string }[]>(() =>
    tab === "attachment" || tab === "snippet"
      ? []
      : lists[tab].filter((i) => (pickQuery ? i.name.toLowerCase().includes(pickQuery) : true)),
    [tab, lists, pickQuery]
  );

  // --- Live Camera Capture Logic ---
  const startCamera = async () => {
    try {
      // Önce UI'ı (Modalı ve video etiketini) açıyoruz ki DOM'a yerleşsin
      setCameraOpen(true);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      
      // DOM'un render olması için kısa bir gecikme verip stream'i bağlıyoruz
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 50);
    } catch (err) {
      console.error("Failed to access camera", err);
      alert("Kameraya erişilemedi. Lütfen tarayıcı izinlerini kontrol edin.");
      setCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  const takePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Draw current video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to blob and create a File object
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      addFiles([file]);
      stopCamera(); // close modal after capture
    }, "image/jpeg", 0.9);
  };

  // Ensure camera is stopped if component unmounts
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);
  // --- End of Camera Logic ---

  // --- Speech-to-Text (Dictation) Logic ---
  useEffect(() => {
    // Check if the browser supports Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "tr-TR"; // Varsayılan dili Türkçe yaptık (ingilizce de yapılabilir)

      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        // Append final transcript and update UI with interim 
        onChange(value + (value.length > 0 && !value.endsWith(" ") ? " " : "") + finalTranscript + interimTranscript);
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "not-allowed" || event.error === "no-speech") {
          setRecording(false);
        }
      };

      recognition.onend = () => {
        if (recording) {
           // continuous true olduğu için durmaması lazım, ama durursa tekrar başlat (Keep-alive)
           try { recognition.start(); } catch(e) {}
        }
      };

      recognitionRef.current = recognition;
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert("Tarayıcınız sesli dikte (Speech-to-Text) özelliğini desteklemiyor. (Brave veya Safari/Chrome kullanın).");
      return;
    }
    
    if (recording) {
      recognitionRef.current.stop();
      setRecording(false);
    } else {
      try {
        // Eski kayıttan kalan interim parçaları temizlemek için yeniden oluşturmak daha sağlıklı
        recognitionRef.current.start();
        setRecording(true);
      } catch(e) {
        console.error(e);
      }
    }
  };
  // --- End of Speech-to-Text ---

  const tabs: { id: MenuTab; label: string; sigil: string; icon: typeof Bot }[] = [
    { id: "attachment", label: "File", sigil: "", icon: Paperclip },
    { id: "agent", label: "Agent", sigil: "@", icon: Bot },
    { id: "tool", label: "Tool", sigil: "/", icon: Puzzle },
    { id: "skill", label: "Skill", sigil: "!", icon: Sparkles },
    { id: "mcp", label: "MCP", sigil: "#", icon: Boxes },
    { id: "snippet", label: "Snip", sigil: ">", icon: ScrollText },
  ];

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-raised/60 hover:text-foreground/90";

  return (
    <div className="relative" ref={wrapRef}>
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <AnimatePresence>
        {cameraOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <div className="relative w-full max-w-lg overflow-hidden rounded-[14px] bg-[var(--canvas-deep)] border border-white/[0.08] shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
                <h3 className="font-mono text-[13px] font-medium text-foreground tracking-widest uppercase">Live Camera</h3>
                <button onClick={stopCamera} className="text-muted-foreground hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="relative aspect-video w-full bg-black">
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              </div>
              <div className="flex items-center justify-center gap-4 p-4">
                <button
                  onClick={takePhoto}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-sapphire text-white shadow-[0_0_20px_-5px_var(--sapphire)] transition-transform hover:scale-105 active:scale-95"
                >
                  <Camera size={20} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: "opacity, transform" }}
            className="obsidian-slab absolute bottom-[calc(100%+10px)] left-0 z-30 w-[344px] overflow-hidden rounded-[14px] p-1.5"
          >
            <div className="grid grid-cols-2 gap-1 border-b border-border/60 px-1 pb-1.5 pt-1.5">
              <button
                onClick={() => {
                  onWebSearchToggle?.();
                  setMenu(false);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors",
                  webSearch
                    ? "bg-sapphire/15 text-sapphire"
                    : "text-foreground/85 hover:bg-raised/70",
                )}
              >
                <Globe className="h-3.5 w-3.5" strokeWidth={1.6} />
                {webSearch ? "Web search enabled" : "Web search"}
              </button>
              <button
                onClick={() => {
                  onCompactContext?.();
                  setMenu(false);
                }}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-foreground/85 transition-colors hover:bg-raised/70"
              >
                <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                Context Compact
              </button>
              <button
                onClick={() => {
                  toggleRecording();
                  setMenu(false);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors",
                  recording ? "bg-ruby/15 text-ruby" : "text-foreground/85 hover:bg-raised/70",
                )}
              >
                {recording ? (
                  <Square className="h-3 w-3 fill-current" strokeWidth={1.6} />
                ) : (
                  <Mic className="h-3.5 w-3.5" strokeWidth={1.6} />
                )}
                {recording ? "Stop recording" : "Record voice"}
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  startCamera();
                }}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-foreground/85 transition-colors hover:bg-raised/70"
              >
                <Camera className="h-3.5 w-3.5" strokeWidth={1.6} />
                Capture image
              </button>
            </div>
            <div className="grid grid-cols-6 gap-1 px-1 py-1.5">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (t.id === "attachment") {
                      fileRef.current?.click();
                      setMenu(false);
                    } else {
                      setTab(t.id);
                      setSearch("");
                    }
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors",
                    tab === t.id && t.id !== "attachment"
                      ? "bg-raised text-foreground"
                      : "text-muted-foreground/75 hover:bg-raised/60 hover:text-foreground",
                  )}
                  title={t.sigil ? `${t.sigil} ${t.label}` : t.label}
                >
                  <t.icon className="h-3.5 w-3.5" strokeWidth={1.6} />
                  <span className="leading-none">
                    {t.sigil && <span className="font-mono opacity-60">{t.sigil}</span>}
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
            {tab !== "attachment" && (
              <div className="flex items-center gap-2 border-t border-border/60 px-2.5 py-1.5">
                <Search
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                  strokeWidth={1.6}
                />
                <input
                  value={trigger?.query ?? search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${tab === "snippet" ? "snippets" : tab}…`}
                  readOnly={!!trigger}
                  className="w-full bg-transparent font-mono text-[12px] text-foreground/90 outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            )}
            <div className="max-h-64 overflow-y-auto py-1">
              {tab === "snippet" && (
                <>
                  {visibleSnippets.map((s) => (
                    <div
                      key={s.id}
                      className="group flex w-full items-start gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-raised/70"
                    >
                      <button
                        onClick={() => insertSnippet(s.body)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className={cn("font-mono text-[12.5px]", toneText[s.tone])}>
                          &gt;{s.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground/65">
                          {s.body}
                        </span>
                      </button>
                      <button
                        aria-label={`Delete snippet ${s.name}`}
                        onClick={() => removeSnippet(s.id)}
                        className="mt-0.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity hover:text-ruby group-hover:opacity-100"
                        title={`Delete snippet ${s.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {value.trim() && (
                    <button
                      onClick={() => {
                        const words = value.trim().split(/\s+/).slice(0, 2).join("-");
                        addSnippet(words || `snip-${snippets.length + 1}`, value);
                        setMenu(false);
                      }}
                      className="mt-1 flex w-full items-center gap-2 border-t border-border/60 px-2.5 py-2 text-left font-mono text-[11.5px] text-emerald transition-colors hover:bg-raised/70"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.7} /> save composer text as
                      snippet
                    </button>
                  )}
                  {visibleSnippets.length === 0 && !value.trim() && (
                    <p className="px-2.5 py-3 font-mono text-[11.5px] text-muted-foreground/60">
                      No snippets yet — type text and save it here.
                    </p>
                  )}
                </>
              )}
              {tab !== "attachment" &&
                tab !== "snippet" &&
                visibleList.map((item) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      addMention({
                        id: item.id,
                        label: item.name,
                        kind: tab as Mention["kind"],
                        tone: item.tone,
                      })
                    }
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised/70"
                  >
                    <span className={cn("font-mono text-[13px]", toneText[item.tone])}>
                      {item.name}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground/70">
                      {item.meta}
                    </span>
                  </button>
                ))}
              {tab !== "attachment" && tab !== "snippet" && visibleList.length === 0 && (
                <p className="px-2.5 py-3 font-mono text-[11.5px] text-muted-foreground/60">
                  {tab === "mcp"
                    ? "No MCP servers registered — add one in MCP Management."
                    : "No matches."}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {emoji && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: "opacity, transform" }}
            className="obsidian-slab absolute bottom-[calc(100%+10px)] left-0 z-30 w-[340px] overflow-hidden rounded-[14px] p-2"
          >
            <div className="h-[288px] overflow-y-auto pr-1">
              <div className="grid grid-cols-8 gap-1">
                {EMOJI_PICKER_LIST.map((e: string) => (
                  <button
                    key={e}
                    onClick={() => insertEmoji(e)}
                    className="flex h-9 items-center justify-center rounded-md text-[18px] leading-none transition-colors duration-100 hover:bg-raised/70"
                    aria-label={`Insert emoji ${e}`}
                    title={`Insert emoji ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="obsidian-slab relative rounded-[16px] px-4 pb-2.5 pt-3 focus-within:border-white/15">
        {(attachments.length > 0 || mentions.length > 0) && (
          <div className="mb-3 flex flex-wrap gap-2">
            {mentions.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-raised/60 px-2 py-1 font-mono text-[11.5px]"
              >
                <span className={toneText[m.tone]}>
                  {mentionPrefix[m.kind]}
                  {m.label}
                </span>
                <button
                  onClick={() => setMentions((p) => p.filter((x) => x.id !== m.id))}
                  className="text-muted-foreground/60 hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {attachments.map((a) => (
              <FileHoverPreview key={a.id} file={a}>
                <span className="inline-flex items-center gap-2 rounded-md border border-border bg-raised/60 px-2 py-1 text-[12px] text-foreground/85">
                  {a.kind === "image" && a.url ? (
                    <img src={a.url} alt={a.name} className="h-4 w-4 rounded-[3px] object-cover" />
                  ) : a.kind === "image" ? (
                    <ImageIcon className="h-3.5 w-3.5 text-sapphire" strokeWidth={1.6} />
                  ) : a.kind === "audio" ? (
                    <Mic className="h-3.5 w-3.5 text-emerald" strokeWidth={1.6} />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
                  )}
                  <span className="max-w-[180px] truncate" title={a.name}>
                    {a.name}
                  </span>
                  <span className="font-mono text-[10.5px] text-muted-foreground/60">
                    {formatSize(a.size)}
                  </span>
                  <button
                    onClick={() => removeAttachment(a.id)}
                    className="text-muted-foreground/60 hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </FileHoverPreview>
            ))}
          </div>
        )}

        <textarea
          ref={inputRef}
          rows={3}
          value={value}
          onMouseDown={closeAllMenus}
          onChange={(e) => {
            onChange(e.target.value);
            syncTrigger(e.target.value);
          }}

          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask anything. Drop, paste or attach files."
          className="max-h-52 min-h-[88px] w-full resize-none bg-transparent text-[16.5px] font-medium leading-[1.65] tracking-[-0.01em] text-foreground placeholder:font-normal placeholder:text-muted-foreground/50 focus:outline-none"
        />

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <button
              aria-label="Attach, agent, tool or skill"
              onClick={() => {
                setEmoji(false);
                setMenu((m) => !m);
              }}
              className={cn(iconBtn, menu && "bg-raised/60 text-foreground")}
              title="Attach, agent, tool or skill"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
            <button
              aria-label="Toggle zen mode"
              title={zen ? "Exit zen mode" : "Zen mode"}
              onClick={() => onZenToggle?.()}
              className={cn(
                iconBtn,
                zen && "bg-sapphire/15 text-sapphire hover:bg-sapphire/25 hover:text-sapphire",
              )}
            >
              {zen ? (
                <Minimize2 className="h-[18px] w-[18px]" strokeWidth={1.5} />
              ) : (
                <Maximize2 className="h-[18px] w-[18px]" strokeWidth={1.5} />
              )}
            </button>
            <button
              aria-label="Thread context"
              title={pinnedContext.trim() ? "Thread context pinned" : "Pin thread context"}
              onClick={() => onPinContext?.()}
              className={cn(
                iconBtn,
                pinnedContext.trim() &&
                  "bg-amethyst/15 text-amethyst hover:bg-amethyst/25 hover:text-amethyst",
              )}
            >
              <Pin className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
            <button
              aria-label="Purge conversation"
              title="Purge conversation"
              onClick={() => onPurge?.()}
              className={cn(iconBtn, "hover:bg-ruby/15 hover:text-ruby")}
            >
              <BrushCleaning className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
            <button
              aria-label="Emoji"
              onClick={() => {
                setMenu(false);
                setEmoji((v) => !v);
              }}
              className={cn(iconBtn, emoji && "bg-raised/60 text-foreground")}
              title="Emoji"
            >
              <Smile className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
            <ContextGauge
              used={contextTokens + Math.ceil(value.length / 4)}
              total={model?.contextWindow ?? 128000}
            />

            {recording && (
              <span className="ml-1.5 font-mono text-[11px] tracking-[0.18em] text-ruby">REC</span>
            )}
          </div>
          <div className="relative flex items-center gap-2">
            <button
              onClick={() => {
                setMenu(false);
                setEmoji(false);
                setEffortSub(false);
                setEffortOpen((v) => !v);
              }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] font-medium text-muted-foreground/80 transition-colors hover:bg-raised/50 hover:text-foreground"
            >
              <span className="flex items-center gap-2 text-foreground">
                {model && (
                  <EntityAvatar
                    seed={model.avatar.seed}
                    label={model.name}
                    style={model.avatar.style}
                    jewel={model.avatar.jewel}
                    size={18}
                  />
                )}
                {model?.name ?? "No model"}
              </span>
              <span className={cn("capitalize", effortTone[effort])}>{effort}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  effortOpen && "rotate-180",
                )}
                strokeWidth={1.75}
              />
            </button>

            <AnimatePresence>
              {effortOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="obsidian-slab absolute bottom-[calc(100%+10px)] right-0 z-30 w-[260px] rounded-[14px] p-1.5"
                >
                  <div className="px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground/50">
                    model
                  </div>
                  {activeModels.map((m: any) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setModelId(m.id);
                        onModelChange?.(m.id);
                        setEffortOpen(false);
                        setEffortSub(false);
                      }}
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised/70",
                        model?.id === m.id && "bg-raised/60",
                      )}
                    >
                      <span className="flex min-w-0 items-start gap-2.5">
                        <EntityAvatar
                          seed={m.avatar.seed}
                          label={m.name}
                          style={m.avatar.style}
                          jewel={m.avatar.jewel}
                          size={26}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="flex min-w-0 flex-col">
                          <span
                            className={cn(
                              "text-[13.5px] font-medium",
                              model?.id === m.id ? "text-sapphire" : "text-foreground/90",
                            )}
                          >
                            {m.name}
                          </span>
                          <span className="truncate font-mono text-[11px] leading-snug text-muted-foreground/55">
                            {m.modelId}
                          </span>
                        </span>
                      </span>
                      {model?.id === m.id ? (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sapphire" />
                      ) : m.id === defaultId ? (
                        <span className="mt-0.5 shrink-0 rounded-md border border-border bg-raised/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
                          default
                        </span>
                      ) : null}
                    </button>
                  ))}

                  <div className="mt-1.5 border-t border-border/60 pt-1.5">
                    <button
                      onClick={() => setRouteOpen((v) => !v)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised/70",
                        routeOpen && "bg-raised/60",
                      )}
                    >
                      <span className="flex items-center gap-2 text-[13.5px] font-medium text-foreground/90">
                        <Route className="h-3.5 w-3.5 text-muted-foreground/70" strokeWidth={1.6} />
                        Routing
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "font-mono text-[11px] uppercase tracking-[0.14em]",
                            manualBlocked ? "text-ruby" : "text-sapphire",
                          )}
                        >
                          {manualBlocked ? "pick provider" : (activeMode?.label ?? "auto")}
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200",
                            routeOpen && "rotate-180",
                          )}
                          strokeWidth={1.75}
                        />
                      </span>
                    </button>

                    {routeOpen && (
                      <div className="mt-1 space-y-0.5 rounded-[12px] bg-raised/25 p-1">
                        {routingModes.map((m) => (
                          <button
                            key={m.key}
                            onClick={() => {
                              setLocalRoutingMode(m.key);
                              onRoutingChange?.(m.key);
                            }}
                            disabled={!canOverride}
                            className={cn(
                              "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                              canOverride ? "hover:bg-raised/70" : "opacity-50 cursor-not-allowed",
                              currentMode === m.key && "bg-raised/60",
                            )}
                          >
                            <span
                              className={cn(
                                "text-[13px] font-medium",
                                currentMode === m.key ? "text-sapphire" : "text-foreground/85",
                              )}
                            >
                              {m.label}
                              {!canOverride && <span className="ml-2 text-[10px] text-muted-foreground font-normal">(locked)</span>}
                            </span>
                            {currentMode === m.key && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-sapphire" />
                            )}
                          </button>
                        ))}

                        {currentMode === "manual_only" &&
                          (llmProviders.length === 0 ? (
                            <div className="px-2.5 py-2 text-[12px] text-muted-foreground/60">
                              No active LLM provider. Add one in Settings.
                            </div>
                          ) : (
                            <div className="mt-1 border-t border-border/60 pt-1">
                              {llmProviders.map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => setManualProvider(p.id)}
                                  className={cn(
                                    "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-raised/70",
                                    manualProvider === p.id && "bg-raised/60",
                                  )}
                                >
                                  <span className="truncate text-[12.5px] text-foreground/85">
                                    {p.name}
                                  </span>
                                  {manualProvider === p.id && (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald" />
                                  )}
                                </button>
                              ))}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  <div
                    className="relative mt-1.5 border-t border-border/60 pt-1.5"
                    onMouseLeave={() => setEffortSub(false)}
                  >
                    <button
                      onMouseEnter={() => setEffortSub(true)}
                      onClick={() => setEffortSub((v) => !v)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised/70",
                        effortSub && "bg-raised/60",
                      )}
                    >
                      <span className="text-[13.5px] font-medium text-foreground/90">
                        Thinking effort
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={cn("text-[13px] capitalize", effortTone[effort])}>
                          {effort}
                        </span>
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200",
                            effortSub && "translate-x-0.5",
                          )}
                          strokeWidth={1.75}
                        />
                      </span>
                    </button>

                    <AnimatePresence>
                      {effortSub && (
                        <motion.div
                          initial={{ opacity: 0, x: -10, scale: 0.98 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={{ opacity: 0, x: -8, scale: 0.98 }}
                          transition={{ duration: 0.18, ease: "easeOut" }}
                          className="absolute bottom-0 left-full z-40 w-[186px] pl-2"
                          onMouseEnter={() => setEffortSub(true)}
                        >
                          <div className="obsidian-slab rounded-[12px] p-1">
                            {efforts.map((e) => (
                              <button
                                key={e.id}
                                onClick={() => {
                                  setEffort(e.id);
                                  onEffortChange?.(e.id);
                                  setEffortOpen(false);
                                  setEffortSub(false);
                                }}
                                className={cn(
                                  "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised/70",
                                  effort === e.id && "bg-raised/60",
                                )}
                              >
                                <span className="flex flex-col">
                                  <span
                                    className={cn(
                                      "text-[13.5px] font-medium capitalize",
                                      effort === e.id ? effortTone[e.id] : "text-foreground/85",
                                    )}
                                  >
                                    {e.id}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground/55">
                                    {e.hint}
                                  </span>
                                </span>
                                {effort === e.id && <Check className="h-3.5 w-3.5 text-emerald" />}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {streaming ? (
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={() => onStop?.()}
                aria-label="Stop generating"
                title="Stop generating"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-ruby/20 text-ruby transition-colors hover:bg-ruby/30"
                style={{ boxShadow: "0 0 22px -8px var(--ruby)" }}
              >
                <Square className="h-3 w-3 fill-current" strokeWidth={2} />
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={send}
                aria-label="Send"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-foreground/70 transition-colors hover:bg-sapphire/25 hover:text-sapphire"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={1.8} />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
