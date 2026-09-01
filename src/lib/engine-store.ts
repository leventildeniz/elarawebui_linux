import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "./api";

/**
 * System Engine configuration — Intent Router + Orchestrator Bridge.
 * Persisted in Postgres (app_system_config) under key 'engine_policy'.
 */

export type ClassifierMode = "embedding" | "llm" | "hybrid";
export type RagMode = "auto" | "always" | "never";
export type GuardOverride = "auto" | "force-on" | "force-off";
export type RuntimeProvider = "legacy" | "custom";

export const runtimePresets: Record<
  RuntimeProvider,
  { label: string; baseUrl: string; note: string }
> = {
  legacy: { label: "LEGACY", baseUrl: "http://127.0.0.1:11434", note: "Legacy HTTP endpoint" },
  custom: { label: "CUSTOM", baseUrl: "", note: "Your own endpoint" },
};

export type EngineConfig = {
  /* runtime provider */
  runtimeProvider: RuntimeProvider;
  baseUrlOverride: string;
  activeModelId: string;
  /* intent router */
  bypassEnabled: boolean;
  similarity: number;
  classifier: ClassifierMode;
  classifierPrompt: string;
  ragMode: RagMode;
  /* orchestrator bridge */
  guard: GuardOverride;
  allowedAgents: string;
  allowedTools: string;
  disarmedTools: string;
  /* deny lists — empty = everything permitted */
  deniedAgents: string;
  deniedTools: string;
  deniedSkills: string;
  deniedMcp: string;
};

export const defaultClassifierPrompt =
  "Classify the user message below. If it needs the Library/RAG (technical docs, network, security, product/device configuration, error/log analysis, version, CVE, etc.), reply with a single word: RAG. If it is a greeting, social small-talk, or personal chit-chat, reply with a single word: CHAT. Output only RAG or CHAT — nothing else.";

export const defaultEngine: EngineConfig = {
  runtimeProvider: "legacy",
  baseUrlOverride: "http://127.0.0.1:11434",
  activeModelId: "qwen2.5:72b",
  bypassEnabled: false,
  similarity: 0.35,
  classifier: "hybrid",
  classifierPrompt: defaultClassifierPrompt,
  ragMode: "auto",
  guard: "auto",
  allowedAgents: "",
  allowedTools: "",
  disarmedTools: "",
  deniedAgents: "",
  deniedTools: "",
  deniedSkills: "",
  deniedMcp: "",
};

export function useEngine() {
  const [config, setConfig] = useState<EngineConfig>(defaultEngine);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi("/api/engine-config");
      if (data && typeof data === "object") {
        setConfig({
          runtimeProvider: data.runtime_provider || defaultEngine.runtimeProvider,
          baseUrlOverride: data.base_url_override || defaultEngine.baseUrlOverride,
          activeModelId: data.active_model_id || defaultEngine.activeModelId,
          bypassEnabled: !!data.bypass_enabled,
          similarity: data.similarity !== undefined ? Number(data.similarity) : defaultEngine.similarity,
          classifier: (data.classifier as ClassifierMode) || defaultEngine.classifier,
          classifierPrompt: data.classifier_prompt || defaultEngine.classifierPrompt,
          ragMode: (data.rag_mode as RagMode) || defaultEngine.ragMode,
          guard: (data.guard as GuardOverride) || defaultEngine.guard,
          allowedAgents: data.allowed_agents || "",
          allowedTools: data.allowed_tools || "",
          disarmedTools: data.disarmed_tools || "",
          deniedAgents: data.denied_agents || "",
          deniedTools: data.denied_tools || "",
          deniedSkills: data.denied_skills || "",
          deniedMcp: data.denied_mcp || ""
        });
      }
    } catch (e) {
      console.error("Failed to load engine policy", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const update = useCallback(
    async (patch: Partial<EngineConfig>) => {
      const next = { ...config, ...patch };
      setConfig(next); // optimistic
      try {
        const payload = {
          runtime_provider: next.runtimeProvider,
          base_url_override: next.baseUrlOverride,
          active_model_id: next.activeModelId,
          bypass_enabled: next.bypassEnabled,
          similarity: next.similarity,
          classifier: next.classifier,
          classifier_prompt: next.classifierPrompt,
          rag_mode: next.ragMode,
          guard: next.guard,
          allowed_agents: next.allowedAgents,
          allowed_tools: next.allowedTools,
          disarmed_tools: next.disarmedTools,
          denied_agents: next.deniedAgents,
          denied_tools: next.deniedTools,
          denied_skills: next.deniedSkills,
          denied_mcp: next.deniedMcp
        };
        await fetchApi("/api/engine-config", {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } catch (e) {
        console.error("Failed to save engine policy", e);
        loadData(); // Resync on error
      }
    },
    [config, loadData],
  );

  const reset = useCallback(async () => {
    const keys: (keyof EngineConfig)[] = [
      "allowedAgents",
      "allowedTools",
      "disarmedTools",
      "deniedAgents",
      "deniedTools",
      "deniedSkills",
      "deniedMcp",
    ];
    
    const patch = Object.fromEntries(keys.map((k) => [k, defaultEngine[k]]));
    await update(patch);
  }, [update]);

  return { config, update, reset, loading };
}
