import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Activity,
  Zap,
  Terminal,
  RefreshCw,
  Sliders,
  SlidersHorizontal,
  Pencil,
  Layers,
  Sparkles,
  Bot,
  Brain,
  Library,
  X,
} from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { cn } from "@/lib/utils";
import { fetchApi } from "@/lib/api";

const description =
  "Universal Sovereign AI Gateway & B2B Developer Hub — Google AI Studio style AES-256 vault keys, dynamic rate limit tiers and FinOps token ledger.";

export const Route = createFileRoute("/api-tokens")({
  head: () => ({
    meta: [
      { title: "Developer Hub — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Developer Hub — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ApiTokensPage,
});

type ApiKeyItem = {
  id: string;
  name: string;
  key_prefix: string;
  raw_key: string;
  tenant_id: string;
  user_id: string;
  role: string;
  tier: string;
  tier_name: string;
  rpm_limit: number;
  tpm_limit: number;
  monthly_token_quota: string;
  max_concurrency: number;
  allowed_models: string[];
  allowed_spaces: string[];
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

type RateLimitTier = {
  id: string;
  tier: string;
  name: string;
  rpm_limit: number;
  tpm_limit: number;
  monthly_token_quota: string;
  max_concurrency: number;
  created_at?: string;
};

type UsageSummary = {
  monthly_tokens: number;
  monthly_cost: number;
  total_requests: number;
  total_errors: number;
};

type KeyBreakdown = {
  api_key_id: string;
  key_name: string;
  key_prefix: string;
  tier: string;
  tokens: number;
  cost: number;
  requests: number;
};

type NamedEntity = {
  id: string;
  name: string;
  category?: string;
};

function ApiTokensPage() {
  const [activeTab, setActiveTab] = useState<"keys" | "tiers" | "usage">("keys");
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [tiers, setTiers] = useState<RateLimitTier[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [keyBreakdown, setKeyBreakdown] = useState<KeyBreakdown[]>([]);

  // Entities for modern 3-way card selector
  const [availableModels, setAvailableModels] = useState<NamedEntity[]>([]);
  const [availableSpaces, setAvailableSpaces] = useState<NamedEntity[]>([]);
  const [availableAgents, setAvailableAgents] = useState<NamedEntity[]>([]);

  const [loading, setLoading] = useState(true);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Key Create / Edit Modal State
  const [createKeyModalOpen, setCreateKeyModalOpen] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [isCustomScope, setIsCustomScope] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  // Dropdown transient states inside modal
  const [modelSelectVal, setModelSelectVal] = useState("");
  const [spaceSelectVal, setSpaceSelectVal] = useState("");
  const [agentSelectVal, setAgentSelectVal] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);

  // Tier Modal State (Admin Rate Limit Management)
  const [tierModalOpen, setTierModalOpen] = useState(false);
  const [editingTierSlug, setEditingTierSlug] = useState<string | null>(null);
  const [tierFormSlug, setTierFormSlug] = useState("");
  const [tierFormName, setTierFormName] = useState("");
  const [tierFormRpm, setTierFormRpm] = useState(30);
  const [tierFormTpm, setTierFormTpm] = useState(100000);
  const [tierFormQuota, setTierFormQuota] = useState(25000000);
  const [tierFormConcurrency, setTierFormConcurrency] = useState(5);
  const [savingTier, setSavingTier] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, tiersRes, usageRes, providersRes, spacesRes, agentsRes] = await Promise.all([
        fetchApi("/api/developer/keys"),
        fetchApi("/api/developer/tiers"),
        fetchApi("/api/developer/usage"),
        fetchApi("/api/system/providers").catch(() => []),
        fetchApi("/api/knowledge/spaces").catch(() => []),
        fetchApi("/api/agents").catch(() => []),
      ]);

      if (keysRes?.ok && keysRes?.keys) {
        setKeys(keysRes.keys || []);
      }
      if (tiersRes?.ok && tiersRes?.tiers) {
        setTiers(tiersRes.tiers || []);
      }
      if (usageRes?.ok && usageRes?.summary) {
        setUsage(usageRes.summary);
        setKeyBreakdown(usageRes.key_breakdown || []);
      }

      // 1. Models Catalog (Deduplicated)
      const mList: NamedEntity[] = [];
      const seenNames = new Set<string>();

      const addModelUnique = (id: string, name: string) => {
        const key = (name || id).trim().toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          mList.push({ id, name: name || id });
        }
      };

      if (Array.isArray(providersRes)) {
        for (const p of providersRes) {
          const mId = p.model || p.name || p.id;
          const mName = p.name || p.model || mId;
          addModelUnique(mId, mName);
        }
      }

      addModelUnique("elara-smart", "Elara Smart Router");
      addModelUnique("gemma4-31b", "Gemma 4 31B Local");
      setAvailableModels(mList);

      // 2. Spaces Catalog
      const sList: NamedEntity[] = [];
      if (Array.isArray(spacesRes)) {
        for (const s of spacesRes) {
          sList.push({ id: s.slug || s.name, name: s.name });
        }
      }
      setAvailableSpaces(sList);

      // 3. Agents Catalog
      const aList: NamedEntity[] = [];
      if (Array.isArray(agentsRes)) {
        for (const a of agentsRes) {
          aList.push({ id: a.name || a.agent_name || a.id, name: a.name || a.agent_name || a.id });
        }
      }
      setAvailableAgents(aList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Failed to load developer hub: " + msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (keyStr: string, id: string) => {
    navigator.clipboard.writeText(keyStr);
    setCopiedKeyId(id);
    toast.success("API Key copied to clipboard!");
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const handleAddEntity = (
    type: "model" | "space" | "agent",
    val: string,
    setVal: (v: string) => void
  ) => {
    if (!val) return;
    if (type === "model" && !selectedModels.includes(val)) {
      setSelectedModels((prev) => [...prev, val]);
    }
    if (type === "space" && !selectedSpaces.includes(val)) {
      setSelectedSpaces((prev) => [...prev, val]);
    }
    if (type === "agent" && !selectedAgents.includes(val)) {
      setSelectedAgents((prev) => [...prev, val]);
    }
    setVal("");
  };

  const handleRemoveEntity = (type: "model" | "space" | "agent", id: string) => {
    if (type === "model") setSelectedModels((prev) => prev.filter((m) => m !== id));
    if (type === "space") setSelectedSpaces((prev) => prev.filter((s) => s !== id));
    if (type === "agent") setSelectedAgents((prev) => prev.filter((a) => a !== id));
  };

  const openKeyModal = (keyItem?: ApiKeyItem) => {
    if (keyItem) {
      setEditingKeyId(keyItem.id);
      setNewKeyName(keyItem.name);
      const perms = Array.isArray(keyItem.allowed_models) ? keyItem.allowed_models : [];
      if (perms.length > 0) {
        setIsCustomScope(true);
        setSelectedModels(perms.filter((m) => !m.startsWith("space:") && !availableAgents.some((a) => a.id === m)));
        setSelectedSpaces(
          perms
            .filter((m) => m.startsWith("space:") || availableSpaces.some((s) => s.id === m))
            .map((m) => m.replace(/^space:/, ""))
        );
        setSelectedAgents(perms.filter((m) => availableAgents.some((a) => a.id === m)));
      } else {
        setIsCustomScope(false);
        setSelectedModels([]);
        setSelectedSpaces([]);
        setSelectedAgents([]);
      }
    } else {
      setEditingKeyId(null);
      setNewKeyName("");
      setIsCustomScope(false);
      setSelectedModels([]);
      setSelectedSpaces([]);
      setSelectedAgents([]);
    }
    setModelSelectVal("");
    setSpaceSelectVal("");
    setAgentSelectVal("");
    setCreateKeyModalOpen(true);
  };

  const handleSaveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      toast.error("Please provide a name for this API key.");
      return;
    }

    // Combine models, spaces and agents if scoped
    const combinedPermissions = isCustomScope
      ? [
          ...selectedModels,
          ...selectedSpaces.map((s) => (s.startsWith("space:") ? s : `space:${s}`)),
          ...selectedAgents,
        ]
      : [];

    setCreatingKey(true);
    try {
      if (editingKeyId) {
        const res = await fetchApi(`/api/developer/keys/${editingKeyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newKeyName.trim(),
            allowed_models: combinedPermissions,
          }),
        });

        if (res?.ok) {
          toast.success("API Key updated successfully!");
          setCreateKeyModalOpen(false);
          loadData();
        }
      } else {
        const res = await fetchApi("/api/developer/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newKeyName.trim(),
            allowed_models: combinedPermissions,
          }),
        });

        if (res?.ok && res?.key) {
          toast.success("API Key generated successfully!");
          setCreateKeyModalOpen(false);
          loadData();
        } else {
          toast.error("Failed to generate API Key.");
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Error saving key: " + msg);
    } finally {
      setCreatingKey(false);
    }
  };

  const handleDeleteKey = async (id: string, name: string) => {
    const ok = await confirmAction({
      title: "Revoke API Key",
      body: `Are you sure you want to revoke '${name}'? Any application using this key will immediately receive HTTP 401 Unauthorized.`,
      confirmLabel: "Revoke Key",
      tone: "ruby",
    });

    if (!ok) return;

    try {
      const res = await fetchApi(`/api/developer/keys/${id}`, { method: "DELETE" });
      if (res?.ok) {
        toast.success("API Key revoked successfully.");
        loadData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Failed to delete key: " + msg);
    }
  };

  // Tier Modal Open Handler
  const openTierModal = (tierItem?: RateLimitTier) => {
    if (tierItem) {
      setEditingTierSlug(tierItem.tier);
      setTierFormSlug(tierItem.tier);
      setTierFormName(tierItem.name);
      setTierFormRpm(tierItem.rpm_limit);
      setTierFormTpm(tierItem.tpm_limit);
      setTierFormQuota(Number(tierItem.monthly_token_quota));
      setTierFormConcurrency(tierItem.max_concurrency);
    } else {
      setEditingTierSlug(null);
      setTierFormSlug("");
      setTierFormName("");
      setTierFormRpm(30);
      setTierFormTpm(100000);
      setTierFormQuota(25000000);
      setTierFormConcurrency(5);
    }
    setTierModalOpen(true);
  };

  const handleSaveTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tierFormName.trim() || (!editingTierSlug && !tierFormSlug.trim())) {
      toast.error("Please fill in tier identifier and name.");
      return;
    }

    setSavingTier(true);
    try {
      if (editingTierSlug) {
        const res = await fetchApi(`/api/developer/tiers/${editingTierSlug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: tierFormName.trim(),
            rpm_limit: Number(tierFormRpm),
            tpm_limit: Number(tierFormTpm),
            monthly_token_quota: Number(tierFormQuota),
            max_concurrency: Number(tierFormConcurrency),
          }),
        });
        if (res?.ok) {
          toast.success("Rate Limit Tier updated successfully!");
          setTierModalOpen(false);
          loadData();
        }
      } else {
        const res = await fetchApi("/api/developer/tiers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tier: tierFormSlug.trim(),
            name: tierFormName.trim(),
            rpm_limit: Number(tierFormRpm),
            tpm_limit: Number(tierFormTpm),
            monthly_token_quota: Number(tierFormQuota),
            max_concurrency: Number(tierFormConcurrency),
          }),
        });
        if (res?.ok) {
          toast.success("New Rate Limit Tier created!");
          setTierModalOpen(false);
          loadData();
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Error saving tier: " + msg);
    } finally {
      setSavingTier(false);
    }
  };

  const handleDeleteTier = async (tierSlug: string, tierName: string) => {
    if (tierSlug === "tier1") {
      toast.error("Tier 1 is the default baseline tier and cannot be deleted.");
      return;
    }

    const ok = await confirmAction({
      title: "Delete Rate Limit Tier",
      body: `Are you sure you want to delete '${tierName}' (${tierSlug})? Any active keys using this tier will automatically fallback to Tier 1.`,
      confirmLabel: "Delete Tier",
      tone: "ruby",
    });

    if (!ok) return;

    try {
      const res = await fetchApi(`/api/developer/tiers/${tierSlug}`, { method: "DELETE" });
      if (res?.ok) {
        toast.success(res.message || "Tier deleted successfully.");
        loadData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Failed to delete tier: " + msg);
    }
  };

  // Quota calculation
  const totalTokensUsed = usage?.monthly_tokens || 0;
  const currentQuota = 10000000;
  const quotaPercent = Math.min(100, Math.round((totalTokensUsed / currentQuota) * 100));

  return (
    <Surface title="Developer Hub" meta="API KEYS · DYNAMIC RATE LIMITS · OPENAI GATEWAY" wide>
      <div className="space-y-6">
        {/* Navigation Sub-Tabs */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("keys")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 font-mono text-xs transition-all",
                activeTab === "keys"
                  ? "border border-sapphire/40 bg-sapphire/15 text-sapphire font-semibold"
                  : "text-muted-foreground hover:bg-raised/40 hover:text-foreground"
              )}
            >
              <KeyRound className="h-3.5 w-3.5" />
              API Credentials ({keys.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("tiers")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 font-mono text-xs transition-all",
                activeTab === "tiers"
                  ? "border border-emerald/40 bg-emerald/15 text-emerald font-semibold"
                  : "text-muted-foreground hover:bg-raised/40 hover:text-foreground"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Rate Limit Tiers ({tiers.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("usage")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 font-mono text-xs transition-all",
                activeTab === "usage"
                  ? "border border-topaz/40 bg-topaz/15 text-topaz font-semibold"
                  : "text-muted-foreground hover:bg-raised/40 hover:text-foreground"
              )}
            >
              <Activity className="h-3.5 w-3.5" />
              Gateway Metering
            </button>
          </div>

          <div className="flex items-center gap-2">
            <JewelButton variant="outline" size="sm" onClick={() => { loadData(); }} disabled={loading}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </JewelButton>

            {activeTab === "keys" && (
              <JewelButton variant="primary" size="sm" onClick={() => openKeyModal()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Generate API Key
              </JewelButton>
            )}

            {activeTab === "tiers" && (
              <JewelButton variant="primary" size="sm" onClick={() => openTierModal()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Rate Limit Tier
              </JewelButton>
            )}
          </div>
        </div>

        {/* Top KPI Banner */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-raised/30 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                Active Keys
              </span>
              <Terminal className="h-4 w-4 text-sapphire" />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {keys.filter((k) => k.status === "active").length}
            </div>
            <span className="text-[11px] text-muted-foreground/60">
              Across all tenant applications
            </span>
          </div>

          <div className="rounded-xl border border-white/10 bg-raised/30 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                Configured Tiers
              </span>
              <Sliders className="h-4 w-4 text-emerald" />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {tiers.length} Tiers
            </div>
            <span className="text-[11px] text-muted-foreground/60">
              Sliding-window RPM / TPM rules
            </span>
          </div>

          <div className="rounded-xl border border-white/10 bg-raised/30 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                Monthly Tokens Metered
              </span>
              <Activity className="h-4 w-4 text-emerald" />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {(totalTokensUsed / 1000000).toFixed(2)}M
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground/60">
              <span>Baseline: {(currentQuota / 1000000).toFixed(0)}M</span>
              <span className={quotaPercent > 80 ? "text-amber-400 font-mono" : "text-emerald font-mono"}>
                {quotaPercent}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/6">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  quotaPercent > 80 ? "bg-amber-400" : "bg-emerald"
                )}
                style={{ width: `${quotaPercent}%` }}
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-raised/30 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                Total Requests
              </span>
              <Zap className="h-4 w-4 text-topaz" />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {usage?.total_requests?.toLocaleString() || 0}
            </div>
            <span className="text-[11px] text-muted-foreground/60">
              Redis pipeline rate-limited
            </span>
          </div>
        </div>

        {/* TAB 1: API CREDENTIALS */}
        {activeTab === "keys" && (
          <div className="space-y-4">
            {keys.length === 0 && !loading && (
              <div className="rounded-xl border border-dashed border-white/10 p-12 text-center">
                <KeyRound className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <h4 className="mt-3 text-sm font-medium text-foreground">No API Keys Generated</h4>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Generate your first API key to connect external applications, Python scripts, or SDKs to ELARA.
                </p>
                <div className="mt-4">
                  <JewelButton variant="primary" size="sm" onClick={() => openKeyModal()}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Generate API Key
                  </JewelButton>
                </div>
              </div>
            )}

            {keys.map((key) => {
              const isRevealed = !!revealedKeys[key.id];
              const isCopied = copiedKeyId === key.id;
              const hasModelFilter = Array.isArray(key.allowed_models) && key.allowed_models.length > 0;

              return (
                <motion.div
                  key={key.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group relative rounded-xl border border-white/10 bg-raised/40 p-4 transition-all hover:border-white/20 hover:bg-raised/60"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground text-sm">{key.name}</span>
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
                            key.tier === "tier3"
                              ? "border border-purple-500/30 bg-purple-500/15 text-purple-400"
                              : key.tier === "tier2"
                                ? "border border-sapphire/30 bg-sapphire/15 text-sapphire"
                                : "border border-emerald/30 bg-emerald/15 text-emerald"
                          )}
                        >
                          {key.tier_name || key.tier}
                        </span>
                        <span className="rounded-md border border-white/6 bg-black/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70">
                          {key.rpm_limit} RPM · {(key.tpm_limit / 1000).toFixed(0)}K TPM
                        </span>
                      </div>

                      {/* Secret Key Input Bar */}
                      <div className="flex items-center gap-2">
                        <div className="flex select-all items-center rounded-lg border border-white/8 bg-black/40 px-3 py-1.5 font-mono text-xs text-foreground/90">
                          {isRevealed ? (
                            <span>{key.raw_key}</span>
                          ) : (
                            <span>{key.key_prefix}••••••••••••••••••••••••••••••••</span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleReveal(key.id)}
                          className="rounded-lg border border-white/8 bg-raised/50 p-1.5 text-muted-foreground/70 transition-colors hover:bg-raised hover:text-foreground"
                          title={isRevealed ? "Hide Key" : "Reveal Key (Google AI Studio Model)"}
                        >
                          {isRevealed ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5 text-sapphire" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => copyToClipboard(key.raw_key, key.id)}
                          className="rounded-lg border border-white/8 bg-raised/50 p-1.5 text-muted-foreground/70 transition-colors hover:bg-raised hover:text-foreground"
                          title="Copy API Key"
                        >
                          {isCopied ? (
                            <Check className="h-3.5 w-3.5 text-emerald" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>

                      {/* Allowed Models & Permissions Tags */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                        <span className="text-muted-foreground/60 font-mono text-[10.5px]">MODELS:</span>
                        {!hasModelFilter ? (
                          <span className="rounded border border-white/6 bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-muted-foreground/80">
                            All Sovereign & Configured Models
                          </span>
                        ) : (
                          key.allowed_models.map((m) => (
                            <span
                              key={m}
                              className="rounded border border-sapphire/20 bg-sapphire/10 px-2 py-0.5 font-mono text-[10px] text-sapphire"
                            >
                              {m}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Metadata & Actions */}
                    <div className="flex items-center justify-between gap-3 md:justify-end">
                      <div className="text-right text-[11px] text-muted-foreground/60 font-mono">
                        <div>Created {new Date(key.created_at).toLocaleDateString()}</div>
                        <div>
                          {key.last_used_at
                            ? `Last used ${new Date(key.last_used_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                            : "Never used"}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openKeyModal(key)}
                          className="rounded-lg border border-white/10 bg-raised/50 p-2 text-muted-foreground transition-colors hover:border-sapphire/40 hover:text-foreground"
                          title="Edit API Key Permissions"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => { handleDeleteKey(key.id, key.name); }}
                          className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-red-400 transition-colors hover:bg-red-500/20"
                          title="Revoke Key"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {/* Quick Connection Code Snippet */}
            <div className="rounded-xl border border-white/8 bg-black/40 p-4">
              <div className="flex items-center justify-between border-b border-white/6 pb-2">
                <span className="flex items-center gap-1.5 font-mono text-xs font-medium text-muted-foreground">
                  <Terminal className="h-3.5 w-3.5 text-sapphire" />
                  Quickstart — Universal OpenAI SDK Integration
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/50">
                  Python 3.10+ / Node.js
                </span>
              </div>
              <pre className="mt-3 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-foreground/90">
                {`from openai import OpenAI

# Connect directly to ELARA Sovereign AI Gateway
client = OpenAI(
    base_url="http://127.0.0.1:3005/v1",
    api_key="sk-elara-live-..."  # Your generated API Key
)

response = client.chat.completions.create(
    model="gemma-31b-local",  # Or RAG space: 'technical', or agent: 'Technical_Librarian'
    messages=[{"role": "user", "content": "Hello Sovereign AI Gateway!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`}
              </pre>
            </div>
          </div>
        )}

        {/* TAB 2: RATE LIMIT TIERS & QUOTA MANAGEMENT */}
        {activeTab === "tiers" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tiers.map((t) => (
                <motion.div
                  key={t.tier}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col justify-between rounded-xl border border-white/10 bg-raised/30 p-5 transition-all hover:border-white/20"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold uppercase text-sapphire">
                        {t.tier}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openTierModal(t)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-white/6 hover:text-foreground"
                          title="Edit Tier Limits"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {t.tier !== "tier1" && (
                          <button
                            type="button"
                            onClick={() => { handleDeleteTier(t.tier, t.name); }}
                            className="rounded-md p-1.5 text-red-400 hover:bg-red-500/15"
                            title="Delete Tier"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <h4 className="mt-1 text-base font-semibold text-foreground">{t.name}</h4>

                    <div className="mt-4 space-y-2.5 border-t border-white/6 pt-3 font-mono text-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Requests Per Minute (RPM):</span>
                        <span className="font-semibold text-foreground">{t.rpm_limit} RPM</span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Tokens Per Minute (TPM):</span>
                        <span className="font-semibold text-foreground">
                          {(t.tpm_limit / 1000).toLocaleString()}K TPM
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Monthly Token Quota:</span>
                        <span className="font-semibold text-emerald">
                          {(Number(t.monthly_token_quota) / 1000000).toLocaleString()}M Tokens
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Max Concurrency:</span>
                        <span className="font-semibold text-foreground">{t.max_concurrency} Requests</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-white/6 pt-3 text-[11px] text-muted-foreground/60">
                    Active keys assigned: {keys.filter((k) => k.tier === t.tier).length}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: GATEWAY METERING & USAGE */}
        {activeTab === "usage" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-raised/30 p-5">
              <h4 className="font-medium text-foreground">API Key Consumption Breakdown</h4>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                Detailed token usage, latency and cost attribution for each active developer key.
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-white/8 text-muted-foreground/70">
                      <th className="pb-2.5 font-normal uppercase tracking-wider">Application Name</th>
                      <th className="pb-2.5 font-normal uppercase tracking-wider">Key Prefix</th>
                      <th className="pb-2.5 font-normal uppercase tracking-wider">Tier</th>
                      <th className="pb-2.5 font-normal uppercase tracking-wider text-right">Requests</th>
                      <th className="pb-2.5 font-normal uppercase tracking-wider text-right">Tokens Metered</th>
                      <th className="pb-2.5 font-normal uppercase tracking-wider text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyBreakdown.map((kb) => (
                      <tr key={kb.api_key_id} className="border-b border-white/4 hover:bg-white/2">
                        <td className="py-2.5 font-medium text-foreground">{kb.key_name}</td>
                        <td className="py-2.5 text-muted-foreground">{kb.key_prefix}</td>
                        <td className="py-2.5">
                          <span className="rounded bg-sapphire/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sapphire">
                            {kb.tier}
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-foreground">{kb.requests.toLocaleString()}</td>
                        <td className="py-2.5 text-right font-semibold text-foreground">
                          {(kb.tokens / 1000).toFixed(1)}K
                        </td>
                        <td className="py-2.5 text-right font-semibold text-emerald">
                          ${kb.cost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {keyBreakdown.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center font-sans text-xs text-muted-foreground/50">
                          No direct API usage recorded this month yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: Generate API Key with 3-Way Scoped Configuration Cards */}
      <AnimatePresence>
        {createKeyModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-surface-overlay p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/8 pb-3">
                <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <KeyRound className="h-4 w-4 text-sapphire" />
                  {editingKeyId ? "Edit API Key Permissions" : "Generate New API Key"}
                </h3>
                <button
                  onClick={() => setCreateKeyModalOpen(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-white/6"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveKey} className="mt-4 space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                    Application / Purpose Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ERP Integration / Support Bot"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="w-full rounded-lg border border-white/8 bg-raised/50 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-sapphire"
                  />
                </div>

                {/* Scope Policy Switch */}
                <div className="rounded-xl border border-white/8 bg-raised/20 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-foreground">Access Envelope</div>
                      <div className="text-[11px] text-muted-foreground/60">
                        {isCustomScope
                          ? "Custom restricted permissions enabled below."
                          : "Full Access: Key can access all models, spaces & agents."}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCustomScope(!isCustomScope)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition-all",
                        isCustomScope
                          ? "border-sapphire bg-sapphire/15 text-sapphire"
                          : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {isCustomScope ? "Custom Scoped" : "Full Access (All)"}
                    </button>
                  </div>
                </div>

                {/* 3 CONFIGURATION CARDS (When Custom Scoped) */}
                {isCustomScope && (
                  <div className="space-y-3 pt-1">
                    {/* Card 1: Models */}
                    <div className="rounded-xl border border-white/8 bg-raised/30 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/70 flex items-center gap-1.5">
                          <Brain className="h-3.5 w-3.5 text-sapphire" />
                          LLM Models · {selectedModels.length}/{availableModels.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={modelSelectVal}
                          onChange={(e) => setModelSelectVal(e.target.value)}
                          className="flex-1 rounded-lg border border-white/10 bg-[#121216] px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-sapphire"
                        >
                          <option value="" className="bg-[#18181e] text-muted-foreground">— Select Model to authorize —</option>
                          {availableModels
                            .filter((m) => !selectedModels.includes(m.id))
                            .map((m) => (
                              <option key={m.id} value={m.id} className="bg-[#18181e] text-foreground py-1.5">
                                {m.name}
                              </option>
                            ))}
                        </select>
                        <JewelButton
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!modelSelectVal}
                          onClick={() => handleAddEntity("model", modelSelectVal, setModelSelectVal)}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add
                        </JewelButton>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {selectedModels.length === 0 ? (
                          <span className="font-mono text-[11px] text-muted-foreground/45">
                            No models bound.
                          </span>
                        ) : (
                          selectedModels.map((mId) => (
                            <span
                              key={mId}
                              className="inline-flex items-center gap-1.5 rounded-md border border-sapphire/30 bg-sapphire/15 px-2 py-1 font-mono text-[11px] text-sapphire"
                            >
                              {availableModels.find((m) => m.id === mId)?.name || mId}
                              <button
                                type="button"
                                onClick={() => handleRemoveEntity("model", mId)}
                                className="text-sapphire/60 hover:text-sapphire"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Card 2: Knowledge / RAG Spaces */}
                    <div className="rounded-xl border border-white/8 bg-raised/30 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/70 flex items-center gap-1.5">
                          <Library className="h-3.5 w-3.5 text-emerald" />
                          RAG Knowledge Spaces · {selectedSpaces.length}/{availableSpaces.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={spaceSelectVal}
                          onChange={(e) => setSpaceSelectVal(e.target.value)}
                          className="flex-1 rounded-lg border border-white/10 bg-[#121216] px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-emerald"
                        >
                          <option value="" className="bg-[#18181e] text-muted-foreground">— Select Knowledge Space —</option>
                          {availableSpaces
                            .filter((s) => !selectedSpaces.includes(s.id))
                            .map((s) => (
                              <option key={s.id} value={s.id} className="bg-[#18181e] text-foreground py-1.5">
                                {s.name}
                              </option>
                            ))}
                        </select>
                        <JewelButton
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!spaceSelectVal}
                          onClick={() => handleAddEntity("space", spaceSelectVal, setSpaceSelectVal)}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add
                        </JewelButton>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {selectedSpaces.length === 0 ? (
                          <span className="font-mono text-[11px] text-muted-foreground/45">
                            No RAG spaces bound · Direct model execution.
                          </span>
                        ) : (
                          selectedSpaces.map((sId) => (
                            <span
                              key={sId}
                              className="inline-flex items-center gap-1.5 rounded-md border border-emerald/30 bg-emerald/15 px-2 py-1 font-mono text-[11px] text-emerald"
                            >
                              {availableSpaces.find((s) => s.id === sId)?.name || sId}
                              <button
                                type="button"
                                onClick={() => handleRemoveEntity("space", sId)}
                                className="text-emerald/60 hover:text-emerald"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Card 3: Agents */}
                    <div className="rounded-xl border border-white/8 bg-raised/30 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/70 flex items-center gap-1.5">
                          <Bot className="h-3.5 w-3.5 text-topaz" />
                          Autonomous & RAG Agents · {selectedAgents.length}/{availableAgents.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={agentSelectVal}
                          onChange={(e) => setAgentSelectVal(e.target.value)}
                          className="flex-1 rounded-lg border border-white/10 bg-[#121216] px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-topaz"
                        >
                          <option value="" className="bg-[#18181e] text-muted-foreground">— Select Specialized Agent —</option>
                          {availableAgents
                            .filter((a) => !selectedAgents.includes(a.id))
                            .map((a) => (
                              <option key={a.id} value={a.id} className="bg-[#18181e] text-foreground py-1.5">
                                {a.name}
                              </option>
                            ))}
                        </select>
                        <JewelButton
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!agentSelectVal}
                          onClick={() => handleAddEntity("agent", agentSelectVal, setAgentSelectVal)}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add
                        </JewelButton>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {selectedAgents.length === 0 ? (
                          <span className="font-mono text-[11px] text-muted-foreground/45">
                            No autonomous agents bound.
                          </span>
                        ) : (
                          selectedAgents.map((aId) => (
                            <span
                              key={aId}
                              className="inline-flex items-center gap-1.5 rounded-md border border-topaz/30 bg-topaz/15 px-2 py-1 font-mono text-[11px] text-topaz"
                            >
                              {availableAgents.find((a) => a.id === aId)?.name || aId}
                              <button
                                type="button"
                                onClick={() => handleRemoveEntity("agent", aId)}
                                className="text-topaz/60 hover:text-topaz"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 border-t border-white/8 pt-4">
                  <JewelButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreateKeyModalOpen(false)}
                  >
                    Cancel
                  </JewelButton>
                  <JewelButton type="submit" variant="primary" size="sm" disabled={creatingKey}>
                    {creatingKey ? "Saving..." : editingKeyId ? "Save Permissions" : "Generate API Key"}
                  </JewelButton>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Create / Edit Rate Limit Tier */}
      <AnimatePresence>
        {tierModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg rounded-2xl border border-white/10 bg-surface-overlay p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/8 pb-3">
                <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <SlidersHorizontal className="h-4 w-4 text-emerald" />
                  {editingTierSlug ? `Edit Tier: ${editingTierSlug}` : "Create New Rate Limit Tier"}
                </h3>
                <button
                  onClick={() => setTierModalOpen(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-white/6"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveTier} className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                      Tier Slug / Identifier
                    </label>
                    <input
                      type="text"
                      required
                      disabled={!!editingTierSlug}
                      placeholder="e.g. tier_custom_client"
                      value={tierFormSlug}
                      onChange={(e) => setTierFormSlug(e.target.value)}
                      className="w-full rounded-lg border border-white/8 bg-raised/50 px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-emerald disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                      Display Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Client X Dedicated Tier"
                      value={tierFormName}
                      onChange={(e) => setTierFormName(e.target.value)}
                      className="w-full rounded-lg border border-white/8 bg-raised/50 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-emerald"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                      RPM Limit (Req / Minute)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      required
                      value={tierFormRpm}
                      onChange={(e) => setTierFormRpm(Number(e.target.value))}
                      className="w-full rounded-lg border border-white/8 bg-raised/50 px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-emerald"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                      TPM Limit (Tokens / Minute)
                    </label>
                    <input
                      type="number"
                      min={1000}
                      max={50000000}
                      required
                      value={tierFormTpm}
                      onChange={(e) => setTierFormTpm(Number(e.target.value))}
                      className="w-full rounded-lg border border-white/8 bg-raised/50 px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-emerald"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                      Monthly Token Quota
                    </label>
                    <input
                      type="number"
                      min={100000}
                      max={100000000000}
                      required
                      value={tierFormQuota}
                      onChange={(e) => setTierFormQuota(Number(e.target.value))}
                      className="w-full rounded-lg border border-white/8 bg-raised/50 px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-emerald"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                      Max Concurrency
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      required
                      value={tierFormConcurrency}
                      onChange={(e) => setTierFormConcurrency(Number(e.target.value))}
                      className="w-full rounded-lg border border-white/8 bg-raised/50 px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-emerald"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-white/8 pt-4">
                  <JewelButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setTierModalOpen(false)}
                  >
                    Cancel
                  </JewelButton>
                  <JewelButton type="submit" variant="primary" size="sm" disabled={savingTier}>
                    {savingTier ? "Saving..." : editingTierSlug ? "Update Tier Limits" : "Create Tier"}
                  </JewelButton>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Surface>
  );
}
