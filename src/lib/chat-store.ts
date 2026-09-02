import { useEffect, useState } from "react";

export type ChatColor = "none" | "sapphire" | "emerald" | "amethyst" | "topaz" | "ruby";

export type ChatFile = {
  id: string;
  name: string;
  size: number;
  kind: "image" | "file" | "audio";
  mime?: string;
  url?: string | undefined;
};

export type ChatMessage = {
  role: "user" | "agent";
  text: string;
  proposals?: unknown[];
  approval?: boolean | { invocationId: string; toolName: string; reason: string; decided?: "approve" | "reject" };
  files?: ChatFile[];
  thinking?: string;
  activity?: any;
  compaction?: unknown;
  agent?: unknown;
  retrieval?: unknown;
  telemetry?: {
    firstTokenMs: number;
    totalMs: number;
    tokens: number;
    model: string;
    effort: string;
  };
  streaming?: boolean;
};

export type ChatThread = {
  id: string;
  title: string;
  pinned: boolean;
  color: ChatColor;
  createdAt: number;
  messages: ChatMessage[];
  files?: ChatFile[];
  /** Thread-level pinned system context, prepended to every turn of this thread. */
  context?: string;
  /** Thread this one was branched from, when applicable. */
  branchedFrom?: string;
  /** true once the title was written by hand — auto-title stops touching it. */
  titleLocked?: boolean;
};

/** Derive a thread title from the first operator turn. */
export function deriveTitle(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "New chat";
  const cut = line.length > 46 ? `${line.slice(0, 46).replace(/[\s,.;:!?-]+$/, "")}…` : line;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

export const chatColors: { key: ChatColor; label: string; token: string }[] = [
  { key: "none", label: "None", token: "var(--muted-foreground)" },
  { key: "sapphire", label: "Sapphire", token: "var(--sapphire)" },
  { key: "emerald", label: "Emerald", token: "var(--emerald)" },
  { key: "amethyst", label: "Amethyst", token: "var(--amethyst)" },
  { key: "topaz", label: "Topaz", token: "var(--topaz)" },
  { key: "ruby", label: "Ruby", token: "var(--ruby)" },
];

import { readDesk, readDeskRaw, writeDesk, writeDeskRaw } from "@/lib/ownership";
import {
  apiCreateThread,
  apiDeleteThread,
  apiListThreads,
  apiPatchThread,
  apiPutFiles,
  apiPutMessages,
} from "@/lib/chat-api";

const KEY = "elara.chats.v1";
const ACTIVE_KEY = "elara.chats.active.v1";

function blankChat(): ChatThread {
  return {
    id: `chat_${Date.now()}`,
    title: "New chat",
    pinned: false,
    color: "none",
    createdAt: Date.now(),
    messages: [],
    files: [],
  };
}

// Never expose mock threads before browser storage has been read.
let state: ChatThread[] = [];
let activeId = "";
let hydrated = false;
let remote = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function rememberActive() {
  writeDeskRaw(ACTIVE_KEY, activeId);
}

async function pull() {
  const remoteList = await apiListThreads();
  if (remoteList && remoteList.length > 0) {
    remote = true;
    const remoteMap = new Map(remoteList.map((t) => [t.id, t]));
    for (const t of state) {
      // SADECE son 5 dakika içinde açılmış, içi dolu ve server'da olmayan taze chat'leri yukarı it (Offline kurtarma).
      // Aksi halde silinmiş eski chat'lerin "hortlamasına" (Split-brain) sebep olur!
      const isFresh = Date.now() - t.createdAt < 5 * 60 * 1000;
      if (!remoteMap.has(t.id) && isFresh && (t.messages.length > 0 || t.title !== "New chat")) {
        void apiCreateThread(t);
        remoteList.push(t);
      }
    }
    state = remoteList;
    writeDesk(KEY, state);
    
    // Eğer activeId boşsa veya DB'den gelen listede yoksa, en yeni (en üstteki) chat'i aktif yap
    if (!activeId || !state.some((c) => c.id === activeId)) {
      activeId = state[0]?.id ?? "";
      rememberActive();
    }
    emit();
  } else if (remoteList && remoteList.length === 0) {
    remote = true;
    state = [blankChat()];
    activeId = state[0]?.id ?? "";
    writeDesk(KEY, state);
    rememberActive();
    emit();
  }
}

const putMessagesTimeouts = new Map<string, any>();

function push(t: ChatThread | undefined, sync: "create" | "messages" | "files" | "patch" | "delete", syncId?: string) {
  if (!remote && sync !== "delete") return;
  if (sync === "create" && t) void apiCreateThread(t);
  if (sync === "messages" && t) {
    // Debounce message persistence to avoid flooding the API during streams
    clearTimeout(putMessagesTimeouts.get(t.id));
    putMessagesTimeouts.set(
      t.id,
      setTimeout(() => {
        putMessagesTimeouts.delete(t.id);
        const latestT = state.find((c) => c.id === t.id);
        if (latestT) void apiPutMessages(latestT.id, latestT.messages);
      }, 1000)
    );
  }
  if (sync === "files" && t) void apiPutFiles(t.id, t.files ?? []);
  if (sync === "patch" && t) {
    void apiPatchThread(t.id, {
      title: t.title,
      ...(t.titleLocked !== undefined ? { titleLocked: t.titleLocked } : {}),
      pinned: t.pinned,
      color: t.color,
      ...(t.context !== undefined ? { context: t.context } : {}),
    });
  }
  if (sync === "delete" && syncId) void apiDeleteThread(syncId);
}

/** A different principal signed in — drop this desk and read theirs. */
if (typeof window !== "undefined") {
  window.addEventListener("sovereign:identity", () => {
    hydrated = false;
    remote = false;
    state = [];
    activeId = "";
    hydrate();
    emit();
  });
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  state = readDesk<ChatThread[]>(KEY, []);
  activeId = readDeskRaw(ACTIVE_KEY) ?? "";
  if (state.length === 0) state = [blankChat()];
  if (!state.some((c) => c.id === activeId)) activeId = state[0]?.id ?? "";
  void pull();
}

let writeDeskTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedWriteDesk(key: string, data: any, delayMs = 350) {
  if (writeDeskTimeout) clearTimeout(writeDeskTimeout);
  writeDeskTimeout = setTimeout(() => {
    writeDeskTimeout = null;
    writeDesk(key, data);
  }, delayMs);
}

function commit(next: ChatThread[], sync?: "create" | "messages" | "files" | "patch" | "delete", syncId?: string) {
  // Asla sıfır chat durumuna izin verme! Kullanıcı son chati silerse anında yepyeni, boş bir chat üret.
  if (next.length === 0) {
    const fallbackChat = blankChat();
    next = [fallbackChat];
  }
  
  state = next;
  if (!state.some((c) => c.id === activeId)) activeId = state[0]?.id ?? "";
  
  if (sync === "messages") {
    debouncedWriteDesk(KEY, next, 350);
  } else {
    if (writeDeskTimeout) {
      clearTimeout(writeDeskTimeout);
      writeDeskTimeout = null;
    }
    writeDesk(KEY, next);
  }
  rememberActive();
  emit();

  if (sync) {
    const t = state.find((c) => c.id === syncId);
    push(t, sync, syncId);
  }
}

/** Sorted: pinned first, then newest. */
export function sortChats(list: ChatThread[]) {
  return [...list].sort((a, b) =>
    a.pinned === b.pinned ? b.createdAt - a.createdAt : a.pinned ? -1 : 1,
  );
}

export function useChats() {
  const [, force] = useState(0);

  useEffect(() => {
    hydrate();
    const l = () => force((n) => n + 1);
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);

  const chats = sortChats(state);
  const active = state.find((c) => c.id === activeId) ?? chats[0];

  return {
    /** false until localStorage has been read — render nothing chat-specific before this */
    ready: hydrated,
    chats,
    activeId: active?.id ?? "",
    active,
    setActive: (id: string) => {
      activeId = id;
      rememberActive();
      emit();
    },
    newChat: () => {
      const chat: ChatThread = {
        id: `chat_${Date.now()}`,
        title: "New chat",
        pinned: false,
        color: "none",
        createdAt: Date.now(),
        messages: [],
        files: [],
      };
      activeId = chat.id;
      commit([chat, ...state], "create", chat.id);
    },
    setMessages: (id: string, messages: ChatMessage[]) =>
      commit(state.map((c) => (c.id === id ? { ...c, messages } : c)), "messages", id),
    setFiles: (id: string, files: ChatFile[]) =>
      commit(state.map((c) => (c.id === id ? { ...c, files } : c)), "files", id),
    rename: (id: string, title: string) =>
      commit(
        state.map((c) =>
          c.id === id ? { ...c, title: title.trim() || c.title, titleLocked: true } : c,
        ),
        "patch",
        id
      ),
    /** Auto-title from the first operator turn — never overrides a manual title. */
    autoTitle: (id: string, firstText: string) => {
      const chat = state.find((c) => c.id === id);
      if (!chat || chat.titleLocked || chat.title !== "New chat") return;
      commit(state.map((c) => (c.id === id ? { ...c, title: deriveTitle(firstText) } : c)), "patch", id);
    },
    /** Thread-level pinned context (system instructions for this thread only). */
    setContext: (id: string, context: string) =>
      commit(state.map((c) => (c.id === id ? { ...c, context } : c)), "patch", id),
    /** Fork a thread at a message index into a fresh sibling thread. */
    branch: (id: string, upto: number) => {
      const src = state.find((c) => c.id === id);
      if (!src) return "";
      const chat: ChatThread = {
        id: `chat_${Date.now()}`,
        title: `${src.title} · branch`,
        pinned: false,
        color: src.color,
        createdAt: Date.now(),
        messages: src.messages.slice(0, upto),
        files: src.files ?? [],
        ...(src.context ? { context: src.context } : {}),
        branchedFrom: src.id,
        titleLocked: true,
      };
      activeId = chat.id;
      commit([chat, ...state], "create", chat.id);
      return chat.id;
    },
    togglePin: (id: string) =>
      commit(state.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)), "patch", id),
    setColor: (id: string, color: ChatColor) =>
      commit(state.map((c) => (c.id === id ? { ...c, color } : c)), "patch", id),
    remove: (id: string) => commit(state.filter((c) => c.id !== id), "delete", id),
  };
}
