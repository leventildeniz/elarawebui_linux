import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AgentsAPI,
  ForgeAPI,
  SkillsAPI,
  type SkillDef,
  type ActionDef,
  type AgentRow,
  type InterpreterInfo,
} from "@/lib/api-client";
import {
  Wand2,
  FileCode2,
  Save,
  RotateCcw,
  FolderTree,
  Plus,
  Trash2,
  ArrowRightLeft,
  Folder,
  ChevronUp,
  ChevronDown,
  Bot,
  Wrench,
  Sparkles,
  Bug,
  Copy as CopyIcon,
} from "lucide-react";
import { toast } from "sonner";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

type SourceKind = "cursor" | "cloudcode" | "copilot" | "claude-code" | "continue" | "generic";
type TargetKind = "auto" | "skill" | "tool" | "agent";

type PathEntry = { id: string; label: string; path: string };
type VarMap = { from: string; to: string; regex?: boolean };

type SkillDraft = {
  kind: "skill";
  slug: string;
  name: string;
  description: string;
  instructions: string;
};
type ToolDraft = {
  kind: "tool";
  id: string;
  name: string;
  category: string;
  description: string;
  params: { key: string; type: string; label?: string }[];
};
type AgentDraft = {
  kind: "agent";
  id: string;
  name: string;
  agent_path: string;
  interpreter_path: string;
  description: string;
};
type AnyDraft = SkillDraft | ToolDraft | AgentDraft;

type DebugEntry = { ts: number; level: "info" | "warn" | "error"; msg: string; data?: unknown };

// ────────────────────────────────────────────────────────────────────────────
// Storage
// ────────────────────────────────────────────────────────────────────────────

const LS_PATHS = "elara.converter.paths";
const LS_SOURCE = "elara.converter.source_kind";
const LS_TARGET = "elara.converter.target_kind";
const LS_BASE_LEGACY = "elara.skill_converter.base_path";
const LS_MAP = "elara.skill_converter.var_map";
const DEFAULT_BASE = "~/Documents/skills";

function loadPaths(): PathEntry[] {
  try {
    const raw = localStorage.getItem(LS_PATHS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch {
    /* ignore */
  }
  const legacy = localStorage.getItem(LS_BASE_LEGACY) || DEFAULT_BASE;
  return [{ id: "p1", label: "Primary", path: legacy }];
}
function loadMap(): VarMap[] {
  try {
    return JSON.parse(localStorage.getItem(LS_MAP) || "[]");
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "imported-skill"
  );
}
function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sniffTarget(md: string): Exclude<TargetKind, "auto"> {
  const hasToolSchema =
    /```(?:json|yaml)[\s\S]*?(?:"inputSchema"|"parameters"|"params"|parameters\s*:)/i.test(md) ||
    /^#{1,3}\s+Tool[:\s]/im.test(md);
  const hasAgentSignal =
    /(?:agent\.(?:py|js|ts|mjs)|persona\s*:|system_prompt\s*:|interpreter\s*:)/i.test(md);
  if (hasAgentSignal) return "agent";
  if (hasToolSchema) return "tool";
  return "skill";
}

function preParseBySource(md: string, src: SourceKind): string {
  let out = md;
  if (src === "cursor") {
    // .mdc frontmatter → keep, but normalize "rules:" markers
    out = out.replace(/^description:\s*(.+)$/im, "# $1");
  } else if (src === "copilot") {
    out = out.replace(/^#\s*instructions:\s*$/im, "# Instructions");
  } else if (src === "claude-code") {
    out = out.replace(/^---\s*name:\s*(.+?)\s*$/im, "# $1");
  }
  return out;
}

function deriveSkill(md: string): SkillDraft {
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Imported Skill";
  const firstPara =
    md.split(/\n\s*\n/).find((p) => !p.startsWith("#") && p.trim().length > 0) || "";
  const description = firstPara.replace(/[`*_>#-]/g, "").trim().slice(0, 160);
  return { kind: "skill", slug: slugify(title), name: title, description, instructions: md.trim() };
}

function deriveTool(md: string): ToolDraft {
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Imported Tool";
  const desc =
    md.split(/\n\s*\n/).find((p) => !p.startsWith("#") && p.trim().length > 0)?.slice(0, 160) || "";
  const params: { key: string; type: string }[] = [];
  // Try to grab a JSON code block with parameters/inputSchema
  const jsonBlock = md.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (jsonBlock) {
    try {
      const obj = JSON.parse(jsonBlock);
      const props =
        obj?.parameters?.properties ?? obj?.inputSchema?.properties ?? obj?.properties ?? {};
      for (const [k, v] of Object.entries(props as Record<string, { type?: string }>)) {
        params.push({ key: k, type: String(v?.type || "text") });
      }
    } catch {
      /* ignore */
    }
  }
  return {
    kind: "tool",
    id: uid("tool"),
    name: title,
    category: "imported",
    description: desc.replace(/[`*_>#-]/g, "").trim(),
    params,
  };
}

function deriveAgent(md: string, paths: PathEntry[], interp: string): AgentDraft {


  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Imported Agent";
  const desc =
    md.split(/\n\s*\n/).find((p) => !p.startsWith("#") && p.trim().length > 0)?.slice(0, 160) || "";
  const pathHit = md.match(/(?:agent_path|path)\s*:\s*([^\s`"']+)/i)?.[1] || "";
  const basePath = paths[0]?.path || DEFAULT_BASE;
  const agent_path = pathHit || `${basePath}/${slugify(title)}/agent.py`;
  return {
    kind: "agent",
    id: uid("ag"),
    name: title,
    agent_path,
    interpreter_path: interp,
    description: desc.replace(/[`*_>#-]/g, "").trim(),
  };
}

function summarizeDraft(d: AnyDraft): Record<string, unknown> {
  if (d.kind === "skill") return { slug: d.slug, name: d.name, desc: d.description.slice(0, 80) };
  if (d.kind === "tool") return { id: d.id, name: d.name, params: d.params.length };
  return { id: d.id, name: d.name, path: d.agent_path };
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function SkillConverter() {
  const [paths, setPaths] = useState<PathEntry[]>(() => loadPaths());
  const [sourceKind, setSourceKind] = useState<SourceKind>(
    () => (localStorage.getItem(LS_SOURCE) as SourceKind) || "generic",
  );
  const [targetKind, setTargetKind] = useState<TargetKind>(
    () => (localStorage.getItem(LS_TARGET) as TargetKind) || "auto",
  );
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [autoBase, setAutoBase] = useState(true);
  const [mappings, setMappings] = useState<VarMap[]>(() => loadMap());
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [draft, setDraft] = useState<AnyDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [browseOpenFor, setBrowseOpenFor] = useState<string | null>(null);
  const [interpreters, setInterpreters] = useState<InterpreterInfo[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([]);
  const dbg = (level: DebugEntry["level"], msg: string, data?: unknown) => {
    setDebugLog((prev) => {
      const next = [...prev, { ts: Date.now(), level, msg, data }];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
    if (level === "error") console.error("[converter]", msg, data);
  };

  useEffect(() => {
    SkillsAPI.list().then(setSkills).catch(() => {});
    AgentsAPI.interpreters()
      .then((r) => setInterpreters(r.interpreters || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    localStorage.setItem(LS_PATHS, JSON.stringify(paths));
  }, [paths]);
  useEffect(() => {
    localStorage.setItem(LS_SOURCE, sourceKind);
  }, [sourceKind]);
  useEffect(() => {
    localStorage.setItem(LS_TARGET, targetKind);
  }, [targetKind]);
  useEffect(() => {
    localStorage.setItem(LS_MAP, JSON.stringify(mappings));
  }, [mappings]);

  const defaultInterpreter = interpreters[0]?.path || "/usr/bin/python3";

  const skillNameMap = useMemo(() => {
    const m: { from: RegExp; to: string }[] = [];
    for (const sk of skills) {
      if (!sk.name) continue;
      const safe = sk.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      m.push({ from: new RegExp(`\\b${safe}\\b`, "gi"), to: `!${sk.slug}` });
    }
    return m;
  }, [skills]);

  const sniffed = useMemo<Exclude<TargetKind, "auto">>(() => sniffTarget(input || ""), [input]);
  const effectiveTarget: Exclude<TargetKind, "auto"> =
    targetKind === "auto" ? sniffed : (targetKind as Exclude<TargetKind, "auto">);

  const convert = () => {
    if (!input.trim()) {
      toast.error("Paste markdown content first.");
      dbg("warn", "convert aborted: empty input");
      return;
    }
    dbg("info", "pre-parse", { source: sourceKind, length: input.length });
    let out = preParseBySource(input, sourceKind);
    const base = paths[0]?.path || DEFAULT_BASE;

    if (autoBase) {
      const extRoots: { name: string; re: RegExp }[] = [
        { name: "users-skills", re: /\/Users\/[^\/\s`"']+\/(?:Documents|Desktop|Projects|Workspace|Repos)\/[^\s`"']*?\/Skills/gi },
        { name: "home-skills", re: /~\/(?:Documents|Desktop|Projects|Workspace|Repos)\/[^\s`"']*?\/Skills/gi },
        { name: "win-skills", re: /(?:C:\\|D:\\)[^\s`"']*?\\Skills/gi },
        { name: "rel-skills", re: /\.\/skills/gi },
        { name: "abs-skills", re: /\/skills(?=[\/\s`"'])/gi },
      ];
      for (const { name, re } of extRoots) {
        const hits = (out.match(re) || []).length;
        if (hits > 0) dbg("info", `rewrite:${name}`, { hits, replace: base });
        out = out.replace(re, base);
      }
      out = out.replace(/\b(?:cursor|cloudcode|claude|copilot)\s*:\s*\/\//gi, "skill://");
      out = out.replace(/\b(?:CloudCode|Cursor|Copilot)\s+Tool\b/g, "Local Skill");
    }

    for (const m of mappings) {
      if (!m.from) continue;
      try {
        const re = m.regex
          ? new RegExp(m.from, "g")
          : new RegExp(m.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        const hits = (out.match(re) || []).length;
        out = out.replace(re, m.to);
        dbg("info", "mapping", { from: m.from, to: m.to, regex: !!m.regex, hits });
      } catch (e) {
        dbg("error", "mapping:regex-failed", { from: m.from, error: (e as Error).message });
      }
    }
    for (const m of skillNameMap) out = out.replace(m.from, m.to);
    dbg("info", "slug-map", { knownSkills: skillNameMap.length });

    setOutput(out);
    if (targetKind === "auto") dbg("info", "sniff", { detected: sniffed });
    let nextDraft: AnyDraft;
    if (effectiveTarget === "tool") nextDraft = deriveTool(out);
    else if (effectiveTarget === "agent") nextDraft = deriveAgent(out, paths, defaultInterpreter);
    else nextDraft = deriveSkill(out);
    setDraft(nextDraft);
    dbg("info", "draft", { kind: nextDraft.kind, summary: summarizeDraft(nextDraft) });
    toast.success(`Conversion complete → ${effectiveTarget.toUpperCase()}`);
  };

  const reset = () => {
    setInput("");
    setOutput("");
    setDraft(null);
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    dbg("info", "save:request", { kind: draft.kind, id: "id" in draft ? draft.id : draft.slug });
    try {
      if (draft.kind === "skill") {
        const r = await SkillsAPI.save({
          slug: draft.slug,
          name: draft.name,
          description: draft.description,
          instructions: draft.instructions,
          risk_level: "read",
          requires_approval: false,
          script_kind: "js",
          script_body: `// Imported via Global Converter\nstep("Imported skill ready", 1, 1);\nreturn { ok: true };`,
          param_schema: { type: "object", properties: {} },
          color: "#22c55e",
        } as Partial<SkillDef> & { slug: string; name: string });
        dbg("info", "save:response", { kind: "skill", response: r });
        toast.success(`Skill sealed: !${draft.slug}`);
        SkillsAPI.list().then(setSkills).catch(() => {});
      } else if (draft.kind === "tool") {
        const payload: Omit<ActionDef, "is_system" | "updated_at"> = {
          id: draft.id,
          kind: "action",
          name: draft.name,
          category: draft.category || "imported",
          provider: "import",
          icon: "Wrench",
          color: "#06b6d4",
          description: draft.description,
          params: draft.params.map((p) => ({
            key: p.key,
            label: p.label || p.key,
            type: (p.type === "number"
              ? "number"
              : p.type === "boolean"
                ? "boolean"
                : p.type === "object" || p.type === "array"
                  ? "json"
                  : "text") as "text" | "number" | "boolean" | "json",
          })),
          outputs: [{ key: "result", label: "Result" }],
          runtime: { handler: "noop" },
        };
        const r = await ForgeAPI.save(payload);
        dbg("info", "save:response", { kind: "tool", response: r });
        toast.success(`Tool sealed: ${draft.id}`);
      } else {
        const agent: Partial<AgentRow> & { name: string } = {
          id: draft.id,
          name: draft.name,
          agent_path: draft.agent_path,
          interpreter_path: draft.interpreter_path,
          status: "idle",
          meta: { description: draft.description, importedBy: "global-converter" },
        };
        const r = await AgentsAPI.create(agent);
        dbg("info", "save:response", { kind: "agent", response: r });
        toast.success(`Agent sealed: ${draft.id}`);
      }
    } catch (e) {
      dbg("error", "save:error", { message: (e as Error).message });
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // Path helpers
  const updatePath = (id: string, patch: Partial<PathEntry>) =>
    setPaths((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removePath = (id: string) => setPaths((p) => p.filter((x) => x.id !== id));
  const addPath = () =>
    setPaths((p) => [...p, { id: uid("p"), label: `Path ${p.length + 1}`, path: "" }]);

  return (
    <div className="space-y-4">
      <Card className="glass">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Wand2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold tracking-wide">Global Converter</h3>
            <Badge variant="outline" className="text-[9px] ml-1">
              External → Local (Agent / Tool / Skill)
            </Badge>
            {debugLog.some((e) => e.level === "error") && (
              <span className="ml-1 inline-block h-2 w-2 rounded-full bg-destructive animate-pulse" title="Errors logged" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            Convert external Agent / Tool / Skill definitions (CloudCode, Cursor, Copilot, Claude
            Code, Continue…) into local Elara capabilities. Auto-binds external paths to the
            configured local base, rewrites known tool/skill names to <code>!slug</code> references,
            and routes the result into the matching subsystem.
          </p>

          {/* Source & Target selectors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Source format
              </Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {(["cursor", "cloudcode", "copilot", "claude-code", "continue", "generic"] as SourceKind[]).map(
                  (k) => (
                    <Button
                      key={k}
                      size="sm"
                      variant={sourceKind === k ? "default" : "outline"}
                      className="h-7 text-[10px]"
                      onClick={() => setSourceKind(k)}
                    >
                      {k}
                    </Button>
                  ),
                )}
              </div>
            </div>
            <div>
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Target ({targetKind === "auto" ? `auto → ${sniffed}` : targetKind})
              </Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {(["auto", "skill", "tool", "agent"] as TargetKind[]).map((k) => (
                  <Button
                    key={k}
                    size="sm"
                    variant={targetKind === k ? "default" : "outline"}
                    className="h-7 text-[10px]"
                    onClick={() => setTargetKind(k)}
                  >
                    {k === "skill" && <Sparkles className="h-3 w-3 mr-1" />}
                    {k === "tool" && <Wrench className="h-3 w-3 mr-1" />}
                    {k === "agent" && <Bot className="h-3 w-3 mr-1" />}
                    {k}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Path list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <FolderTree className="h-3 w-3" /> Local base paths
              </Label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 border border-border rounded h-7 px-2">
                  <Switch checked={autoBase} onCheckedChange={setAutoBase} />
                  <span className="text-[10px]">Auto rewrite</span>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={addPath}>
                  <Plus className="h-3 w-3 mr-1" /> Add path
                </Button>
              </div>
            </div>
            {paths.map((p, i) => (
              <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-3 h-8 font-mono text-xs"
                  placeholder="label"
                  value={p.label}
                  onChange={(e) => updatePath(p.id, { label: e.target.value })}
                />
                <Input
                  className="col-span-7 h-8 font-mono text-xs"
                  placeholder={DEFAULT_BASE}
                  value={p.path}
                  onChange={(e) => updatePath(p.id, { path: e.target.value })}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="col-span-1 h-8 text-[10px]"
                  onClick={() => setBrowseOpenFor(p.id)}
                >
                  <Folder className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="col-span-1 h-8 text-destructive"
                  onClick={() => removePath(p.id)}
                  disabled={paths.length === 1 && i === 0}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground font-mono">
              The first path is the primary rebind target. Additional paths are kept for reference.
            </p>
          </div>

          {/* Variable mappings */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <ArrowRightLeft className="h-3 w-3" /> Variable / tool mapping
              </Label>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => setMappings([...mappings, { from: "", to: "", regex: false }])}
              >
                <Plus className="h-3 w-3 mr-1" /> Add mapping
              </Button>
            </div>
            {mappings.length === 0 && (
              <p className="text-[10px] text-muted-foreground font-mono">
                e.g. <code>cursor-mcp</code> → <code>!local-mcp</code>,{" "}
                <code>~/dev/scripts</code> → <code>{paths[0]?.path}/scripts</code>
              </p>
            )}
            {mappings.map((m, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-5 h-8 font-mono text-xs"
                  placeholder="from (string or regex)"
                  value={m.from}
                  onChange={(e) =>
                    setMappings(mappings.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))
                  }
                />
                <Input
                  className="col-span-5 h-8 font-mono text-xs"
                  placeholder="to"
                  value={m.to}
                  onChange={(e) =>
                    setMappings(mappings.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))
                  }
                />
                <div className="col-span-1 flex items-center gap-1 text-[10px]">
                  <Switch
                    checked={!!m.regex}
                    onCheckedChange={(v) =>
                      setMappings(mappings.map((x, j) => (j === i ? { ...x, regex: v } : x)))
                    }
                  />
                  <span>re</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="col-span-1 h-8 text-destructive"
                  onClick={() => setMappings(mappings.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                External source
              </Label>
              <Textarea
                rows={14}
                className="font-mono text-xs mt-1"
                placeholder="# Skill: My External Tool&#10;Path: /Users/other/Documents/Projects/Skills/foo.md&#10;..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <FileCode2 className="h-3 w-3" /> Converted output
              </Label>
              <Textarea
                rows={14}
                className="font-mono text-xs mt-1"
                placeholder="Press Convert…"
                value={output}
                onChange={(e) => {
                  setOutput(e.target.value);
                  if (effectiveTarget === "tool") setDraft(deriveTool(e.target.value));
                  else if (effectiveTarget === "agent")
                    setDraft(deriveAgent(e.target.value, paths, defaultInterpreter));
                  else setDraft(deriveSkill(e.target.value));
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={convert} className="bg-gradient-primary text-primary-foreground">
              <Wand2 className="h-3 w-3 mr-1" /> Convert
            </Button>
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="h-3 w-3 mr-1" /> Reset
            </Button>
            <Button
              variant="outline"
              onClick={() => setDebugOpen((v) => !v)}
              className={debugLog.some((e) => e.level === "error") ? "border-destructive/60" : ""}
            >
              <Bug className="h-3 w-3 mr-1" /> Debug ({debugLog.length})
              {debugOpen ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
            </Button>
            <div className="flex-1" />
            <Button
              disabled={!draft || saving}
              onClick={saveDraft}
              className="bg-gradient-primary text-primary-foreground"
            >
              {(() => {
                const kind = draft?.kind ?? (targetKind === "auto" ? null : (targetKind as "skill" | "tool" | "agent"));
                const Icon = kind === "tool" ? Wrench : kind === "agent" ? Bot : kind === "skill" ? Sparkles : Save;
                const label = saving
                  ? "Saving…"
                  : kind === "tool"
                    ? "Create Tool"
                    : kind === "agent"
                      ? "Create Agent"
                      : kind === "skill"
                        ? "Create Skill"
                        : "Create Capability";
                return <><Icon className="h-3 w-3 mr-1" />{label}</>;
              })()}
            </Button>
          </div>

          {debugOpen && (
            <DebugPanel
              log={debugLog}
              onClear={() => setDebugLog([])}
              onCopy={() => {
                try {
                  navigator.clipboard.writeText(JSON.stringify(debugLog, null, 2));
                  toast.success("Debug log copied");
                } catch (e) {
                  toast.error(`Copy failed: ${(e as Error).message}`);
                }
              }}
            />
          )}

          {draft && <DraftPreview draft={draft} setDraft={setDraft} interpreters={interpreters} />}
        </CardContent>
      </Card>


      <BrowseDialog
        open={!!browseOpenFor}
        onClose={() => setBrowseOpenFor(null)}
        onPick={(picked) => {
          if (browseOpenFor) updatePath(browseOpenFor, { path: picked });
          setBrowseOpenFor(null);
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Draft preview
// ────────────────────────────────────────────────────────────────────────────

function DraftPreview({
  draft,
  setDraft,
  interpreters,
}: {
  draft: AnyDraft;
  setDraft: (d: AnyDraft) => void;
  interpreters: InterpreterInfo[];
}) {
  return (
    <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-2">
      <p className="text-[10px] uppercase font-mono text-muted-foreground">
        Draft preview — {draft.kind}
      </p>
      {draft.kind === "skill" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <LabeledInput
              label="Slug"
              value={draft.slug}
              onChange={(v) => setDraft({ ...draft, slug: slugify(v) })}
            />
            <div className="md:col-span-2">
              <LabeledInput label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            </div>
          </div>
          <LabeledInput
            label="Description"
            value={draft.description}
            onChange={(v) => setDraft({ ...draft, description: v })}
          />
        </>
      )}
      {draft.kind === "tool" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <LabeledInput
              label="ID"
              value={draft.id}
              onChange={(v) => setDraft({ ...draft, id: v.replace(/[^a-zA-Z0-9_-]/g, "_") })}
            />
            <LabeledInput label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            <LabeledInput
              label="Category"
              value={draft.category}
              onChange={(v) => setDraft({ ...draft, category: v })}
            />
          </div>
          <LabeledInput
            label="Description"
            value={draft.description}
            onChange={(v) => setDraft({ ...draft, description: v })}
          />
          <p className="text-[10px] font-mono text-muted-foreground">
            Params detected: {draft.params.length === 0 ? "none" : draft.params.map((p) => `${p.key}:${p.type}`).join(", ")}
          </p>
        </>
      )}
      {draft.kind === "agent" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <LabeledInput
              label="ID"
              value={draft.id}
              onChange={(v) => setDraft({ ...draft, id: v.replace(/[^a-zA-Z0-9_-]/g, "_") })}
            />
            <LabeledInput label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          </div>
          <LabeledInput
            label="Agent path"
            value={draft.agent_path}
            onChange={(v) => setDraft({ ...draft, agent_path: v })}
          />
          <div>
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">Interpreter</Label>
            <select
              className="w-full h-8 text-xs font-mono border border-border rounded px-2 bg-background"
              value={draft.interpreter_path}
              onChange={(e) => setDraft({ ...draft, interpreter_path: e.target.value })}
            >
              {[draft.interpreter_path, ...interpreters.map((i) => i.path)]
                .filter((v, i, a) => v && a.indexOf(v) === i)
                .map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
            </select>
          </div>
          <LabeledInput
            label="Description"
            value={draft.description}
            onChange={(v) => setDraft({ ...draft, description: v })}
          />
        </>
      )}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-[10px] font-mono uppercase text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs h-8" />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Browse dialog — minimal path picker using AgentsAPI.browse
// ────────────────────────────────────────────────────────────────────────────

function BrowseDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [cur, setCur] = useState<string>("");
  const [data, setData] = useState<{
    path: string;
    parent: string | null;
    home: string;
    shortcuts: { label: string; path: string }[];
    dirs: { name: string; path: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    AgentsAPI.browse(cur || undefined)
      .then((r) => {
        setData({
          path: r.path,
          parent: r.parent,
          home: r.home,
          shortcuts: r.shortcuts || [],
          dirs: r.dirs || [],
        });
        if (!cur) setCur(r.path);
      })
      .finally(() => setBusy(false));
  }, [open, cur]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Pick a folder</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              disabled={!data?.parent}
              onClick={() => data?.parent && setCur(data.parent)}
            >
              <ChevronUp className="h-3 w-3 mr-1" /> Up
            </Button>
            <Input value={cur} onChange={(e) => setCur(e.target.value)} className="font-mono text-xs h-7" />
            <Button size="sm" className="h-7 text-[10px]" onClick={() => onPick(cur)}>
              Use this
            </Button>
          </div>
          {data && data.shortcuts.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.shortcuts.map((s) => (
                <Button
                  key={s.path}
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={() => setCur(s.path)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          )}
          <div className="border border-border rounded max-h-72 overflow-auto">
            {busy && <p className="p-3 text-[11px] text-muted-foreground">Loading…</p>}
            {!busy &&
              data?.dirs.map((d) => (
                <button
                  key={d.path}
                  className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-muted/40 flex items-center gap-2"
                  onClick={() => setCur(d.path)}
                >
                  <Folder className="h-3 w-3 text-muted-foreground" />
                  {d.name}
                </button>
              ))}
            {!busy && data && data.dirs.length === 0 && (
              <p className="p-3 text-[11px] text-muted-foreground">No subfolders.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Debug panel
// ────────────────────────────────────────────────────────────────────────────

function DebugPanel({
  log,
  onClear,
  onCopy,
}: {
  log: DebugEntry[];
  onClear: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="border border-border rounded-lg bg-muted/20">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <p className="text-[10px] uppercase font-mono text-muted-foreground flex items-center gap-1.5">
          <Bug className="h-3 w-3" /> Debug log ({log.length}/200)
        </p>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onCopy}>
            <CopyIcon className="h-3 w-3 mr-1" /> Copy JSON
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" onClick={onClear}>
            <Trash2 className="h-3 w-3 mr-1" /> Clear
          </Button>
        </div>
      </div>
      <div className="max-h-64 overflow-auto font-mono text-[10px]">
        {log.length === 0 && (
          <p className="px-3 py-4 text-muted-foreground">No events yet. Convert/save to see traces.</p>
        )}
        {log.map((e, i) => {
          const color =
            e.level === "error"
              ? "text-destructive"
              : e.level === "warn"
                ? "text-amber-400"
                : "text-muted-foreground";
          return (
            <div key={i} className="px-3 py-1 border-b border-border/30 flex gap-2">
              <span className="text-muted-foreground/70 shrink-0">
                {new Date(e.ts).toISOString().slice(11, 23)}
              </span>
              <span className={`shrink-0 uppercase ${color}`}>{e.level}</span>
              <span className="text-foreground">{e.msg}</span>
              {e.data !== undefined && (
                <span className="text-muted-foreground/80 truncate">{JSON.stringify(e.data)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
