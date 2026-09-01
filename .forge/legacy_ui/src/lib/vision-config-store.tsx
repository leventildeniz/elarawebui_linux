// Vision Profiles store — operatör birden fazla "Gözcü Subayı" kimliği tanımlar,
// Live Call ve diğer Capture noktaları aktif profili kullanır. Her profil kendi
// system prompt, model, ses modu ve dilini taşır. localStorage'da tutulur; her
// değişim Mac middleware'ine fire-and-forget push'lanır.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { VisionConfigAPI } from "@/lib/api-client";

export type VisionExtraParam = { id: string; key: string; value: string };
export type VisionVoiceMode = "silent" | "via_elara" | "direct";
export type VisionVoiceLang = "tr" | "en";

export type VisionProfile = {
  id: string;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  maxFrames: number;
  timeoutMs: number;
  extra: VisionExtraParam[];
  voiceMode: VisionVoiceMode;
  voiceLang: VisionVoiceLang;
  contextLabel: string;
  isDefault?: boolean;
  updatedAt: number;
};

// Geriye uyumluluk için eski tek-config tip adını koruyoruz.
export type VisionConfig = VisionProfile;

const PROFILES_KEY = "elara.vision.profiles.v1";
const LEGACY_KEY = "elara.vision.config.v1";

const DEFAULT_SYSTEM_PROMPT =
  "You are the Senior Architect Sentinel. Report the scene with discipline and a neutral tone. " +
  "Do not use pleasantries, greetings or questions. " +
  "Structure: 1) Scene assessment  2) Notable elements  3) Risk/opportunity note.";

const DEFAULT_CONTEXT_LABEL =
  "[Visual Report — summarize with Senior Architect discipline and relay through Mimar's own voice]";

// Legacy Turkish seeds — used by the one-shot migration in loadState() to detect
// and replace stale TR defaults stored in localStorage from earlier builds.
const LEGACY_TR_NAME = "Senior Architect Gözcü";
const LEGACY_TR_PROMPT_PREFIX = "Sen Senior Architect Gözcü Subayısın";
const LEGACY_TR_USER_PROMPT = "Bu kareyi analiz et.";

function makeDefaultProfile(): VisionProfile {
  return {
    id: "default",
    name: "Senior Architect Sentinel",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    userPromptTemplate: "Analyze this frame.",
    baseUrl: "http://127.0.0.1:8011",
    model: "local-community/Qwen2-VL-7B-Instruct-4bit",
    temperature: 0.1,
    maxTokens: 800,
    maxFrames: 1,
    timeoutMs: 60000,
    extra: [],
    voiceMode: "via_elara",
    voiceLang: "tr",
    contextLabel: DEFAULT_CONTEXT_LABEL,
    isDefault: true,
    updatedAt: 0,
  };
}

export const DEFAULT_VISION_CONFIG: VisionProfile = makeDefaultProfile();

type State = { profiles: VisionProfile[]; activeId: string };

function migrateLegacy(): VisionProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VisionProfile>;
    const base = makeDefaultProfile();
    return {
      ...base,
      ...parsed,
      id: "default",
      name: "Senior Architect Gözcü",
      isDefault: true,
      voiceMode: (parsed.voiceMode as VisionVoiceMode) ?? base.voiceMode,
      voiceLang: (parsed.voiceLang as VisionVoiceLang) ?? base.voiceLang,
      contextLabel: parsed.contextLabel ?? base.contextLabel,
      extra: Array.isArray(parsed.extra) ? parsed.extra : [],
    };
  } catch {
    return null;
  }
}

function loadState(): State {
  if (typeof window === "undefined") {
    return { profiles: [makeDefaultProfile()], activeId: "default" };
  }
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<State>;
      const rawProfiles = Array.isArray(parsed.profiles) && parsed.profiles.length
        ? parsed.profiles.map(normalize)
        : [makeDefaultProfile()];
      // One-shot migration: replace stale TR-seeded default profile with the
      // English default. Only touches the built-in `default` profile when its
      // name/prompt still matches the legacy Turkish seeds — custom profiles
      // and user-modified defaults are left intact.
      const profiles = rawProfiles.map((p) => {
        if (p.id !== "default") return p;
        const isLegacyTR =
          p.name === LEGACY_TR_NAME ||
          p.systemPrompt?.startsWith(LEGACY_TR_PROMPT_PREFIX) ||
          p.userPromptTemplate === LEGACY_TR_USER_PROMPT;
        if (!isLegacyTR) return p;
        return { ...makeDefaultProfile(), updatedAt: Date.now() };
      });
      const activeId = profiles.find((p) => p.id === parsed.activeId)?.id
        ?? profiles.find((p) => p.isDefault)?.id
        ?? profiles[0].id;
      return { profiles, activeId };
    }
    const legacy = migrateLegacy();
    if (legacy) return { profiles: [legacy], activeId: legacy.id };
  } catch { /* fallthrough */ }
  return { profiles: [makeDefaultProfile()], activeId: "default" };
}

function normalize(p: Partial<VisionProfile>): VisionProfile {
  const base = makeDefaultProfile();
  return {
    ...base,
    ...p,
    id: p.id || `vp-${Math.random().toString(36).slice(2, 8)}`,
    name: p.name || "Adsız Profil",
    extra: Array.isArray(p.extra) ? p.extra : [],
    voiceMode: (p.voiceMode as VisionVoiceMode) ?? base.voiceMode,
    voiceLang: (p.voiceLang as VisionVoiceLang) ?? base.voiceLang,
    contextLabel: p.contextLabel ?? base.contextLabel,
    isDefault: !!p.isDefault,
  };
}

function persist(state: State) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PROFILES_KEY, JSON.stringify(state)); } catch { /* */ }
}

// extra repeater → düz objeye dönüştür (sayı/bool tahmini)
export function extraToObject(extra: VisionExtraParam[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, value } of extra) {
    const k = (key || "").trim();
    if (!k) continue;
    const v = (value ?? "").trim();
    if (v === "") { out[k] = ""; continue; }
    if (v === "true") { out[k] = true; continue; }
    if (v === "false") { out[k] = false; continue; }
    if (!Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) { out[k] = Number(v); continue; }
    out[k] = v;
  }
  return out;
}

export function buildVisionPayload(cfg: VisionProfile): Record<string, unknown> {
  return {
    systemPrompt: cfg.systemPrompt,
    prompt: cfg.userPromptTemplate,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    maxFrames: cfg.maxFrames,
    timeoutMs: cfg.timeoutMs,
    extra: extraToObject(cfg.extra),
  };
}

type Ctx = {
  // Aktif profile bağlı geri-uyumlu API:
  config: VisionProfile;
  set: (patch: Partial<VisionProfile>) => void;
  reset: () => void;
  snapshot: () => VisionProfile;

  // Profil yönetimi:
  profiles: VisionProfile[];
  activeId: string;
  selectProfile: (id: string) => void;
  createProfile: (seed?: Partial<VisionProfile>) => VisionProfile;
  updateProfile: (id: string, patch: Partial<VisionProfile>) => void;
  deleteProfile: (id: string) => void;
  setDefaultProfile: (id: string) => void;
  pushActive: () => Promise<void>;
};

const VisionConfigContext = createContext<Ctx | null>(null);

export function VisionConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => loadState());
  const ref = useRef(state);
  useEffect(() => { ref.current = state; }, [state]);

  const active = useMemo(
    () => state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0],
    [state],
  );

  // Boot'ta aktif profili bir kez Mac'e mühürle (server cache cold).
  useEffect(() => {
    if (active) void VisionConfigAPI.push(buildVisionPayload(active)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writeState = useCallback((next: State, pushActiveProfile = true) => {
    persist(next);
    setState(next);
    if (pushActiveProfile) {
      const a = next.profiles.find((p) => p.id === next.activeId);
      if (a) void VisionConfigAPI.push(buildVisionPayload(a)).catch(() => {});
    }
  }, []);

  const set = useCallback((patch: Partial<VisionProfile>) => {
    setState((prev) => {
      const profiles = prev.profiles.map((p) =>
        p.id === prev.activeId ? { ...p, ...patch, updatedAt: Date.now() } : p,
      );
      const next = { ...prev, profiles };
      persist(next);
      const a = next.profiles.find((p) => p.id === next.activeId);
      if (a) void VisionConfigAPI.push(buildVisionPayload(a)).catch(() => {});
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState((prev) => {
      const fresh = { ...makeDefaultProfile(), id: prev.activeId, isDefault: prev.profiles.find(p => p.id === prev.activeId)?.isDefault ?? false, updatedAt: Date.now() };
      const profiles = prev.profiles.map((p) => p.id === prev.activeId ? fresh : p);
      const next = { ...prev, profiles };
      persist(next);
      void VisionConfigAPI.push(buildVisionPayload(fresh)).catch(() => {});
      return next;
    });
  }, []);

  const selectProfile = useCallback((id: string) => {
    setState((prev) => {
      if (!prev.profiles.find((p) => p.id === id)) return prev;
      const next = { ...prev, activeId: id };
      persist(next);
      const a = next.profiles.find((p) => p.id === id)!;
      void VisionConfigAPI.push(buildVisionPayload(a)).catch(() => {});
      return next;
    });
  }, []);

  const createProfile = useCallback((seed?: Partial<VisionProfile>): VisionProfile => {
    const id = (seed?.id?.trim()) || `vp-${Math.random().toString(36).slice(2, 8)}`;
    const profile = normalize({ ...makeDefaultProfile(), ...seed, id, isDefault: false, updatedAt: Date.now() });
    setState((prev) => {
      if (prev.profiles.some((p) => p.id === id)) return prev;
      const next = { profiles: [...prev.profiles, profile], activeId: id };
      writeState(next);
      return next;
    });
    return profile;
  }, [writeState]);

  const updateProfile = useCallback((id: string, patch: Partial<VisionProfile>) => {
    setState((prev) => {
      const profiles = prev.profiles.map((p) => p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p);
      const next = { ...prev, profiles };
      persist(next);
      if (id === prev.activeId) {
        const a = profiles.find((p) => p.id === id)!;
        void VisionConfigAPI.push(buildVisionPayload(a)).catch(() => {});
      }
      return next;
    });
  }, []);

  const deleteProfile = useCallback((id: string) => {
    setState((prev) => {
      const target = prev.profiles.find((p) => p.id === id);
      if (!target || target.isDefault || prev.profiles.length <= 1) return prev;
      const profiles = prev.profiles.filter((p) => p.id !== id);
      const activeId = prev.activeId === id
        ? (profiles.find((p) => p.isDefault)?.id ?? profiles[0].id)
        : prev.activeId;
      const next = { profiles, activeId };
      writeState(next);
      return next;
    });
  }, [writeState]);

  const setDefaultProfile = useCallback((id: string) => {
    setState((prev) => {
      const profiles = prev.profiles.map((p) => ({ ...p, isDefault: p.id === id }));
      const next = { ...prev, profiles };
      writeState(next, false);
      return next;
    });
  }, [writeState]);

  const pushActive = useCallback(async () => {
    const a = ref.current.profiles.find((p) => p.id === ref.current.activeId);
    if (!a) return;
    await VisionConfigAPI.push(buildVisionPayload(a)).catch(() => {});
  }, []);

  const snapshot = useCallback(() => {
    return ref.current.profiles.find((p) => p.id === ref.current.activeId) ?? ref.current.profiles[0];
  }, []);

  const value = useMemo<Ctx>(() => ({
    config: active,
    set, reset, snapshot,
    profiles: state.profiles,
    activeId: state.activeId,
    selectProfile, createProfile, updateProfile, deleteProfile, setDefaultProfile, pushActive,
  }), [active, set, reset, snapshot, state, selectProfile, createProfile, updateProfile, deleteProfile, setDefaultProfile, pushActive]);

  return <VisionConfigContext.Provider value={value}>{children}</VisionConfigContext.Provider>;
}

export function useVisionConfig(): Ctx {
  const ctx = useContext(VisionConfigContext);
  if (!ctx) throw new Error("useVisionConfig must be used within VisionConfigProvider");
  return ctx;
}
