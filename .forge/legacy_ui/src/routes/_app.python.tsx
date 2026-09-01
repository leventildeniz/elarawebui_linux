import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, TerminalSquare, ShieldCheck, Search, Lock, CheckCircle2, CircleAlert, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSystem, type RuntimeEntry } from "@/lib/system-store";
import { PythonAPI, type PythonPrimary } from "@/lib/api-client";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/python")({ component: PythonPage });

const EMPTY: RuntimeEntry = {
  id: "", name: "", python: "", venv: "/var/venvs/", packages: [], status: "idle",
};

function PythonPage() {
  const { t } = useI18n();
  const { runtimes, setRuntimes } = useSystem();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RuntimeEntry>(EMPTY);
  const [pkgInput, setPkgInput] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectedVer, setDetectedVer] = useState<string>("");

  // Primary Python (sealed)
  const [primary, setPrimary] = useState<PythonPrimary | null>(null);
  const [primaryDraft, setPrimaryDraft] = useState("");
  const [sealing, setSealing] = useState(false);

  useEffect(() => {
    PythonAPI.getPrimary().then((r) => {
      setPrimary(r.primary);
      if (r.primary?.path) setPrimaryDraft(r.primary.path);
    });
  }, []);

  const detectDraft = async () => {
    if (!draft.python.trim()) { toast.error(t("py.enter_path")); return; }
    setDetecting(true);
    const r = await PythonAPI.detect(draft.python.trim());
    setDetecting(false);
    if (!r.ok) { setDetectedVer(""); toast.error(r.error || t("py.detect_failed")); return; }
    setDetectedVer(r.version);
    setDraft({ ...draft, python: r.path });
    toast.success(r.version);
  };

  const sealPrimary = async () => {
    if (!primaryDraft.trim()) return;
    setSealing(true);
    const r = await PythonAPI.setPrimary(primaryDraft.trim());
    setSealing(false);
    if (!r.ok) { toast.error(r.error || t("py.seal_failed")); return; }
    setPrimary(r.primary);
    toast.success(`${t("py.sealed_ok")}: ${r.primary?.version}`);
  };
  const unsealPrimary = async () => {
    if (!confirm(t("py.unseal_confirm"))) return;
    await PythonAPI.setPrimary("");
    setPrimary(null);
    setPrimaryDraft("");
    toast.success(t("py.unsealed_ok"));
  };

  const openNew  = () => { setDraft({ ...EMPTY, id: `rt-${Date.now()}`, python: primary?.path || "" }); setEditId(null); setPkgInput(""); setDetectedVer(primary?.version || ""); setOpen(true); };
  const openEdit = (r: RuntimeEntry) => { setDraft(r); setEditId(r.id); setPkgInput(r.packages.join(", ")); setDetectedVer(""); setOpen(true); };

  const persist = async (next: RuntimeEntry[]) => {
    const r = await PythonAPI.saveRuntimes(next);
    if (!r.ok) toast.error(r.error || "Save failed");
    return r.ok;
  };

  const save = async () => {
    if (!draft.name) { toast.error(t("py.name_required")); return; }
    if (!draft.python.trim()) { toast.error(t("py.path_required")); return; }
    const next = { ...draft, packages: pkgInput.split(",").map(s=>s.trim()).filter(Boolean) };
    const list = editId ? runtimes.map(r => r.id === editId ? next : r) : [next, ...runtimes];
    const ok = await persist(list);
    if (!ok) return;
    setRuntimes(list);
    toast.success(editId ? t("py.runtime_updated") : t("py.runtime_created"));
    setOpen(false);
  };
  const remove = async (id: string) => {
    const list = runtimes.filter(r=>r.id!==id);
    const ok = await persist(list);
    if (!ok) return;
    setRuntimes(list);
    toast.success(t("common.removed"));
  };
  // Per-runtime verification state (in-memory only; reflects "is this interpreter reachable right now").
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [verified, setVerified] = useState<Record<string, { ok: boolean; version?: string; error?: string }>>({});

  const verifyOne = async (r: RuntimeEntry) => {
    if (!r.python.trim()) return;
    setVerifying((v) => ({ ...v, [r.id]: true }));
    const res = await PythonAPI.detect(r.python.trim());
    setVerifying((v) => ({ ...v, [r.id]: false }));
    setVerified((s) => ({ ...s, [r.id]: res.ok ? { ok: true, version: res.version } : { ok: false, error: res.error } }));
    if (res.ok) toast.success(`${r.name} · ${res.version}`);
    else toast.error(res.error || "Unreachable");
  };

  const counts = {
    venvs: runtimes.length,
    verified: Object.values(verified).filter((v) => v.ok).length,
  };

  return (
    <PageShell>
      <PageHeader
        title={t("page.python.title")}
        subtitle={t("page.python.subtitle")}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary text-primary-foreground" onClick={openNew}>
                <Plus className="h-4 w-4 mr-1"/>{t("py.new_runtime")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editId?t("py.modify_runtime"):t("py.new_runtime")}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>{t("common.name")}</Label>
                  <Input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} className="mt-1 font-mono"/></div>
                <div>
                  <Label>{t("py.exec_path")}</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      value={draft.python}
                      onChange={e=>{ setDraft({...draft,python:e.target.value}); setDetectedVer(""); }}
                      placeholder="/opt/homebrew/bin/python3.14"
                      className="font-mono"
                    />
                    <Button type="button" variant="outline" onClick={detectDraft} disabled={detecting}>
                      <Search className="h-3.5 w-3.5 mr-1"/>{detecting ? "…" : t("py.detect")}
                    </Button>
                  </div>
                  {detectedVer && (
                    <p className="text-[10px] font-mono text-primary mt-1">✓ {detectedVer}</p>
                  )}
                </div>
                <div><Label>{t("py.venv_path")}</Label>
                  <Input value={draft.venv} onChange={e=>setDraft({...draft,venv:e.target.value})} className="mt-1 font-mono"/></div>
                <div><Label>{t("py.packages")}</Label>
                  <Input value={pkgInput} onChange={e=>setPkgInput(e.target.value)} placeholder="pandas, numpy" className="mt-1 font-mono"/></div>
              </div>
              <DialogFooter>
                <Button onClick={save} className="bg-gradient-primary text-primary-foreground">{editId?t("common.save"):t("py.create")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Primary Python — sealed interpreter for Forge & Library scripts */}
      <Card className="glass mb-4">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary"/>
              <p className="text-sm font-mono uppercase tracking-widest">{t("py.primary_title")}</p>
            </div>
            {primary ? (
              <Badge className="font-mono text-[10px] bg-primary/20 text-primary border-primary/40">
                <Lock className="h-3 w-3 mr-1"/>{t("py.sealed")}
              </Badge>
            ) : (
              <Badge variant="outline" className="font-mono text-[10px]">{t("py.unsealed")}</Badge>
            )}
          </div>
          <p className="text-[11px] font-mono text-muted-foreground">
            {t("py.primary_hint")}
          </p>
          <div className="flex gap-2">
            <Input
              value={primaryDraft}
              onChange={(e) => setPrimaryDraft(e.target.value)}
              placeholder="/opt/homebrew/bin/python3.14"
              className="font-mono"
            />
            <Button onClick={sealPrimary} disabled={sealing} className="bg-gradient-primary text-primary-foreground">
              <ShieldCheck className="h-3.5 w-3.5 mr-1"/>{sealing ? t("py.sealing") : t("py.seal")}
            </Button>
            {primary && (
              <Button variant="outline" className="text-destructive" onClick={unsealPrimary}>
                <Trash2 className="h-3.5 w-3.5"/>
              </Button>
            )}
          </div>
          {primary && (
            <div className="text-[10px] font-mono text-muted-foreground border border-border rounded p-2 bg-card/40">
              <div>{t("py.path")}: <span className="text-foreground">{primary.path}</span></div>
              <div>{t("py.version")}: <span className="text-primary">{primary.version}</span></div>
              <div>{t("py.sealed_at")}: {new Date(primary.sealed_at).toLocaleString()}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {[
          [t("py.active_venvs"), String(counts.venvs)],
          ["VERIFIED",           String(counts.verified)],
          [t("py.artifacts"),    "37"],
        ].map(([l,v]) => (
          <Card key={l} className="glass"><CardContent className="p-4">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">{l}</p>
            <p className="text-2xl font-bold text-primary mt-1">{v}</p>
          </CardContent></Card>
        ))}
      </div>

      <div className="space-y-2 mb-4">
        {runtimes.map(r => {
          const v = verified[r.id];
          const isVerifying = !!verifying[r.id];
          return (
            <Card key={r.id} className="glass"><CardContent className="p-4 flex items-center gap-4">
              <TerminalSquare className="h-5 w-5 text-primary"/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono truncate">{r.name} <span className="text-muted-foreground">· {r.python || t("py.no_path")}</span></p>
                <p className="text-[10px] font-mono text-muted-foreground truncate">{r.venv} · {r.packages.length} {t("py.pkgs")}</p>
              </div>
              {v ? (
                v.ok ? (
                  <Badge className="font-mono text-[10px] bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-1">
                    <CheckCircle2 className="h-3 w-3"/>{v.version}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-mono text-[10px] text-destructive border-destructive/40 gap-1">
                    <CircleAlert className="h-3 w-3"/>unreachable
                  </Badge>
                )
              ) : (
                <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">unverified</Badge>
              )}
              <Button size="sm" variant="outline" onClick={()=>verifyOne(r)} disabled={isVerifying}>
                <RotateCw className={`h-3 w-3 mr-1 ${isVerifying ? "animate-spin" : ""}`}/>Verify
              </Button>
              <Button size="icon" variant="outline" onClick={()=>openEdit(r)}><Pencil className="h-3.5 w-3.5"/></Button>
              <Button size="icon" variant="outline" className="text-destructive" onClick={()=>remove(r.id)}><Trash2 className="h-3.5 w-3.5"/></Button>
            </CardContent></Card>
          );
        })}
      </div>
    </PageShell>
  );
}
