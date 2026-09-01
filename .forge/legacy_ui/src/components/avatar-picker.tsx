// Reusable avatar gallery dialog — themed (cyber/woman/man) + uploads + defaults.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload } from "lucide-react";
import { AVATAR_PRESETS, type AvatarCategory } from "@/lib/avatars";

interface Props {
  value?: string | null;
  onChange: (url: string) => void;
  trigger?: React.ReactNode;
  size?: number;
  title?: string;
}

const CATS: { key: AvatarCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "default", label: "Default" },
  { key: "cyber", label: "Cyber" },
  { key: "woman", label: "Woman" },
  { key: "man", label: "Man" },
];

export function AvatarPicker({ value, onChange, trigger, size = 40, title = "Pick an avatar" }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AvatarCategory | "all">("all");

  const filtered = tab === "all" ? AVATAR_PRESETS : AVATAR_PRESETS.filter(p => p.category === tab);
  const choose = (url: string) => { onChange(url); setOpen(false); };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="rounded border border-border hover:border-primary transition-colors overflow-hidden"
            style={{ width: size, height: size }}
            title="Change avatar">
            <img src={value ?? AVATAR_PRESETS[0].url} alt="" className="w-full h-full object-cover" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="glass">
            {CATS.map(c => <TabsTrigger key={c.key} value={c.key}>{c.label}</TabsTrigger>)}
          </TabsList>
          {CATS.map(c => (
            <TabsContent key={c.key} value={c.key}>
              <div className="grid grid-cols-8 gap-2 max-h-[420px] overflow-y-auto pt-3">
                {filtered.map(p => (
                  <button key={p.id} type="button" onClick={() => choose(p.url)}
                    title={p.label}
                    className={`h-12 w-12 rounded border ${value === p.url ? "border-primary ring-2 ring-primary/40" : "border-border"} overflow-hidden hover:border-primary`}>
                    <img src={p.url} alt={p.label} className="h-full w-full" />
                  </button>
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
        <div className="border-t border-border pt-3 flex items-center gap-2">
          <label className="text-[11px] font-mono cursor-pointer flex items-center gap-1 px-3 py-2 rounded border border-dashed border-border">
            <Upload className="h-3.5 w-3.5"/> Upload custom
            <input type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const r = new FileReader();
              r.onload = () => choose(String(r.result));
              r.readAsDataURL(f);
            }}/>
          </label>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
