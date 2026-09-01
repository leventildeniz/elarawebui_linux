import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, ScanEye, Trash2, Pencil, Lock } from "lucide-react";
import { useState } from "react";
import { useSystem, type PolicyRule } from "@/lib/system-store";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/policies")({ component: PoliciesPage });

const EMPTY: PolicyRule = { id: "", name: "", cond: "", action: "", active: true };

function PoliciesPage() {
  const { t } = useI18n();
  const { policies, setPolicies } = useSystem();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PolicyRule>(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);

  const openNew  = () => { setDraft({ ...EMPTY, id: `p-${Date.now()}` }); setEditId(null); setOpen(true); };
  const openEdit = (r: PolicyRule) => { setDraft(r); setEditId(r.id); setOpen(true); };
  const save = () => {
    if (!draft.name || !draft.cond || !draft.action) { toast.error(t("common.all_fields_required")); return; }
    if (editId) setPolicies(policies.map(p => p.id === editId ? draft : p));
    else setPolicies([draft, ...policies]);
    toast.success(editId ? t("pol.updated") : t("pol.added"));
    setOpen(false);
  };
  const remove = (id: string) => { setPolicies(policies.filter(p=>p.id!==id)); toast.success(t("common.removed")); };
  const toggle = (id: string, v: boolean) => setPolicies(policies.map(p=>p.id===id?{...p,active:v}:p));

  return (
    <PageShell>
      <PageHeader
        title={t("page.policies.title")}
        subtitle={t("page.policies.subtitle")}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary text-primary-foreground" onClick={openNew}>
                <Plus className="h-4 w-4 mr-1"/>{t("pol.new")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editId?t("pol.edit_title"):t("pol.new_title")}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>{t("common.name")}</Label>
                  <Input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} className="mt-1"/></div>
                <div><Label>{t("pol.if")}</Label>
                  <Input value={draft.cond} onChange={e=>setDraft({...draft,cond:e.target.value})} placeholder={t("pol.cond_ph")} className="mt-1 font-mono"/></div>
                <div><Label>{t("pol.then")}</Label>
                  <Input value={draft.action} onChange={e=>setDraft({...draft,action:e.target.value})} placeholder={t("pol.action_ph")} className="mt-1 font-mono"/></div>
                <div className="flex items-center gap-2">
                  <Switch checked={draft.active} onCheckedChange={v=>setDraft({...draft,active:v})}/>
                  <span className="text-xs font-mono">{t("pol.active")}</span>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={save} className="bg-gradient-primary text-primary-foreground">{editId?t("common.save"):t("common.add")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="space-y-3">
        {policies.map((r) => (
          <Card key={r.id} className="glass">
            <CardContent className="p-4 flex items-center gap-4">
              <ScanEye className="h-5 w-5 text-primary shrink-0"/>
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                <div>
                  <p className="text-[10px] font-mono uppercase text-muted-foreground flex items-center gap-1">
                    {t("pol.label_rule")} {r.locked && <Lock className="h-2.5 w-2.5"/>}
                  </p>
                  <p className="font-medium">{r.name}</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase text-muted-foreground">{t("pol.if").split(" ")[0]}</p>
                  <code className="text-xs">{r.cond}</code>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase text-muted-foreground">{t("pol.then").split(" ")[0]}</p>
                  <code className="text-xs text-primary">{r.action}</code>
                </div>
              </div>
              <Switch checked={r.active} onCheckedChange={(v)=>toggle(r.id,v)}/>
              <Badge variant="outline" className="font-mono text-[9px]">{r.active?t("pol.active").toLowerCase():t("pol.paused")}</Badge>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={()=>openEdit(r)}>
                <Pencil className="h-3.5 w-3.5"/>
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={()=>remove(r.id)}>
                <Trash2 className="h-3.5 w-3.5"/>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
