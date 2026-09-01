// Tur-5.6 — Unified per-row Brain / Interpreter pickers.
// Used by Forge (tools), Skills, and Capability Packs editors so every surface
// presents the SAME UX as the Agents editor. Each instance is independent —
// picking a model for one tool does NOT affect any other tool/skill/pack.
//
// Value contract (matches agents.model semantics):
//   - Local model → stored as the bare modelName (e.g. "elara-LOCAL")
//   - Cloud provider → stored as "provider:<providerId>"
//   - Empty string when unset
import { useEffect, useMemo, useState } from "react";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  SystemAPI, ProvidersAPI, AgentsAPI,
  type ModelDTO, type AiProviderDTO, type InterpreterInfo,
} from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Shared in-memory caches — these lists change rarely; fetch once per page.
// ---------------------------------------------------------------------------
let _models: ModelDTO[] | null = null;
let _providers: AiProviderDTO[] | null = null;
let _interpreters: InterpreterInfo[] | null = null;
const _modelsSubs = new Set<() => void>();
const _providersSubs = new Set<() => void>();
const _interpretersSubs = new Set<() => void>();

function useBrainSources() {
  const [models, setModels] = useState<ModelDTO[]>(_models ?? []);
  const [providers, setProviders] = useState<AiProviderDTO[]>(_providers ?? []);
  useEffect(() => {
    const tickM = () => setModels(_models ?? []);
    const tickP = () => setProviders(_providers ?? []);
    _modelsSubs.add(tickM); _providersSubs.add(tickP);
    if (_models == null) {
      SystemAPI.listModels()
        .then((r) => { _models = r; _modelsSubs.forEach((f) => f()); })
        .catch(() => { _models = []; _modelsSubs.forEach((f) => f()); });
    }
    if (_providers == null) {
      ProvidersAPI.list()
        .then((r) => { _providers = r; _providersSubs.forEach((f) => f()); })
        .catch(() => { _providers = []; _providersSubs.forEach((f) => f()); });
    }
    return () => { _modelsSubs.delete(tickM); _providersSubs.delete(tickP); };
  }, []);
  return { models, providers };
}

function useInterpreters() {
  const [items, setItems] = useState<InterpreterInfo[]>(_interpreters ?? []);
  useEffect(() => {
    const tick = () => setItems(_interpreters ?? []);
    _interpretersSubs.add(tick);
    if (_interpreters == null) {
      AgentsAPI.interpreters()
        .then((r) => { _interpreters = r.interpreters || []; _interpretersSubs.forEach((f) => f()); })
        .catch(() => { _interpreters = []; _interpretersSubs.forEach((f) => f()); });
    }
    return () => { _interpretersSubs.delete(tick); };
  }, []);
  return items;
}

// ---------------------------------------------------------------------------
// BrainSelect — local model or active provider.
// ---------------------------------------------------------------------------
export function BrainSelect({
  value, onChange, placeholder = "Select brain…", disabled,
}: {
  value: string;
  onChange: (resolved: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { models, providers } = useBrainSources();
  const activeProviders = useMemo(
    () => providers.filter((p) => p.isActive !== false),
    [providers],
  );

  // Map stored raw value → Select internal prefixed value.
  const selectValue = useMemo(() => {
    if (!value) return "";
    if (value.startsWith("provider:")) return value;
    const m = models.find((x) => x.modelName === value || x.id === value);
    return m ? `model:${m.id}` : "";
  }, [value, models]);

  const handleChange = (v: string) => {
    if (!v) { onChange(""); return; }
    if (v.startsWith("provider:")) { onChange(v); return; }
    if (v.startsWith("model:")) {
      // Persist the immutable models.id (not modelName). Display layer still
      // shows modelName via the models lookup in selectValue. This decouples
      // agent/tool/skill/pack brain refs from cosmetic rename in the Models tab.
      const id = v.slice(6);
      onChange(id);
    }
  };

  return (
    <Select value={selectValue} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {models.length === 0 && activeProviders.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No local models or active providers — add in Models / Settings
          </div>
        )}
        {models.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase font-mono text-primary">Local models</SelectLabel>
            {models.map((m) => (
              <SelectItem key={`m-${m.id}`} value={`model:${m.id}`}>
                <div className="flex flex-col leading-tight">
                  <span>{m.modelName} · {m.provider}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">id: {m.id}</span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {activeProviders.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase font-mono text-muted-foreground">Active providers</SelectLabel>
            {activeProviders.map((p) => (
              <SelectItem key={`p-${p.id}`} value={`provider:${p.id}`}>
                <div className="flex flex-col leading-tight">
                  <span>{p.providerName} · {p.kind}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">id: {p.id}</span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// InterpreterSelect — venv / conda / system Python discovery list.
// ---------------------------------------------------------------------------
export function InterpreterSelect({
  value, onChange, placeholder = "Select interpreter…", disabled,
}: {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const interpreters = useInterpreters();
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {interpreters.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No interpreters discovered — install via Agents tab
          </div>
        )}
        {interpreters.map((i) => (
          <SelectItem key={i.path} value={i.path}>
            <span className="font-mono text-xs">[{i.kind}] {i.path} · {i.version}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
