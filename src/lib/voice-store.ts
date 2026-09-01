import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "./api";

export type VoiceEngine = "local" | "gateway" | "custom";

export type VoiceProfile = {
  id: string;
  lang: "tr" | "en";
  label: string;
  engine: VoiceEngine;
  voiceUri: string;
  rate: number;
  pitch: number;
  isDefault: boolean;
  createdAt: number;
};

export const voiceEngines: { id: VoiceEngine; label: string }[] = [
  { id: "local", label: "Local (browser TTS)" },
  { id: "gateway", label: "Elara Gateway TTS" },
  { id: "custom", label: "Custom endpoint" },
];

export const emptyVoiceProfile: Omit<VoiceProfile, "id" | "createdAt"> = {
  lang: "en",
  label: "",
  engine: "local",
  voiceUri: "",
  rate: 1,
  pitch: 1,
  isDefault: false,
};

const SPEED_KEY = "sovereign.voice.speed";
const EVT = "sovereign:voice";

export function useVoiceProfiles() {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [speed, setSpeedState] = useState(1);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi("/voice-profiles");
      if (Array.isArray(data)) {
        setProfiles(data);
      }
    } catch (err) {
      console.error("Failed to fetch voice profiles", err);
    } finally {
      setLoading(false);
    }
    
    // Sync speed from localStorage (this remains local preference)
    if (typeof window !== "undefined") {
      setSpeedState(Number(window.localStorage.getItem(SPEED_KEY) ?? "1") || 1);
    }
  }, []);

  useEffect(() => {
    loadData();
    const handleEvt = () => {
      if (typeof window !== "undefined") {
        setSpeedState(Number(window.localStorage.getItem(SPEED_KEY) ?? "1") || 1);
      }
    };
    window.addEventListener(EVT, handleEvt);
    return () => window.removeEventListener(EVT, handleEvt);
  }, [loadData]);

  const save = useCallback(async (draft: Partial<VoiceProfile>) => {
    try {
      const res = await fetchApi("/voice-profiles", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      if (res.ok && res.profile) {
        setProfiles((prev) => {
          let next = [...prev];
          // If updating existing
          if (draft.id) {
            next = next.map(p => p.id === draft.id ? res.profile : p);
          } else {
            next.push(res.profile);
          }
          // If made default, untoggle others of same language locally for optimistic UI
          if (res.profile.isDefault) {
             next = next.map(p => 
               (p.lang === res.profile.lang && p.id !== res.profile.id) 
                 ? { ...p, isDefault: false } 
                 : p
             );
          }
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to save voice profile", err);
      loadData(); // Re-sync on error
    }
  }, [loadData]);

  const remove = useCallback(async (id: string) => {
    try {
      // Optimistic
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      await fetchApi(`/voice-profiles/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error("Failed to delete voice profile", err);
      loadData();
    }
  }, [loadData]);

  const makeDefault = useCallback(async (id: string) => {
    const target = profiles.find((p) => p.id === id);
    if (!target) return;
    
    // Optimistic UI
    setProfiles((prev) => 
      prev.map(p => (p.lang === target.lang ? { ...p, isDefault: p.id === id } : p))
    );

    try {
      await fetchApi("/voice-profiles", {
        method: "POST",
        body: JSON.stringify({ ...target, isDefault: true }),
      });
    } catch (err) {
      console.error("Failed to set default voice profile", err);
      loadData();
    }
  }, [profiles, loadData]);

  const setSpeed = useCallback((v: number) => {
    setSpeedState(v);
    try {
      window.localStorage.setItem(SPEED_KEY, String(v));
      window.dispatchEvent(new CustomEvent(EVT));
    } catch {
      /* ignore */
    }
  }, []);

  return { profiles, speed, save, remove, makeDefault, setSpeed, loading };
}
