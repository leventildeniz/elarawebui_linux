import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Crosshair, Pencil, Trash2, RotateCcw, Upload, Download, FolderTree, HelpCircle, Star,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  TargetsAPI, TargetGroupsAPI, AdaptersAPI, VaultAPI, TargetEndpointsAPI,
  type TargetRow, type TargetGroupRow, type AdapterRow, type VaultItem, type TargetEndpointRow,
} from "@/lib/api-client";
import { Plug2, Activity } from "lucide-react";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_app/targets")({ component: TargetsPage });

const RISKS = ["low", "medium", "high", "critical"] as const;
const KINDS = ["firewall", "router", "switch", "server", "cloud", "endpoint", "service", "custom"] as const;

interface TForm {
  id?: string;
  group_id: string;
  name: string;
  host: string;
  ip: string;
  port: string;
  tags: string;
  risk_level: typeof RISKS[number];
  requires_approval: boolean;
  vault_scope: string;
  vault_name: string;
  default_adapter_id: string;
  owner: string;
  notes: string;
}

interface GForm {
  id?: string;
  name: string;
  kind: typeof KINDS[number];
  description: string;
  tags: string;
}

const emptyT = (group_id = ""): TForm => ({
  group_id, name: "", host: "", ip: "", port: "", tags: "",
  risk_level: "low", requires_approval: false,
  vault_scope: "", vault_name: "", default_adapter_id: "", owner: "", notes: "",
});
const emptyG = (): GForm => ({ name: "", kind: "firewall", description: "", tags: "" });

function TargetsPage() {
  const [groups, setGroups] = useState<TargetGroupRow[]>([]);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [adapters, setAdapters] = useState<AdapterRow[]>([]);
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [filter, setFilter] = useState<string>("__all__");
  const [search, setSearch] = useState("");

  const [tOpen, setTOpen] = useState(false);
  const [tForm, setTForm] = useState<TForm>(emptyT());
  const [tSaving, setTSaving] = useState(false);

  const [gOpen, setGOpen] = useState(false);
  const [gForm, setGForm] = useState<GForm>(emptyG());
  const [gSaving, setGSaving] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // ---- Tur-3.3/3.9 multi-endpoint editor ----
  const PORT_LABELS: Record<number, string> = {
    22: "ssh", 23: "telnet", 25: "smtp", 53: "dns", 80: "http", 161: "snmp",
    389: "ldap", 443: "api", 445: "smb", 636: "ldaps", 587: "smtp-tls",
    993: "imaps", 995: "pop3s", 1433: "mssql", 3306: "mysql", 3389: "rdp",
    5432: "pg", 5985: "winrm", 6443: "k8s", 8080: "http-alt", 8443: "mgmt",
    9090: "metrics", 9200: "es",
  };
  const labelForPort = (p: number) => PORT_LABELS[p] || (p ? `:${p}` : "");
  /** Parse "443,22,8443" or "8000-8003" or "443" into a port list. */
  const parsePortList = (raw: string): number[] => {
    const out = new Set<number>();
    for (const chunk of raw.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean)) {
      const range = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const a = +range[1], b = +range[2];
        if (a > 0 && b >= a && b - a <= 64) for (let p = a; p <= b; p++) out.add(p);
      } else {
        const n = Number(chunk);
        if (n > 0 && n < 65536) out.add(n);
      }
    }
    return [...out];
  };

  const [endpoints, setEndpoints] = useState<TargetEndpointRow[]>([]);
  const [epLoading, setEpLoading] = useState(false);
  const [epTesting, setEpTesting] = useState<string | null>(null);
  const loadEndpoints = async (targetId: string) => {
    setEpLoading(true);
    try {
      const r = await TargetEndpointsAPI.list(targetId);
      setEndpoints(r.items || []);
    } finally { setEpLoading(false); }
  };
  const makeNewEp = (idx: number, init: Partial<TargetEndpointRow> = {}): TargetEndpointRow => ({
    id: `new-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
    target_id: tForm.id || "",
    // Pre-fill defaults from the main form so "Add endpoint" matches
    // "Generate from Port(s)" behavior. Null fields are resolved by the
    // backend resolver (COALESCE on targets.default_*).
    adapter_id: tForm.default_adapter_id || null,
    port: 0, label: "",
    vault_scope: tForm.vault_scope || null,
    vault_name: tForm.vault_name || null,
    is_primary: idx === 0, last_health: null,
    ...init,
  } as TargetEndpointRow);
  const addEndpointRow = () => {
    setEndpoints((rows) => [...rows, makeNewEp(rows.length)]);
  };
  const expandFromPortField = () => {
    const ports = parsePortList(tForm.port);
    if (!ports.length) { toast.error("Type ports first (e.g. 443,22,8443)"); return; }
    setEndpoints((rows) => {
      const existing = new Set(rows.map((r) => r.port));
      const additions = ports.filter((p) => !existing.has(p))
        .map((p, i) => makeNewEp(rows.length + i, {
          port: p, label: labelForPort(p),
          adapter_id: tForm.default_adapter_id || null,
          vault_scope: tForm.vault_scope || null,
          vault_name: tForm.vault_name || null,
          is_primary: rows.length === 0 && i === 0,
        }));
      return [...rows, ...additions];
    });
    toast.success(`Added ${ports.length} endpoint${ports.length > 1 ? "s" : ""}`);
  };
  const updEp = (id: string, patch: Partial<TargetEndpointRow>) =>
    setEndpoints((rows) => rows.map((r) => {
      if (r.id !== id) return r;
      const merged = { ...r, ...patch } as TargetEndpointRow;
      // Clamp port to [0, 65535] — HTML min/max can be bypassed by paste/script.
      if (patch.port !== undefined) {
        const p = Number(patch.port) || 0;
        merged.port = Math.max(0, Math.min(65535, p));
      }
      return merged;
    }));
  const setPrimary = (id: string) =>
    setEndpoints((rows) => rows.map((r) => ({ ...r, is_primary: r.id === id })));
  const delEp = (id: string) => setEndpoints((rows) => rows.filter((r) => r.id !== id));
  /** Filter out endpoints with invalid ports and warn the user. */
  const validEndpoints = (rows: TargetEndpointRow[]): TargetEndpointRow[] => {
    const valid: TargetEndpointRow[] = [];
    let dropped = 0;
    for (const r of rows) {
      const p = Number(r.port) || 0;
      if (p > 0 && p < 65536) valid.push(r); else dropped++;
    }
    if (dropped > 0) {
      toast.warning(`${dropped} endpoint row${dropped === 1 ? "" : "s"} dropped: port must be between 1 and 65535`);
    }
    return valid;
  };
  const persistEndpoints = async (targetId: string, rows = endpoints) => {
    const clean = validEndpoints(rows);
    await TargetEndpointsAPI.save(targetId, clean.map((e) => ({
      id: e.id.startsWith("new-") ? undefined : e.id,
      adapter_id: e.adapter_id, port: Number(e.port) || 0,
      label: e.label || "", vault_scope: e.vault_scope || "",
      vault_name: e.vault_name || "", is_primary: e.is_primary,
    })));
  };
  const saveEndpoints = async () => {
    if (!tForm.id) { toast.error("Save target first"); return; }
    try {
      await persistEndpoints(tForm.id);
      toast.success("Endpoints saved");
      await loadEndpoints(tForm.id);
    } catch (e) { toast.error((e as Error).message); }
  };
  const testEp = async (ep: TargetEndpointRow) => {
    if (!tForm.id || ep.id.startsWith("new-")) { toast.error("Save endpoints first"); return; }
    setEpTesting(ep.id);
    try {
      const r = await TargetEndpointsAPI.test(tForm.id, ep.id);
      updEp(ep.id, { last_health: r.health });
      toast[r.health.ok ? "success" : "error"](
        r.health.ok ? `OK ${r.health.latency_ms ?? "?"}ms` : `Fail: ${r.health.error ?? "unreachable"}`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setEpTesting(null); }
  };

  const downloadTemplate = () => {
    const csv = [
      "name,ip,host,port,tags,group,vault_scope,vault_name,default_adapter,risk_level,requires_approval,owner,notes",
      'fw01,10.0.0.1,fw01.corp.local,"443,22",prod|dmz,Forti,prod,fw01_admin,http_rest,high,true,netsec,"Primary edge firewall"',
      "fw02,10.0.0.2,fw02.corp.local,443,prod,Forti,prod,fw02_admin,http_rest,high,false,netsec,",
      "web01,10.0.1.10,,80,prod,Linux DMZ,,,,medium,false,,",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "targets-template.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };


  const refresh = async () => {
    const [g, t, a, v] = await Promise.all([
      TargetGroupsAPI.list(), TargetsAPI.list(), AdaptersAPI.list(), VaultAPI.list(),
    ]);
    setGroups(g.items ?? []);
    setTargets(t.items ?? []);
    setAdapters(a.items ?? []);
    setVault(v.items ?? []);
  };
  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return targets.filter((t) => {
      if (filter !== "__all__" && t.group_id !== filter) return false;
      if (!q) return true;
      return [t.name, t.host, t.ip, t.owner, ...(t.tags ?? [])].some((s) =>
        String(s ?? "").toLowerCase().includes(q));
    });
  }, [targets, filter, search]);

  const openCreateT = () => { setEndpoints([]); setTForm(emptyT(filter === "__all__" ? "" : filter)); setTOpen(true); };
  const openEditT = (row: TargetRow) => {
    setTForm({
      id: row.id, group_id: row.group_id ?? "", name: row.name,
      host: row.host ?? "", ip: row.ip ?? "", port: row.port ? String(row.port) : "",
      tags: (row.tags ?? []).join(","), risk_level: (row.risk_level as typeof RISKS[number]) || "low",
      requires_approval: !!row.requires_approval,
      vault_scope: row.vault_scope ?? "", vault_name: row.vault_name ?? "",
      default_adapter_id: row.default_adapter_id ?? "",
      owner: row.owner ?? "", notes: row.notes ?? "",
    });
    setEndpoints([]);
    void loadEndpoints(row.id);
    setTOpen(true);
  };

  const saveT = async () => {
    if (!tForm.name.trim()) { toast.error("Name required"); return; }
    // Multi-port shortcut: if user typed "443,22,8443" in Port, use the first
    // as the primary target.port and queue the rest as endpoints on create.
    const portList = parsePortList(tForm.port);
    const primaryPort = portList[0] || (tForm.port ? Number(tForm.port) : null);
    const body: Partial<TargetRow> & { name: string } = {
      name: tForm.name.trim(),
      group_id: tForm.group_id || null,
      host: tForm.host.trim(),
      ip: tForm.ip.trim(),
      port: primaryPort,
      tags: tForm.tags.split(",").map((s) => s.trim()).filter(Boolean),
      risk_level: tForm.risk_level,
      requires_approval: tForm.requires_approval,
      vault_scope: tForm.vault_scope || "",
      vault_name: tForm.vault_name || "",
      default_adapter_id: tForm.default_adapter_id || null,
      owner: tForm.owner,
      notes: tForm.notes,
    };
    setTSaving(true);
    try {
      let targetId: string | undefined = tForm.id;
      if (tForm.id) {
        await TargetsAPI.update(tForm.id, body);
      } else {
        const created = await TargetsAPI.create(body);
        targetId = (created as { item?: { id: string }; id?: string }).item?.id
          ?? (created as { id?: string }).id ?? undefined;
      }
      // Persist endpoint rows. On create, also auto-expand extra ports from "443,22,8443".
      if (targetId) {
        let toSave = endpoints;
        if (!tForm.id && portList.length > 1) {
          const existingPorts = new Set(endpoints.map((e) => e.port));
          const extras = portList.slice(1).filter((p) => !existingPorts.has(p))
            .map((p, i) => ({
              id: `new-extra-${i}`, target_id: targetId!,
              adapter_id: tForm.default_adapter_id || null,
              port: p, label: labelForPort(p),
              vault_scope: tForm.vault_scope || null,
              vault_name: tForm.vault_name || null,
              is_primary: false, last_health: null,
            } as TargetEndpointRow));
          toSave = [...endpoints, ...extras];
        }
        if (toSave.length) {
          await persistEndpoints(targetId, toSave);
        }
      }
      toast.success(tForm.id ? "Target updated" : "Target created");
      setTOpen(false); await refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setTSaving(false); }
  };

  const removeT = async (row: TargetRow) => {
    if (!confirm(`Delete target "${row.name}"?`)) return;
    try { await TargetsAPI.remove(row.id); toast.success("Deleted"); await refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const openCreateG = () => { setGForm(emptyG()); setGOpen(true); };
  const openEditG = (row: TargetGroupRow) => {
    setGForm({
      id: row.id, name: row.name,
      kind: (row.kind as typeof KINDS[number]) || "custom",
      description: row.description ?? "",
      tags: (row.tags ?? []).join(","),
    });
    setGOpen(true);
  };
  const saveG = async () => {
    if (!gForm.name.trim()) { toast.error("Name required"); return; }
    const body = {
      name: gForm.name.trim(),
      kind: gForm.kind,
      description: gForm.description,
      tags: gForm.tags.split(",").map((s) => s.trim()).filter(Boolean),
    };
    setGSaving(true);
    try {
      if (gForm.id) await TargetGroupsAPI.update(gForm.id, body);
      else          await TargetGroupsAPI.create(body);
      toast.success(gForm.id ? "Group updated" : "Group created");
      setGOpen(false); await refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setGSaving(false); }
  };
  const removeG = async (row: TargetGroupRow) => {
    if (!confirm(`Delete group "${row.name}"? Targets will be unlinked.`)) return;
    try { await TargetGroupsAPI.remove(row.id); toast.success("Deleted"); await refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  // ---------- Import / Export ----------
  const handleImport = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      let rows: Array<Record<string, unknown>> = [];
      const ext = file.name.toLowerCase().split(".").pop();
      if (ext === "txt") {
        const text = new TextDecoder().decode(buf);
        rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
          .map((line) => {
            // Either bare ip, or "name,ip" or "name<TAB>ip"
            const parts = line.split(/[,\t;]/).map((s) => s.trim()).filter(Boolean);
            if (parts.length === 1) return { name: parts[0], ip: parts[0] };
            return { name: parts[0], ip: parts[1], host: parts[2] ?? "", tags: parts[3] ?? "" };
          });
      } else {
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      }
      if (!rows.length) { toast.error("No rows parsed"); return; }
      const normalized = rows.map((r) => {
        const tagsRaw = r.tags ?? r.Tags ?? "";
        const tags = Array.isArray(tagsRaw)
          ? tagsRaw
          : String(tagsRaw).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
        const port = Number(r.port ?? r.Port ?? 0);
        return {
          name: String(r.name ?? r.Name ?? r.ip ?? r.IP ?? "").trim(),
          host: String(r.host ?? r.Host ?? "").trim(),
          ip: String(r.ip ?? r.IP ?? "").trim(),
          port: port > 0 ? port : null,
          tags,
          risk_level: String(r.risk_level ?? r.Risk ?? "low").toLowerCase() as TargetRow["risk_level"],
          requires_approval: String(r.requires_approval ?? "").toLowerCase() === "true",
          owner: String(r.owner ?? r.Owner ?? ""),
          notes: String(r.notes ?? r.Notes ?? ""),
        };
      }).filter((r) => r.name);
      if (!normalized.length) { toast.error("All rows missing 'name'"); return; }
      const default_group_id = filter !== "__all__" ? filter : undefined;
      const r = await TargetsAPI.bulk(normalized, default_group_id);
      toast.success(`Imported ${r.inserted} · skipped ${r.skipped}`);
      await refresh();
    } catch (e) { toast.error("Import failed: " + (e as Error).message); }
  };

  const exportRows = (fmt: "csv" | "xlsx") => {
    const rows = filtered.map((t) => ({
      name: t.name, host: t.host, ip: t.ip, port: t.port ?? "",
      group: groups.find((g) => g.id === t.group_id)?.name ?? "",
      tags: (t.tags ?? []).join("|"),
      risk_level: t.risk_level, requires_approval: t.requires_approval,
      vault_scope: t.vault_scope, vault_name: t.vault_name,
      owner: t.owner, notes: t.notes,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    if (fmt === "csv") {
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "targets.csv"; a.click();
      URL.revokeObjectURL(url);
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "targets");
      XLSX.writeFile(wb, "targets.xlsx");
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Targets"
        subtitle="Hosts, IPs, infrastructure registry — grouped, vault-bound, agent-routable"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={refresh}><RotateCcw className="h-3.5 w-3.5 mr-1" />Refresh</Button>
            <Button variant="outline" size="sm" onClick={openCreateG}><FolderTree className="h-3.5 w-3.5 mr-1" />New Group</Button>
            <Button size="sm" onClick={openCreateT}><Plus className="h-3.5 w-3.5 mr-1" />New Target</Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1" />Import
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Batch import format">
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[460px] text-xs">
                <div className="font-medium text-sm mb-2 flex items-center gap-1.5">
                  <Upload className="h-3.5 w-3.5" /> Batch import — CSV / XLSX / TXT
                </div>
                <p className="text-muted-foreground mb-2">
                  Bulk-load up to thousands of devices. First row of CSV / XLSX must be a header.
                  Recognized columns (case-insensitive):
                </p>
                <pre className="bg-muted rounded p-2 text-[11px] leading-relaxed overflow-x-auto">
{`name           Target display name           (required)
ip             IPv4 / IPv6 address
host           FQDN (e.g. fw01.corp.local)
port           Single (443) or list (443,22,8443)
                — multi-port rows auto-create endpoints
                — ranges supported (8000-8005)
adapter        Adapter name (matched to registry)
group          Target group name
tags           Comma- or pipe-separated tags
vault_scope    Credential scope
vault_name     Credential name
risk_level     low | medium | high | critical
owner          Free text
notes          Free text`}
                </pre>
                <p className="text-muted-foreground mt-2">
                  <strong>CSV example:</strong>
                </p>
                <pre className="bg-muted rounded p-2 text-[11px] leading-relaxed overflow-x-auto">
{`name,ip,host,port,tags,group,risk_level
fw01,10.0.0.1,fw01.corp.local,"443,22",prod|dmz,Forti,high
fw02,10.0.0.2,fw02.corp.local,443,prod,Forti,high
web01,10.0.1.10,,80,prod,Linux DMZ,medium`}
                </pre>
                <p className="text-muted-foreground mt-2">
                  <strong>TXT shortcut:</strong> one host per line — <code>ip</code>, <code>name,ip</code>, or <code>ip:port</code>.
                </p>
                <p className="text-muted-foreground mt-1">
                  Tip: filter a group first → imported rows land in that group by default.
                </p>
                <div className="mt-3 pt-2 border-t flex justify-end">
                  <Button size="sm" variant="outline" type="button" onClick={downloadTemplate}>
                    <Download className="h-3.5 w-3.5 mr-1" />Download template.csv
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <input
              ref={fileRef} type="file" className="hidden"
              accept=".csv,.txt,.xlsx,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" onClick={() => exportRows("csv")}>
              <Download className="h-3.5 w-3.5 mr-1" />CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportRows("xlsx")}>
              <Download className="h-3.5 w-3.5 mr-1" />XLSX
            </Button>
          </div>
        }
      />

      {/* Groups */}
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Target Groups ({groups.length})
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter("__all__")}
              className={`text-xs px-3 py-1.5 rounded border ${
                filter === "__all__" ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"
              }`}
            >All · {targets.length}</button>
            {groups.map((g) => (
              <div key={g.id} className="flex items-center gap-1">
                <button
                  onClick={() => setFilter(g.id)}
                  className={`text-xs px-3 py-1.5 rounded border ${
                    filter === g.id ? "border-primary text-primary bg-primary/10" : "border-border"
                  }`}
                >
                  {g.name} · {g.target_count ?? 0}
                  <span className="ml-2 text-[9px] text-muted-foreground font-mono">{g.kind}</span>
                </button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEditG(g)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => void removeG(g)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {!groups.length && (
              <p className="text-xs text-muted-foreground">No groups — create one (e.g. "Forti", "Checkpoint", "Netscaler").</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Targets table */}
      <Card className="border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Targets ({filtered.length})
            </p>
            <Input
              placeholder="Search name, ip, host, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs h-8 text-xs"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr className="text-left">
                  <th className="py-2 px-2">Name</th>
                  <th className="py-2 px-2">IP / Host</th>
                  <th className="py-2 px-2">Group</th>
                  <th className="py-2 px-2">Adapter</th>
                  <th className="py-2 px-2">Vault</th>
                  <th className="py-2 px-2">Risk</th>
                  <th className="py-2 px-2">Tags</th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="py-2 px-2 font-mono">{t.name}</td>
                    <td className="py-2 px-2 font-mono text-muted-foreground">
                      {t.ip || "—"}{t.port ? `:${t.port}` : ""}
                      {t.host && <div className="text-[10px] opacity-70">{t.host}</div>}
                    </td>
                    <td className="py-2 px-2">{groups.find((g) => g.id === t.group_id)?.name ?? "—"}</td>
                    <td className="py-2 px-2 font-mono text-[10px]">
                      {adapters.find((a) => a.id === t.default_adapter_id)?.name ?? "—"}
                    </td>
                    <td className="py-2 px-2 font-mono text-[10px]">
                      {t.vault_scope ? `${t.vault_scope}/${t.vault_name}` : "—"}
                    </td>
                    <td className="py-2 px-2">
                      <Badge variant={t.risk_level === "low" ? "outline" : "destructive"} className="text-[9px]">
                        {t.risk_level}
                      </Badge>
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex flex-wrap gap-1">
                        {(t.tags ?? []).slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[9px]">{tag}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditT(t)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => void removeT(t)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">
                    No targets. Add one or Import from CSV/XLSX/TXT.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Target dialog */}
      <Dialog open={tOpen} onOpenChange={setTOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tForm.id ? "Edit Target" : "New Target"}</DialogTitle>
            <DialogDescription>
              <Crosshair className="inline h-3 w-3 mr-1" />
              Register a single host, firewall, or service. Bind it to an adapter + vault entry for one-click agent connect.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Name *</label>
                <Input value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Group</label>
                <Select value={tForm.group_id || "__none__"} onValueChange={(v) => setTForm({ ...tForm, group_id: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— ungrouped —</SelectItem>
                    {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">IP</label>
                <Input value={tForm.ip} onChange={(e) => setTForm({ ...tForm, ip: e.target.value })} placeholder="10.0.0.1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Host (FQDN)</label>
                <Input value={tForm.host} onChange={(e) => setTForm({ ...tForm, host: e.target.value })} placeholder="fw01.corp.local" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Port(s)</label>
                <Input value={tForm.port} onChange={(e) => setTForm({ ...tForm, port: e.target.value })}
                  placeholder="443  or  443,22,8443" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tags (comma)</label>
              <Input value={tForm.tags} onChange={(e) => setTForm({ ...tForm, tags: e.target.value })} placeholder="prod,dmz,emea" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Default Adapter</label>
                <Select value={tForm.default_adapter_id || "__none__"} onValueChange={(v) => setTForm({ ...tForm, default_adapter_id: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— none —</SelectItem>
                    {adapters.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Vault scope</label>
                <Select value={tForm.vault_scope || "__none__"} onValueChange={(v) => setTForm({ ...tForm, vault_scope: v === "__none__" ? "" : v, vault_name: "" })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {[...new Set(vault.map((v) => v.scope))].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Vault name</label>
                <Select value={tForm.vault_name || "__none__"} onValueChange={(v) => setTForm({ ...tForm, vault_name: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {vault.filter((v) => v.scope === tForm.vault_scope).map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Risk</label>
                <Select value={tForm.risk_level} onValueChange={(v) => setTForm({ ...tForm, risk_level: v as typeof RISKS[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RISKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Switch checked={tForm.requires_approval} onCheckedChange={(v) => setTForm({ ...tForm, requires_approval: v })} />
                <span className="text-xs">Requires approval</span>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Owner</label>
                <Input value={tForm.owner} onChange={(e) => setTForm({ ...tForm, owner: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea rows={2} value={tForm.notes} onChange={(e) => setTForm({ ...tForm, notes: e.target.value })} />
            </div>

            {/* Multi-endpoint editor — readable card layout */}
            <div className="border rounded-md p-3 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5">
                  <Plug2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Endpoints</span>
                  <Badge variant="outline" className="h-5 text-[10px]">{endpoints.length}</Badge>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="What are endpoints?">
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 text-xs">
                      <p className="font-medium mb-1">Multiple ways to reach one target</p>
                      <p className="text-muted-foreground">
                        A single device can expose more than one service. Add an
                        endpoint for each adapter + port pair the agent should be
                        allowed to use. The <Star className="inline h-3 w-3 fill-yellow-400 text-yellow-500" /> star
                        marks the primary endpoint (used when no specific one is requested).
                      </p>
                      <p className="text-muted-foreground mt-2">
                        Example — a firewall reachable via REST API on 443 and SSH on 22:
                        two endpoints, one primary.
                      </p>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" type="button"
                    onClick={expandFromPortField}
                    title={parsePortList(tForm.port).length
                      ? `Create ${parsePortList(tForm.port).length} endpoint(s) from the Port(s) field`
                      : "Type comma-separated ports in the Port(s) field first (e.g. 443,22,8443)"}
                    disabled={!parsePortList(tForm.port).length}>
                    Generate from Port(s)
                    {parsePortList(tForm.port).length > 0 && (
                      <Badge variant="secondary" className="ml-1.5 h-4 text-[9px] px-1">
                        {parsePortList(tForm.port).length}
                      </Badge>
                    )}
                  </Button>
                  <Button size="sm" variant="outline" type="button" onClick={addEndpointRow}>
                    <Plus className="h-3 w-3 mr-1" />Add endpoint
                  </Button>
                  {tForm.id && (
                    <Button size="sm" type="button" onClick={saveEndpoints}>Save endpoints</Button>
                  )}
                </div>
              </div>

              {epLoading ? (
                <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>
              ) : endpoints.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded">
                  {tForm.id
                    ? "This target uses the default Port + Adapter above. Add endpoints here to reach it on additional ports."
                    : "No endpoints yet. Add one manually, or type comma-separated ports above (e.g. 443,22,8443) and click Generate from Port(s)."}
                </div>
              ) : (
                <div className="space-y-2">
                  {endpoints.map((ep, idx) => (
                    <div key={ep.id} className={`border rounded-md bg-background p-2.5 space-y-2 ${
                      !ep.port || ep.port < 1 || ep.port > 65535 ? "border-destructive/60" : ""
                    }`}>
                      {/* Row 1 — header: primary toggle, label, port, health, actions */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="sm" variant={ep.is_primary ? "default" : "outline"} type="button"
                          className="h-7 px-2"
                          onClick={() => setPrimary(ep.id)}
                          title={ep.is_primary ? "Primary endpoint" : "Mark as primary"}>
                          <Star className={`h-3.5 w-3.5 mr-1 ${ep.is_primary ? "fill-yellow-300 text-yellow-200" : "text-muted-foreground"}`} />
                          <span className="text-[11px]">{ep.is_primary ? "Primary" : "Set primary"}</span>
                        </Button>
                        <div className="flex-1 min-w-[140px]">
                          <label className="text-[9px] uppercase tracking-wide text-muted-foreground">Label</label>
                          <Input className="h-7 text-xs" placeholder="e.g. api, ssh, mgmt"
                            value={ep.label ?? ""}
                            onChange={(e) => updEp(ep.id, { label: e.target.value })} />
                        </div>
                        <div className="w-24">
                          <label className="text-[9px] uppercase tracking-wide text-muted-foreground">Port</label>
                          <Input className="h-7 text-xs" placeholder="443" type="number" min={1} max={65535}
                            value={ep.port ? String(ep.port) : ""}
                            onChange={(e) => {
                              const p = Number(e.target.value) || 0;
                              updEp(ep.id, {
                                port: p,
                                label: ep.label && ep.label !== labelForPort(Number(ep.port || 0))
                                  ? ep.label
                                  : labelForPort(p),
                              });
                            }} />
                        </div>
                        <div className="flex items-center gap-1 self-end pb-0.5">
                          {ep.last_health && (
                            <Badge variant={ep.last_health.ok ? "default" : "destructive"} className="h-5 text-[10px]">
                              {ep.last_health.ok ? `OK · ${ep.last_health.latency_ms ?? "?"}ms` : "fail"}
                            </Badge>
                          )}
                          {tForm.id && !ep.id.startsWith("new-") && (
                            <Button size="sm" variant="outline" type="button" className="h-7 px-2"
                              disabled={epTesting === ep.id} onClick={() => testEp(ep)}
                              title="Test connection">
                              <Activity className={`h-3.5 w-3.5 mr-1 ${epTesting === ep.id ? "animate-pulse" : ""}`} />
                              <span className="text-[11px]">Test</span>
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" type="button" className="h-7 w-7 p-0 text-destructive"
                            onClick={() => delEp(ep.id)} title="Remove endpoint">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Row 2 — credentials: adapter, vault scope, vault name */}
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[9px] uppercase tracking-wide text-muted-foreground">Adapter</label>
                          <Select value={ep.adapter_id || "__none__"}
                            onValueChange={(v) => updEp(ep.id, { adapter_id: v === "__none__" ? null : v })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select adapter…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— inherit default —</SelectItem>
                              {adapters.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-[9px] uppercase tracking-wide text-muted-foreground">Vault scope</label>
                          <Select value={ep.vault_scope || "__none__"}
                            onValueChange={(v) => updEp(ep.id, { vault_scope: v === "__none__" ? null : v, vault_name: null })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select scope…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— inherit default —</SelectItem>
                              {[...new Set(vault.map((v) => v.scope))].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-[9px] uppercase tracking-wide text-muted-foreground">Vault name</label>
                          <Select value={ep.vault_name || "__none__"}
                            onValueChange={(v) => updEp(ep.id, { vault_name: v === "__none__" ? null : v })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select credential…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— inherit default —</SelectItem>
                              {vault.filter((v) => v.scope === ep.vault_scope).map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {idx === 0 && endpoints.length > 1 && (
                        <p className="text-[10px] text-muted-foreground pt-0.5">
                          Tip: leave fields on “inherit default” to reuse the adapter / vault from the main form above.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>


          <DialogFooter>
            <Button variant="outline" onClick={() => setTOpen(false)}>Cancel</Button>
            <Button
              onClick={saveT}
              disabled={tSaving || endpoints.some((e) => !e.port || e.port < 1 || e.port > 65535)}
              title={endpoints.some((e) => !e.port || e.port < 1 || e.port > 65535)
                ? "One or more endpoints have an invalid port (1–65535 required)" : undefined}
            >{tSaving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group dialog */}
      <Dialog open={gOpen} onOpenChange={setGOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{gForm.id ? "Edit Group" : "New Group"}</DialogTitle>
            <DialogDescription>Group hosts by vendor/role (Forti, Checkpoint, Netscaler, Linux DMZ…).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Name *</label>
              <Input value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Kind</label>
              <Select value={gForm.kind} onValueChange={(v) => setGForm({ ...gForm, kind: v as typeof KINDS[number] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Description</label>
              <Input value={gForm.description} onChange={(e) => setGForm({ ...gForm, description: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tags (comma)</label>
              <Input value={gForm.tags} onChange={(e) => setGForm({ ...gForm, tags: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGOpen(false)}>Cancel</Button>
            <Button onClick={saveG} disabled={gSaving}>{gSaving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
