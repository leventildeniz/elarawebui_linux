import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Plus, Cpu, Minus, Star, Trash2, Radar, PlugZap, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useSystem, type ModelEntry } from "@/lib/system-store";
import { SystemAPI, type ModelProbeResult, type RuntimeSafetyDTO, type ChatTemplateFamilyDTO, type TransportOptionDTO } from "@/lib/api-client";
import { useModelIdentity } from "@/lib/model-identity-store";
import { AvatarPicker } from "@/components/avatar-picker";
import { ModelParamPresets, PRESET_NAMES } from "@/components/model-param-presets";
import { VisionConsole } from "@/components/vision-console";
import { VisionProfilesList } from "@/components/vision-profiles-list";
import { VisionServiceCard } from "@/components/vision-service-card";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/models")({ component: ModelsPage });

const PROVIDERS = ["LOCAL", "Legacy HTTP", "vLLM", "Remote", "Anthropic", "QWEN", "DeepSeek"];
const EMPTY_PROMPT = "";

interface KV { id: string; name: string; value: string; }

type DraftModel = ModelEntry & { systemPrompt: string; params: KV[] };
type RuntimeSafetyKey = keyof RuntimeSafetyDTO;

const RUNTIME_SAFETY_FIELDS: { key: RuntimeSafetyKey; label: string; hint: string; min: number; step: number; placeholder: string }[] = [
  { key: "headersMs", label: "Headers timeout", hint: "LOCAL response headers wait. Long technical prompts hit this before any token exists.", min: 1000, step: 1000, placeholder: "inherit" },
  { key: "firstTokenMs", label: "First token timeout", hint: "Headers arrived; maximum wait for the first generated token.", min: 1000, step: 1000, placeholder: "inherit" },
  { key: "idleDeltaMs", label: "Idle delta timeout", hint: "Maximum gap between token chunks after generation starts.", min: 1000, step: 1000, placeholder: "inherit" },
  { key: "warmingNoticeMs", label: "Warming notice", hint: "When the UI shows model warming while prefill is still running.", min: 500, step: 500, placeholder: "inherit" },
  { key: "coldFirstTokenMs", label: "Cold first token", hint: "Extra first-token budget when the model is cold or freshly swapped.", min: 1000, step: 1000, placeholder: "inherit" },
  { key: "streamTimeoutMs", label: "Total stream timeout", hint: "Hard ceiling for one model answer from request start to finish.", min: 5000, step: 5000, placeholder: "inherit" },
  { key: "warmupTimeoutMs", label: "Warmup timeout", hint: "Budget for optional warmup probes before real traffic.", min: 5000, step: 5000, placeholder: "inherit" },
];

function cleanRuntimeSafety(input?: RuntimeSafetyDTO): RuntimeSafetyDTO {
  const out: RuntimeSafetyDTO = {};
  for (const f of RUNTIME_SAFETY_FIELDS) {
    const n = Number(input?.[f.key]);
    out[f.key] = Number.isFinite(n) && n >= f.min ? Math.floor(n) : null;
  }
  return out;
}

const emptyDraft = (): DraftModel => ({
  id: "",
  modelName: "",
  provider: "LOCAL",
  base: "http://127.0.0.1:",
  ctx: 8192,
  status: "offline",
  source: "manual",
  systemPrompt: EMPTY_PROMPT,
  params: [],
  ragEnabled: true,
  runtimeSafety: cleanRuntimeSafety(),
  transport: "local_local",
  apiKeyEnv: "",
  inspectorDirective: "",
});

function normalizeModel(model: ModelEntry): DraftModel {
  return {
    ...model,
    modelName: model.modelName || model.id.split(/[\\/]/).filter(Boolean).pop() || model.id,
    status: model.status === "loaded" ? "ready" : model.status,
    systemPrompt: model.systemPrompt ?? EMPTY_PROMPT,
    params: Array.isArray(model.params) ? model.params : [],
    ragEnabled: model.ragEnabled !== false,
    runtimeSafety: cleanRuntimeSafety(model.runtimeSafety),
    loopGuard: model.loopGuard ?? null,
    transport: model.transport ?? "local_local",
    apiKeyEnv: model.apiKeyEnv ?? "",
    inspectorDirective: model.inspectorDirective ?? "",
  };
}

const modelLabel = (m: Pick<ModelEntry, "id" | "modelName">) => m.modelName || m.id.split(/[\\/]/).filter(Boolean).pop() || m.id;

function ModelsPage() {
  const { t, locale } = useI18n();
  const { models, setModels } = useSystem();
  const identity = useModelIdentity();
  const [selId, setSelId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastProbe, setLastProbe] = useState<ModelProbeResult | null>(null);
  const [editor, setEditor] = useState<DraftModel>(emptyDraft);

  const sel = useMemo(() => models.find((m) => m.id === selId) ?? models[0], [models, selId]);

  const hydrateModels = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await SystemAPI.listModels();
      const next = rows.map<ModelEntry>((m) => ({
        id: m.id,
        modelName: m.modelName,
        provider: m.provider,
        base: m.base,
        ctx: m.ctx,
        status: m.status,
        isDefault: m.isDefault,
        source: m.source,
        systemPrompt: m.systemPrompt,
        params: m.params,
        ragEnabled: m.ragEnabled,
        templateFamily: m.templateFamily,
        promptPrefix: m.promptPrefix,
        stopSequences: m.stopSequences,
        chatTemplateKwargs: m.chatTemplateKwargs,
        runtimeSafety: cleanRuntimeSafety(m.runtimeSafety),
        runtimeModelId: m.runtimeModelId ?? "",
        loopGuard: m.loopGuard ?? null,
        transport: m.transport ?? "local_local",
        apiKeyEnv: m.apiKeyEnv ?? "",
        inspectorDirective: m.inspectorDirective ?? "",
      }));

      setModels(next);
      setSelId((current) => current || next[0]?.id || "");
    } catch (e) {
      toast.error(`${"Bridge Connection Error"}: ${(e as Error).message}`);
      setModels([]);
      setSelId("");
    } finally {
      setLoading(false);
    }
  }, [setModels]);

  useEffect(() => { void hydrateModels(); }, [hydrateModels]);

  useEffect(() => {
    if (!sel) {
      setEditor(emptyDraft());
      setLastProbe(null);
      return;
    }
    setEditor(normalizeModel(sel));
    setLastProbe(null);
  }, [sel?.id]);

  const addP = () => setEditor((m) => ({
    ...m,
    params: [...m.params, { id: `p${Date.now()}`, name: "", value: "" }],
  }));
  const rmP = (id: string) => setEditor((m) => ({ ...m, params: m.params.filter((x) => x.id !== id) }));
  const updP = (id: string, f: "name" | "value", v: string) =>
    setEditor((m) => ({ ...m, params: m.params.map((x) => (x.id === id ? { ...x, [f]: v } : x)) }));

  const testConnection = async (model = editor) => {
    setTesting(true);
    try {
      const result = await SystemAPI.testModel({ provider: model.provider, baseUrl: model.base });
      setLastProbe(result);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      return result;
    } catch (e) {
      const result = { ok: false, message: String((e as Error).message ?? e), latencyMs: 0 };
      setLastProbe(result);
      toast.error(result.message);
      return result;
    } finally {
      setTesting(false);
    }
  };

  const saveModel = async (model: DraftModel, closeDialog?: () => void) => {
    // Defensive normalize — sampling presets, preset-cleared rows, and partial
    // DB payloads can leave fields undefined. Never call .trim() on a raw field
    // (caused: "Cannot read properties of undefined (reading 'trim')").
    const safe = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const idTrim = safe(model.id);
    if (!idTrim) { toast.error("Model ID required"); return; }
    if (/^[/~.]|^[A-Za-z]:[\\/]/.test(idTrim)) { toast.error("Model ID cannot be a filesystem path. Use the repo slug the runtime exposes at /v1/models (e.g. local-community/Qwen3-32B-4bit)."); return; }
    if (!safe(model.base)) { toast.error("Base URL required"); return; }
    setSaving(true);
    try {
      // Strip enable_thinking from raw kwargs — the Switch is the sole authority.
      const rawKwargs = (model.chatTemplateKwargs && typeof model.chatTemplateKwargs === "object" && !Array.isArray(model.chatTemplateKwargs))
        ? { ...(model.chatTemplateKwargs as Record<string, unknown>) }
        : {};
      const cleanParams = (Array.isArray(model.params) ? model.params : [])
        .map((p) => ({
          id: typeof p?.id === "string" && p.id ? p.id : `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          name: safe(p?.name),
          value: safe(p?.value),
        }))
        .filter((p) => p.name.length > 0);
      const saved = await SystemAPI.saveModel({
        id: idTrim,
        modelName: safe(model.modelName) || modelLabel(model),
        provider: safe(model.provider),
        base: safe(model.base),
        ctx: Number(model.ctx) || 8192,
        systemPrompt: typeof model.systemPrompt === "string" ? model.systemPrompt : "",
        params: cleanParams,
        isDefault: !!model.isDefault,
        ragEnabled: model.ragEnabled !== false,

        source: model.source ?? "manual",
        templateFamily: safe(model.templateFamily),
        promptPrefix: typeof model.promptPrefix === "string" ? model.promptPrefix : "",
        stopSequences: Array.isArray(model.stopSequences) ? model.stopSequences : [],
        chatTemplateKwargs: rawKwargs,
        runtimeSafety: cleanRuntimeSafety(model.runtimeSafety),
        runtimeModelId: safe(model.runtimeModelId),
        loopGuard: model.loopGuard ?? null,
        transport: model.transport ?? "local_local",
        apiKeyEnv: safe(model.apiKeyEnv),
        inspectorDirective: typeof model.inspectorDirective === "string" ? model.inspectorDirective : "",
      });

      setLastProbe(saved.probe ?? null);
      // Eğer bu kayıt default olarak işaretlendiyse, server zaten diğerlerini
      // unset etti (server.mjs:5161/5289). Lokal listede de optimistic clear
      // yaparak UI'da iki star görünmesini engelle.
      const others = models
        .filter((m) => m.id !== saved.model.id)
        .map((m) => (saved.model.isDefault ? { ...m, isDefault: false } : m));
      setModels([saved.model, ...others]);
      setSelId(saved.model.id);
      setEditor(normalizeModel(saved.model));
      closeDialog?.();
      // Sunucudan tek-default kuralının uygulandığını teyit etmek için
      // arka planda tazele (race'siz son söz).
      void hydrateModels();
      if (saved.probe?.ok === false) {
        toast.warning(`Model sealed · runtime offline: ${saved.probe.message ?? "LOCAL unreachable"}`);
      } else {
        toast.success("Model sealed to PostgreSQL");
      }
    } catch (e) {
      toast.error(`${"Save failed"}: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const removeModel = async (id: string) => {
    try {
      await SystemAPI.deleteModel(id);
      const next = models.filter((m) => m.id !== id);
      setModels(next);
      setSelId(next[0]?.id ?? "");
      toast.success("Model removed from PostgreSQL");
    } catch (e) {
      toast.error(`${"Delete failed"}: ${(e as Error).message}`);
    }
  };

  const setDefault = async () => {
    if (!sel) return;
    await saveModel({ ...editor, isDefault: true });
  };

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftModel>(emptyDraft);
  const [draftProbe, setDraftProbe] = useState<ModelProbeResult | null>(null);

  const testDraft = async () => {
    setTesting(true);
    try {
      const result = await SystemAPI.testModel({ provider: draft.provider, baseUrl: draft.base });
      setDraftProbe(result);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      return result;
    } finally {
      setTesting(false);
    }
  };

  const addModel = async () => {
    if (models.some((m) => m.id === draft.id)) { toast.error("Duplicate id"); return; }
    setLastProbe(draftProbe);
    await saveModel(draft, () => {
      setOpen(false);
      setDraft(emptyDraft());
      setDraftProbe(null);
    });
  };

  type ScanCandidate = { id: string; modelName?: string; provider: string; base: string; ctx: number };
  const [scanning, setScanning] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[]>([]);
  const [scanPicked, setScanPicked] = useState<Set<string>>(new Set());
  const [scanAdding, setScanAdding] = useState(false);

  const scan = async () => {
    setScanning(true);
    try {
      const found = await SystemAPI.scanLocalModels();
      const known = new Set(models.map((m) => m.id));
      const added = found.filter((f) => !known.has(f.id));
      if (added.length === 0) { toast("No new local models"); return; }
      setScanCandidates(added);
      setScanPicked(new Set()); // default: none selected — operator picks
      setScanOpen(true);
    } catch (e) {
      toast.error(`${"Scan failed"}: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  };

  const addPickedFromScan = async () => {
    const picks = scanCandidates.filter((c) => scanPicked.has(c.id));
    if (picks.length === 0) { setScanOpen(false); return; }
    setScanAdding(true);
    try {
      for (const f of picks) {
        await saveModel(normalizeModel({
          ...f,
          modelName: f.modelName || f.id.split(/[\\/]/).filter(Boolean).pop() || f.id,
          status: "ready",
          source: "scanned",
          systemPrompt: EMPTY_PROMPT,
          params: [],
          runtimeSafety: cleanRuntimeSafety(),
        } as ModelEntry));
      }
      await hydrateModels();
      toast.success(`${picks.length} model${picks.length === 1 ? "" : "s"} added`);
      setScanOpen(false);
    } catch (e) {
      toast.error(`${"Add failed"}: ${(e as Error).message}`);
    } finally {
      setScanAdding(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={t("page.models.title")}
        subtitle={t("page.models.subtitle")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={scan} disabled={scanning || saving}>
              <Radar className="h-4 w-4 mr-1" />{scanning ? "Scanning…" : "Scan Local"}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-primary text-primary-foreground">
                  <Plus className="h-4 w-4 mr-1" />{t("models.register")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{t("models.register")}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Field label="Model ID" value={draft.id} on={(v) => setDraft({ ...draft, id: v })} placeholder="qwen2.5:72b" />
                  <Field label="Model Name" value={draft.modelName} on={(v) => setDraft({ ...draft, modelName: v })} placeholder="qwen2.5-72b" />
                  <Field label="Provider" value={draft.provider} on={(v) => setDraft({ ...draft, provider: v })} />
                  <Field label="Base URL" value={draft.base} on={(v) => setDraft({ ...draft, base: v })} />
                  <Field label="Context Length" type="number" value={String(draft.ctx)} on={(v) => setDraft({ ...draft, ctx: Number(v) || 0 })} />
                  <div>
                    <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("models.system_prompt")}</Label>
                    <textarea
                      value={draft.systemPrompt}
                      onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                      className="w-full mt-2 h-24 p-3 rounded-md bg-card/50 border border-border text-sm font-mono"
                    />
                  </div>
                  {draftProbe && <ProbeBadge probe={draftProbe} />}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={testDraft} disabled={testing || saving}>
                    <PlugZap className="h-4 w-4 mr-1" />{testing ? "Testing…" : "Test Connection"}
                  </Button>
                  <Button onClick={addModel} disabled={saving} className="bg-gradient-primary text-primary-foreground">
                    {saving ? "Sealing…" : "Register"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={scanOpen} onOpenChange={setScanOpen}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    {scanCandidates.length} new local model{scanCandidates.length === 1 ? "" : "s"} found
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-2 max-h-[55vh] overflow-y-auto">
                  <div className="flex items-center justify-between pb-2 border-b border-border/40">
                    <span className="text-[11px] font-mono text-muted-foreground">
                      Pick the models to register. Unselected entries are ignored.
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" className="h-7 font-mono text-[11px]"
                        onClick={() => setScanPicked(new Set(scanCandidates.map((c) => c.id)))}>
                        Select all
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 font-mono text-[11px]"
                        onClick={() => setScanPicked(new Set())}>
                        Clear
                      </Button>
                    </div>
                  </div>
                  {scanCandidates.map((c) => {
                    const checked = scanPicked.has(c.id);
                    return (
                      <label key={c.id}
                        className="flex items-start gap-3 p-2 rounded-md border border-border/40 hover:bg-card/40 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(scanPicked);
                            if (e.target.checked) next.add(c.id); else next.delete(c.id);
                            setScanPicked(next);
                          }}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono truncate">{c.id}</div>
                          <div className="text-[10px] font-mono text-muted-foreground truncate">
                            {c.provider} · ctx {c.ctx} · {c.base}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setScanOpen(false)} disabled={scanAdding}>
                    Cancel
                  </Button>
                  <Button
                    onClick={addPickedFromScan}
                    disabled={scanAdding || scanPicked.size === 0}
                    className="bg-gradient-primary text-primary-foreground">
                    {scanAdding ? "Adding…" : `Add ${scanPicked.size} selected`}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Tabs defaultValue="models" className="w-full">
        <TabsList>
          <TabsTrigger value="models">{"Models"}</TabsTrigger>
          <TabsTrigger value="vision">Vision</TabsTrigger>
        </TabsList>

        <TabsContent value="models" className="mt-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            {PROVIDERS.map((p) => <Badge key={p} variant="outline" className="font-mono">{p}</Badge>)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                Only one model can be the default at a time
              </p>
              {loading && <p className="text-xs font-mono text-muted-foreground">{"Fetching models from PostgreSQL…"}</p>}
              {!loading && models.length === 0 && <p className="text-xs font-mono text-muted-foreground">{"No registered model in PostgreSQL."}</p>}
              {models.map((m) => {
                const av = identity.resolve(modelLabel(m));
                return (
                <Card key={m.id} className={`glass cursor-pointer ${sel?.id === m.id ? "ring-1 ring-primary" : ""}`} onClick={() => setSelId(m.id)}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <img src={av} alt="" className="h-7 w-7 rounded shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium font-mono flex items-center gap-1 truncate">
                        {modelLabel(m)}
                        {m.isDefault && <Star className="h-3 w-3 text-primary fill-primary" />}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">
                        {m.provider} · {m.id} · ctx {m.ctx}{m.source === "scanned" && " · scanned"}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[9px] font-mono">{m.status}</Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={`h-7 w-7 ${m.isDefault ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                      title={m.isDefault ? "Already default" : "Set as default"}
                      disabled={m.isDefault || saving}
                      onClick={(e) => {
                        e.stopPropagation();
                        void saveModel({ ...normalizeModel(m), isDefault: true });
                      }}
                    >
                      <Star className={`h-3.5 w-3.5 ${m.isDefault ? "fill-primary" : ""}`} />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      onClick={(e) => { e.stopPropagation(); void removeModel(m.id); }}
                      disabled={m.isDefault} title={m.isDefault ? "Default model is sealed" : "Remove"}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              );})}
            </div>


            {sel && (
              <Card className="glass lg:col-span-2">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <AvatarPicker
                        value={identity.resolve(modelLabel(editor))}
                        onChange={(url) => { void identity.save(modelLabel(editor), url); toast.success("Model avatar sealed"); }}
                        size={48}
                        title={`${"Model avatar"} · ${modelLabel(editor)}`}
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-lg break-all">{modelLabel(editor)}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">Runtime ID:</span>
                          <Input
                            value={editor.id}
                            onChange={(e) => setEditor((prev) => ({ ...prev, id: e.target.value }))}
                            className="h-7 font-mono text-[11px] flex-1 min-w-0"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saving || !editor.id.trim() || editor.id === sel?.id}
                            onClick={async () => {
                              if (!sel) return;
                              const oldId = sel.id;
                              const newId = editor.id.trim();
                              if (!confirm(`Rename runtime ID "${oldId}" → "${newId}"?\nAgents/tools/skills will follow at next call (slug-based resolution).`)) return;
                              try {
                                const r = await SystemAPI.renameModel(oldId, newId);
                                if (r.unchanged) { toast("ID unchanged"); return; }
                                toast.success(`Renamed: ${r.oldId} → ${r.newId}`);
                                await hydrateModels();
                                setSelId(r.newId);
                              } catch (e) {
                                toast.error(`Rename failed: ${(e as Error).message}`);
                              }
                            }}
                            className="h-7 font-mono text-[10px]"
                          >Rename ID</Button>
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant={editor.isDefault ? "default" : "outline"} onClick={() => void setDefault()} disabled={saving}>
                      <Star className="h-3.5 w-3.5 mr-1" />{editor.isDefault ? "Default" : "Make Default"}
                    </Button>
                  </div>
                  <Field label="Model Name" value={editor.modelName} on={(v) => setEditor((prev) => ({ ...prev, modelName: v }))} />
                  <Field label="Provider" value={editor.provider} on={(v) => setEditor((prev) => ({ ...prev, provider: v }))} />
                  <Field label="Base URL" value={editor.base} on={(v) => setEditor((prev) => ({ ...prev, base: v }))} />
                  <Field label="Context Length" type="number" value={String(editor.ctx)} on={(v) => setEditor((prev) => ({ ...prev, ctx: Number(v) || 0 }))} />
                  <div>
                    <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("models.system_prompt")}</Label>
                    <textarea
                      value={editor.systemPrompt}
                      onChange={(e) => setEditor((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                      className="w-full mt-2 h-24 p-3 rounded-md bg-card/50 border border-border text-sm font-mono"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Inspector Directive (RAG override)</Label>
                      <span className="text-[10px] font-mono text-muted-foreground">{(editor.inspectorDirective ?? "").trim().length > 0 ? "OVERRIDE" : "DEFAULT"}</span>
                    </div>
                    <textarea
                      value={editor.inspectorDirective ?? ""}
                      onChange={(e) => setEditor((prev) => ({ ...prev, inspectorDirective: e.target.value }))}
                      placeholder="Leave empty to inherit the global RAG Inspector Directive. Write a model-specific tone/format here. Placeholders: {BRAND_LOCK}, {SOURCES}."
                      className="w-full mt-2 h-32 p-3 rounded-md bg-card/50 border border-border text-sm font-mono"
                    />
                  </div>

                  <LocalServingIdField editor={editor} setEditor={setEditor} />

                  <TransportFields editor={editor} setEditor={setEditor} />

                  <ChatTemplateFields editor={editor} setEditor={setEditor} />

                  <RuntimeSafetyFields editor={editor} setEditor={setEditor} />

                  <LoopGuardFields editor={editor} setEditor={setEditor} />


                  <div className="flex items-start justify-between gap-4 p-3 rounded-md border border-border bg-card/30">
                    <div className="min-w-0">
                      <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                        RAG Retrieval
                      </Label>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                        On: the model queries the library on every chat (probe + rerank + inject).
                        Off: answers from pure model knowledge; the retrieval pipeline is fully skipped.
                      </p>
                    </div>
                    <Switch
                      checked={editor.ragEnabled !== false}
                      onCheckedChange={(v) => setEditor((prev) => ({ ...prev, ragEnabled: !!v }))}
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2 block">
                      {"Sampling Presets"}
                    </Label>
                    <ModelParamPresets
                      params={editor.params}
                      onChange={(next) => setEditor((prev) => ({ ...prev, params: next }))}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("models.custom_params")}</Label>
                      <Button size="sm" variant="outline" onClick={addP}><Plus className="h-3.5 w-3.5 mr-1" />{"Add"}</Button>
                    </div>
                    <div className="space-y-2">
                      {editor.params.filter((p) => !PRESET_NAMES.has(p.name)).map((p) => (
                        <div key={p.id} className="flex gap-2">
                          <Input value={p.name} onChange={(e) => updP(p.id, "name", e.target.value)} placeholder="name (e.g. seed)" className="font-mono text-xs h-9" />
                          <Input value={p.value} onChange={(e) => updP(p.id, "value", e.target.value)} placeholder="value" className="font-mono text-xs h-9" />
                          <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => rmP(p.id)}>
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>


                  {lastProbe && <ProbeBadge probe={lastProbe} />}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                    <Button variant="outline" onClick={() => void testConnection()} disabled={testing || saving}>
                      <PlugZap className="h-4 w-4 mr-1" />{testing ? "Testing…" : "Test Connection"}
                    </Button>
                    <Button className="bg-gradient-primary text-primary-foreground" onClick={() => void saveModel(editor)} disabled={saving}>
                      <Save className="h-4 w-4 mr-1" />{saving ? "Sealing…" : "Save to PostgreSQL"}
                    </Button>
                  </div>



                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="vision" className="mt-4 space-y-4">
          <VisionServiceCard />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1">
              <VisionProfilesList />
            </div>
            <div className="lg:col-span-2">
              <VisionConsole />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function ProbeBadge({ probe }: { probe: ModelProbeResult }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-card/40 px-3 py-2 text-xs font-mono">
      <span className={probe.ok ? "text-primary" : "text-destructive"}>{probe.ok ? "UP" : "DOWN"}</span>
      <span className="text-muted-foreground truncate px-3">{probe.message}</span>
      <span>{probe.latencyMs}ms</span>
    </div>
  );
}

function Field({ label, value, on, placeholder, type = "text" }: { label: string; value: string; on: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</Label>
      <Input type={type} value={value} onChange={(e) => on(e.target.value)} placeholder={placeholder} className="font-mono mt-2" />
    </div>
  );
}

function RuntimeSafetyFields({ editor, setEditor }: { editor: DraftModel; setEditor: Dispatch<SetStateAction<DraftModel>> }) {
  const safety = cleanRuntimeSafety(editor.runtimeSafety);
  const setSafetyValue = (key: RuntimeSafetyKey, raw: string) => {
    const field = RUNTIME_SAFETY_FIELDS.find((f) => f.key === key);
    const next = { ...safety };
    if (!raw.trim()) next[key] = null;
    else {
      const n = Math.floor(Number(raw));
      next[key] = Number.isFinite(n) ? Math.max(field?.min ?? 1, n) : null;
    }
    setEditor((prev) => ({ ...prev, runtimeSafety: next }));
  };
  return (
    <div className="space-y-3 rounded-md border border-border bg-card/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Runtime Safety</Label>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            Model-specific timeout profile. Empty fields inherit System Engine global fallback; filled fields move with this model.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 font-mono text-[10px]" onClick={() => setEditor((prev) => ({ ...prev, runtimeSafety: cleanRuntimeSafety() }))}>
          Inherit all
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {RUNTIME_SAFETY_FIELDS.map((field) => {
          const value = safety[field.key];
          return (
            <div key={field.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[11px] font-mono">{field.label}</Label>
                <Input
                  type="number"
                  min={field.min}
                  step={field.step}
                  value={value ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) => setSafetyValue(field.key, e.target.value)}
                  className="h-8 w-32 font-mono text-xs"
                />
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">{field.hint}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LOOP_GUARD_DEFAULTS = { enabled: true, lineMin: 6, lineMaxLen: 80, phraseMin: 5, minTokens: 200, substrWin: 24, substrRepeat: 6 };

function NumberKnob({ value, min, disabled, onCommit }: { value: number; min: number; disabled?: boolean; onCommit: (n: number) => void }) {
  const [text, setText] = useState<string>(String(value ?? min));
  useEffect(() => { setText(String(value ?? min)); }, [value, min]);
  const commit = () => {
    const n = Math.floor(Number(text));
    const clamped = Number.isFinite(n) ? Math.max(min, n) : min;
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <Input
      type="number"
      min={min}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-8 font-mono text-xs"
    />
  );
}

function LoopGuardFields({ editor, setEditor }: { editor: DraftModel; setEditor: Dispatch<SetStateAction<DraftModel>> }) {
  const lg = editor.loopGuard ?? null;
  const enabled = !!lg?.enabled;
  const update = (patch: Partial<typeof LOOP_GUARD_DEFAULTS>) => {
    const base = lg ?? { ...LOOP_GUARD_DEFAULTS, enabled: false };
    setEditor((prev) => ({ ...prev, loopGuard: { ...base, ...patch } }));
  };
  const num = (key: "lineMin" | "lineMaxLen" | "phraseMin" | "minTokens" | "substrWin" | "substrRepeat", min: number) => {
    const v = lg?.[key] ?? LOOP_GUARD_DEFAULTS[key];
    return (
      <div className="space-y-1">
        <Label className="text-[11px] font-mono">{key}</Label>
        <NumberKnob
          value={v}
          min={min}
          disabled={!enabled}
          onCommit={(n) => update({ [key]: n } as Partial<typeof LOOP_GUARD_DEFAULTS>)}
        />
      </div>
    );
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-card/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Loop Guard</Label>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            Aborts the chat stream when repeated lines, sentences, or token substrings are detected. Applies to this model only.
            Disabled below <code className="ml-1">minTokens</code> (warm-up noise).
            <span className="block mt-1"><code>substrWin</code> = char window scanned at tail; <code>substrRepeat</code> = consecutive non-overlapping repeats that trip the guard (catches single-line token loops like <code>synsynfinrst, synsynfinrst…</code>).</span>
          </p>

        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 font-mono text-[10px]" onClick={() => setEditor((prev) => ({ ...prev, loopGuard: { ...LOOP_GUARD_DEFAULTS } }))}>
            Reset defaults
          </Button>
          <Switch checked={enabled} onCheckedChange={(v) => update({ enabled: !!v })} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {num("lineMin", 2)}
        {num("lineMaxLen", 20)}
        {num("phraseMin", 2)}
        {num("minTokens", 0)}
        {num("substrWin", 8)}
        {num("substrRepeat", 3)}
      </div>
    </div>
  );
}

// 2026-06-02 — Chat template families now come from the backend registry
// (lib/chat-templates.mjs single source of truth). UI fallback list kept only
// so the dropdown remains useful when the API call is mid-flight.
const FAMILY_FALLBACK: ChatTemplateFamilyDTO[] = [
  { id: "qwen2.5", label: "qwen2.5 / chatml", description: "", pythonSupported: true },
];

const TRANSPORT_FALLBACK: TransportOptionDTO[] = [
  { id: "local_local", label: "LOCAL local", description: "" },
  { id: "remote_compatible", label: "Remote-compatible cloud", description: "" },
];

function TransportFields({ editor, setEditor }: { editor: DraftModel; setEditor: Dispatch<SetStateAction<DraftModel>> }) {
  const [opts, setOpts] = useState<TransportOptionDTO[]>(TRANSPORT_FALLBACK);
  useEffect(() => {
    let cancelled = false;
    SystemAPI.listTransports().then((r) => {
      if (cancelled) return;
      if (r?.transports?.length) setOpts(r.transports);
    });
    return () => { cancelled = true; };
  }, []);

  const transport = editor.transport ?? "local_local";
  const isCloud = transport === "remote_compatible";
  return (
    <div className="space-y-3 rounded-md border border-border bg-card/30 p-3">
      <div>
        <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Transport</Label>
        <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
          <code>local_local</code> = local <code>local_lm.server</code> on this machine (Path C — chat template configured below).
          <code className="ml-1">remote_compatible</code> = cloud provider (Remote, OpenRouter, DeepSeek API, Groq, Together, Mistral API, or Lovable AI Gateway).
          When a cloud transport is selected the chat template is applied by the provider — the Chat Template Family field below is ignored.
        </p>
        <select
          value={transport}
          onChange={(e) => setEditor((prev) => ({ ...prev, transport: e.target.value as DraftModel["transport"] }))}
          className="w-full mt-2 h-9 px-3 rounded-md bg-card/50 border border-border text-sm font-mono"
        >
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {opts.find((o) => o.id === transport)?.description && (
          <p className="text-[10px] text-muted-foreground mt-1 font-mono">{opts.find((o) => o.id === transport)?.description}</p>
        )}
      </div>

      {isCloud && (
        <div>
          <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">API Key Env</Label>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            The key itself is <strong>never stored in the DB</strong> — enter only the <code>UPPER_SNAKE_CASE</code> env variable name that holds it
            (e.g. <code>REMOTE_API_KEY</code>, <code>OPENROUTER_API_KEY</code>, <code>LOVABLE_API_KEY</code>).
            Lovable Gateway uses a <code>Lovable-API-Key</code> header automatically; other providers use <code>Authorization: Bearer …</code>.
          </p>
          <Input
            value={editor.apiKeyEnv ?? ""}
            onChange={(e) => setEditor((prev) => ({ ...prev, apiKeyEnv: e.target.value.trim() }))}
            placeholder="REMOTE_API_KEY"
            className="font-mono mt-2"
          />
        </div>
      )}
    </div>
  );
}

function ChatTemplateFields({ editor, setEditor }: { editor: DraftModel; setEditor: Dispatch<SetStateAction<DraftModel>> }) {
  const [families, setFamilies] = useState<ChatTemplateFamilyDTO[]>(FAMILY_FALLBACK);
  useEffect(() => {
    let cancelled = false;
    SystemAPI.listChatTemplates().then((r) => {
      if (cancelled) return;
      if (r?.families?.length) setFamilies(r.families);
    });
    return () => { cancelled = true; };
  }, []);
  const isCloud = (editor.transport ?? "local_local") === "remote_compatible";
  const stops = Array.isArray(editor.stopSequences) ? editor.stopSequences : [];
  const stopsText = stops.join("\n");
  const kwargs = (editor.chatTemplateKwargs && typeof editor.chatTemplateKwargs === "object") ? editor.chatTemplateKwargs : {};
  // Hide enable_thinking from the advanced JSON textarea — the Switch is the sole authority.
  const stripThinking = (k: Record<string, unknown>): Record<string, unknown> => {
    const { enable_thinking: _ignore, ...rest } = k;
    void _ignore;
    return rest;
  };
  const [kwargsText, setKwargsText] = useState<string>(() => {
    try { return JSON.stringify(stripThinking(kwargs as Record<string, unknown>), null, 2); } catch { return "{}"; }
  });
  const [kwargsErr, setKwargsErr] = useState<string>("");
  useEffect(() => {
    try { setKwargsText(JSON.stringify(stripThinking((editor.chatTemplateKwargs ?? {}) as Record<string, unknown>), null, 2)); setKwargsErr(""); }
    catch { setKwargsText("{}"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.id]);

  return (
    <div className={`space-y-3 rounded-md border p-3 ${isCloud ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card/30"}`}>
      <div>
        <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Chat Template Family</Label>
        <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
          Sets the model's chat template (BOS/EOS, role markers) used when the runtime exposes only <code>/v1/completions</code>.
          {isCloud
            ? <span className="block mt-1 text-amber-600 dark:text-amber-400 font-mono">Transport=remote_compatible → the provider applies its own template; this field is ignored.</span>
            : <> Leave empty to inherit <code>LLM_CHAT_TEMPLATE</code> env or fall back to <code>qwen2.5</code>.</>}
        </p>
        <select
          value={editor.templateFamily ?? ""}
          onChange={(e) => setEditor((prev) => ({ ...prev, templateFamily: e.target.value }))}
          disabled={isCloud}
          className="w-full mt-2 h-9 px-3 rounded-md bg-card/50 border border-border text-sm font-mono disabled:opacity-50"
        >
          <option value="">auto (env LLM_CHAT_TEMPLATE → qwen2.5)</option>
          {families.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}{f.pythonSupported ? "" : " ⚠ Python missing"}
            </option>
          ))}
        </select>
      </div>


      <div>
        <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Prompt Prefix</Label>
        <p className="text-[11px] text-muted-foreground mt-1">Prepended to the rendered prompt (e.g. <code>/no_think</code>). Empty = disabled.</p>
        <textarea
          value={editor.promptPrefix ?? ""}
          onChange={(e) => setEditor((prev) => ({ ...prev, promptPrefix: e.target.value }))}
          placeholder="/no_think"
          className="w-full mt-2 h-16 p-3 rounded-md bg-card/50 border border-border text-sm font-mono"
        />
      </div>

      <div>
        <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Extra Stop Sequences</Label>
        <p className="text-[11px] text-muted-foreground mt-1">Appended to the template's default stop tokens. One per line. Max 8 total.</p>
        <textarea
          value={stopsText}
          onChange={(e) => {
            const arr = e.target.value.split(/\n/).map((s) => s).filter((s) => s.length > 0).slice(0, 8);
            setEditor((prev) => ({ ...prev, stopSequences: arr }));
          }}
          placeholder={"<|endoftext|>\n</s>"}
          className="w-full mt-2 h-20 p-3 rounded-md bg-card/50 border border-border text-xs font-mono"
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Thinking</Label>
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
              Enables the model's reasoning channel (Gemma 4 <code>&lt;|channel&gt;thought</code>, Qwen3 <code>enable_thinking</code>). OFF = fast direct answers.
            </p>
          </div>
          <Switch
            checked={Boolean((kwargs as Record<string, unknown>)?.enable_thinking)}
            onCheckedChange={(v) => {
              const base = (editor.chatTemplateKwargs && typeof editor.chatTemplateKwargs === "object" && !Array.isArray(editor.chatTemplateKwargs))
                ? { ...(editor.chatTemplateKwargs as Record<string, unknown>) }
                : {};
              const next = { ...base, enable_thinking: !!v };
              setEditor((prev) => ({ ...prev, chatTemplateKwargs: next }));
              // Keep the advanced textarea in sync — but never expose enable_thinking there.
              try { setKwargsText(JSON.stringify(stripThinking(next), null, 2)); setKwargsErr(""); } catch { /* noop */ }
            }}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Chat Template Kwargs (JSON, advanced)</Label>
        <p className="text-[11px] text-muted-foreground mt-1">
          Forwarded to the engine as <code>extra_body.chat_template_kwargs</code>. Thinking is controlled by the Switch above — any <code>enable_thinking</code> written here is ignored.
        </p>
        <textarea
          value={kwargsText}
          onChange={(e) => {
            const v = e.target.value;
            setKwargsText(v);
            try {
              const obj = v.trim() ? JSON.parse(v) : {};
              if (obj && typeof obj === "object" && !Array.isArray(obj)) {
                setKwargsErr("");
                // Preserve Switch state — strip enable_thinking from JSON,
                // then re-attach the current Switch value from existing kwargs.
                const existing = (editor.chatTemplateKwargs && typeof editor.chatTemplateKwargs === "object" && !Array.isArray(editor.chatTemplateKwargs))
                  ? (editor.chatTemplateKwargs as Record<string, unknown>)
                  : {};
                const merged = { ...stripThinking(obj as Record<string, unknown>) } as Record<string, unknown>;
                if ("enable_thinking" in existing) merged.enable_thinking = !!existing.enable_thinking;
                setEditor((prev) => ({ ...prev, chatTemplateKwargs: merged }));
              } else {
                setKwargsErr("JSON object expected");
              }
            } catch (err) {
              setKwargsErr(String((err as Error).message || err));
            }
          }}
          placeholder='{"top_k": 40}'
          className="w-full mt-2 h-20 p-3 rounded-md bg-card/50 border border-border text-xs font-mono"
        />
        {kwargsErr && <p className="text-[11px] text-destructive mt-1 font-mono">{kwargsErr}</p>}
      </div>

    </div>
  );
}


// Runtime Model ID picker.
// Lists the runtime's /v1/models response as-is. No filtering/matching;
// the operator picks the right ID. Empty = models.id fallback.
function LocalServingIdField({ editor, setEditor }: { editor: DraftModel; setEditor: Dispatch<SetStateAction<DraftModel>> }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const bound = (editor.runtimeModelId ?? "").trim();
  const effective = bound || editor.id || "(unbound)";

  const refresh = useCallback(async () => {
    if (!editor.id?.trim()) { setMsg("Save the model first to ping its runtime."); return; }
    setLoading(true);
    try {
      const r = await SystemAPI.servingCandidates(editor.id.trim());
      if (!r.ok) {
        setMsg(`Runtime unreachable: ${("message" in r && r.message) || "unknown error"}`);
      } else {
        const present = "selectedPresent" in r ? !!r.selectedPresent : undefined;
        const eff = "effectiveModelId" in r && typeof r.effectiveModelId === "string" ? r.effectiveModelId : effective;
        setMsg(present === true
          ? `Runtime reachable · active binding "${eff}" is advertised at /v1/models.`
          : present === false
            ? `Runtime reachable, but "${eff}" is NOT in /v1/models — the runtime would 404 on this ID. Update the binding.`
            : `Runtime reachable.`);
      }
    } finally {
      setLoading(false);
    }
  }, [editor.id, effective]);

  return (
    <div className="space-y-3 rounded-md border border-border bg-card/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Runtime Model ID</Label>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            The ID the runtime exposes at <code>/v1/models</code>. If it differs from the DB <code>id</code> the runtime returns 404 — bind it here.
            Empty = <code>id</code> fallback. Works the same on macOS, Linux, or any Remote-compatible runtime.
          </p>
        </div>
        <Badge variant={bound ? "default" : "outline"} className="font-mono text-[10px] shrink-0">
          {bound ? "bound" : "fallback"}
        </Badge>
      </div>

      <div className="flex gap-2">
        <Input
          value={bound}
          placeholder={editor.id ? `(fallback: ${editor.id})` : "Save model first"}
          onChange={(e) => setEditor((prev) => ({ ...prev, runtimeModelId: e.target.value }))}
          className="font-mono text-xs"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
          {loading ? "…" : "Ping runtime"}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground font-mono">
        Active runtime binding: <span className="text-foreground">{effective}</span>
      </p>
      {msg && <p className="text-[11px] text-muted-foreground font-mono">{msg}</p>}
    </div>
  );
}
