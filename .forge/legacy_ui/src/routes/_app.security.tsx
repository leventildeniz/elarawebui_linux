import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Minus, Wifi, Save, ShieldCheck, ShieldAlert, RefreshCw, Trash2, Loader2, Eye, EyeOff, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { useSecurity, type SiemConfig } from "@/lib/security-store";
import { loadGuard, saveGuard, loadEvents, type GuardConfig } from "@/lib/safety";

import { useI18n } from "@/lib/i18n";
import { SiemAPI, VaultAPI, type SiemStatusDTO, type VaultItem, type VaultKind, type VaultAuditEntry, type VaultAuditChainResult } from "@/lib/api-client";

import { toast } from "sonner";

export const Route = createFileRoute("/_app/security")({ component: SecurityPage });

function SecurityPage() {
  const { t } = useI18n();
  const sec = useSecurity();
  const [guard, setGuard] = useState<GuardConfig>(() => loadGuard());
  const persistGuard = (g: GuardConfig) => { setGuard(g); saveGuard(g); };
  const [siemTest, setSiemTest] = useState<string>("");
  const [siemStatus, setSiemStatus] = useState<SiemStatusDTO | null>(null);
  const [siemSaving, setSiemSaving] = useState(false);

  // Hydrate live SIEM config + status from server on mount so multiple
  // operators see the same configuration regardless of localStorage.
  // Polling visibility/streaming-gated via useVisiblePoll — arka plan sekme
  // CPU/RAM yakmıyor, chat streaming sırasında re-render baskısı yok.
  const pullSiem = useCallback(async () => {
    const r = await SiemAPI.get();
    if (r.config) sec.setSiem(r.config as SiemConfig);
    if (r.status) setSiemStatus(r.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useVisiblePoll(pullSiem, 15000);

  const saveSiem = async () => {
    setSiemSaving(true);
    const r = await SiemAPI.put(sec.siem);
    setSiemSaving(false);
    if (r.ok) {
      setSiemStatus(r.status ?? null);
      toast.success("SIEM config sealed");
    } else {
      toast.error(r.error || "Failed to seal SIEM config");
    }
  };
  const testSiem = async () => {
    setSiemTest("…testing");
    const r = await SiemAPI.test(sec.siem);
    const sent = (r as Partial<SiemStatusDTO>).sent ?? 0;
    if (r.ok) setSiemTest(`OK · ${sec.siem.host}:${sec.siem.port}/${sec.siem.protocol.toUpperCase()} · sent=${sent}`);
    else setSiemTest(`FAIL · ${r.error || "unknown error"}`);
  };

  return (
    <PageShell>
      <PageHeader title={t("page.security.title")} subtitle={t("page.security.subtitle")} />
      <Tabs defaultValue="siem">
        <TabsList className="glass mb-4 flex-wrap h-auto">
          <TabsTrigger value="siem">Syslog · SIEM</TabsTrigger>
          <TabsTrigger value="vault">{t("sec.tab_vault")}</TabsTrigger>
          <TabsTrigger value="guard">{t("sec.tab_guard")}</TabsTrigger>
          <TabsTrigger value="audit">{t("sec.tab_audit")}</TabsTrigger>
          <TabsTrigger value="sandbox">{t("sec.tab_sandbox")}</TabsTrigger>
          <TabsTrigger value="signed">{t("sec.tab_signed")}</TabsTrigger>
        </TabsList>

        {/* SIEM */}
        <TabsContent value="siem" className="space-y-4">
          {siemStatus && (
            <Card className="glass"><CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <div>
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">Forwarder</div>
                  <Badge variant="outline" className={`mt-1 font-mono text-[10px] ${sec.siem.enabled ? "text-primary border-primary" : "text-muted-foreground"}`}>
                    {sec.siem.enabled ? "ENABLED" : "DISABLED"}
                  </Badge>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">Sent</div>
                  <div className="text-2xl font-mono font-bold text-primary mt-1">{siemStatus.sent}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">Queue Depth</div>
                  <div className="text-2xl font-mono font-bold mt-1">{siemStatus.queueDepth}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">Dropped</div>
                  <div className={`text-2xl font-mono font-bold mt-1 ${siemStatus.dropped > 0 ? "text-destructive" : ""}`}>{siemStatus.dropped}</div>
                </div>
              </div>
            </CardContent></Card>
          )}
          <Card className="glass"><CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm font-mono uppercase tracking-widest">{t("sec.siem_forwarder")}</h3>
              <Switch checked={sec.siem.enabled} onCheckedChange={(v)=>sec.setSiem({...sec.siem, enabled:v})} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>SIEM Server (IP / Host)</Label>
                <Input value={sec.siem.host} onChange={e=>sec.setSiem({...sec.siem, host:e.target.value})} className="font-mono mt-1" /></div>
              <div><Label>{t("sec.port")}</Label>
                <Input type="number" value={sec.siem.port} onChange={e=>sec.setSiem({...sec.siem, port:Number(e.target.value)})} className="font-mono mt-1" /></div>
              <div><Label>{t("sec.protocol")}</Label>
                <Select value={sec.siem.protocol} onValueChange={(v)=>sec.setSiem({...sec.siem, protocol:v as SiemConfig["protocol"]})}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem><SelectItem value="tcp">TCP</SelectItem><SelectItem value="tls">TLS</SelectItem>
                  </SelectContent>
                </Select></div>
              <div><Label>{t("sec.format")}</Label>
                <Select value={sec.siem.format} onValueChange={(v)=>sec.setSiem({...sec.siem, format:v as SiemConfig["format"]})}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CEF">CEF · ArcSight</SelectItem>
                    <SelectItem value="LEEF">LEEF · QRadar</SelectItem>
                    <SelectItem value="JSON">JSON · Splunk</SelectItem>
                    <SelectItem value="RFC5424">RFC5424</SelectItem>
                  </SelectContent>
                </Select></div>
              <div><Label>{t("sec.facility")}</Label>
                <Input value={sec.siem.facility} onChange={e=>sec.setSiem({...sec.siem, facility:e.target.value})} className="font-mono mt-1" /></div>
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-border flex-wrap">
              <Button onClick={saveSiem} disabled={siemSaving}><Save className="h-4 w-4 mr-1" />{siemSaving ? "…" : "Seal Config"}</Button>
              <Button variant="outline" onClick={testSiem}><Wifi className="h-4 w-4 mr-1" />{t("sec.test_conn")}</Button>
              {siemTest && <Badge variant="outline" className="font-mono text-[10px]">{siemTest}</Badge>}
              {siemStatus && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  sent {siemStatus.sent} · queue {siemStatus.queueDepth} · drop {siemStatus.dropped}
                </Badge>
              )}
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* VAULT */}
        <TabsContent value="vault">
          <VaultEditor />
        </TabsContent>

        {/* GENGUARD */}
        <TabsContent value="guard">
          <Card className="glass"><CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm font-mono uppercase tracking-widest">{t("sec.genguard")}</h3>
              <Switch checked={guard.enabled} onCheckedChange={(v)=>persistGuard({...guard, enabled:v})} />
            </div>
            <div>
              <Label>{t("sec.sensitivity")}</Label>
              <div className="flex items-center gap-3 mt-2">
                <Slider value={[{low:33,medium:66,high:100}[guard.sensitivity]]} min={0} max={100} step={33}
                  onValueChange={(v)=>persistGuard({...guard, sensitivity: v[0]<34?"low":v[0]<67?"medium":"high"})} />
                <Badge variant="outline" className="font-mono text-[10px] uppercase">{guard.sensitivity}</Badge>
              </div>
            </div>
            <div>
              <Label>Input Blacklist (virgülle ayır)</Label>
              <Textarea rows={3} className="font-mono mt-1"
                value={guard.inputBlacklist.join(", ")}
                onChange={e=>persistGuard({...guard, inputBlacklist: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})} />
            </div>
            <div>
              <Label>Output Regex Patterns (virgülle ayır)</Label>
              <Textarea rows={3} className="font-mono mt-1"
                value={guard.outputPatterns.join(", ")}
                onChange={e=>persistGuard({...guard, outputPatterns: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})} />
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <Label>Instructions / Blacklist File</Label>
              <div className="flex items-center gap-2">
                <input id="guard-file" type="file" accept=".txt,.json,.yaml,.yml,.md,.csv" hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const r = new FileReader();
                    r.onload = () => persistGuard({ ...guard, instructionsFile: { name: f.name, content: String(r.result || ""), updatedAt: new Date().toISOString() } });
                    r.readAsText(f);
                  }}/>
                <Button size="sm" variant="outline" onClick={() => document.getElementById("guard-file")?.click()}>{t("sec.upload")}</Button>
                {guard.instructionsFile && (
                  <>
                    <Badge variant="outline" className="font-mono text-[10px]">{guard.instructionsFile.name}</Badge>
                    <Button size="sm" variant="ghost" className="text-destructive"
                      onClick={() => persistGuard({ ...guard, instructionsFile: null })}>
                      <Minus className="h-3.5 w-3.5 mr-1"/>Remove
                    </Button>
                  </>
                )}
              </div>
              {guard.instructionsFile && (
                <Textarea rows={6} className="font-mono text-xs"
                  value={guard.instructionsFile.content}
                  onChange={(e) => persistGuard({ ...guard, instructionsFile: { ...guard.instructionsFile!, content: e.target.value, updatedAt: new Date().toISOString() } })}/>
              )}
              <Label className="pt-2 block">Local Machine File Path (read on the host)</Label>
              <Input className="font-mono" placeholder="/Users/admin/genguard/rules.txt"
                value={guard.localFilePath ?? ""}
                onChange={(e) => persistGuard({ ...guard, localFilePath: e.target.value })}/>
              <p className="text-[10px] text-muted-foreground font-mono">
                Both sources are merged into the GenGuard ruleset on the local middleware.
              </p>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-[10px] font-mono uppercase text-muted-foreground mb-2">Son engellenen ({loadEvents().length})</p>
              <div className="space-y-1 max-h-44 overflow-auto">
                {loadEvents().slice(0,20).map(ev => (
                  <div key={ev.id} className="text-[11px] font-mono border border-border rounded p-2">
                    <span className="text-destructive">{ev.direction}</span> · {ev.matched} · {new Date(ev.ts).toLocaleString()}
                    <div className="text-muted-foreground truncate">{ev.excerpt}</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* AUDIT — backend hash-chain viewer (Faz 19 Part 2) */}
        <TabsContent value="audit">
          <VaultAuditViewer />
        </TabsContent>

        {/* SANDBOX */}
        <TabsContent value="sandbox">
          <Card className="glass"><CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm font-mono uppercase tracking-widest">{t("sec.tool_isolation")}</h3>
              <Switch checked={sec.sandbox.enabled} onCheckedChange={(v)=>sec.setSandbox({...sec.sandbox, enabled:v})} />
            </div>
            <div>
              <Label>Allowed Sandbox Paths (her satıra bir adet)</Label>
              <Textarea rows={3} className="font-mono mt-1" value={sec.sandbox.allowedPaths.join("\n")}
                onChange={e=>sec.setSandbox({...sec.sandbox, allowedPaths:e.target.value.split("\n").map(s=>s.trim()).filter(Boolean)})}/>
            </div>
            <div>
              <Label>{t("sec.denied_syscalls")}</Label>
              <Input className="font-mono mt-1" value={sec.sandbox.deniedSyscalls.join(", ")}
                onChange={e=>sec.setSandbox({...sec.sandbox, deniedSyscalls:e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})}/>
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* SIGNED */}
        <TabsContent value="signed">
          <Card className="glass"><CardContent className="p-6 space-y-3">
            <h3 className="font-bold text-sm font-mono uppercase tracking-widest">{t("sec.signed_workflows_h")}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("sec.signing_key_h")}</Label><Input defaultValue="SHA256:abc1…ef9" className="font-mono mt-1" /></div>
              <div><Label>{t("sec.algorithm")}</Label>
                <Select defaultValue="ed25519">
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ed25519">Ed25519</SelectItem>
                    <SelectItem value="rsa">RSA-4096</SelectItem>
                  </SelectContent>
                </Select></div>
            </div>
            <p className="text-[11px] text-muted-foreground">All workflow commits are signed; unverified flows are rejected at runtime.</p>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/**
 * Faz 19 Part 2 — backend-connected vault editor.
 * Values are write-only (POST then forgotten); reads only return scope/name/timestamps.
 * Old local-only useSecurity().vault has been retired; left in the store for legacy
 * callers but no longer drives this UI.
 */
// Vault v2 — kind-aware credential editor.
// Her kind için zorunlu/opsiyonel alanlar burada deklare; custom serbest key-value.
// Backend (vault.mjs VAULT_KIND_FIELDS) ile aynı sözleşme.
const VAULT_KIND_SPEC: Record<VaultKind, {
  label: string;
  hint: string;
  fields: Array<{ name: string; label: string; type: "text" | "password" | "textarea"; required?: boolean }>;
  meta?: Array<{ name: string; label: string; placeholder?: string }>;
  allowCustomFields?: boolean;
}> = {
  api_key: {
    label: "API Key", hint: "Remote, Remote gibi tek-token API'ler",
    fields: [{ name: "api_key", label: "API Key", type: "password", required: true }],
  },
  bearer_token: {
    label: "Bearer Token", hint: "Cloudflare API Token, GitHub PAT",
    fields: [{ name: "token", label: "Token", type: "password", required: true }],
  },
  basic_auth: {
    label: "Username + Password", hint: "Web login, basic-auth REST",
    fields: [
      { name: "username", label: "Username", type: "text", required: true },
      { name: "password", label: "Password", type: "password", required: true },
    ],
  },
  ssh_password: {
    label: "SSH (password)", hint: "Parolayla SSH bağlantısı",
    fields: [
      { name: "username", label: "Username", type: "text", required: true },
      { name: "password", label: "Password", type: "password", required: true },
    ],
    meta: [
      { name: "host", label: "Host", placeholder: "10.0.0.1" },
      { name: "port", label: "Port", placeholder: "22" },
    ],
  },
  ssh_key: {
    label: "SSH (private key)", hint: "Anahtarla SSH bağlantısı",
    fields: [
      { name: "username", label: "Username", type: "text", required: true },
      { name: "private_key", label: "Private Key (PEM)", type: "textarea", required: true },
      { name: "passphrase", label: "Passphrase (opt.)", type: "password" },
    ],
    meta: [
      { name: "host", label: "Host", placeholder: "10.0.0.1" },
      { name: "port", label: "Port", placeholder: "22" },
    ],
  },
  oauth2_client: {
    label: "OAuth2 Client", hint: "client_credentials akışı",
    fields: [
      { name: "client_id", label: "Client ID", type: "text", required: true },
      { name: "client_secret", label: "Client Secret", type: "password", required: true },
      { name: "token_url", label: "Token URL (opt.)", type: "text" },
      { name: "scope", label: "Scope (opt.)", type: "text" },
    ],
  },
  aws: {
    label: "AWS Access Key", hint: "AWS SDK kimliği",
    fields: [
      { name: "access_key_id", label: "Access Key ID", type: "text", required: true },
      { name: "secret_access_key", label: "Secret Access Key", type: "password", required: true },
    ],
    meta: [{ name: "region", label: "Region", placeholder: "eu-central-1" }],
  },
  db_url: {
    label: "Database URL", hint: "Postgres/Mongo connection string",
    fields: [{ name: "connection_string", label: "Connection String", type: "password", required: true }],
  },
  custom: {
    label: "Custom", hint: "Serbest alanlar — kendi anahtarlarını ekle",
    fields: [],
    allowCustomFields: true,
  },
};

const KIND_ORDER: VaultKind[] = [
  "api_key", "bearer_token", "basic_auth", "ssh_password", "ssh_key",
  "oauth2_client", "aws", "db_url", "custom",
];

function VaultEditor() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("global");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<VaultKind>("api_key");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [customRows, setCustomRows] = useState<Array<{ k: string; v: string }>>([{ k: "", v: "" }]);
  const [saving, setSaving] = useState(false);

  // Reveal state per item.
  const [revealed, setRevealed] = useState<Record<string, Record<string, string>>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleSel = (key: string) =>
    setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const filteredItems = items.filter((it) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return it.scope.toLowerCase().includes(q) || it.name.toLowerCase().includes(q);
  });
  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((it) => selected.has(`${it.scope}/${it.name}`));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelected((s) => {
        const n = new Set(s);
        filteredItems.forEach((it) => n.delete(`${it.scope}/${it.name}`));
        return n;
      });
    } else {
      setSelected((s) => {
        const n = new Set(s);
        filteredItems.forEach((it) => n.add(`${it.scope}/${it.name}`));
        return n;
      });
    }
  };
  const bulkDelete = async () => {
    const targets = items.filter((it) => selected.has(`${it.scope}/${it.name}`));
    if (!targets.length) return;
    if (!confirm(`Remove ${targets.length} secret${targets.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      const r = await VaultAPI.bulkDelete(targets.map((it) => ({ scope: it.scope, name: it.name })));
      toast.success(`Removed ${r.deleted}/${r.requested}`);
      setSelected(new Set());
      void refresh();
    } catch (e) {
      toast.error(`Bulk delete failed · ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBulkDeleting(false); }
  };

  const refresh = async () => {
    setLoading(true);
    const r = await VaultAPI.list();
    setItems(r.items ?? []);
    setLoading(false);
  };
  useEffect(() => { void refresh(); }, []);

  // Kind değişince ilgili alanları sıfırla.
  useEffect(() => {
    setFields({});
    setMeta({});
    setCustomRows([{ k: "", v: "" }]);
  }, [kind]);

  const spec = VAULT_KIND_SPEC[kind];

  const submit = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    // Custom kind → customRows'tan fields üret.
    let outFields: Record<string, string> = {};
    if (spec.allowCustomFields) {
      for (const row of customRows) {
        const k = row.k.trim();
        if (!k) continue;
        if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(k)) { toast.error(`Bad field name: ${k}`); return; }
        outFields[k] = row.v;
      }
      if (Object.keys(outFields).length === 0) { toast.error("Add at least one field"); return; }
    } else {
      for (const f of spec.fields) {
        const v = fields[f.name] ?? "";
        if (f.required && !v) { toast.error(`${f.label} required`); return; }
        if (v !== "") outFields[f.name] = v;
      }
    }
    setSaving(true);
    try {
      const r = await VaultAPI.putV2({
        scope: scope.trim() || "global",
        name: name.trim(),
        kind,
        fields: outFields,
        meta: Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== "")),
      });
      if (!r.ok) { toast.error("Failed to seal secret"); return; }
      toast.success(`Sealed ${scope}/${name} · ${r.field_names.length} field${r.field_names.length === 1 ? "" : "s"}`);
      setName(""); setFields({}); setMeta({}); setCustomRows([{ k: "", v: "" }]);
      void refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[vault] seal failed:", e);
      toast.error(`Seal failed · ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (it: VaultItem) => {
    if (!confirm(`Remove ${it.scope}/${it.name}?`)) return;
    try {
      const r = await VaultAPI.remove(it.scope, it.name);
      if (!r.ok) { toast.error("Failed to remove"); return; }
      toast.success("Removed");
      const key = `${it.scope}/${it.name}`;
      setRevealed(({ [key]: _drop, ...rest }) => rest);
      void refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Remove failed · ${msg}`);
    }
  };

  const reveal = async (it: VaultItem) => {
    const key = `${it.scope}/${it.name}`;
    if (revealed[key]) {
      // Toggle hide.
      setRevealed(({ [key]: _drop, ...rest }) => rest);
      return;
    }
    setRevealing(key);
    try {
      const r = await VaultAPI.reveal(it.scope, it.name);
      setRevealed((m) => ({ ...m, [key]: r.fields }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Reveal failed · ${msg}`);
    } finally {
      setRevealing(null);
    }
  };

  return (
    <Card className="glass"><CardContent className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm font-mono uppercase tracking-widest">Secret Vault · Encrypted at rest</h3>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {/* Editor */}
      <div className="space-y-3 border-b border-border pb-4">
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-3">
            <Label className="text-[10px] font-mono uppercase">Scope</Label>
            <Input className="font-mono text-xs h-9 mt-1" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="global" />
          </div>
          <div className="col-span-4">
            <Label className="text-[10px] font-mono uppercase">Name</Label>
            <Input className="font-mono text-xs h-9 mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="checkpoint-prod" />
          </div>
          <div className="col-span-5">
            <Label className="text-[10px] font-mono uppercase">Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as VaultKind)}>
              <SelectTrigger className="font-mono text-xs h-9 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KIND_ORDER.map((k) => (
                  <SelectItem key={k} value={k} className="font-mono text-xs">
                    {VAULT_KIND_SPEC[k].label}
                    <span className="text-muted-foreground ml-2">· {VAULT_KIND_SPEC[k].hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Kind-specific fields */}
        {!spec.allowCustomFields && spec.fields.length > 0 && (
          <div className="grid grid-cols-12 gap-2">
            {spec.fields.map((f) => (
              <div key={f.name} className={f.type === "textarea" ? "col-span-12" : "col-span-6"}>
                <Label className="text-[10px] font-mono uppercase">
                  {f.label} {f.required && <span className="text-destructive">*</span>}
                </Label>
                {f.type === "textarea" ? (
                  <Textarea
                    className="font-mono text-xs mt-1 min-h-[100px]"
                    value={fields[f.name] ?? ""}
                    onChange={(e) => setFields((m) => ({ ...m, [f.name]: e.target.value }))}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----…"
                  />
                ) : (
                  <Input
                    className="font-mono text-xs h-9 mt-1"
                    type={f.type}
                    value={fields[f.name] ?? ""}
                    onChange={(e) => setFields((m) => ({ ...m, [f.name]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Custom dynamic rows */}
        {spec.allowCustomFields && (
          <div className="space-y-2">
            <Label className="text-[10px] font-mono uppercase">Custom fields</Label>
            {customRows.map((row, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <Input
                  className="col-span-4 font-mono text-xs h-9"
                  placeholder="field_name"
                  value={row.k}
                  onChange={(e) => setCustomRows((rs) => rs.map((r, j) => j === i ? { ...r, k: e.target.value } : r))}
                />
                <Input
                  className="col-span-7 font-mono text-xs h-9"
                  type="password"
                  placeholder="value (encrypted)"
                  value={row.v}
                  onChange={(e) => setCustomRows((rs) => rs.map((r, j) => j === i ? { ...r, v: e.target.value } : r))}
                />
                <Button
                  size="icon" variant="ghost" className="col-span-1 h-9 w-9"
                  onClick={() => setCustomRows((rs) => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setCustomRows((rs) => [...rs, { k: "", v: "" }])}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add field
            </Button>
          </div>
        )}

        {/* Meta (plaintext, non-secret) */}
        {spec.meta && spec.meta.length > 0 && (
          <div className="space-y-2 rounded border border-border/60 bg-muted/20 p-3">
            <div className="text-[10px] font-mono uppercase text-muted-foreground flex items-center gap-2">
              Connection metadata
              <Badge variant="outline" className="text-[9px] font-mono">non-secret · plaintext</Badge>
            </div>
            <div className="grid grid-cols-12 gap-2">
              {spec.meta.map((m) => (
                <div key={m.name} className="col-span-6">
                  <Label className="text-[10px] font-mono uppercase">{m.label}</Label>
                  <Input
                    className="font-mono text-xs h-9 mt-1"
                    value={meta[m.name] ?? ""}
                    onChange={(e) => setMeta((mm) => ({ ...mm, [m.name]: e.target.value }))}
                    placeholder={m.placeholder}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            Seal credential
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 mb-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by scope or name (e.g. BRAND_, EMBED_WORKER_, global)"
            className="h-8 text-xs font-mono flex-1"
          />
          <Button
            size="sm" variant="outline"
            onClick={toggleSelectAll}
            disabled={filteredItems.length === 0}
          >
            {allFilteredSelected ? "Unselect filtered" : "Select filtered"}
          </Button>
          <Button
            size="sm" variant="destructive"
            onClick={bulkDelete}
            disabled={selected.size === 0 || bulkDeleting}
          >
            {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
            Delete selected ({selected.size})
          </Button>
        </div>
        <div className="text-[10px] font-mono uppercase text-muted-foreground mb-2">
          {filteredItems.length} of {items.length} stored secrets{selected.size > 0 && ` · ${selected.size} selected`}
        </div>
        {filteredItems.length > 0 && (
          <div className="grid grid-cols-12 gap-2 items-center text-[10px] font-mono uppercase text-muted-foreground border-b border-border/40 pb-1 mb-1">
            <span className="col-span-1 flex justify-center">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAll}
                title={allFilteredSelected ? "Unselect all filtered" : "Select all filtered"}
                className="h-3.5 w-3.5 accent-destructive cursor-pointer"
              />
            </span>
            <span className="col-span-2">Scope</span>
            <span className="col-span-3">Name</span>
            <span className="col-span-1">Kind</span>
            <span className="col-span-3">Fields</span>
            <span className="col-span-2 text-right">Actions</span>
          </div>
        )}
        {loading && items.length === 0 && <div className="text-xs font-mono text-muted-foreground py-4 text-center">Loading…</div>}
        {!loading && items.length === 0 && <div className="text-xs font-mono text-muted-foreground py-4 text-center">No secrets stored yet.</div>}
        {filteredItems.map((it) => {
          const key = `${it.scope}/${it.name}`;
          const open = !!revealed[key];
          const isSelected = selected.has(key);
          const fieldNames = it.field_names ?? ["api_key"];
          const host = (it.meta && typeof it.meta === "object" && "host" in it.meta) ? String((it.meta as Record<string, unknown>).host ?? "") : "";
          return (
            <div key={key} className="border-b border-border/40 py-2">
              <div className="grid grid-cols-12 gap-2 items-center text-xs font-mono">
                <span className="col-span-1 flex justify-center">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSel(key)}
                    className="h-3.5 w-3.5 accent-destructive cursor-pointer"
                  />
                </span>
                <span className="col-span-2 text-muted-foreground truncate">{it.scope}</span>
                <span className="col-span-3 text-foreground truncate">{it.name}</span>
                <span className="col-span-1">
                  <Badge variant="secondary" className="text-[9px] font-mono uppercase">{it.kind ?? "api_key"}</Badge>
                </span>
                <span className="col-span-3 text-[10px] text-muted-foreground truncate">
                  {fieldNames.length} field{fieldNames.length === 1 ? "" : "s"}
                  {host && ` · ${host}`}
                </span>
                <div className="col-span-2 flex justify-end gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => reveal(it)} disabled={revealing === key}>
                    {revealing === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : open ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(it)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {open && (
                <div className="mt-2 ml-4 space-y-1 rounded bg-muted/40 p-2">
                  {Object.entries(revealed[key]).map(([fn, fv]) => (
                    <div key={fn} className="grid grid-cols-12 gap-2 text-[11px] font-mono">
                      <span className="col-span-3 text-muted-foreground">{fn}</span>
                      <span className="col-span-9 break-all text-foreground">{fv}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CardContent></Card>
  );
}

/**
 * Faz 19 Part 2 — Vault audit chain viewer.
 * Calls /api/vault-audit/verify to walk the hash chain and surface any tamper
 * point, then lists the most recent audit entries with hash + prev_hash.
 */
function VaultAuditViewer() {
  const [entries, setEntries] = useState<VaultAuditEntry[]>([]);
  const [chain, setChain] = useState<VaultAuditChainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const [list, verify] = await Promise.all([VaultAPI.auditList(100), VaultAPI.auditVerify(2000)]);
    setEntries(list.items ?? []);
    setChain(verify);
    setLoading(false);
  };
  useEffect(() => { void refresh(); }, []);

  const verifyAgain = async () => {
    setVerifying(true);
    const r = await VaultAPI.auditVerify(2000);
    setChain(r);
    setVerifying(false);
    if (r.ok) toast.success(`Chain intact · ${r.scanned} entries`);
    else toast.error(`Chain broken at #${r.broken_at_id ?? "?"} · ${r.reason ?? "unknown"}`);
  };

  return (
    <Card className="glass"><CardContent className="p-0">
      <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Vault Audit · Hash Chain</div>
          {chain && (
            chain.ok ? (
              <Badge variant="outline" className="font-mono text-[10px] gap-1">
                <ShieldCheck className="h-3 w-3 text-primary" />intact · {chain.scanned} scanned
              </Badge>
            ) : (
              <Badge variant="outline" className="font-mono text-[10px] gap-1 text-destructive border-destructive">
                <ShieldAlert className="h-3 w-3" />broken @ #{chain.broken_at_id ?? "?"} · {chain.reason ?? "unknown"}
              </Badge>
            )
          )}
        </div>
        <Button size="sm" variant="outline" onClick={verifyAgain} disabled={verifying}>
          {verifying ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1" />}
          Verify chain
        </Button>
      </div>
      {loading ? (
        <div className="p-8 text-center text-xs font-mono text-muted-foreground">Loading audit chain…</div>
      ) : entries.length === 0 ? (
        <div className="p-8 text-center text-xs font-mono text-muted-foreground">No audit entries yet.</div>
      ) : (
        <table className="w-full text-xs font-mono">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left p-2 w-12">#</th>
              <th className="text-left p-2">Timestamp</th>
              <th className="text-left p-2">Action</th>
              <th className="text-left p-2">Scope / Name</th>
              <th className="text-left p-2">Actor</th>
              <th className="text-left p-2">Hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => {
              const isBreakPoint = chain && !chain.ok && String(chain.broken_at_id) === String(e.id);
              return (
                <tr key={String(e.id)} className={`border-b border-border/40 ${isBreakPoint ? "bg-destructive/10" : ""}`}>
                  <td className="p-2 text-muted-foreground">{String(e.id)}</td>
                  <td className="p-2 text-muted-foreground">{new Date(e.ts).toLocaleString()}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[9px] uppercase">{e.action}</Badge>
                  </td>
                  <td className="p-2">{e.scope ?? "—"}{e.name ? ` / ${e.name}` : ""}</td>
                  <td className="p-2 text-muted-foreground">{e.actor ?? "—"}</td>
                  <td className="p-2 text-[10px] text-muted-foreground truncate max-w-[200px]" title={e.hash ?? ""}>
                    {e.hash ? `${e.hash.slice(0, 16)}…` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </CardContent></Card>
  );
}

