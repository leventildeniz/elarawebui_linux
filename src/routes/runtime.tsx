import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Check, Cpu, Loader2, Pencil, Play, Plus, Search, Square, Trash2, X } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, Sheen, StatusDot, Tag } from "@/components/sovereign/primitives";
import { useRuntimes, type PythonRuntime, type RuntimeStatus } from "@/lib/runtime-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/runtime")({
  head: () => ({
    meta: [
      { title: "Python Runtime — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Create, edit and remove isolated Python sandboxes for custom scripts, transforms and one-off analysis.",
      },
      { property: "og:title", content: "Python Runtime — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Create, edit and remove isolated Python sandboxes for custom scripts, transforms and one-off analysis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RuntimePage,
});

type Draft = Omit<PythonRuntime, "id" | "createdAt">;

const emptyDraft: Draft = {
  name: "",
  version: "3.12",
  pythonPath: "",
  venvPath: "",
  memory: "auto",
  packages: "",
  egress: false,
  status: "idle",
};

const MEMORY_PRESETS = [256, 512, 1024, 2048, 4096];



const statusTone: Record<RuntimeStatus, "emerald" | "sapphire" | "ruby"> = {
  running: "emerald",
  idle: "sapphire",
  stopped: "ruby",
  error: "ruby",
};

function RuntimePage() {
  const { runtimes, create, update, remove } = useRuntimes();
  const [editing, setEditing] = useState<PythonRuntime | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const running = runtimes.filter((r) => r.status === "running").length;
  const memory = runtimes.reduce((s, r) => s + (typeof r.memory === "number" ? r.memory : 0), 0);
  const autoCount = runtimes.filter((r) => r.memory === "auto").length;

  return (
    <Surface
      title="Python Runtime"
      meta={`${runtimes.length} sandbox · ${running} running · ${memory} MB allocated${autoCount ? ` · ${autoCount} auto` : ""}`}
      wide
      action={
        <JewelButton onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          New runtime
        </JewelButton>
      }
    >
      <p className="max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
        Isolated Python workspaces for custom scripts, transforms and one-off analysis. Create as
        many sandboxes as you need — each one is editable and removable at any time.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <AnimatePresence initial={false}>
          {runtimes.map((r, i) => (
            <motion.article
              key={r.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.24, delay: i * 0.018, ease: [0.22, 1, 0.36, 1] }}
              className="glass group relative overflow-hidden rounded-xl p-5 transition-shadow duration-300 hover:shadow-[0_0_38px_-24px_var(--sapphire)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 rounded-lg border border-sapphire/30 bg-sapphire/10 p-2 text-sapphire">
                    <Cpu className="h-4 w-4" strokeWidth={1.6} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-[15.5px] font-medium tracking-tight text-foreground">
                      {r.name}
                    </h2>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/60">
                      {r.id}
                    </div>
                  </div>
                </div>
                <span className="flex items-center gap-2">
                  <StatusDot tone={statusTone[r.status]} pulse={r.status === "running"} />
                  <Tag tone={statusTone[r.status]}>{r.status}</Tag>
                </span>
              </div>

              <Sheen className="my-4" />

              <dl className="grid grid-cols-2 gap-y-2 font-mono text-[11.5px]">
                <dt className="text-muted-foreground/55">python</dt>
                <dd className="text-right text-foreground/85">{r.version}</dd>
                <dt className="text-muted-foreground/55">memory</dt>
                <dd
                  className={cn(
                    "text-right",
                    r.memory === "auto" ? "text-amethyst" : "text-foreground/85",
                  )}
                >
                  {r.memory === "auto" ? "auto" : `${r.memory} MB`}
                </dd>
                {r.pythonPath && (
                  <>
                    <dt className="text-muted-foreground/55">path</dt>
                    <dd className="truncate text-right text-foreground/70" title={r.pythonPath}>
                      {r.pythonPath}
                    </dd>
                  </>
                )}
                {r.venvPath && (
                  <>
                    <dt className="text-muted-foreground/55">venv</dt>
                    <dd className="truncate text-right text-foreground/70" title={r.venvPath}>
                      {r.venvPath}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground/55">egress</dt>
                <dd className={cn("text-right", r.egress ? "text-topaz" : "text-emerald")}>
                  {r.egress ? "granted" : "denied"}
                </dd>
              </dl>

              {r.packages && (
                <p className="mt-3 line-clamp-2 font-mono text-[11px] leading-relaxed text-muted-foreground/60">
                  {r.packages}
                </p>
              )}

              <div className="mt-5 flex items-center gap-2">
                <JewelButton
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() =>
                    update(r.id, { status: r.status === "running" ? "idle" : "running" })
                  }
                >
                  {r.status === "running" ? (
                    <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  {r.status === "running" ? "Stop" : "Start"}
                </JewelButton>
                <JewelButton
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => setEditing(r)}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Edit
                </JewelButton>
                <JewelButton
                  size="sm"
                  variant="ghost"
                  className="ml-auto gap-1.5 text-ruby hover:text-ruby"
                  onClick={() => setConfirm(r.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Delete
                </JewelButton>
              </div>

              <AnimatePresence>
                {confirm === r.id && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-canvas/80 backdrop-blur-[3px]"
                  >
                    <p className="px-6 text-center text-[13.5px] text-foreground/85">
                      Delete <span className="font-mono text-ruby">{r.name}</span>?
                    </p>
                    <div className="flex gap-2">
                      <JewelButton
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          remove(r.id);
                          setConfirm(null);
                        }}
                      >
                        Delete
                      </JewelButton>
                      <JewelButton size="sm" variant="outline" onClick={() => setConfirm(null)}>
                        Cancel
                      </JewelButton>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.article>
          ))}
        </AnimatePresence>

        <motion.button
          layout
          onClick={() => setCreating(true)}
          className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-muted-foreground/70 transition-colors hover:border-sapphire/40 hover:bg-raised/20 hover:text-sapphire"
        >
          <Plus className="h-5 w-5" strokeWidth={1.5} />
          <span className="font-mono text-[11px] uppercase tracking-[0.2em]">new runtime</span>
        </motion.button>
      </div>

      <RuntimeDialog
        open={creating || editing !== null}
        initial={editing ?? undefined}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={(draft) => {
          if (editing) update(editing.id, draft);
          else create(draft);
          setCreating(false);
          setEditing(null);
        }}
      />
    </Surface>
  );
}

function RuntimeDialog({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: PythonRuntime | undefined;
  onClose: () => void;
  onSubmit: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [key, setKey] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<string | null>(null);

  const detect = async () => {
    setDetecting(true);
    setDetected(null);
    
    // Doğru Mantık:
    // Eğer input kutusu (pythonPath) tamamen BOŞ ise -> "Gerçek Auto-Detect"
    // Gider makinedeki standart 'python3' komutunu bulur, path'i doldurur ve dropdown'u ona göre (örn. 3.14) günceller.
    // Eğer kullanıcı input kutusuna kendisi bir yol (örn. 'python3.12' veya '/usr/bin/python3.12') GİRDİYSE -> "Manual Verify"
    // Sadece kullanıcının girdiği o path'i sunucuya sorar. Doğruysa onu verified eder. Dropdown'ı değiştirmesine gerek yok.
    
    let targetPath = draft.pythonPath?.trim();
    const isAutoDetect = !targetPath; // Kullanıcı path girmeden bastıysa auto-detect'tir.
    
    if (isAutoDetect) {
      targetPath = "python3";
    }
    
    try {
      const res = await fetch("/api/python/detect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": "demo", 
        },
        body: JSON.stringify({ path: targetPath }),
      });
      
      const data = await res.json();
      
      if (res.ok && data.ok) {
        // BAŞARILI: Path bulundu ve versiyon tespit edildi.
        const detectedVersion = data.version.replace('Python ', '');
        const majorMinor = detectedVersion.split('.').slice(0, 2).join('.'); // 3.14.4 -> 3.14
        
        setDraft((d) => {
          const next = { ...d };
          if (isAutoDetect) {
            next.pythonPath = "python3"; // Keep agnostic instead of data.path
            next.version = majorMinor;
          }
          next.venvPath = d.venvPath || "/opt/elara/venvs/sandbox";
          return next;
        });
        
        setDetected(detectedVersion);
      } else {
        // İlk deneme başarısız oldu.
        if (isAutoDetect) {
          // Auto-detect modundaysak ve "python3" patladıysa, bir de "python" ı deneyelim (Windows için)
          const fallbackRes = await fetch("/api/python/detect", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-session-id": "demo" },
            body: JSON.stringify({ path: "python" }),
          });
          const fbData = await fallbackRes.json();
  
          if (fallbackRes.ok && fbData.ok) {
            const detectedVersion = fbData.version.replace('Python ', '');
            const majorMinor = detectedVersion.split('.').slice(0, 2).join('.');
            
            setDraft((d) => ({
              ...d,
              pythonPath: "python", // Keep agnostic for Windows
              version: majorMinor,
              venvPath: d.venvPath || "/opt/elara/venvs/sandbox",
            }));
            setDetected(detectedVersion);
          } else {
             // İkisi de yok
             setDetected("not verified");
          }
        } else {
          // Manuel olarak bir path girildi ve o path yanlış çıktı.
          setDetected("not found");
        }
      }
    } catch (err) {
      setDetected("network error");
    } finally {
      setDetecting(false);
    }
  };

  const signature = `${open}:${initial?.id ?? "new"}`;
  if (open && key !== signature) {
    setKey(signature);
    setDetected(null);
    setDetecting(false);
    setDraft(
      initial
        ? {
            name: initial.name,
            version: initial.version,
            pythonPath: initial.pythonPath ?? "",
            venvPath: initial.venvPath ?? "",
            memory: initial.memory,
            packages: initial.packages,
            egress: initial.egress,
            status: initial.status,
          }
        : emptyDraft,
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-[2px]"
          />
          <motion.div
            role="dialog"
            aria-label={initial ? "Edit runtime" : "New runtime"}
            initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="obsidian-slab fixed left-1/2 top-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-[16px] p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-medium tracking-tight">
                {initial ? "Edit runtime" : "New runtime"}
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-muted-foreground/60 transition-colors hover:text-foreground"
                title="Close"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.name.trim()) return;
                onSubmit({ ...draft, name: draft.name.trim() });
              }}
            >
              <Field label="name">
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Analysis sandbox"
                  className="w-full rounded-lg border border-input bg-raised/50 px-3 py-2 text-[14px] outline-none transition-colors focus:border-sapphire/50"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="python">
                  <select
                    value={draft.version}
                    onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))}
                    className="w-full rounded-lg border border-input bg-raised/50 px-3 py-2 font-mono text-[13px] outline-none focus:border-sapphire/50"
                  >
                    {Array.from(new Set(["3.9", "3.10", "3.11", "3.12", "3.13", "3.14", draft.version])).sort().map((v) => (
                      <option key={v} value={v} className="bg-panel">
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="python detected">
                  <div className="flex h-[38px] items-center rounded-lg border border-border/70 bg-raised/30 px-3 font-mono text-[12px] text-muted-foreground/70">
                    {detected ? (
                      <span className="flex items-center gap-1.5 text-emerald">
                        <Check className="h-3.5 w-3.5" strokeWidth={2} />
                        Python {detected}
                      </span>
                    ) : (
                      "not verified"
                    )}
                  </div>
                </Field>
              </div>

              <Field label="python executable path">
                <div className="flex gap-2">
                  <input
                    value={draft.pythonPath ?? ""}
                    onChange={(e) => {
                      setDetected(null);
                      setDraft((d) => ({ ...d, pythonPath: e.target.value }));
                    }}
                    placeholder="python3"
                    className="min-w-0 flex-1 rounded-lg border border-input bg-raised/50 px-3 py-2 font-mono text-[12.5px] outline-none transition-colors focus:border-sapphire/50"
                  />
                  <JewelButton
                    type="button"
                    variant="outline"
                    className="gap-1.5 shrink-0"
                    onClick={detect}
                  >
                    {detecting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    Detect
                  </JewelButton>
                </div>
              </Field>

              <Field label="venv path">
                <input
                  value={draft.venvPath ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, venvPath: e.target.value }))}
                  placeholder="/opt/elara/venvs/sandbox"
                  className="w-full rounded-lg border border-input bg-raised/50 px-3 py-2 font-mono text-[12.5px] outline-none transition-colors focus:border-sapphire/50"
                />
              </Field>

              <Field label="memory (MB)">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, memory: "auto" }))}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 font-mono text-[11.5px] transition-colors duration-200",
                      draft.memory === "auto"
                        ? "border-amethyst/50 bg-amethyst/10 text-amethyst"
                        : "border-border/70 text-muted-foreground/70 hover:border-amethyst/35 hover:text-amethyst",
                    )}
                  >
                    auto
                  </button>
                  {MEMORY_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, memory: m }))}
                      className={cn(
                        "rounded-md border px-2.5 py-1.5 font-mono text-[11.5px] transition-colors duration-200",
                        draft.memory === m
                          ? "border-sapphire/50 bg-sapphire/10 text-sapphire"
                          : "border-border/70 text-muted-foreground/70 hover:border-sapphire/35 hover:text-foreground",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={128}
                    step={128}
                    value={draft.memory === "auto" ? "" : draft.memory}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        memory: e.target.value === "" ? "auto" : Number(e.target.value),
                      }))
                    }
                    placeholder="custom"
                    className="w-[92px] rounded-md border border-input bg-raised/50 px-2.5 py-1.5 font-mono text-[11.5px] outline-none transition-colors focus:border-sapphire/50"
                  />
                </div>
                <p className="mt-2 font-mono text-[10.5px] text-muted-foreground/50">
                  auto — sandbox scales to whatever the process actually consumes
                </p>
              </Field>

              <Field label="pinned packages">
                <input
                  value={draft.packages}
                  onChange={(e) => setDraft((d) => ({ ...d, packages: e.target.value }))}
                  placeholder="pandas, numpy, httpx"
                  className="w-full rounded-lg border border-input bg-raised/50 px-3 py-2 font-mono text-[12.5px] outline-none transition-colors focus:border-sapphire/50"
                />
              </Field>

              <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2.5">
                <span className="text-[13.5px] text-foreground/85">Outbound network</span>
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, egress: !d.egress }))}
                  className={cn(
                    "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                    draft.egress
                      ? "border-topaz/40 bg-topaz/10 text-topaz"
                      : "border-emerald/35 bg-emerald/10 text-emerald",
                  )}
                >
                  {draft.egress ? "granted" : "denied"}
                </button>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <JewelButton type="button" variant="outline" onClick={onClose}>
                  Cancel
                </JewelButton>
                <JewelButton type="submit">
                  {initial ? "Save changes" : "Create runtime"}
                </JewelButton>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono-label mb-2 block">{label}</span>
      {children}
    </label>
  );
}
