// Vision Profiles list — Models → Vision sekmesinde sol kolon. Mimar yeni profil
// ekler, aralarında geçiş yapar, varsayılan belirler ve siler. Sağ kolondaki
// VisionConsole aktif profili düzenler.
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Star, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import { useVisionConfig } from "@/lib/vision-config-store";
import { useI18n } from "@/lib/i18n";

export function VisionProfilesList() {
  const { profiles, activeId, selectProfile, createProfile, deleteProfile, setDefaultProfile } = useVisionConfig();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftId, setDraftId] = useState("");

  const submit = () => {
    const name = draftName.trim();
    if (!name) { toast.error(t("vision.profile.name")); return; }
    const id = (draftId.trim() || `vp-${Math.random().toString(36).slice(2, 8)}`)
      .toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    if (profiles.some((p) => p.id === id)) { toast.error("ID already in use"); return; }
    createProfile({ id, name });
    toast.success(t("vision.console.applied_ok"));
    setOpen(false); setDraftName(""); setDraftId("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          {t("vision.profile.title")}
        </h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-gradient-primary text-primary-foreground">
              <Plus className="h-3.5 w-3.5 mr-1" />{t("vision.profile.new")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("vision.profile.new")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("vision.profile.name")}</Label>
                <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} className="font-mono mt-2" placeholder="Senior Architect Sentinel" />
              </div>
              <div>
                <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("vision.profile.id")}</Label>
                <Input value={draftId} onChange={(e) => setDraftId(e.target.value)} className="font-mono mt-2" placeholder="auto-generate" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={submit} className="bg-gradient-primary text-primary-foreground">{t("vision.console.apply")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {profiles.length === 0 && (
        <p className="text-xs font-mono text-muted-foreground">{t("vision.profile.empty")}</p>
      )}

      <div className="space-y-2">
        {profiles.map((p) => {
          const sel = p.id === activeId;
          return (
            <Card key={p.id} className={`glass cursor-pointer ${sel ? "ring-1 ring-primary" : ""}`} onClick={() => selectProfile(p.id)}>
              <CardContent className="p-3 flex items-center gap-3">
                <Eye className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium font-mono flex items-center gap-1 truncate">
                    {p.name}
                    {p.isDefault && <Star className="h-3 w-3 text-primary fill-primary" />}
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground truncate">
                    {p.id} · {p.voiceMode} · {p.voiceLang}
                  </p>
                </div>
                <Badge variant="outline" className="text-[9px] font-mono shrink-0">{p.model.split("/").pop()?.slice(0, 18)}</Badge>
                {!p.isDefault && (
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7"
                    title={t("vision.profile.make_default")}
                    onClick={(e) => { e.stopPropagation(); setDefaultProfile(p.id); toast.success(t("vision.profile.is_default")); }}
                  >
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                  title={p.isDefault ? t("vision.profile.cannot_delete_default") : "Delete"}
                  disabled={p.isDefault || profiles.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!confirm(t("vision.profile.delete_confirm"))) return;
                    deleteProfile(p.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
