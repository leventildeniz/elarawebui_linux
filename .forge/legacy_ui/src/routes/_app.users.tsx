import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Plus, Minus, Eye, EyeOff, Lock, Unlock, Power, ShieldCheck, Users as UsersIcon, Save, RotateCcw, AlertTriangle, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { avatarFor } from "@/lib/avatars";
import { AvatarPicker } from "@/components/avatar-picker";
import { useEffect, useMemo, useState } from "react";
import { useUsers, type Account, type Group, type AccountStatus } from "@/lib/users-store";
import { useAuth, ROLES, type Role } from "@/lib/auth";
import { useSecurity } from "@/lib/security-store";
import { useSystem } from "@/lib/system-store";
import { createPrefixedId } from "@/lib/id";
import { toast } from "sonner";
import { ProvidersAPI, AgentsAPI, ForgeAPI, SkillsAPI, type AiProviderDTO, type ActionDef, type SkillDef } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { AllowedVisionProfilesChips } from "@/components/allowed-vision-profiles-chips";

export const Route = createFileRoute("/_app/users")({ component: UsersPage });

function newId(prefix: string) {
  return createPrefixedId(`${prefix}_`);
}

function UsersPage() {
  const { accounts, setAccounts, groups, setGroups, refresh, bridgeOnline, syncing } = useUsers();
  const { providers, rbac } = useAuth();
  const { templates } = useSecurity();
  const { t } = useI18n();
  const enabledProviders = providers.filter(p => p.enabled);
  const allProviders = providers;

  return (
    <PageShell>
      <PageHeader
        title={t("users.title")}
        subtitle={t("users.subtitle")}
      />
      <div className="mb-3 flex items-center gap-3 text-xs font-mono">
        <span className={`pulse-dot ${bridgeOnline ? "" : "opacity-30"}`} />
        <span className={bridgeOnline ? "text-primary" : "text-destructive"}>
          {bridgeOnline ? t("users.bridge_online") : t("users.bridge_offline")}
        </span>
        <span className="text-muted-foreground">· {accounts.length} {t("users.accounts").toLowerCase()} · {groups.length} {t("users.groups").toLowerCase()}</span>
        <Button size="sm" variant="outline" className="h-7 ml-auto" onClick={() => refresh()} disabled={syncing}>
          <RotateCcw className={`h-3.5 w-3.5 mr-1 ${syncing ? "animate-spin" : ""}`} /> {t("users.refresh")}
        </Button>
      </div>
      <Tabs defaultValue="accounts">
        <TabsList className="glass mb-4">
          <TabsTrigger value="accounts"><UsersIcon className="h-3.5 w-3.5 mr-1"/>{t("users.accounts")}</TabsTrigger>
          <TabsTrigger value="groups">{t("users.groups")}</TabsTrigger>
          <TabsTrigger value="rbac"><ShieldCheck className="h-3.5 w-3.5 mr-1"/>{t("users.rbac")}</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
          <AccountsTab
            accounts={accounts} setAccounts={setAccounts}
            groups={groups}
            templates={templates}
            providers={allProviders}
            enabledProviders={enabledProviders}
          />
        </TabsContent>

        <TabsContent value="groups">
          <GroupsTab
            groups={groups} setGroups={setGroups}
            accounts={accounts}
            templates={templates}
            providers={allProviders}
            enabledProviders={enabledProviders}
          />
        </TabsContent>

        <TabsContent value="rbac">
          <RbacComplianceTab accounts={accounts} groups={groups} rbac={rbac} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/* ---------------- ACCOUNTS ---------------- */

function AccountsTab({
  accounts, setAccounts, groups, templates, providers, enabledProviders,
}: {
  accounts: Account[]; setAccounts: (a: Account[]) => void;
  groups: Group[];
  templates: { id: string; name: string }[];
  providers: { id: Account["provider"]; enabled: boolean }[];
  enabledProviders: { id: Account["provider"] }[];
}) {
  const { rbac } = useAuth();
  const { models: sysModels } = useSystem();
  const { t } = useI18n();
  const [selId, setSelId] = useState<string>(accounts[0]?.id ?? "");
  const [reveal, setReveal] = useState(false);
  const sel = accounts.find(a => a.id === selId);
  const [draft, setDraft] = useState<Account | null>(sel ?? null);
  const [llmProviders, setLlmProviders] = useState<AiProviderDTO[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [agentChoices, setAgentChoices] = useState<{ id: string; name: string }[]>([]);
  const [toolChoices, setToolChoices] = useState<ActionDef[]>([]);
  const [skillChoices, setSkillChoices] = useState<SkillDef[]>([]);
  useEffect(() => {
    const load = () => {
      ProvidersAPI.list()
        .then(r => { setLlmProviders(r.filter(p => p.isActive !== false)); setProviderError(null); })
        .catch((e) => { setLlmProviders([]); setProviderError((e as Error).message); });
      AgentsAPI.list()
        .then(r => setAgentChoices(r.map(a => ({ id: a.name, name: a.name }))))
        .catch(() => setAgentChoices([]));
      ForgeAPI.list({ kind: "action" }).then(setToolChoices).catch(() => setToolChoices([]));
      SkillsAPI.list().then(setSkillChoices).catch(() => setSkillChoices([]));
    };
    load(); const id = setInterval(load, 8000); return () => clearInterval(id);
  }, []);

  useEffect(() => { setDraft(sel ?? null); }, [selId, sel?.id]);

  const dirty = !!sel && !!draft && JSON.stringify(sel) !== JSON.stringify(draft);
  const upd = (patch: Partial<Account>) => draft && setDraft({ ...draft, ...patch });

  // RBAC compliance vs. Settings → RBAC
  const expectedRole = useMemo(() => {
    if (!draft) return null;
    const exact = rbac.find(r => r.match.toLowerCase() === draft.username.toLowerCase() && r.provider === draft.provider);
    const star  = rbac.find(r => r.match === "*" && r.provider === draft.provider);
    return exact?.role ?? star?.role ?? null;
  }, [draft, rbac]);
  const compliant = expectedRole ? expectedRole === draft?.role : true;

  const save = () => {
    if (!draft) return;
    if (!draft.username.trim()) { toast.error("Username required"); return; }
    if (!enabledProviders.find(p => p.id === draft.provider)) {
      toast.error(`Provider "${draft.provider.toUpperCase()}" is not enabled in Settings → Authentication`); return;
    }
    setAccounts(accounts.map(a => a.id === draft.id ? draft : a));
    toast.success(`Account "${draft.username}" saved`);
  };
  const reset = () => setDraft(sel ?? null);
  const remove = () => {
    if (!sel) return;
    if (!confirm(`Delete account "${sel.username}"?`)) return;
    setAccounts(accounts.filter(a => a.id !== sel.id));
    setSelId(""); setDraft(null);
    toast.success("Account deleted");
  };

  const addAccount = () => {
    const a: Account = {
      id: newId("u"),
      username: "new.user", email: "", phone: "", password: "",
      provider: enabledProviders[0]?.id ?? providers[0]?.id ?? "local", role: "Viewer",
      groups: [], status: "active", mustChangePassword: true,
      allowedProviders: [], canOverrideProvider: true,
      allowedModels: [], canOverrideModel: true,
      allowedAgents: [], allowedTools: [], allowedSkills: [],
      createdAt: new Date().toISOString(),
    };
    setAccounts([a, ...accounts]); setSelId(a.id); setDraft(a);
    toast.success("New account created — remember to Save");
  };

  const setStatus = (s: AccountStatus) => {
    if (!sel) return;
    const next = { ...sel, status: s };
    setAccounts(accounts.map(a => a.id === sel.id ? next : a));
    setDraft(next);
    toast.success(`Account ${s}`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <Card className="glass lg:col-span-3"><CardContent className="p-3 space-y-1">
        <Button size="sm" className="w-full mb-2 bg-gradient-primary text-primary-foreground" onClick={addAccount}>
          <Plus className="h-3.5 w-3.5 mr-1"/>{t("users.new_account")}
        </Button>
        {accounts.map(a => (
          <button key={a.id} onClick={() => setSelId(a.id)}
            className={`w-full text-left border rounded p-2 ${selId === a.id ? "border-primary" : "border-border"}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">{a.username}{dirty && a.id === selId ? " *" : ""}</p>
              <StatusDot status={a.status}/>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">{a.role} · {a.provider}</p>
          </button>
        ))}
      </CardContent></Card>

      {sel && draft && (
        <Card className="glass lg:col-span-9"><CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-lg font-bold">{draft.username}{dirty && <span className="text-yellow-500 ml-1">*</span>}</h3>
              <p className="text-[11px] font-mono text-muted-foreground">created {new Date(sel.createdAt).toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" className="bg-gradient-primary text-primary-foreground" disabled={!dirty} onClick={save}>
                <Save className="h-3.5 w-3.5 mr-1"/>Save
              </Button>
              <Button size="sm" variant="outline" disabled={!dirty} onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5 mr-1"/>Reset
              </Button>
              {sel.status !== "locked"
                ? <Button size="sm" variant="outline" onClick={() => setStatus("locked")}><Lock className="h-3.5 w-3.5 mr-1"/>Lock</Button>
                : <Button size="sm" variant="outline" onClick={() => setStatus("active")}><Unlock className="h-3.5 w-3.5 mr-1"/>Unlock</Button>}
              {sel.status !== "disabled"
                ? <Button size="sm" variant="outline" className="text-destructive" onClick={() => setStatus("disabled")}><Power className="h-3.5 w-3.5 mr-1"/>Disable</Button>
                : <Button size="sm" variant="outline" onClick={() => setStatus("active")}><Power className="h-3.5 w-3.5 mr-1"/>Enable</Button>}
              <Button size="sm" variant="ghost" className="text-destructive" onClick={remove}>
                <Minus className="h-3.5 w-3.5 mr-1"/>Delete
              </Button>
            </div>
          </div>

          {enabledProviders.length === 0 && (
            <div className="border border-destructive/40 rounded p-2 text-[11px] font-mono text-destructive flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5"/> No enabled providers. Enable in <b>Settings → Authentication</b>.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Username</Label>
              <Input value={draft.username} onChange={e => upd({ username: e.target.value })} className="font-mono mt-1"/></div>
            <div><Label>Email</Label>
              <Input type="email" value={draft.email} onChange={e => upd({ email: e.target.value })} className="font-mono mt-1"/></div>
            <div><Label>Phone</Label>
              <Input value={draft.phone} onChange={e => upd({ phone: e.target.value })} className="font-mono mt-1"/></div>
            <div>
              <Label>Password</Label>
              <div className="flex gap-1 mt-1">
                <Input type={reveal ? "text" : "password"} value={draft.password}
                  onChange={e => upd({ password: e.target.value })} className="font-mono"/>
                <Button size="icon" variant="ghost" onClick={() => setReveal(!reveal)}>
                  {reveal ? <EyeOff className="h-3.5 w-3.5"/> : <Eye className="h-3.5 w-3.5"/>}
                </Button>
              </div>
            </div>

            <div><Label>{t("users.auth_provider")}</Label>
              <Select value={draft.provider} onValueChange={(v) => upd({ provider: v as Account["provider"] })}>
                <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {providers.map(p => (
                    <SelectItem key={p.id} value={p.id} disabled={!p.enabled}>
                      {p.id.toUpperCase()}{!p.enabled && " · disabled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                {t("users.providers_hint")}
              </p>
              {!enabledProviders.find(p => p.id === draft.provider) && (
                <p className="text-[10px] font-mono text-yellow-500 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3"/> {t("users.provider_off")}
                </p>
              )}
            </div>
            <div><Label>Role (RBAC)</Label>
              <Select value={draft.role} onValueChange={(v) => upd({ role: v as Role })}>
                <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              {expectedRole && (
                <p className={`text-[10px] font-mono mt-1 flex items-center gap-1 ${compliant ? "text-emerald-500" : "text-yellow-500"}`}>
                  {compliant
                    ? <>✓ Matches Settings → RBAC ({expectedRole})</>
                    : <><AlertTriangle className="h-3 w-3"/> RBAC rule expects <b>{expectedRole}</b>
                        <button className="underline ml-1" onClick={() => upd({ role: expectedRole })}>apply</button></>}
                </p>
              )}
            </div>

            <div><Label>{t("users.model_template")}</Label>
              <Select value={draft.templateId ?? "__none"} onValueChange={(v) => upd({ templateId: v === "__none" ? undefined : v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Valid Until (account expiry)</Label>
              <div className="flex gap-2 mt-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" type="button"
                      className={cn("flex-1 justify-start font-mono text-xs", !draft.validUntil && "text-muted-foreground")}>
                      <CalendarIcon className="h-3.5 w-3.5 mr-2"/>
                      {draft.validUntil ? format(new Date(draft.validUntil), "yyyy-MM-dd") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0 z-[100]">
                    <Calendar mode="single"
                      selected={draft.validUntil ? new Date(draft.validUntil) : undefined}
                      onSelect={(d) => {
                        if (!d) { upd({ validUntil: undefined }); return; }
                        const cur = draft.validUntil ? new Date(draft.validUntil) : new Date();
                        d.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
                        upd({ validUntil: d.toISOString() });
                      }}
                      initialFocus className={cn("p-3 pointer-events-auto")}/>
                  </PopoverContent>
                </Popover>
                <Input type="time" className="font-mono w-28"
                  value={draft.validUntil ? format(new Date(draft.validUntil), "HH:mm") : ""}
                  onChange={(e) => {
                    const [hh, mm] = e.target.value.split(":").map(Number);
                    const base = draft.validUntil ? new Date(draft.validUntil) : new Date();
                    base.setHours(hh || 0, mm || 0, 0, 0);
                    upd({ validUntil: base.toISOString() });
                  }}/>
                {draft.validUntil && (
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9"
                    onClick={() => upd({ validUntil: undefined })}>
                    <Minus className="h-3.5 w-3.5"/>
                  </Button>
                )}
              </div>
              {draft.validUntil && new Date(draft.validUntil) < new Date() &&
                <Badge variant="outline" className="text-destructive text-[9px] mt-1">EXPIRED</Badge>}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <Label>{t("users.group_membership")}</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {groups.map(g => {
                const on = draft.groups.includes(g.id);
                return (
                  <button key={g.id}
                    onClick={() => upd({ groups: on ? draft.groups.filter(x => x !== g.id) : [...draft.groups, g.id] })}
                    className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                    {on ? "✓ " : ""}{g.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <Label>Avatar</Label>
            <div className="flex items-center gap-3 mt-2">
              <img src={avatarFor(draft.username, draft.avatarUrl)} alt="" className="h-12 w-12 rounded"/>
              <AvatarPicker
                value={draft.avatarUrl ?? undefined}
                onChange={(url) => upd({ avatarUrl: url })}
                trigger={<Button size="sm" variant="outline">{t("users.change_avatar")}</Button>}
                title={`Pick avatar · ${draft.username}`}
              />
            </div>
          </div>

          <div className="border-t border-border pt-3 flex items-center gap-3">
            <Switch checked={draft.mustChangePassword} onCheckedChange={(v) => upd({ mustChangePassword: v })}/>
            <span className="text-xs font-mono">{t("users.force_pwd")}</span>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("users.llm_perm")}</Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono">
                  {draft.allowedProviders.length || "all"}/{llmProviders.length || "—"}
                </Badge>
                <Switch
                  checked={draft.canOverrideProvider}
                  onCheckedChange={(v) => upd({ canOverrideProvider: v })}
                />
                <span className="text-[11px] font-mono text-muted-foreground">
                  {t("users.chat_pick_provider")}
                </span>
              </div>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              {t("users.llm_perm_hint")}
            </p>
            {providerError && (
              <p className="text-[10px] font-mono text-destructive">
                Provider API: {providerError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {llmProviders.length === 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">{t("users.no_llm")}</span>
              )}
              {llmProviders.map(p => {
                const on = draft.allowedProviders.includes(p.id);
                return (
                  <button key={p.id}
                    onClick={() => upd({ allowedProviders: on ? draft.allowedProviders.filter(x=>x!==p.id) : [...draft.allowedProviders, p.id] })}
                    className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"} ${!p.isActive ? "opacity-50" : ""}`}>
                    {on ? "✓ " : ""}{p.providerName}
                    {!p.isActive && <span className="ml-1 text-[9px]">(off)</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("users.allowed_models")}</Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono">
                  {draft.allowedModels.length || t("users.models_all")}/{sysModels.length || "—"}
                </Badge>
                <Switch
                  checked={draft.canOverrideModel}
                  onCheckedChange={(v) => upd({ canOverrideModel: v })}
                />
                <span className="text-[11px] font-mono text-muted-foreground">
                  {t("users.can_override_model")}
                </span>
              </div>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              {t("users.allowed_models_hint")}
            </p>
            <div className="flex items-center gap-2 mb-1">
              <Button size="sm" variant="ghost" className="h-6 text-[10px] font-mono"
                onClick={() => upd({ allowedModels: sysModels.map(m => m.id) })}>
                {t("users.select_all")}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] font-mono"
                onClick={() => upd({ allowedModels: [] })}>
                {t("users.select_none")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {sysModels.length === 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">{t("users.no_models")}</span>
              )}
              {sysModels.map(m => {
                const on = draft.allowedModels.includes(m.id);
                const label = m.modelName || m.id.split(/[\\/]/).filter(Boolean).pop() || m.id;
                return (
                  <button key={m.id}
                    onClick={() => upd({ allowedModels: on ? draft.allowedModels.filter(x=>x!==m.id) : [...draft.allowedModels, m.id] })}
                    className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}>
                    {on ? "✓ " : ""}{label}
                    <span className="ml-1 text-[9px] opacity-60">{m.provider}</span>
                  </button>
                );
              })}
          </div>

          <AllowedVisionProfilesChips scope="users" id={draft.id} />
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label>Agent permissions</Label>
              <Badge variant="outline" className="text-[10px] font-mono">
                {draft.allowedAgents.length || "all"}/{agentChoices.length || "—"}
              </Badge>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              Leave empty to grant access to every agent the template allows. Select to restrict to this list only.
            </p>
            <div className="flex flex-wrap gap-2">
              {agentChoices.length === 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">No agents registered yet.</span>
              )}
              {agentChoices.map(a => {
                const on = draft.allowedAgents.includes(a.name);
                return (
                  <button key={a.id}
                    onClick={() => upd({ allowedAgents: on ? draft.allowedAgents.filter(x=>x!==a.name) : [...draft.allowedAgents, a.name] })}
                    className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}>
                    {on ? "✓ " : ""}{a.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label>Tool permissions</Label>
              <Badge variant="outline" className="text-[10px] font-mono">
                {draft.allowedTools.length || "all"}/{toolChoices.length || "—"}
              </Badge>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              Leave empty to grant access to every tool the template allows. Select to restrict to this list only.
            </p>
            <div className="flex flex-wrap gap-2">
              {toolChoices.length === 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">No tools defined in the Forge yet.</span>
              )}
              {toolChoices.map(tool => {
                const on = draft.allowedTools.includes(tool.id);
                return (
                  <button key={tool.id}
                    onClick={() => upd({ allowedTools: on ? draft.allowedTools.filter(x=>x!==tool.id) : [...draft.allowedTools, tool.id] })}
                    title={tool.description || tool.id}
                    className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}>
                    {on ? "✓ " : ""}{tool.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label>Skill permissions</Label>
              <Badge variant="outline" className="text-[10px] font-mono">
                {(draft.allowedSkills ?? []).length || "all"}/{skillChoices.length || "—"}
              </Badge>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">
              Sealed procedures (! triggers). Empty = all skills the template allows. Selecting locks the user to this list only.
            </p>
            <div className="flex flex-wrap gap-2">
              {skillChoices.length === 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">No skills sealed yet.</span>
              )}
              {skillChoices.map(sk => {
                const list = draft.allowedSkills ?? [];
                const on = list.includes(sk.slug);
                const riskColor = sk.risk_level === "critical" ? "border-destructive text-destructive" : sk.risk_level === "write" ? "border-chart-3 text-chart-3" : "border-border text-muted-foreground";
                return (
                  <button key={sk.id}
                    onClick={() => upd({ allowedSkills: on ? list.filter(x=>x!==sk.slug) : [...list, sk.slug] })}
                    title={`${sk.description || sk.slug} · risk:${sk.risk_level}`}
                    className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : riskColor}`}>
                    {on ? "✓ " : "!"}{sk.slug}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

/* ---------------- GROUPS ---------------- */

function GroupsTab({
  groups, setGroups, accounts, templates, providers, enabledProviders,
}: {
  groups: Group[]; setGroups: (g: Group[]) => void;
  accounts: Account[];
  templates: { id: string; name: string }[];
  providers: { id: Account["provider"]; enabled: boolean }[];
  enabledProviders: { id: Account["provider"] }[];
}) {
  const { t } = useI18n();
  const [selId, setSelId] = useState<string>(groups[0]?.id ?? "");
  const sel = groups.find(g => g.id === selId);
  const [draft, setDraft] = useState<Group | null>(sel ?? null);
  useEffect(() => { setDraft(sel ?? null); }, [selId, sel?.id]);

  const dirty = !!sel && !!draft && JSON.stringify(sel) !== JSON.stringify(draft);
  const upd = (patch: Partial<Group>) => draft && setDraft({ ...draft, ...patch });

  const save = () => {
    if (!draft) return;
    if (!draft.name.trim()) { toast.error("Group name required"); return; }
    if (!enabledProviders.find(p => p.id === draft.provider)) {
      toast.error(`Provider "${draft.provider.toUpperCase()}" is not enabled in Settings → Authentication`); return;
    }
    setGroups(groups.map(g => g.id === draft.id ? draft : g));
    toast.success(`Group "${draft.name}" saved`);
  };
  const reset = () => setDraft(sel ?? null);
  const remove = () => {
    if (!sel) return;
    if (!confirm(`Delete group "${sel.name}"?`)) return;
    setGroups(groups.filter(g => g.id !== sel.id));
    setSelId(""); setDraft(null);
    toast.success("Group deleted");
  };

  const addGroup = () => {
    const g: Group = {
      id: newId("g"), name: "new-group", description: "",
      role: "Viewer", provider: enabledProviders[0]?.id ?? providers[0]?.id ?? "local", members: [],
    };
    setGroups([g, ...groups]); setSelId(g.id); setDraft(g);
    toast.success("New group created — remember to Save");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <Card className="glass lg:col-span-3"><CardContent className="p-3 space-y-1">
        <Button size="sm" className="w-full mb-2 bg-gradient-primary text-primary-foreground" onClick={addGroup}>
          <Plus className="h-3.5 w-3.5 mr-1"/>New Group
        </Button>
        {groups.map(g => (
          <button key={g.id} onClick={() => setSelId(g.id)}
            className={`w-full text-left border rounded p-2 ${selId === g.id ? "border-primary" : "border-border"}`}>
            <p className="text-xs font-medium">{g.name}{dirty && g.id === selId ? " *" : ""}</p>
            <p className="text-[10px] font-mono text-muted-foreground">{g.role} · {g.members.length} members</p>
          </button>
        ))}
      </CardContent></Card>

      {sel && draft && (
        <Card className="glass lg:col-span-9"><CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-lg font-bold">{draft.name}{dirty && <span className="text-yellow-500 ml-1">*</span>}</h3>
            <div className="flex items-center gap-2">
              <Button size="sm" className="bg-gradient-primary text-primary-foreground" disabled={!dirty} onClick={save}>
                <Save className="h-3.5 w-3.5 mr-1"/>Save
              </Button>
              <Button size="sm" variant="outline" disabled={!dirty} onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5 mr-1"/>Reset
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={remove}>
                <Minus className="h-3.5 w-3.5 mr-1"/>Delete
              </Button>
            </div>
          </div>

          {enabledProviders.length === 0 && (
            <div className="border border-destructive/40 rounded p-2 text-[11px] font-mono text-destructive flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5"/> No enabled providers. Enable in <b>Settings → Authentication</b>.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Group Name</Label>
              <Input value={draft.name} onChange={e => upd({ name: e.target.value })} className="font-mono mt-1"/></div>
            <div><Label>Default Role</Label>
              <Select value={draft.role} onValueChange={(v) => upd({ role: v as Role })}>
                <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>{t("users.auth_provider")}</Label>
              <Select value={draft.provider} onValueChange={(v) => upd({ provider: v as Account["provider"] })}>
                <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {providers.map(p => (
                    <SelectItem key={p.id} value={p.id} disabled={!p.enabled}>
                      {p.id.toUpperCase()}{!p.enabled && " · disabled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t("users.default_template")}</Label>
              <Select value={draft.templateId ?? "__none"} onValueChange={(v) => upd({ templateId: v === "__none" ? undefined : v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div><Label>Description</Label>
            <Textarea rows={2} value={draft.description}
              onChange={e => upd({ description: e.target.value })} className="font-mono mt-1"/></div>

          <div className="border-t border-border pt-3">
            <Label>Members</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {accounts.map(a => {
                const on = draft.members.includes(a.id);
                return (
                  <button key={a.id}
                    onClick={() => upd({ members: on ? draft.members.filter(x => x !== a.id) : [...draft.members, a.id] })}
                    className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                    {on ? "✓ " : ""}{a.username}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

/* ---------------- RBAC COMPLIANCE ---------------- */

function RbacComplianceTab({
  accounts, groups, rbac,
}: {
  accounts: Account[]; groups: Group[];
  rbac: { id: string; match: string; provider: string; role: Role }[];
}) {
  const { t } = useI18n();
  const rows = useMemo(() => accounts.map(a => {
    const exact = rbac.find(r => r.match.toLowerCase() === a.username.toLowerCase() && r.provider === a.provider);
    const star  = rbac.find(r => r.match === "*" && r.provider === a.provider);
    const expected = exact?.role ?? star?.role ?? "Viewer";
    const compliant = expected === a.role;
    const groupNames = a.groups.map(id => groups.find(g => g.id === id)?.name).filter(Boolean).join(", ") || "—";
    return { a, expected, compliant, groupNames };
  }), [accounts, groups, rbac]);

  return (
    <Card className="glass"><CardContent className="p-0">
      <div className="p-3 border-b border-border text-xs font-mono uppercase tracking-widest">
        RBAC Compliance · {rows.filter(r => r.compliant).length}/{rows.length} aligned
      </div>
      <table className="w-full text-xs font-mono">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left p-2">User</th>
            <th className="text-left p-2">Provider</th>
            <th className="text-left p-2">{t("users.assigned_role")}</th>
            <th className="text-left p-2">Expected (RBAC rule)</th>
            <th className="text-left p-2">Groups</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Compliance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, expected, compliant, groupNames }) => (
            <tr key={a.id} className="border-b border-border/40">
              <td className="p-2">{a.username}</td>
              <td className="p-2">{a.provider}</td>
              <td className="p-2">{a.role}</td>
              <td className="p-2 text-muted-foreground">{expected}</td>
              <td className="p-2 text-muted-foreground">{groupNames}</td>
              <td className="p-2"><StatusDot status={a.status}/> <span className="ml-1">{a.status}</span></td>
              <td className="p-2">
                <Badge variant="outline" className={`text-[9px] ${compliant ? "text-primary" : "text-destructive"}`}>
                  {compliant ? "✓ COMPLIANT" : "✗ DRIFT"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent></Card>
  );
}

function StatusDot({ status }: { status: AccountStatus }) {
  const c = status === "active" ? "bg-emerald-500" : status === "locked" ? "bg-yellow-500" : "bg-destructive";
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} />;
}
