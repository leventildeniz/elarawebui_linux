import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "motion/react";
import { Bug, Copy, FolderOpen, Plus, RotateCcw, Trash2, Wand2, ArrowRight } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const description =
  "Convert external Agent / Tool / Skill definitions from Cursor, CloudCode, Copilot, Claude Code or Continue into local sovereign capabilities.";

export const Route = createFileRoute("/converter")({
  head: () => ({
    meta: [
      { title: "Global Converter — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Global Converter — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConverterPage,
});

const SOURCES = ["cursor", "cloudcode", "copilot", "claude-code", "continue", "generic"] as const;
const TARGETS = ["auto", "skill", "tool", "agent"] as const;

const labelCls =
  "mb-2 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60";
const fieldCls =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-sapphire/50";
const btnCls =
  "flex items-center gap-2 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[7px] font-mono text-[11px] tracking-[0.12em] text-muted-foreground/80 transition-colors hover:border-sapphire/50 hover:text-foreground";

type PathRow = { id: string; name: string; path: string };
type MapRow = { id: string; from: string; to: string };

function ConverterPage() {
  const [source, setSource] = useState<string>("generic");
  const [target, setTarget] = useState<string>("auto");
  const [autoRewrite, setAutoRewrite] = useState(true);
  const [paths, setPaths] = useState<PathRow[]>([
    { id: "p1", name: "Primary", path: "~/Documents/skills" },
  ]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [input, setInput] = useState(
    "# Tool: My External Tool\nPath: /Users/other/Documents/Projects/Skills/foo.md\n…",
  );
  const [output, setOutput] = useState("");
  const [rawOutput, setRawOutput] = useState<any>(null);
  const [log, setLog] = useState<string[]>([]);
  const [debugOpen, setDebugOpen] = useState(true);
  const [saving, setSaving] = useState(false);

  const push = (line: string) =>
    setLog((l) => [`${new Date().toISOString().slice(11, 19)} · ${line}`, ...l].slice(0, 200));

  const convert = () => {
    const base = paths[0]?.path ?? "~/";
    let body = input;
    if (autoRewrite) {
      body = body.replace(/(\/[\w./-]*?)(?=\/[\w-]+\.(?:md|json|py|ts)\b)/g, base);
      maps.forEach((m) => {
        if (m.from.trim()) body = body.split(m.from).join(m.to);
      });
    }
    const kind = target === "auto" ? "tool" : target;
    const name = (input.match(/^#\s*(?:Skill|Tool|Agent):\s*(.+)$/m)?.[1] ?? "untitled").trim();
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
      
    const payload = {
      id: `${kind}_${slug}`,
      name,
      kind,
      category: "converted",
      visibility: "org",
      source_code: body,
      definition: {
        description: `Converted from ${source}`,
        parameters: { type: "object", properties: {} }
      }
    };
    
    setRawOutput(payload);
    setOutput(JSON.stringify(payload, null, 2));
    push(`convert · ${source} → ${kind} · ${slug}`);
  };

  const createCapability = async () => {
    if (!rawOutput) return;
    setSaving(true);
    push(`saving · sending POST /api/forge/actions...`);
    try {
      const res = await fetchApi("/forge/actions", {
        method: "POST",
        body: JSON.stringify(rawOutput)
      });
      if (res.ok) {
        push(`success · ${rawOutput.kind} capability saved to database (${res.id})`);
      } else {
        push(`error · API returned non-ok status`);
      }
    } catch (e: any) {
      push(`error · failed to save capability: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setOutput("");
    setRawOutput(null);
    setInput("");
    push("reset · editor cleared");
  };

  return (
    <Surface
      wide
      crumb="Global Converter"
      title="Global Converter"
      meta="EXTERNAL → LOCAL · AGENT / TOOL / SKILL"
    >
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-6"
      >
        <div className="flex items-center gap-3">
          <Wand2 size={15} className="text-sapphire" strokeWidth={1.6} />
          <h2 className="text-[15px] font-medium text-foreground">Global Converter</h2>
          <span className="rounded-md border border-sapphire/40 px-2 py-[3px] font-mono text-[10.5px] tracking-[0.12em] text-sapphire">
            EXTERNAL → LOCAL
          </span>
        </div>
        <p className="mt-3 max-w-[110ch] font-mono text-[12px] leading-relaxed text-muted-foreground/65">
          {description} Auto-binds external paths to the configured local base, rewrites known
          tool/skill names to <span className="text-sapphire">!slug</span> references, and routes
          the result into the matching subsystem.
        </p>

        <div className="mt-7 grid gap-6 md:grid-cols-2">
          <div>
            <span className={labelCls}>Source format</span>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((s) => (
                <Chip key={s} active={source === s} tone="sapphire" onClick={() => setSource(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <span className={labelCls}>Target ({target} → capability)</span>
            <div className="flex flex-wrap gap-2">
              {TARGETS.map((t) => (
                <Chip key={t} active={target === t} tone="amethyst" onClick={() => setTarget(t)}>
                  {t}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        {/* base paths */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
            Local base paths
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAutoRewrite((v) => !v)}
              className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground/75"
            >
              <span
                className={cn(
                  "relative h-[20px] w-[38px] rounded-full border transition-colors",
                  autoRewrite ? "border-transparent bg-emerald" : "border-white/12 bg-raised/50",
                )}
              >
                <span
                  className={cn(
                    "absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all",
                    autoRewrite ? "left-[21px] bg-canvas" : "left-[3px] bg-muted-foreground/60",
                  )}
                />
              </span>
              Auto rewrite
            </button>
            <button
              className={btnCls}
              onClick={() =>
                setPaths((p) => [...p, { id: `p${p.length + 1}`, name: "Secondary", path: "" }])
              }
            >
              <Plus size={12} /> ADD PATH
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          {paths.map((p, i) => (
            <div key={p.id} className="grid grid-cols-[220px_1fr_auto_auto] items-center gap-2">
              <input
                className={fieldCls}
                value={p.name}
                onChange={(e) =>
                  setPaths((rows) =>
                    rows.map((r) => (r.id === p.id ? { ...r, name: e.target.value } : r)),
                  )
                }
              />
              <input
                className={fieldCls}
                placeholder="~/Documents/skills"
                value={p.path}
                onChange={(e) =>
                  setPaths((rows) =>
                    rows.map((r) => (r.id === p.id ? { ...r, path: e.target.value } : r)),
                  )
                }
              />
              <button className={btnCls} title="Browse">
                <FolderOpen size={12} />
              </button>
              <button
                className={cn(btnCls, "text-ruby/80 hover:border-ruby/50 hover:text-ruby")}
                disabled={i === 0}
                onClick={() => setPaths((rows) => rows.filter((r) => r.id !== p.id))}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 font-mono text-[10.5px] text-muted-foreground/45">
          The first path is the primary rebind target. Additional paths are kept for reference.
        </p>

        {/* mappings */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
            Variable / tool mapping
          </span>
          <button
            className={btnCls}
            onClick={() => setMaps((m) => [...m, { id: `m${m.length + 1}`, from: "", to: "" }])}
          >
            <Plus size={12} /> ADD MAPPING
          </button>
        </div>
        <p className="mt-2 font-mono text-[10.5px] text-muted-foreground/45">
          e.g. cursor-mcp → !local-mcp, ~/dev/scripts → ~/Documents/skills/scripts
        </p>
        {maps.length > 0 && (
          <div className="mt-3 grid gap-2">
            {maps.map((m) => (
              <div key={m.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <input
                  className={fieldCls}
                  placeholder="external token"
                  value={m.from}
                  onChange={(e) =>
                    setMaps((rows) =>
                      rows.map((r) => (r.id === m.id ? { ...r, from: e.target.value } : r)),
                    )
                  }
                />
                <input
                  className={fieldCls}
                  placeholder="local replacement"
                  value={m.to}
                  onChange={(e) =>
                    setMaps((rows) =>
                      rows.map((r) => (r.id === m.id ? { ...r, to: e.target.value } : r)),
                    )
                  }
                />
                <button
                  className={cn(btnCls, "text-ruby/80 hover:border-ruby/50 hover:text-ruby")}
                  onClick={() => setMaps((rows) => rows.filter((r) => r.id !== m.id))}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* editors */}
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <div>
            <span className={labelCls}>External source</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              className={cn(fieldCls, "h-[320px] resize-y leading-relaxed")}
            />
          </div>
          <div>
            <span className={labelCls}>Converted output</span>
            <textarea
              readOnly
              value={output}
              placeholder="Press Convert…"
              spellCheck={false}
              className={cn(fieldCls, "h-[320px] resize-y leading-relaxed text-emerald/90")}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={convert}
              className="flex items-center gap-2 rounded-lg border border-sapphire/45 bg-sapphire/12 px-4 py-[7px] font-mono text-[11px] tracking-[0.12em] text-sapphire transition-colors hover:bg-sapphire/20"
              style={{ boxShadow: "0 0 22px -14px var(--sapphire)" }}
            >
              <Wand2 size={12} /> CONVERT
            </button>
            <button onClick={reset} className={btnCls}>
              <RotateCcw size={12} /> RESET
            </button>
            <button onClick={() => setDebugOpen((v) => !v)} className={btnCls}>
              <Bug size={12} /> DEBUG ({log.length})
            </button>
          </div>
          <button
            disabled={!output || saving}
            className={cn(
              "rounded-lg border px-4 py-[7px] font-mono text-[11px] tracking-[0.12em] transition-colors flex items-center gap-2",
              output && !saving
                ? "border-emerald/45 bg-emerald/12 text-emerald hover:bg-emerald/20"
                : "cursor-not-allowed border-white/[0.07] bg-raised/30 text-muted-foreground/40",
            )}
            onClick={createCapability}
          >
            {saving ? "SAVING..." : "CREATE CAPABILITY"} <ArrowRight size={12} />
          </button>
        </div>

        {debugOpen && (
          <div className="mt-5 rounded-xl border border-white/[0.07] bg-raised/25 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
                Debug log ({log.length}/200)
              </span>
              <div className="flex items-center gap-2">
                <button
                  className={btnCls}
                  onClick={() => navigator.clipboard?.writeText(JSON.stringify(log, null, 2))}
                >
                  <Copy size={12} /> COPY JSON
                </button>
                <button
                  className={cn(btnCls, "text-ruby/80 hover:border-ruby/50 hover:text-ruby")}
                  onClick={() => setLog([])}
                >
                  <Trash2 size={12} /> CLEAR
                </button>
              </div>
            </div>
            <div className="mt-3 max-h-[200px] overflow-y-auto font-mono text-[11.5px] text-muted-foreground/70">
              {log.length === 0 ? (
                <p className="text-muted-foreground/45">
                  No events yet. Convert/save to see traces.
                </p>
              ) : (
                log.map((l, i) => (
                  <div key={i} className="border-t border-white/[0.04] py-1 first:border-t-0">
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </motion.section>
    </Surface>
  );
}

function Chip({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-[6px] font-mono text-[12px] transition-colors",
        active
          ? "text-foreground"
          : "border-white/[0.07] bg-raised/30 text-muted-foreground/70 hover:text-foreground",
      )}
      style={
        active
          ? {
              borderColor: `color-mix(in oklab, var(--${tone}) 48%, transparent)`,
              background: `color-mix(in oklab, var(--${tone}) 14%, transparent)`,
              boxShadow: `0 0 20px -14px var(--${tone})`,
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}
