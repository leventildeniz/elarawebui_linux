import { useCallback, useEffect, useState } from "react";
import type { AvatarStyle, JewelName } from "@/lib/avatar-library";

export type VoiceLang = "tr" | "en";

export type VisionModel = {
  id: string;
  name: string;
  modelId: string;
  vendor: string;
  baseUrl: string;
  apiKeyRef: string;
  note: string;
  systemPrompt: string;
  maxImage: string;
  ocr: string;
  video: boolean;
  voice: boolean;
  voiceLang: VoiceLang;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  avatar: { seed: string; style: AvatarStyle; jewel: JewelName };
  createdAt: number;
};

export const voiceLanguages: { id: VoiceLang; label: string; hint: string }[] = [
  { id: "tr", label: "Turkish", hint: "tr-TR · Sovereign voice pack" },
  { id: "en", label: "English", hint: "en-US · Sovereign voice pack" },
];

const KEY = "sovereign.vision";
const DEFAULT_KEY = "sovereign.vision.default";

export const emptyVisionModel: Omit<VisionModel, "id" | "createdAt"> = {
  name: "",
  modelId: "",
  vendor: "",
  baseUrl: "",
  apiKeyRef: "",
  note: "",
  systemPrompt: "",
  maxImage: "4096 × 4096",
  ocr: "latin",
  video: false,
  voice: true,
  voiceLang: "en",
  temperature: 0.2,
  maxTokens: 800,
  enabled: true,
  avatar: { seed: "atlas", style: "prism", jewel: "sapphire" },
};

function read(): VisionModel[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as VisionModel[];
    if (!Array.isArray(parsed) || !parsed.length) return [];
    return parsed.map((m) => ({ ...emptyVisionModel, ...m }));
  } catch {
    return [];
  }
}

function readDefault(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(DEFAULT_KEY) ?? "";
}

function write(list: VisionModel[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  }
}

export function useVisionModels() {
  const [models, setModels] = useState<VisionModel[]>([]);
  const [defaultId, setDefaultIdState] = useState<string>("");

  useEffect(() => {
    const sync = () => {
      setModels(read());
      setDefaultIdState(readDefault());
    };
    sync();
    window.addEventListener("sovereign:vision", sync);
    return () => window.removeEventListener("sovereign:vision", sync);
  }, []);

  const create = useCallback((draft: Omit<VisionModel, "id" | "createdAt">) => {
    setModels((prev) => {
      const next = [
        ...prev,
        { ...draft, id: `vis.${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() },
      ];
      write(next);
      return next;
    });
  }, []);

  const update = useCallback((id: string, patch: Partial<VisionModel>) => {
    setModels((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, ...patch } : m));
      write(next);
      return next;
    });
  }, []);

  const remove = useCallback(
    (id: string) => {
      setModels((prev) => {
        const next = prev.filter((m) => m.id !== id);
        write(next);
        if (id === defaultId && next[0]) {
          window.localStorage.setItem(DEFAULT_KEY, next[0].id);
          setDefaultIdState(next[0].id);
        }
        return next;
      });
    },
    [defaultId],
  );

  const setDefault = useCallback((id: string) => {
    setDefaultIdState(id);
    try {
      window.localStorage.setItem(DEFAULT_KEY, id);
      window.dispatchEvent(new CustomEvent("sovereign:vision"));
    } catch {
      /* ignore */
    }
  }, []);

  return { models, defaultId, create, update, remove, setDefault };
}
