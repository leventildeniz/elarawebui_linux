// Voice profile store — per-language TTS identity (TR/EN/DE).
// Profiles are sourced from local PostgreSQL via VoiceProfilesAPI; no offline profile fallback.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { VoiceProfilesAPI, TTSAPI, isBridgeUnreachableContext, type VoiceProfileDTO } from "@/lib/api-client";

const LS_PB = "voice.playbackRate";

type Ctx = {
  profiles: VoiceProfileDTO[];
  voices: SpeechSynthesisVoice[];
  playbackRate: number;
  setPlaybackRate: (r: number) => void;
  refresh: () => Promise<void>;
  save: (p: Partial<VoiceProfileDTO>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Pick the right profile for a given language code (auto-falls back to default/en). */
  pick: (lang: string) => VoiceProfileDTO | null;
  /** Speak via local SpeechSynthesis using the profile assigned to `lang`. */
  speak: (text: string, lang?: string) => void | Promise<void>;
  cancel: () => void;
};

const VoiceCtx = createContext<Ctx>({
  profiles: [], voices: [], playbackRate: 1, setPlaybackRate: () => {},
  refresh: async () => {}, save: async () => {}, remove: async () => {},
  pick: () => null, speak: () => {}, cancel: () => {},
});

/** Detect language of a short text — TR varsayılan; sadece açık İngilizce işaretleri varsa EN. */
export function detectLang(text: string): string {
  const t = (text || "").slice(0, 800).toLowerCase();
  // Türkçe karakter veya yaygın TR kelime → TR
  if (/[şğıçöü]/.test(t) || /\b(ve|bir|için|ama|merhaba|nasıl|evet|hayır|değil|şu|bu)\b/.test(t)) return "tr";
  // Sadece güçlü EN sinyali varsa EN'e dön (TR karakter yok + birden fazla EN stop-word)
  const enHits = (t.match(/\b(the|and|is|are|was|were|with|that|this|of|for|you|have)\b/g) || []).length;
  if (enHits >= 3 && !/[şğıçöü]/.test(t)) return "en";
  return "tr";
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<VoiceProfileDTO[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [playbackRate, setPlaybackRateState] = useState<number>(1);
  // Playback preference only; profile data must come from the bridge.
  useEffect(() => {
    try {
      const r = Number(localStorage.getItem(LS_PB) || "1");
      if (r) setPlaybackRateState(r);
    } catch { /* */ }
  }, []);

  const setPlaybackRate = useCallback((r: number) => {
    setPlaybackRateState(r);
    if (typeof window !== "undefined") localStorage.setItem(LS_PB, String(r));
  }, []);

  // Load browser voices (async on some browsers).
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const refresh = useCallback(async () => {
    if (isBridgeUnreachableContext()) { setProfiles([]); return; }
    try { setProfiles(await VoiceProfilesAPI.list()); }
    catch (e) { console.warn("[voice profiles] bridge unavailable", e); setProfiles([]); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (p: Partial<VoiceProfileDTO>) => {
    await VoiceProfilesAPI.save(p);
    await refresh();
  }, [refresh]);
  const remove = useCallback(async (id: string) => {
    await VoiceProfilesAPI.remove(id);
    await refresh();
  }, [refresh]);

  const pick = useCallback((lang: string): VoiceProfileDTO | null => {
    const l = (lang || "tr").toLowerCase().slice(0, 2);
    const inLang = profiles.filter(p => p.lang === l);
    return inLang.find(p => p.isDefault) || inLang[0]
        || profiles.find(p => p.lang === "tr" && p.isDefault) || profiles.find(p => p.lang === "tr")
        || profiles.find(p => p.lang === "en" && p.isDefault) || profiles[0] || null;
  }, [profiles]);

  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async (text: string, lang?: string) => {
    if (!text) return;
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch { /* */ } audioElRef.current = null; }
    const detected = lang || detectLang(text);
    const profile = pick(detected);
    // Premium path → server-side TTS (OpenAI/GCloud) returning an MP3 blob.
    if (profile?.engine === "premium" && (profile.premiumProvider === "openai" || profile.premiumProvider === "gcloud")) {
      const blob = await TTSAPI.synthesize(text, { lang: detected, provider: profile.premiumProvider, voice: profile.voiceUri });
      if (blob) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = (profile.rate ?? 1) * playbackRate;
        audioElRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); if (audioElRef.current === audio) audioElRef.current = null; };
        try { await audio.play(); return; } catch { /* fall through to local */ }
      }
    }
    // Browser speech output is a client capability; voice profile data is not faked.
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text.slice(0, 4000));
    u.lang = detected === "tr" ? "tr-TR" : "en-US";
    u.rate = (profile?.rate ?? 1) * playbackRate;
    u.pitch = profile?.pitch ?? 1;
    if (profile?.voiceUri && profile.voiceUri !== "default") {
      const v = voices.find(x => x.voiceURI === profile.voiceUri || x.name === profile.voiceUri);
      if (v) u.voice = v;
    } else {
      const v = voices.find(x => x.lang.toLowerCase().startsWith(detected));
      if (v) u.voice = v;
    }
    try { window.speechSynthesis.resume(); } catch { /* */ }
    window.speechSynthesis.speak(u);
  }, [pick, voices, playbackRate]);

  const cancel = useCallback(() => {
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch { /* */ } audioElRef.current = null; }
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try { window.speechSynthesis.cancel(); } catch { /* */ }
  }, []);

  const value = useMemo<Ctx>(() => ({
    profiles, voices, playbackRate, setPlaybackRate,
    refresh, save, remove, pick, speak, cancel,
  }), [profiles, voices, playbackRate, setPlaybackRate, refresh, save, remove, pick, speak, cancel]);

  return <VoiceCtx.Provider value={value}>{children}</VoiceCtx.Provider>;
}

export const useVoice = () => useContext(VoiceCtx);
