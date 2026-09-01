import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Bot, Trash2, Minus, Power, RotateCcw, Zap, FolderSearch, Play, Square, CheckCircle2, XCircle, KeyRound, Eye, EyeOff, MessageSquare, FileCode, Folder, ChevronUp, Home, Pencil, Plug, Crosshair, X, ShieldCheck, ShieldOff, Loader2, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LazyTextarea } from "@/components/lazy-textarea";
import { useEffect, useRef, useState } from "react";
import { AgentsAPI, ProvidersAPI, SystemAPI, resolveApiBaseUrl, AgentBindingsAPI, AgentCapabilitiesAPI, CapabilityPacksAPI, KnowledgeAPI, VaultAPI, AdaptersAPI, TargetsAPI, TargetGroupsAPI, type AgentRow, type AiProviderDTO, type ModelDTO, type DiscoveredScript, type InterpreterInfo, type AgentValidateResult, type AgentRagBinding, type AgentVaultBinding, type AgentAdapterBinding, type AgentTargetBinding, type VaultItem, type AdapterRow, type TargetRow, type TargetGroupRow, type ResolvedCapabilities, type SquadRow, type CapabilityPack } from "@/lib/api-client";
import { InferenceParamsForm, sanitizeInference, DEFAULT_INFERENCE, type InferenceParams } from "@/components/inference-params-form";
import { CapabilityMatrixPicker, type CapabilitySelection } from "@/components/capability-matrix-picker";
import { IconGridPicker, AGENT_ICON_LOOKUP } from "@/components/icon-grid-picker";
import { ColorPalettePicker } from "@/components/color-palette-picker";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useAgentRuns } from "@/hooks/use-agent-runs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunHistoryTable } from "@/components/run-history-table";
import { McpExposedBadge } from "@/components/mcp-exposed-badge";

export const Route = createFileRoute("/_app/agents")({ component: AgentsPage });

const parseBrain = (v: string): { kind: "model" | "provider"; id: string } | null => {
  if (!v) return null;
  if (v.startsWith("model:")) return { kind: "model", id: v.slice(6) };
  if (v.startsWith("provider:")) return { kind: "provider", id: v.slice(9) };
  return null;
};

const portFromBridge = (url?: string | null) => url?.match(/:(\d+)/)?.[1] ?? "3005";
const isAgentLive = (a: AgentRow) =>
  !!a.last_active && Date.now() - new Date(a.last_active).getTime() <= 5 * 60_000;
const agentSignalLabel = (a: AgentRow) => {
  if (isAgentLive(a)) return "live <5m";
  if (a.status === "active") return "armed · no signal";
  if (a.status === "error") return "bridge error";
  return a.last_active ? `last ${new Date(a.last_active).toLocaleTimeString()}` : "no signal";
};

interface KV { id: string; name: string; value: string }

// ICON_OPTIONS removed in v11 — replaced by IconGridPicker.
const ICON_LOOKUP = AGENT_ICON_LOOKUP;
// COLOR_OPTIONS removed in v12 — replaced by shared ColorPalettePicker.

interface AgentMeta {
  systemPrompt?: string;
  description?: string;
  providerId?: string | null;
  providerName?: string | null;
  healthPath?: string;
  icon?: string;
  color?: string;
  port?: number;
  agentPath?: string;
  interpreterPath?: string;
  squad?: string;
  /** Tur-3b — operator override; effective squad = override ?? meta.squad ?? "Unassigned". */
  squadOverride?: string;
  credentials?: { name: string; hasValue: boolean }[];
}


interface CredField { id: string; name: string; value: string; reveal: boolean }

const emptyForm = () => ({
  name: "",
  systemPrompt: "",
  providerId: "",
  port: 3005,
  bridgeUrl: "http://localhost",
  healthPath: "/api/health",
  icon: "Bot",
  color: "#06b6d4",
  model: "",
  agentPath: "",
  interpreterPath: "",
  credentials: [] as CredField[],
  inference: { ...DEFAULT_INFERENCE } as InferenceParams,
  perms: { skill_ids: [], tool_ids: [] } as CapabilitySelection,
  rag: [] as AgentRagBinding[],
  ragEnabled: false,
  ragKeywords: "" as string,           // virgülle ayrılmış UI girdisi
  ragBrands: [] as string[],            // marka-bazlı RAG kapsamı (meta.rag.brands)
  vaultBindings: [] as AgentVaultBinding[],
  adapters: [] as AgentAdapterBinding[],
  targets: [] as AgentTargetBinding[],
  // Orchestrator scheduling — 1 (low) … 10 (critical)
  priority: 5 as number,
  // SIGTERM → SIGKILL grace window (ms)
  stopGraceMs: 5000 as number,
  // Tur-5b — multi-pack binding (union of action_ids inherited).
  capabilityPackIds: [] as string[],
  // Thinking switch (per-agent override). undefined = inherit model setting.
  thinking: undefined as boolean | undefined,
});

type FormState = ReturnType<typeof emptyForm>;

// Tur-3.5 — Resolved Capabilities card: shows the effective union of adapter +
// target bindings inherited from the agent itself + its allowed tools/skills.
function ResolvedCapsCard({ agentId }: { agentId: string }) {
  const [caps, setCaps] = useState<ResolvedCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setCaps(await AgentCapabilitiesAPI.resolve(agentId)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [agentId]);
  if (!caps) {
    return (
      <div className="border-t border-border pt-4 mt-4">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Resolved Capabilities {loading ? "· loading…" : ""}
        </p>
      </div>
    );
  }
  const blockedA = new Set(caps.blocked_by_policy?.adapters || []);
  const blockedT = new Set(caps.blocked_by_policy?.targets || []);
  return (
    <div className="border-t border-border pt-4 mt-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Resolved Capabilities — effective union
        </p>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => void load()}>refresh</Button>
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        Union of agent bindings + bindings inherited from allowed tools / skills. Items struck-through are blocked by execution policy.
      </p>
      <div>
        <p className="text-[10px] font-mono text-muted-foreground mb-1">Adapters ({caps.effective_adapters.length})</p>
        <div className="flex flex-wrap gap-1.5">
          {caps.effective_adapters.length === 0 && <span className="text-[10px] text-muted-foreground/60">none</span>}
          {caps.effective_adapters.map((a) => {
            const blocked = blockedA.has(a.id);
            return (
              <Badge key={a.id} variant="outline"
                className={`text-[10px] gap-1 ${blocked ? "line-through text-destructive border-destructive/40" : "border-emerald-500/30 text-emerald-300"}`}
                title={`Sources: ${a.sources.join(", ")}`}>
                <Plug className="h-3 w-3" />{a.name}
                <span className="text-muted-foreground">· {a.sources.length}</span>
              </Badge>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-mono text-muted-foreground mb-1">Targets ({caps.effective_targets.length})</p>
        <div className="flex flex-wrap gap-1.5">
          {caps.effective_targets.length === 0 && <span className="text-[10px] text-muted-foreground/60">none</span>}
          {caps.effective_targets.map((t) => {
            const key = `${t.scope}::${t.ref_id}`;
            const blocked = blockedT.has(key);
            return (
              <Badge key={key} variant={t.scope === "group" ? "secondary" : "outline"}
                className={`text-[10px] gap-1 ${blocked ? "line-through text-destructive border-destructive/40" : "border-sky-500/30 text-sky-300"}`}
                title={`Sources: ${t.sources.join(", ")}`}>
                <Crosshair className="h-3 w-3" />{t.scope}:{t.ref_id}
                <span className="text-muted-foreground">· {t.sources.length}</span>
              </Badge>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AgentsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [providers, setProviders] = useState<AiProviderDTO[]>([]);
  const [localModels, setLocalModels] = useState<ModelDTO[]>([]);
  const [sel, setSel] = useState<AgentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [temp, setTemp] = useState([0.7]);
  const [topP, setTopP] = useState([0.9]);
  const [maxTok, setMaxTok] = useState([4096]);
  const [params, setParams] = useState<KV[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scripts, setScripts] = useState<DiscoveredScript[]>([]);
  const [discoveryRoots, setDiscoveryRoots] = useState<string[]>([]);
  const [interpreters, setInterpreters] = useState<InterpreterInfo[]>([]);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<AgentValidateResult | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseData, setBrowseData] = useState<Awaited<ReturnType<typeof AgentsAPI.browse>> | null>(null);
  const [running, setRunning] = useState(false);
  const agentRuns = useAgentRuns(true);
  const [runOutput, setRunOutput] = useState<string>("");
  const [promptDraft, setPromptDraft] = useState<string>("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [lastLatency, setLastLatency] = useState<Record<string, number>>({});
  const [squadCollapsed, setSquadCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("agents.squad.collapsed") ?? "{}") || {}; }
    catch { return {}; }
  });
  const toggleSquad = (s: string) => setSquadCollapsed((prev) => {
    const next = { ...prev, [s]: !prev[s] };
    try { localStorage.setItem("agents.squad.collapsed", JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  // Tur-3b — operator-managed squads (CRUD via /api/agents/squads).
  const [squads, setSquads] = useState<SquadRow[]>([]);
  const refreshSquads = async () => {
    try { const r = await AgentsAPI.listSquads(); setSquads(r.items ?? []); }
    catch { /* silent */ }
  };
  useEffect(() => { refreshSquads(); }, []);
  // Tur-3b.2 — inline rename + manage-members modal state.
  const [renamingSquad, setRenamingSquad] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [manageSquad, setManageSquad] = useState<string | null>(null);
  const [manageBusy, setManageBusy] = useState(false);
  // Tur-2/Tur-3 — bindings: knowledge collections, vault, adapters, targets, groups.
  const [collections, setCollections] = useState<Array<{ id: string; name?: string; brand?: string | null; chunks: number }>>([]);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [adapterList, setAdapterList] = useState<AdapterRow[]>([]);
  const [targetList, setTargetList] = useState<TargetRow[]>([]);
  const [targetGroupList, setTargetGroupList] = useState<TargetGroupRow[]>([]);
  const [showRagAdvanced, setShowRagAdvanced] = useState(false);
  const [brands, setBrands] = useState<Array<{ brand: string; files: number; chunks: number }>>([]);
  const [packs, setPacks] = useState<CapabilityPack[]>([]);
  useEffect(() => {
    if (!formOpen) return;
    KnowledgeAPI.listCollections().then((r) => setCollections(r.items ?? [])).catch(() => setCollections([]));
    KnowledgeAPI.listBrands().then((r) => setBrands(r.items ?? [])).catch(() => setBrands([]));
    VaultAPI.list().then((r) => setVaultItems(r.items ?? [])).catch(() => setVaultItems([]));
    AdaptersAPI.list().then((r) => setAdapterList(r.items ?? [])).catch(() => setAdapterList([]));
    TargetsAPI.list().then((r) => setTargetList(r.items ?? [])).catch(() => setTargetList([]));
    TargetGroupsAPI.list().then((r) => setTargetGroupList(r.items ?? [])).catch(() => setTargetGroupList([]));
    CapabilityPacksAPI.list().then((r) => setPacks(r ?? [])).catch(() => setPacks([]));
    // Refresh DB models every time the dialog opens so a model added in
    // /models shows up here without a page reload. Live runtime slugs are
    // intentionally ignored: only registered DB models may be selected.
    SystemAPI.listModels().then(setLocalModels).catch(() => { /* keep last */ });
  }, [formOpen]);

  // Sync detail-panel preview sliders when the selected agent changes,
  // so the user sees the agent's sealed inference values, not stale defaults.
  const inlineSyncingRef = useRef(false);
  const inlineSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const m = (sel?.meta ?? {}) as AgentMeta & { inference?: InferenceParams; customParams?: KV[] };
    const inf = m.inference;
    if (inf) {
      inlineSyncingRef.current = true;
      if (Number.isFinite(inf.temperature)) setTemp([inf.temperature]);
      if (Number.isFinite(inf.top_p)) setTopP([inf.top_p]);
      if (Number.isFinite(inf.max_output_tokens)) setMaxTok([inf.max_output_tokens]);
      const cp = Array.isArray(inf.custom_params) ? inf.custom_params : [];
      setParams(cp.map((p, i) => ({ id: p.id ?? `p${i}`, name: p.name ?? "", value: p.value ?? "" })));
      // release sync flag next tick so the autosave effect below ignores this sync-driven update
      queueMicrotask(() => { inlineSyncingRef.current = false; });
    }
  }, [sel?.id]);

  // Debounced auto-save for inline detail-panel sliders (Temperature / Top-P / Max Tokens).
  // Persists into agents.meta.inference so spawn picks up the new value on next run.
  useEffect(() => {
    if (!sel || inlineSyncingRef.current) return;
    if (inlineSaveTimerRef.current) clearTimeout(inlineSaveTimerRef.current);
    inlineSaveTimerRef.current = setTimeout(async () => {
      try {
        const curMeta = (sel.meta ?? {}) as AgentMeta & { inference?: InferenceParams };
        const curInf = curMeta.inference ?? DEFAULT_INFERENCE;
        const nextInf = sanitizeInference({
          ...curInf,
          temperature: temp[0],
          top_p: topP[0],
          max_output_tokens: maxTok[0],
        });
        // skip no-op
        if (
          curInf.temperature === nextInf.temperature &&
          curInf.top_p === nextInf.top_p &&
          curInf.max_output_tokens === nextInf.max_output_tokens
        ) return;
        const merged = { ...curMeta, inference: nextInf };
        const r = await AgentsAPI.update(sel.id, { meta: merged as Record<string, unknown> });
        if (r.ok) {
          setSel(r.agent);
          toast.success(`Saved · max_tokens=${nextInf.max_output_tokens}, temp=${nextInf.temperature}, top_p=${nextInf.top_p}`);
        }
      } catch (e) {
        toast.error(`Auto-save failed: ${(e as Error).message}`);
      }
    }, 500);
    return () => { if (inlineSaveTimerRef.current) clearTimeout(inlineSaveTimerRef.current); };
  }, [temp, topP, maxTok, sel?.id]);

  // Rehydrate inline system-prompt draft ONLY when a different agent is selected.
  // Polling refresh updates sel.meta reference every 5s; depending on it would
  // wipe in-progress unsaved edits. Keep dep on sel.id only.
  useEffect(() => {
    const m = (sel?.meta ?? {}) as AgentMeta;
    setPromptDraft(m.systemPrompt ?? "");
  }, [sel?.id]);

  const refresh = async () => {
    setLoadError(null);
    try {
      const list = await AgentsAPI.list();
      setAgents(list);
      setSel((cur) =>
        cur ? (list.find((a) => a.id === cur.id) ?? list[0] ?? null) : (list[0] ?? null),
      );
    } catch (e) {
      setAgents([]);
      setSel(null);
      setLoadError((e as Error).message || "Bridge unreachable");
    } finally {
      setLoading(false);
    }
  };

  const loadDiscovery = async () => {
    const [d, i] = await Promise.all([AgentsAPI.discover(), AgentsAPI.interpreters()]);
    setScripts(d.scripts); setDiscoveryRoots(d.roots);
    setInterpreters(i.interpreters);
  };

  // Track dialog state via ref so we can pause polling without re-creating the interval.
  const formOpenRef = useRef(false);
  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      // Pause polling while the Edit/Add dialog is open — re-rendering the
      // 1862-line parent on every tick freezes textareas inside the dialog.
      if (formOpenRef.current) return;
      refresh();
    }, 5000);
    ProvidersAPI.list().then(setProviders).catch(() => setProviders([]));
    SystemAPI.listModels().then(setLocalModels).catch(() => setLocalModels([]));
    loadDiscovery();
    return () => clearInterval(id);
  }, []);

  const addParam = () => setParams((p) => [...p, { id: `p${Date.now()}`, name: "", value: "" }]);
  const removeParam = (id: string) => setParams((p) => p.filter((x) => x.id !== id));
  const updateParam = (id: string, field: "name" | "value", v: string) =>
    setParams((p) => p.map((x) => (x.id === id ? { ...x, [field]: v } : x)));

  const toggle = async (a: AgentRow) => {
    const enable = a.status !== "active";
    const r = await AgentsAPI.toggle(a.id, enable);
    const bridgeConfigured = !!(a.bridge_url && a.bridge_url.trim());
    if (!r.ok) {
      // Only a real bridge probe failure → error toast.
      toast.error(`"${a.name}" health check failed · ${r.bridge.message}`);
    } else if (r.status === "active" && r.signal) {
      toast.success(`"${a.name}" online · ${r.bridge.message}`);
    } else if (r.status === "active" && !bridgeConfigured) {
      // No bridge configured → local registry only, not an error.
      toast.success(`"${a.name}" armed · local registry`);
    } else if (r.status === "active") {
      // Bridge configured but probe returned no live signal yet — keep this informational.
      toast.message(`"${a.name}" armed · awaiting first heartbeat`);
    } else {
      toast.success(`"${a.name}" deactivated`);
    }
    await refresh();
  };

  const openCreate = () => { setEditingId(null); setForm(emptyForm()); setValidation(null); setFormOpen(true); };

  const openEdit = async (a: AgentRow) => {
    const m = (a.meta ?? {}) as AgentMeta & { inference?: InferenceParams; permissions?: CapabilitySelection };
    // Reconstruct providerId in the same shape the Select expects.
    let providerId = "";
    if (m.providerId) {
      if (m.providerId.startsWith("local:")) providerId = `model:${m.providerId.slice(6)}`;
      else providerId = `provider:${m.providerId}`;
    }
    // Bridge host (strip :port — the Port field owns it).
    const port = Number(a.port ?? m.port ?? 3005) || 3005;
    const bridgeUrl = (a.bridge_url || "http://localhost").replace(/:(\d+)(\/?.*)?$/, "");
    // Capabilities matrix lives in a separate table — pull it.
    let perms: CapabilitySelection = m.permissions ?? { skill_ids: [], tool_ids: [] };
    try {
      const cap = await AgentsAPI.capabilities(a.id);
      if (cap.ok) perms = { skill_ids: cap.skill_ids, tool_ids: cap.tool_ids };
    } catch { /* fall back to meta.permissions */ }
    // Load RAG + Vault + Adapter + Target bindings for this agent (Tur-2/Tur-3).
    let rag: AgentRagBinding[] = [];
    let vaultBindings: AgentVaultBinding[] = [];
    let adapters: AgentAdapterBinding[] = [];
    let targets: AgentTargetBinding[] = [];
    try {
      const [rb, vb, ab, tb] = await Promise.all([
        AgentBindingsAPI.ragList(a.id),
        AgentBindingsAPI.vaultList(a.id),
        AgentBindingsAPI.adapterList(a.id),
        AgentBindingsAPI.targetList(a.id),
      ]);
      if (rb.ok) rag = rb.items;
      if (vb.ok) vaultBindings = vb.items;
      if (ab.ok) adapters = ab.items;
      if (tb.ok) targets = tb.items;
    } catch { /* leave empty */ }
    // RAG enable + keywords from meta.rag
    const metaRag = ((m as unknown as { rag?: { enabled?: boolean; keywords?: string[]; brands?: string[] } }).rag) || {};
    const ragEnabled = metaRag.enabled === true || rag.length > 0;
    const ragKeywords = Array.isArray(metaRag.keywords) ? metaRag.keywords.join(", ") : "";
    const ragBrands = Array.isArray(metaRag.brands) ? metaRag.brands : [];
    setEditingId(a.id);
    setForm({
      name: a.name,
      systemPrompt: m.systemPrompt ?? "",
      providerId,
      port,
      bridgeUrl,
      healthPath: m.healthPath ?? "/api/health",
      icon: m.icon ?? "Bot",
      color: m.color ?? "#06b6d4",
      model: a.model ?? "",
      agentPath: a.agent_path ?? m.agentPath ?? "",
      interpreterPath: a.interpreter_path ?? m.interpreterPath ?? "",
      credentials: [], // existing ones stay vault-sealed; only NEW ones go through the form
      inference: sanitizeInference(m.inference ?? {}),
      perms,
      rag,
      ragEnabled,
      ragKeywords,
      ragBrands,
      vaultBindings,
      adapters,
      targets,
      priority: Number(a.priority ?? 5) || 5,
      stopGraceMs: Number(a.stop_grace_ms ?? 5000) || 5000,
      capabilityPackIds: Array.isArray(a.capability_pack_ids) && a.capability_pack_ids.length
        ? a.capability_pack_ids
        : (a.capability_pack_id ? [a.capability_pack_id] : []),
      thinking: typeof (m as { thinking?: unknown }).thinking === "boolean" ? (m as { thinking: boolean }).thinking : undefined,
    });

    setValidation(null);
    setFormOpen(true);
  };

  const validateForm = async () => {
    if (!form.agentPath) { toast.error("Pick a script first"); return; }
    setValidating(true);
    const r = await AgentsAPI.validate(form.agentPath, form.interpreterPath);
    setValidation(r);
    if (r.ok) toast.success(`Validated · ${r.interpreterVersion || "script ok"}`);
    else toast.error(r.issues[0] ?? "Validation failed");
    setValidating(false);
  };

  const submitForm = async () => {
    const name = form.name.trim();
    if (!name) { toast.error("Agent name required"); return; }
    if (!form.systemPrompt.trim()) { toast.error("Agent role (system prompt) required"); return; }
    const modelIdTrim = form.model.trim();
    if (!modelIdTrim) { toast.error("Model ID required — type the exact runtime slug"); return; }
    setSaving(true);
    const selBrain = parseBrain(form.providerId);
    const provider = selBrain?.kind === "provider" ? providers.find((p) => p.id === selBrain.id) : undefined;
    const localModel = selBrain?.kind === "model" ? localModels.find((m) => m.id === selBrain.id) : undefined;
    const ragKeywordList = form.ragKeywords.split(",").map((s) => s.trim()).filter(Boolean);

    const meta: AgentMeta & { inference?: InferenceParams; permissions?: CapabilitySelection; rag?: { enabled: boolean; keywords: string[]; brands: string[] }; thinking?: boolean } = {
      systemPrompt: form.systemPrompt.trim(),
      providerId: provider?.id ?? (localModel ? `local:${localModel.id}` : null),
      providerName: provider?.providerName ?? (localModel ? `Local · ${localModel.provider}` : null),
      healthPath: form.healthPath || "/api/health",
      icon: form.icon,
      color: form.color,
      port: Number(form.port) || 3005,
      agentPath: form.agentPath,
      interpreterPath: form.interpreterPath,
      inference: sanitizeInference(form.inference),
      permissions: form.perms,
      rag: { enabled: form.ragEnabled, keywords: ragKeywordList, brands: form.ragBrands },
      ...(typeof form.thinking === "boolean" ? { thinking: form.thinking } : {}),
    };

    const bridge_url = (() => {
      const host = form.bridgeUrl.trim().replace(/\/$/, "").replace(/:(\d+)$/, "");
      const port = Number(form.port) || 3005;
      return host ? `${host}:${port}` : null;
    })();
    const credentials = form.credentials
      .filter((c) => c.name.trim() && c.value)
      .map((c) => ({ name: c.name.trim(), value: c.value }));
    const priority = Math.max(1, Math.min(10, Math.round(Number(form.priority) || 5)));
    const stopGraceMs = Math.max(0, Math.min(600_000, Math.round(Number(form.stopGraceMs) || 5000)));
    const capability_pack_ids = [...new Set(form.capabilityPackIds.map((s) => s.trim()).filter(Boolean))];
    try {
      const r = editingId
        ? await AgentsAPI.update(editingId, {
            name,
            model: modelIdTrim,

            bridge_url,
            port: Number(form.port) || 3005,
            agent_path: form.agentPath,
            interpreter_path: form.interpreterPath,
            meta: meta as unknown as Record<string, unknown>,
            credentials,
            priority,
            stop_grace_ms: stopGraceMs,
            capability_pack_ids,
          })
        : await AgentsAPI.create({
            id: `ag-${Date.now().toString()}`,
            name,
            model: modelIdTrim,
            bridge_url,
            port: Number(form.port) || 3005,
            agent_path: form.agentPath,
            interpreter_path: form.interpreterPath,
            meta: meta as unknown as Record<string, unknown>,
            credentials,
            priority,
            stop_grace_ms: stopGraceMs,
            capability_pack_ids,
          });
      if (r.ok) {
        // Seal capabilities matrix into agent_capabilities (separate table for hot-path joins).
        try { await AgentsAPI.saveCapabilities(r.agent.id, form.perms); } catch { /* ignore */ }
        // Persist RAG + Vault field bindings (Tur-2). Errors are non-fatal.
        try {
          await AgentBindingsAPI.ragSave(r.agent.id, form.rag.filter((b) => b.collection_id.trim()));
        } catch (e) { console.warn("[agent] rag bindings save failed:", e); }
        try {
          await AgentBindingsAPI.vaultSave(r.agent.id, form.vaultBindings.filter((b) =>
            b.env_alias.trim() && b.vault_scope.trim() && b.vault_name.trim() && b.field_name.trim()));
        } catch (e) { console.warn("[agent] vault bindings save failed:", e); }
        // Tur-3 — Adapter + Target bindings.
        try { await AgentBindingsAPI.adapterSave(r.agent.id, form.adapters); }
        catch (e) { console.warn("[agent] adapter bindings save failed:", e); }
        try { await AgentBindingsAPI.targetSave(r.agent.id, form.targets); }
        catch (e) { console.warn("[agent] target bindings save failed:", e); }
        toast.success(
          editingId
            ? `Agent "${r.agent.name}" updated`
            : `Agent "${r.agent.name}" sealed in PostgreSQL`,
        );
        setSel(r.agent);
        setFormOpen(false);
        setEditingId(null);
        refresh();
      }
    } catch (e) {
      toast.error(`${editingId ? "Update" : "Create"} failed: ${(e as Error).message}`);
    } finally { setSaving(false); }
  };

  const runAgent = async (a: AgentRow) => {
    setRunning(true); setRunOutput("");
    void agentRuns.refresh();
    try {
      const r = await AgentsAPI.run(a.id, {});
      setRunOutput(r.stdout || r.stderr || r.error || "(no output)");
      if (typeof r.latencyMs === "number") {
        setLastLatency((prev) => ({ ...prev, [a.id]: r.latencyMs }));
      }
      const scriptName = (a.agent_path || "").split("/").pop() || "agent";
      if (r.ok) toast.success(`${a.name} · ${scriptName} · ${r.latencyMs ?? "?"}ms`);
      else if (r.error === "agent.cancelled") toast.message(`${a.name} stopped`);
      else toast.error(`${a.name} failed · ${r.error ?? (r.stderr || "").slice(0, 120)}`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setRunning(false); void agentRuns.refresh(); }
  };

  const stopAgent = async (a: AgentRow) => {
    const live = agentRuns.runsFor(a.id);
    if (!live.length) { toast.message(`${a.name} not running`); return; }
    try {
      await agentRuns.cancel(a.id);
      toast.success(`Stop signal sent · ${live.length} run(s)`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const savePrompt = async () => {
    if (!sel) return;
    const next = promptDraft.trim();
    // Empty allowed: clears prompt so boot-time ensure*/seed can re-hydrate defaults
    // (e.g. Meta-Forge orchestrator re-seeds when meta.systemPrompt is empty).
    setSavingPrompt(true);
    try {
      const merged = { ...(sel.meta ?? {}), systemPrompt: next };
      const r = await AgentsAPI.update(sel.id, { meta: merged as Record<string, unknown> });
      if (r.ok) {
        setSel(r.agent);
        await refresh();
        toast.success(next ? "System prompt updated" : "System prompt cleared · will re-seed on next boot");
      } else toast.error("Update failed");
    } catch (e) { toast.error((e as Error).message); }
    finally { setSavingPrompt(false); }
  };

  const fmtLatency = (ms?: number) => {
    if (typeof ms !== "number") return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const removeAgent = async (a: AgentRow) => {
    if (!window.confirm(`Delete agent "${a.name}"?`)) return;
    try {
      await AgentsAPI.remove(a.id);
      toast.success(`"${a.name}" removed`);
      setSel(null);
      refresh();
    } catch (e) {
      toast.error(`Remove failed: ${(e as Error).message}`);
    }
  };

  const sendToChat = (a: AgentRow) => {
    try {
      sessionStorage.setItem("chat:pinnedAgent", JSON.stringify({ id: a.id, name: a.name, meta: a.meta }));
      if (runOutput) sessionStorage.setItem("chat:agentOutput", runOutput);
    } catch { /* ignore */ }
    toast.success(`"${a.name}" pinned to Chat`);
    navigate({ to: "/chat" });
  };

  const openBrowser = async (start?: string) => {
    setBrowseOpen(true);
    setBrowseLoading(true);
    const r = await AgentsAPI.browse(start);
    setBrowseData(r);
    setBrowseLoading(false);
    if (!r.ok) toast.error(r.error || "Browse failed");
  };
  const navigateBrowser = async (p: string) => {
    setBrowseLoading(true);
    const r = await AgentsAPI.browse(p);
    setBrowseData(r);
    setBrowseLoading(false);
    if (!r.ok) toast.error(r.error || "Cannot open folder");
  };
  const pickFile = async (file: { path: string; ext: string }) => {
    const isPy = file.ext === ".py";
    const interpreter = isPy ? (form.interpreterPath || interpreters[0]?.path || "") : "";
    setForm((f) => ({ ...f, agentPath: file.path, interpreterPath: interpreter }));
    setBrowseOpen(false);
    // Auto-validate so the commander gets a green light immediately.
    setValidating(true);
    const r = await AgentsAPI.validate(file.path, interpreter);
    setValidation(r);
    setValidating(false);
    if (r.ok) toast.success(`Sealed · ${file.path.split("/").pop()}${r.interpreterVersion ? ` · ${r.interpreterVersion}` : ""}`);
    else toast.error(r.issues[0] ?? "Validation failed");
  };
  const pickScript = (s: DiscoveredScript) => pickFile({ path: s.path, ext: s.path.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "" });

  const selMeta = (sel?.meta ?? {}) as AgentMeta;
  const SelIcon = ICON_LOOKUP[selMeta.icon ?? "Bot"] ?? Bot;

  return (
    <PageShell>
      <PageHeader
        title={t("page.agents.title")}
        subtitle={t("page.agents.subtitle")}
        actions={
          <div className="flex gap-2">
            <Button onClick={refresh} variant="outline" size="sm">
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
            <Button
              onClick={async () => {
                const name = window.prompt("New squad name (letters, digits, space, _ . -)");
                if (!name) return;
                const r = await AgentsAPI.createSquad(name.trim());
                if (!r.ok) { toast.error(`Create failed · ${r.error || "unknown"}`); return; }
                toast.success(`Squad created · ${name}`);
                refreshSquads();
              }}
              variant="outline"
              size="sm"
              title="Create an operator-defined squad. Agents can be moved into it from each card."
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> New Squad
            </Button>
            <Button
              onClick={async () => {
                const r = await AgentsAPI.seedFromDisk();
                if (!r.ok) { toast.error(`Seed failed · ${r.error || "unknown"}`); return; }
                const c = r.created?.length ?? 0;
                const u = r.updated?.length ?? 0;
                const sq = r.squads?.join(", ") || "—";
                toast.success(`Seeded · ${c} new, ${u} updated · squads: ${sq}`);
                refresh();
                refreshSquads();
              }}
              variant="outline"
              size="sm"
              title="Repo agents/<squad>/*.py dosyalarını DB'ye yaz/güncelle (operatör promptlarını korur)"
            >
              <FolderSearch className="h-3.5 w-3.5 mr-1" /> Seed from disk
            </Button>
            <Button onClick={openCreate} size="sm" className="bg-gradient-primary text-primary-foreground">
              <Plus className="h-3.5 w-3.5 mr-1" /> New Agent
            </Button>
          </div>
        }
      />
      <Tabs defaultValue="roster" className="mt-2">
        <TabsList>
          <TabsTrigger value="roster">Roster · {agents.length}</TabsTrigger>
          <TabsTrigger value="history">Run History</TabsTrigger>
        </TabsList>
        <TabsContent value="roster" className="space-y-4">
      {loading && <p className="text-xs text-muted-foreground font-mono mb-4">Connecting to /api/agents …</p>}
      {!loading && (loadError || agents.length === 0) && (
        <Card className={`glass ${loadError ? "border-destructive/40" : ""}`}>
          <CardContent className="p-6 text-xs font-mono text-muted-foreground">
            {loadError ? (
              <div className="space-y-2">
                <p className="text-destructive">Bridge unreachable: {loadError}</p>
                <p>Target: <code>{resolveApiBaseUrl()}/api/agents</code></p>
                <Button size="sm" variant="outline" onClick={refresh}>{t("ag.retry")}</Button>
              </div>
            ) : (
              <>{t("ag.no_agents")}</>
            )}
          </CardContent>
        </Card>
      )}
      {agents.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-4">
            {(() => {
              const groups = new Map<string, AgentRow[]>();
              // Seed empty groups for operator-defined squads so they show up before any agent is moved in.
              for (const sq of squads) {
                if (!groups.has(sq.name)) groups.set(sq.name, []);
              }
              for (const a of agents) {
                const sq = ((a as AgentRow & { effective_squad?: string }).effective_squad
                  || ((a.meta ?? {}) as AgentMeta).squad
                  || "Unassigned").trim() || "Unassigned";
                if (!groups.has(sq)) groups.set(sq, []);
                groups.get(sq)!.push(a);
              }
              const sortMap = new Map(squads.map((s) => [s.name, s.sortOrder]));
              const fromDiskMap = new Map(squads.map((s) => [s.name, s.fromDisk]));
              const sorted = [...groups.entries()].sort(([a], [b]) => {
                if (a === "Unassigned") return 1;
                if (b === "Unassigned") return -1;
                const sa = sortMap.get(a) ?? 200;
                const sb = sortMap.get(b) ?? 200;
                if (sa !== sb) return sa - sb;
                return a.localeCompare(b);
              });
              const squadOptions = [...new Set([
                ...squads.map((s) => s.name),
                ...[...groups.keys()].filter((k) => k !== "Unassigned"),
              ])].sort();
              return sorted.map(([squad, list]) => {
                const collapsed = !!squadCollapsed[squad];
                const live = list.filter(isAgentLive).length;
                const isDisk = fromDiskMap.get(squad) === true;
                const isUnassigned = squad === "Unassigned";
                return (
                  <div key={squad} className="space-y-2">
                    <div className="w-full flex items-center justify-between px-2 py-1.5 rounded border border-border/60 bg-card/30 hover:bg-card/60 transition-colors">
                      <button
                        type="button"
                        onClick={() => toggleSquad(squad)}
                        className="shrink-0 mr-1"
                        title={collapsed ? `Expand ${squad}` : `Collapse ${squad}`}
                      >
                        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                          {collapsed ? "▸" : "▾"}
                        </span>
                      </button>
                      {renamingSquad === squad ? (
                        <form
                          className="flex-1 flex items-center gap-1"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const newName = renameDraft.trim();
                            if (!newName || newName === squad) { setRenamingSquad(null); return; }
                            const r = await AgentsAPI.renameSquad(squad, newName);
                            if (!r.ok) { toast.error(`Rename failed · ${r.error || "unknown"}`); return; }
                            toast.success(`Renamed → ${newName}`);
                            setRenamingSquad(null);
                            await Promise.all([refresh(), refreshSquads()]);
                          }}
                        >
                          <Input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") setRenamingSquad(null); }}
                            className="h-6 text-[11px] font-mono uppercase tracking-widest"
                            maxLength={64}
                          />
                          <Button type="submit" size="sm" variant="ghost" className="h-6 px-2 text-[10px]">Save</Button>
                          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setRenamingSquad(null)}>Esc</Button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleSquad(squad)}
                          className="flex-1 text-left"
                          title={collapsed ? `Expand ${squad}` : `Collapse ${squad}`}
                        >
                          <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                            {squad}
                          </span>
                        </button>
                      )}
                      <span className="text-[10px] font-mono text-muted-foreground mr-2">
                        {live}/{list.length} live
                      </span>
                      {!isDisk && !isUnassigned && renamingSquad !== squad && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            title="Manage members"
                            onClick={() => setManageSquad(squad)}
                          >
                            <Bot className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            title="Rename squad"
                            onClick={() => { setRenameDraft(squad); setRenamingSquad(squad); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive"
                            title="Delete squad (agents inside revert to disk default)"
                            onClick={async () => {
                              if (!window.confirm(`Delete squad "${squad}"? Agents inside will revert to their disk default.`)) return;
                              const r = await AgentsAPI.deleteSquad(squad);
                              if (!r.ok) { toast.error(`Delete failed · ${r.error || "unknown"}`); return; }
                              toast.success(`Squad deleted · ${squad}`);
                              await Promise.all([refresh(), refreshSquads()]);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                    {!collapsed && list.map((a) => {
                      const meta = (a.meta ?? {}) as AgentMeta;
                      const Icon = ICON_LOOKUP[meta.icon ?? "Bot"] ?? Bot;
                      const currentSquad = squad;
                      return (
                        <Card
                          key={a.id}
                          className={`glass cursor-pointer transition-all ${sel?.id === a.id ? "ring-1 ring-primary" : ""}`}
                          onClick={() => setSel(a)}
                        >
                          <CardContent className="p-3 flex items-center gap-3">
                            <Icon className="h-5 w-5" style={{ color: meta.color ?? (a.status === "active" ? "var(--primary)" : "var(--muted-foreground)") }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{a.name}</p>
                              <p className="text-[10px] font-mono text-muted-foreground truncate">
                                {meta.providerName ?? a.model ?? "—"}{a.model ? ` · id:${a.model}` : ""} · :{a.port ?? portFromBridge(a.bridge_url)} · {agentSignalLabel(a)}
                              </p>
                            </div>
                            <Badge variant="outline" className="font-mono text-[9px] hidden sm:inline-flex">{squad}</Badge>
                            <McpExposedBadge kind="agent" slug={a.id} />
                            <div onClick={(e) => e.stopPropagation()} className="hidden md:block">
                              <Select
                                value={currentSquad}
                                onValueChange={async (val) => {
                                  if (val === currentSquad) return;
                                  const target = val === "__reset__" ? null : val;
                                  const r = await AgentsAPI.setAgentSquad(a.id, target);
                                  if (!r.ok) { toast.error(`Move failed · ${r.error || "unknown"}`); return; }
                                  toast.success(target ? `Moved → ${target}` : "Reset to disk default");
                                  await Promise.all([refresh(), refreshSquads()]);
                                }}
                              >
                                <SelectTrigger className="h-7 w-[120px] text-[10px] font-mono">
                                  <SelectValue placeholder="Move" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    <SelectLabel className="text-[10px]">Move to squad</SelectLabel>
                                    {squadOptions.map((sq) => (
                                      <SelectItem key={sq} value={sq} className="text-[11px] font-mono">{sq}</SelectItem>
                                    ))}
                                    <SelectItem value="__reset__" className="text-[11px] font-mono text-muted-foreground">↺ Reset to disk default</SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </div>
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              title={a.status === "active" ? "Disarm agent (allow-list off)" : "Arm agent (allow-list on)"}
                              onClick={(e) => { e.stopPropagation(); toggle(a); }}>
                              {a.status === "active"
                                ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                                : <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); removeAgent(a); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            <span className={`pulse-dot ${isAgentLive(a) ? "" : a.status === "error" ? "!bg-destructive" : "!bg-muted-foreground"}`} />
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>

          {sel && (
            <Card className="glass lg:col-span-2">
              <CardContent className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <SelIcon className="h-7 w-7" style={{ color: selMeta.color ?? "var(--primary)" }} />
                    <div>
                      <h3 className="font-bold text-lg">{sel.name}</h3>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selMeta.providerName && (
                          <Badge variant="outline" className="font-mono text-[10px]">{selMeta.providerName}</Badge>
                        )}
                        <Badge variant="outline" className="font-mono text-[10px]">{sel.model ?? "no model"}</Badge>
                        {sel.bridge_url && (
                          <Badge variant="outline" className="font-mono text-[10px]">{sel.bridge_url}{selMeta.healthPath ?? ""}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => runAgent(sel)} disabled={running}
                      title="Dispatch this agent's script once and stream stdout/stderr below">
                      {running
                        ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        : <Play className="h-3.5 w-3.5 mr-1" />}
                      {running ? "Dispatching…" : "Dispatch"}
                    </Button>
                    {(agentRuns.isLive(sel.id) || running) && (
                      <Button size="sm" variant="destructive" onClick={() => stopAgent(sel)}
                        title="Send SIGTERM (then SIGKILL after the configured grace) to every live run for this agent">
                        <Square className="h-3.5 w-3.5 mr-1" />
                        Stop ({agentRuns.counts[sel.id] ?? (running ? 1 : 0)})
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openEdit(sel)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => sendToChat(sel)}>
                      <MessageSquare className="h-3.5 w-3.5 mr-1" /> Send to Chat
                    </Button>
                  </div>
                </div>

                <div className="border border-border rounded bg-black/40 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">stdout · description</p>
                  <pre className="text-[11px] font-mono text-emerald-300/90 whitespace-pre-wrap italic max-h-24 overflow-auto">
                    {selMeta.description?.trim() || "No description provided. Edit the agent to add a short summary."}
                  </pre>
                  {runOutput && (
                    <>
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-3 mb-1">last run</p>
                      <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap max-h-48 overflow-auto">{runOutput}</pre>
                    </>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                      Agent Role (System Prompt)
                    </label>
                    <div className="flex items-center gap-2">
                      {promptDraft.trim() !== (selMeta.systemPrompt ?? "").trim() && (
                        <Badge variant="outline" className="font-mono text-[10px] text-amber-500 border-amber-500/40">unsaved</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPromptDraft(selMeta.systemPrompt ?? "")}
                        disabled={savingPrompt || promptDraft === (selMeta.systemPrompt ?? "")}
                      >
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={savePrompt}
                        disabled={savingPrompt || promptDraft.trim() === (selMeta.systemPrompt ?? "").trim()}
                      >
                        {savingPrompt ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                  <LazyTextarea
                    value={promptDraft}
                    onChange={(v) => setPromptDraft(v)}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    dir="ltr"
                    className="w-full mt-2 min-h-[160px] p-3 rounded-md bg-card/50 border border-border font-mono text-[13px] leading-6 tracking-normal whitespace-pre-wrap break-words text-left align-top resize-y"
                    style={{ textAlign: "left", verticalAlign: "top", unicodeBidi: "plaintext", overflowWrap: "break-word", wordBreak: "normal" }}
                    placeholder={t("ag.identity_ph")}
                  />
                </div>

                <ParamSlider label="Temperature" value={temp} setValue={setTemp} min={0} max={2} step={0.05} />
                <ParamSlider label="Top-P" value={topP} setValue={setTopP} min={0} max={1} step={0.01} />
                <ParamSlider label="Max Tokens" value={maxTok} setValue={setMaxTok} min={64} max={8000} step={128} />

                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("ag.custom_params")}</p>
                    <Button size="sm" variant="outline" onClick={addParam}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {params.map((p) => (
                      <div key={p.id} className="flex gap-2">
                        <Input value={p.name} onChange={(e) => updateParam(p.id, "name", e.target.value)} placeholder="name" className="font-mono text-xs h-9" />
                        <Input value={p.value} onChange={(e) => updateParam(p.id, "value", e.target.value)} placeholder="value" className="font-mono text-xs h-9" />
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => removeParam(p.id)}>
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    {params.length === 0 && <p className="text-[11px] text-muted-foreground font-mono">No custom parameters.</p>}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Live Stats (from bridge)</p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <Stat label="Calls" value={String(sel.calls)} />
                    <Stat label="Success" value={`${sel.success}%`} />
                    <Stat label="Latency" value={fmtLatency(lastLatency[sel.id])} />
                    <Stat label="Status" value={sel.status} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(open) => { formOpenRef.current = open; setFormOpen(open); if (!open) setEditingId(null); }}>
        <DialogContent className="max-w-5xl xl:max-w-6xl w-[96vw] max-h-[94vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Agent" : t("ag.identity_form")}</DialogTitle>
            <DialogDescription>
              {editingId
                ? <>Update the sealed agent in PostgreSQL. Existing credentials stay vault-sealed; add new ones below if needed.</>
                : <>Sealed into <code>action_library</code> compatible meta on PostgreSQL. All fields are mandatory for autonomous operation.</>}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="rag"><FolderSearch className="h-3.5 w-3.5 mr-1" /> Knowledge / RAG</TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="space-y-5 py-2">
          <div className="space-y-5 py-2">
            {/* placeholder div retained for layout */}
            <Field label="Agent Name *">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. PostgreSQL Expert" />
            </Field>

            <Field label="Agent Role — System Prompt *" hint="The agent's character. Without this it speaks empty.">
              <LazyTextarea
                value={form.systemPrompt}
                onChange={(v) => setForm({ ...form, systemPrompt: v })}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                dir="ltr"
                placeholder={t("ag.system_prompt_ph")}
                className="w-full min-h-[160px] p-3 rounded-md bg-card/50 border border-border font-mono text-[13px] leading-6 tracking-normal whitespace-pre-wrap break-words text-left align-top resize-y"
                style={{ textAlign: "left", verticalAlign: "top", unicodeBidi: "plaintext", overflowWrap: "break-word", wordBreak: "normal" }}
              />
            </Field>

            <Field label="Model or Provider (Brain)" hint="Optional — pick a local model or active provider only if you want to auto-fill Model ID and metadata. Leave empty and type Model ID directly to bypass.">
              <Select value={form.providerId} onValueChange={(v) => {
                // Auto-fill Model ID from the selected source, but only when the
                // operator hasn't typed one yet. Manual edits always win.
                const sel = parseBrain(v);
                let autoModel = "";
                if (sel?.kind === "model") {
                  const lm = localModels.find((m) => m.id === sel.id);
                  if (lm) autoModel = lm.id;
                } else if (sel?.kind === "provider") {
                  const pr = providers.find((p) => p.id === sel.id);
                  if (pr?.model) autoModel = pr.model;
                }
                setForm((prev) => ({
                  ...prev,
                  providerId: v,
                  model: prev.model.trim() ? prev.model : autoModel,
                }));
              }}>
                <SelectTrigger><SelectValue placeholder={t("ag.select_brain")} /></SelectTrigger>
                <SelectContent>
                  {localModels.length === 0 && providers.filter((p) => p.isActive !== false).length === 0 && (
                    <div className="px-2 py-1 text-xs text-muted-foreground">No local models or active providers — add in Models / Settings</div>
                  )}
                  {localModels.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase font-mono text-primary">{t("ag.local_models")}</SelectLabel>
                      {localModels.map((m) => (
                        <SelectItem key={`m-${m.id}`} value={`model:${m.id}`}>
                          <div className="flex flex-col leading-tight">
                            <span>{m.modelName} · {m.provider}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">id: {m.id}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {providers.filter((p) => p.isActive !== false).length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase font-mono text-muted-foreground">{t("ag.active_providers")}</SelectLabel>
                      {providers.filter((p) => p.isActive !== false).map((p) => (
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
            </Field>

            <Field label="Model ID *" hint="Pick a model from the list. Add new ones in /models — they appear here automatically when you reopen this form.">
              {(() => {
                const dbIds = localModels.map((m) => m.id);
                const hasAny = localModels.length > 0;
                return (
                  <div className="space-y-1.5">
                    <Select
                      value={dbIds.includes(form.model) ? form.model : ""}
                      onValueChange={(v) => setForm({ ...form, model: v })}
                    >
                      <SelectTrigger className="font-mono text-sm">
                        <SelectValue placeholder={hasAny ? "Select a model…" : "No models — add one in /models"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-[320px] w-[var(--radix-select-trigger-width)] bg-popover border-border">
                        {localModels.length > 0 && (
                          <SelectGroup>
                            {localModels.map((m) => (
                              <SelectItem key={`mid-${m.id}`} value={m.id} className="font-mono text-[13px]">
                                <div className="flex flex-col leading-tight">
                                  <span>{m.id}</span>
                                  <span className="text-[10px] text-muted-foreground">{m.modelName} · {m.provider}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </SelectContent>
                    </Select>
                    {form.model && !dbIds.includes(form.model) && (
                      <p className="text-[10px] font-mono text-amber-500/80">
                        Current: <span className="text-foreground">{form.model}</span> · not in /models (kept as-is from previous save)
                      </p>
                    )}
                  </div>
                );
              })()}
            </Field>

            <div className="rounded-md border border-border bg-card/30 p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Thinking</p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                  Per-agent override. ON = enable model's reasoning channel for this agent. Leave OFF to inherit the model's <code>/models</code> Thinking Switch.
                </p>
              </div>
              <Switch
                checked={form.thinking === true}
                onCheckedChange={(v) => setForm((f) => ({ ...f, thinking: !!v }))}
              />
            </div>









            <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono uppercase tracking-widest text-primary inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                  Capability Packs · {form.capabilityPackIds.length} bound
                </p>
                <a href="/capabilities" className="text-[10px] font-mono text-primary hover:underline">Manage packs →</a>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground">
                Bind one or more sectoral packs. The agent inherits the union of all tools + skills from selected packs. Click a chip to toggle.
              </p>
              {packs.length === 0 ? (
                <div className="border border-dashed border-primary/40 rounded p-3 text-center space-y-2">
                  <p className="text-[11px] font-mono text-muted-foreground">No capability packs created yet.</p>
                  <a href="/capabilities">
                    <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]">
                      Create your first pack →
                    </Button>
                  </a>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {packs.map((p) => {
                    const on = form.capabilityPackIds.includes(p.id);
                    const skillCount = Array.isArray((p as any).skill_ids) ? (p as any).skill_ids.length : 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            capabilityPackIds: on
                              ? form.capabilityPackIds.filter((x) => x !== p.id)
                              : [...form.capabilityPackIds, p.id],
                          })
                        }
                        className={`text-[10px] font-mono px-2 py-1 rounded border transition ${
                          on
                            ? "bg-primary/15 border-primary/60 text-primary"
                            : "bg-muted/40 border-border text-muted-foreground hover:border-primary/40"
                        }`}
                        title={`${p.sector} · ${p.action_ids.length} tools · ${skillCount} skills`}
                      >
                        {on ? "✓ " : "+ "}{p.name}
                        <span className="opacity-60 ml-1">· {p.action_ids.length}t / {skillCount}s</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {form.capabilityPackIds.length > 0 && (
                <p className="text-[10px] font-mono text-muted-foreground border-t border-primary/20 pt-2">
                  {form.capabilityPackIds.length} pack{form.capabilityPackIds.length === 1 ? "" : "s"} selected ·
                  {" "}inherited tools: {
                    [...new Set(
                      packs.filter((p) => form.capabilityPackIds.includes(p.id))
                        .flatMap((p) => p.action_ids)
                    )].length
                  } · skills: {
                    [...new Set(
                      packs.filter((p) => form.capabilityPackIds.includes(p.id))
                        .flatMap((p) => (Array.isArray((p as any).skill_ids) ? (p as any).skill_ids : []))
                    )].length
                  }
                </p>
              )}
            </div>


            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Runtime · Script & Interpreter</p>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Field label="Agent Script Path *" hint="Auto-discovered from Mac agent roots.">
                  <Input value={form.agentPath} onChange={(e) => setForm({ ...form, agentPath: e.target.value })} placeholder="~/Documents/agents/script.py" />
                </Field>
                <div className="self-end">
                  <Button type="button" variant="outline" size="sm" onClick={() => openBrowser(form.agentPath ? form.agentPath.replace(/\/[^/]*$/, "") : undefined)}>
                    <FolderSearch className="h-3.5 w-3.5 mr-1" /> Browse Mac
                  </Button>
                </div>
              </div>
              <Field label="Runtime Environment (Interpreter)" hint="Pick the venv/conda/system Python that runs this agent.">
                <Select value={form.interpreterPath} onValueChange={(v) => setForm({ ...form, interpreterPath: v })}>
                  <SelectTrigger><SelectValue placeholder={t("ag.select_interpreter")} /></SelectTrigger>
                  <SelectContent>
                    {interpreters.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">{t("ag.no_interpreters")}</div>}
                    {interpreters.map((i) => (
                      <SelectItem key={i.path} value={i.path}>
                        <span className="font-mono text-xs">[{i.kind}] {i.path} · {i.version}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={validateForm} disabled={validating}>
                  {validating ? t("ag.testing") : <>{t("ag.test_conn")}</>}
                </Button>
                {validation && (
                  <div className="flex items-center gap-1 text-xs font-mono">
                    {validation.scriptOk ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />} script
                    {validation.interpreterOk ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-2" /> : <XCircle className="h-3.5 w-3.5 text-destructive ml-2" />} interpreter
                    {validation.interpreterVersion && <span className="text-muted-foreground ml-2">{validation.interpreterVersion}</span>}
                  </div>
                )}
              </div>
              {validation && validation.issues.length > 0 && (
                <ul className="text-[11px] font-mono text-destructive list-disc pl-5">
                  {validation.issues.map((i, k) => <li key={k}>{i}</li>)}
                </ul>
              )}
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5" /> Credentials / API Keys
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, credentials: [...f.credentials, { id: `c${Date.now()}`, name: "", value: "", reveal: false }] }))}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Key
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/70">AES-256-GCM sealed in PostgreSQL vault under <code>agent:&lt;id&gt;</code> scope.</p>
              {form.credentials.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <Input className="font-mono text-xs h-8" placeholder="GITHUB_TOKEN" value={c.name}
                    onChange={(e) => setForm((f) => ({ ...f, credentials: f.credentials.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x) }))} />
                  <Input className="font-mono text-xs h-8" type={c.reveal ? "text" : "password"} placeholder="value (encrypted on save)" value={c.value}
                    onChange={(e) => setForm((f) => ({ ...f, credentials: f.credentials.map((x) => x.id === c.id ? { ...x, value: e.target.value } : x) }))} />
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setForm((f) => ({ ...f, credentials: f.credentials.map((x) => x.id === c.id ? { ...x, reveal: !x.reveal } : x) }))}>
                    {c.reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setForm((f) => ({ ...f, credentials: f.credentials.filter((x) => x.id !== c.id) }))}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Vault Field Bindings — env_alias → vault scope/name/field; runtime decrypts into child env. */}
            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5" /> Vault Field Bindings
                </p>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => setForm((f) => ({
                    ...f,
                    vaultBindings: [...f.vaultBindings, { env_alias: "", vault_scope: "global", vault_name: "", field_name: "" }],
                  }))}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add binding
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                Map any sealed vault field (SSH password, CF token, REST API key…) to a process env var.
                The runtime decrypts on dispatch and never logs the value.
              </p>
              {form.vaultBindings.length === 0 && (
                <p className="text-[10px] font-mono text-muted-foreground/60 py-2">No bindings yet · agent runs without injected credentials.</p>
              )}
              {form.vaultBindings.map((b, i) => {
                const matchingItem = vaultItems.find((v) => v.scope === b.vault_scope && v.name === b.vault_name);
                const availableFields = matchingItem?.field_names ?? [];
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <Input
                      className="col-span-3 font-mono text-xs h-8"
                      placeholder="ENV_ALIAS"
                      value={b.env_alias}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        vaultBindings: f.vaultBindings.map((x, j) => j === i ? { ...x, env_alias: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") } : x),
                      }))}
                    />
                    <Select
                      value={`${b.vault_scope}/${b.vault_name}`}
                      onValueChange={(v) => {
                        const idx = v.indexOf("/");
                        const scope = v.slice(0, idx);
                        const name = v.slice(idx + 1);
                        setForm((f) => ({
                          ...f,
                          vaultBindings: f.vaultBindings.map((x, j) => j === i ? { ...x, vault_scope: scope, vault_name: name, field_name: "" } : x),
                        }));
                      }}
                    >
                      <SelectTrigger className="col-span-5 h-8 text-xs font-mono">
                        <SelectValue placeholder="Select vault secret…" />
                      </SelectTrigger>
                      <SelectContent>
                        {vaultItems.length === 0 && <SelectItem value="__none__" disabled>No vault secrets — seal one in Security › Vault</SelectItem>}
                        {vaultItems.map((v) => (
                          <SelectItem key={`${v.scope}/${v.name}`} value={`${v.scope}/${v.name}`}>
                            <span className="font-mono text-xs">{v.scope} / {v.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={b.field_name}
                      onValueChange={(v) => setForm((f) => ({
                        ...f,
                        vaultBindings: f.vaultBindings.map((x, j) => j === i ? { ...x, field_name: v } : x),
                      }))}
                      disabled={availableFields.length === 0}
                    >
                      <SelectTrigger className="col-span-3 h-8 text-xs font-mono">
                        <SelectValue placeholder="field" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFields.map((f) => (
                          <SelectItem key={f} value={f}><span className="font-mono text-xs">{f}</span></SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button" size="icon" variant="ghost" className="col-span-1 h-8 w-8 text-destructive"
                      onClick={() => setForm((f) => ({ ...f, vaultBindings: f.vaultBindings.filter((_, j) => j !== i) }))}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>


            {/* Adapters — agent_adapter_bindings; runtime injects ELARA_AGENT_ADAPTERS. */}
            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Plug className="h-3.5 w-3.5" /> Adapters ({form.adapters.length})
                </p>
                <Select
                  value=""
                  onValueChange={(v) => {
                    if (!v || form.adapters.some((a) => a.adapter_id === v)) return;
                    setForm((f) => ({ ...f, adapters: [...f.adapters, { adapter_id: v, enabled: true }] }));
                  }}
                >
                  <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="+ Add adapter…" /></SelectTrigger>
                  <SelectContent>
                    {adapterList.length === 0 && <SelectItem value="__none__" disabled>No adapters — create one in Adapters</SelectItem>}
                    {adapterList
                      .filter((a) => !form.adapters.some((b) => b.adapter_id === a.id))
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="font-mono text-xs">{a.name} · {a.category}/{a.connection_type}</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                Multi-select. Agent can use any bound adapter (Cloudflare, Checkpoint, X.com, RSS…). Vault + risk inherited from the adapter.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {form.adapters.length === 0 && (
                  <p className="text-[10px] font-mono text-muted-foreground/60">No adapters bound · agent has no external connectors.</p>
                )}
                {form.adapters.map((b) => {
                  const a = adapterList.find((x) => x.id === b.adapter_id);
                  return (
                    <Badge key={b.adapter_id} variant="outline" className="text-[10px] gap-1 pr-1">
                      <Plug className="h-3 w-3" />
                      {a?.name ?? b.adapter_id}
                      {a && <span className="text-muted-foreground">· {a.category}</span>}
                      <button
                        type="button"
                        className="ml-1 hover:text-destructive"
                        onClick={() => setForm((f) => ({ ...f, adapters: f.adapters.filter((x) => x.adapter_id !== b.adapter_id) }))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            </div>

            {/* Targets — agent_target_bindings; runtime injects ELARA_AGENT_TARGETS. Scope: target | group. */}
            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Crosshair className="h-3.5 w-3.5" /> Targets ({form.targets.length})
                </p>
                <div className="flex gap-1">
                  <Select
                    value=""
                    onValueChange={(v) => {
                      if (!v || form.targets.some((t) => t.scope === "group" && t.ref_id === v)) return;
                      setForm((f) => ({ ...f, targets: [...f.targets, { scope: "group", ref_id: v, enabled: true }] }));
                    }}
                  >
                    <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue placeholder="+ Group…" /></SelectTrigger>
                    <SelectContent>
                      {targetGroupList.length === 0 && <SelectItem value="__none__" disabled>No groups</SelectItem>}
                      {targetGroupList
                        .filter((g) => !form.targets.some((t) => t.scope === "group" && t.ref_id === g.id))
                        .map((g) => <SelectItem key={g.id} value={g.id}>{g.name} ({g.kind})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select
                    value=""
                    onValueChange={(v) => {
                      if (!v || form.targets.some((t) => t.scope === "target" && t.ref_id === v)) return;
                      setForm((f) => ({ ...f, targets: [...f.targets, { scope: "target", ref_id: v, enabled: true }] }));
                    }}
                  >
                    <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="+ Target…" /></SelectTrigger>
                    <SelectContent>
                      {targetList.length === 0 && <SelectItem value="__none__" disabled>No targets — add in Targets</SelectItem>}
                      {targetList
                        .filter((t) => !form.targets.some((b) => b.scope === "target" && b.ref_id === t.id))
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            <span className="font-mono text-xs">{t.name} · {t.ip || t.host}</span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                Bind whole groups (Forti, Checkpoint…) or individual hosts. The orchestrator looks up IPs/names from chat against these.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {form.targets.length === 0 && (
                  <p className="text-[10px] font-mono text-muted-foreground/60">No targets bound.</p>
                )}
                {form.targets.map((b) => {
                  const label = b.scope === "group"
                    ? targetGroupList.find((g) => g.id === b.ref_id)?.name ?? b.ref_id
                    : targetList.find((t) => t.id === b.ref_id)?.name ?? b.ref_id;
                  const sub = b.scope === "group" ? "group" :
                    targetList.find((t) => t.id === b.ref_id)?.ip || "";
                  return (
                    <Badge key={`${b.scope}:${b.ref_id}`} variant={b.scope === "group" ? "secondary" : "outline"} className="text-[10px] gap-1 pr-1">
                      <Crosshair className="h-3 w-3" />
                      {label}
                      {sub && <span className="text-muted-foreground">· {sub}</span>}
                      <button
                        type="button"
                        className="ml-1 hover:text-destructive"
                        onClick={() => setForm((f) => ({ ...f, targets: f.targets.filter((x) => !(x.scope === b.scope && x.ref_id === b.ref_id)) }))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            </div>

            {/* Tur-3.5 — Resolved Capabilities: union of agent + tool + skill bindings */}
            {editingId && <ResolvedCapsCard agentId={editingId} />}




            {/* Inference Parameters — sealed in agents.meta.inference and re-pushed to LOCAL on restart. */}
            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("ag.inference_params")}</p>
              <p className="text-[10px] text-muted-foreground/70">
                Sealed in PostgreSQL · pushed to local runtime on every restart and new chat.
              </p>
              <InferenceParamsForm
                value={form.inference}
                onChange={(v) => setForm((f) => ({ ...f, inference: v }))}
              />
            </div>

            {/* Capability Matrix — agent_capabilities (skills + tools) */}
            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("ag.capability_matrix")}</p>
              <p className="text-[10px] text-muted-foreground/70">
                Skills + Tools this agent is authorised to invoke. Sealed in <code>agent_capabilities</code>.
              </p>
              <CapabilityMatrixPicker
                value={form.perms}
                onChange={(v) => setForm((f) => ({ ...f, perms: v }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Bridge Host *" hint="Host only — port lives in the next field.">
                <Input value={form.bridgeUrl} onChange={(e) => {
                  let v = e.target.value;
                  // Strip any :port the user pastes — it's owned by the Port field.
                  try {
                    const u = new URL(v);
                    if (u.port) {
                      const port = Number(u.port);
                      u.port = "";
                      v = u.toString().replace(/\/$/, "");
                      setForm({ ...form, bridgeUrl: v, port });
                      return;
                    }
                  } catch { /* not a full URL yet */ }
                  setForm({ ...form, bridgeUrl: v.replace(/:(\d+)(\/?.*)?$/, "") });
                }} placeholder={typeof window !== "undefined" ? `http://${window.location.hostname}` : ""} />
              </Field>
              <Field label="Port *">
                <Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 3005 })} />
              </Field>
              <Field label="Health Endpoint *" hint="Liveness probe path.">
                <Input value={form.healthPath} onChange={(e) => setForm({ ...form, healthPath: e.target.value })} placeholder="/api/health" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Icon" hint="Pick from 120+ ops / security / social marks.">
                <IconGridPicker value={form.icon} onChange={(v) => setForm({ ...form, icon: v })} color={form.color} />
              </Field>
              <Field label="Color" hint="48-swatch curated palette.">
                <ColorPalettePicker value={form.color} onChange={(v) => setForm({ ...form, color: v })} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field
                label={`Priority · ${form.priority}`}
                hint="Orchestrator scheduling: 1 = background, 5 = normal, 10 = critical (preempts lower)."
              >
                <Slider
                  value={[form.priority]}
                  onValueChange={(v) => setForm({ ...form, priority: v[0] ?? 5 })}
                  min={1} max={10} step={1}
                />
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
                  <span>low</span><span>normal</span><span>critical</span>
                </div>
              </Field>
              <Field
                label={`Stop Grace · ${form.stopGraceMs}ms`}
                hint="SIGTERM → wait this long → SIGKILL. 0 = kill immediately. Long-running agents need more."
              >
                <Input
                  type="number"
                  value={form.stopGraceMs}
                  min={0} max={600000} step={500}
                  onChange={(e) => setForm({ ...form, stopGraceMs: Math.max(0, Math.min(600000, Number(e.target.value) || 0)) })}
                />
              </Field>
            </div>
          </div>
            </TabsContent>

            <TabsContent value="rag" className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <FolderSearch className="h-3.5 w-3.5" /> Knowledge / RAG
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground">{form.ragEnabled ? "ON" : "OFF"}</span>
                  <Switch checked={form.ragEnabled} onCheckedChange={(v) => setForm((f) => ({ ...f, ragEnabled: v }))} />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                ON · runtime searches the knowledge base on every dispatch and injects top matches.
                Pick one or more brands below to scope retrieval; leave empty to search everything.
              </p>

              {form.ragEnabled && (
                <>
                  <div className="space-y-2 pt-1">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Brands ({form.ragBrands.length})</p>
                    <div className="flex flex-wrap gap-1.5">
                      {brands.length === 0 && (
                        <p className="text-[10px] font-mono text-muted-foreground/60">No brands indexed yet.</p>
                      )}
                      {brands.map((b) => {
                        const active = form.ragBrands.includes(b.brand);
                        return (
                          <button
                            key={b.brand}
                            type="button"
                            onClick={() => setForm((f) => ({
                              ...f,
                              ragBrands: active
                                ? f.ragBrands.filter((x) => x !== b.brand)
                                : [...f.ragBrands, b.brand],
                            }))}
                          >
                            <Badge
                              variant={active ? "default" : "outline"}
                              className="text-[10px] gap-1 cursor-pointer"
                            >
                              {active && <Check className="h-3 w-3" />}
                              {b.brand}
                              <span className={active ? "text-primary-foreground/70" : "text-muted-foreground"}>
                                · {b.files} files · {b.chunks} chunks
                              </span>
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Keywords / Alias</p>
                    <p className="text-[10px] text-muted-foreground/70">
                      Optional. Comma-separated terms to narrow or alias within the selected scope (e.g. <code>vpn, nat, r81.20</code>).
                    </p>
                    <LazyTextarea
                      rows={2}
                      className="font-mono text-xs"
                      placeholder="vpn, nat, policy…"
                      value={form.ragKeywords}
                      onChange={(v) => setForm((f) => ({ ...f, ragKeywords: v }))}
                    />
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setFormOpen(false); setEditingId(null); }} disabled={saving}>{t("ag.cancel")}</Button>
            <Button onClick={submitForm} disabled={saving} className="bg-gradient-primary text-primary-foreground">
              {saving ? (editingId ? "Updating…" : "Sealing…") : (editingId ? "Save Changes" : "Seal Agent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("ag.browse_fs")}</DialogTitle>
            <DialogDescription>
              Pick the absolute path of any <code>.py / .sh / .js / .mjs / .ts</code> file. Path is sealed into PostgreSQL <code>execution_path</code>.
            </DialogDescription>
          </DialogHeader>

          {/* Shortcuts */}
          <div className="flex flex-wrap gap-1 pb-2 border-b border-border">
            {(browseData?.shortcuts ?? []).map((s) => (
              <Button key={s.path} type="button" variant="outline" size="sm" className="h-7 text-[11px] font-mono"
                onClick={() => navigateBrowser(s.path)}>
                <Home className="h-3 w-3 mr-1" /> {s.label}
              </Button>
            ))}
          </div>

          {/* Path bar */}
          <div className="flex items-center gap-2 py-2">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
              disabled={!browseData?.parent}
              onClick={() => browseData?.parent && navigateBrowser(browseData.parent)}>
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Input
              value={browseData?.path ?? ""}
              onChange={(e) => setBrowseData((d) => d ? { ...d, path: e.target.value } : d)}
              onKeyDown={(e) => { if (e.key === "Enter") navigateBrowser((e.target as HTMLInputElement).value); }}
              className="h-7 text-[11px] font-mono"
              placeholder="/var/lib/elara"
            />
            <Button type="button" variant="outline" size="sm" className="h-7"
              onClick={() => browseData && navigateBrowser(browseData.path)}>Go</Button>
          </div>

          {/* Listing */}
          <div className="flex-1 overflow-y-auto space-y-1">
            {browseLoading && <p className="text-xs font-mono text-muted-foreground p-3">Loading…</p>}
            {!browseLoading && browseData?.ok && browseData.dirs.length === 0 && browseData.files.length === 0 && (
              <p className="text-xs font-mono text-muted-foreground p-3">Empty directory.</p>
            )}
            {!browseLoading && browseData?.dirs.map((d) => (
              <button
                key={d.path} type="button"
                onClick={() => navigateBrowser(d.path)}
                className="w-full flex items-center gap-2 p-2 rounded border border-border bg-card/40 hover:bg-card/70 text-left"
              >
                <Folder className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-xs font-mono">{d.name}</span>
              </button>
            ))}
            {!browseLoading && browseData?.files.map((f) => (
              <button
                key={f.path} type="button"
                onClick={() => pickFile(f)}
                className="w-full flex items-center gap-2 p-2 rounded border border-border bg-card/40 hover:bg-primary/10 text-left"
              >
                <FileCode className="h-3.5 w-3.5 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono truncate">{f.name}</p>
                  <p className="text-[10px] font-mono text-muted-foreground truncate">{f.path}</p>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono">{f.ext.replace(".", "")}</Badge>
                <span className="text-[10px] font-mono text-muted-foreground">{(f.size / 1024).toFixed(1)} kB</span>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { loadDiscovery(); setBrowseOpen(false); }}>
              <FolderSearch className="h-3.5 w-3.5 mr-1" /> Auto-discovered ({scripts.length})
            </Button>
            <Button variant="outline" onClick={() => setBrowseOpen(false)}>{t("ag.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tur-3b.2 — Manage members modal: two-column add/remove for an operator squad. */}
      <Dialog open={manageSquad !== null} onOpenChange={(o) => { if (!o) setManageSquad(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono">Manage members · {manageSquad}</DialogTitle>
            <DialogDescription className="text-xs">
              Move agents in or out of this squad. Changes apply on click; "Reset" sends an agent back to its disk default.
            </DialogDescription>
          </DialogHeader>
          {manageSquad && (() => {
            const inSquad = agents.filter((a) => {
              const eff = ((a as AgentRow & { effective_squad?: string }).effective_squad
                || ((a.meta ?? {}) as AgentMeta).squad
                || "Unassigned").trim() || "Unassigned";
              return eff === manageSquad;
            });
            const outSquad = agents.filter((a) => {
              const eff = ((a as AgentRow & { effective_squad?: string }).effective_squad
                || ((a.meta ?? {}) as AgentMeta).squad
                || "Unassigned").trim() || "Unassigned";
              return eff !== manageSquad;
            });
            const move = async (id: string, target: string | null) => {
              setManageBusy(true);
              try {
                const r = await AgentsAPI.setAgentSquad(id, target);
                if (!r.ok) { toast.error(`Move failed · ${r.error || "unknown"}`); return; }
                await Promise.all([refresh(), refreshSquads()]);
              } finally { setManageBusy(false); }
            };
            return (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    In squad ({inSquad.length})
                  </p>
                  <div className="border border-border/60 rounded p-2 max-h-[420px] overflow-y-auto space-y-1">
                    {inSquad.length === 0 && <p className="text-xs text-muted-foreground p-2">No agents</p>}
                    {inSquad.map((a) => {
                      const meta = (a.meta ?? {}) as AgentMeta;
                      const Icon = ICON_LOOKUP[meta.icon ?? "Bot"] ?? Bot;
                      return (
                        <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-card/60">
                          <Icon className="h-4 w-4 shrink-0" style={{ color: meta.color ?? "var(--muted-foreground)" }} />
                          <span className="flex-1 text-xs font-mono truncate">{a.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={manageBusy}
                            className="h-6 px-2 text-[10px]"
                            title="Reset to disk default"
                            onClick={() => move(a.id, null)}
                          >
                            ↺ Reset
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Available ({outSquad.length})
                  </p>
                  <div className="border border-border/60 rounded p-2 max-h-[420px] overflow-y-auto space-y-1">
                    {outSquad.length === 0 && <p className="text-xs text-muted-foreground p-2">No agents</p>}
                    {outSquad.map((a) => {
                      const meta = (a.meta ?? {}) as AgentMeta;
                      const Icon = ICON_LOOKUP[meta.icon ?? "Bot"] ?? Bot;
                      const eff = ((a as AgentRow & { effective_squad?: string }).effective_squad
                        || meta.squad
                        || "Unassigned").trim() || "Unassigned";
                      return (
                        <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-card/60">
                          <Icon className="h-4 w-4 shrink-0" style={{ color: meta.color ?? "var(--muted-foreground)" }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono truncate">{a.name}</p>
                            <p className="text-[10px] font-mono text-muted-foreground truncate">in {eff}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={manageBusy}
                            className="h-6 px-2 text-[10px]"
                            title={`Move to ${manageSquad}`}
                            onClick={() => move(a.id, manageSquad)}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Add
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageSquad(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>
        <TabsContent value="history">
          <RunHistoryTable limit={100} sources={["agent-run", "agent-history"]} showTool={false} showAgent />
        </TabsContent>
      </Tabs>
    </PageShell>

  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function ParamSlider({ label, value, setValue, min, max, step }: {
  label: string; value: number[]; setValue: (value: number[]) => void; min: number; max: number; step: number;
}) {
  const v = Number.isFinite(value[0]) ? value[0] : min;
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  // Draft state — kullanıcı serbestçe yazsın; commit blur/Enter'da olsun.
  // Her tuşta clamp uygulamak "4" → 64 gibi sıçramalara yol açıp kutuyu
  // kullanılamaz hale getiriyordu.
  const [draft, setDraft] = useState<string>(String(v));
  useEffect(() => { setDraft(String(v)); }, [v]);

  const commit = (raw: string) => {
    if (raw === "") { setDraft(String(v)); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setDraft(String(v)); return; }
    const c = clamp(n);
    setValue([c]);
    setDraft(String(c));
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</label>
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value); }
            else if (e.key === "Escape") { setDraft(String(v)); (e.target as HTMLInputElement).blur(); }
          }}
          className="h-7 w-24 text-xs font-mono font-bold text-primary text-right"
        />
      </div>
      <Slider value={[v]} onValueChange={(nv) => { setValue(nv); setDraft(String(nv[0])); }} min={min} max={max} step={step} />
    </div>
  );
}


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded p-2 bg-card/40">
      <p className="text-[9px] uppercase font-mono text-muted-foreground">{label}</p>
      <p className="text-sm font-bold text-primary mt-0.5">{value}</p>
    </div>
  );
}
