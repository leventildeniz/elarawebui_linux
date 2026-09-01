// Inference parameters form — Temperature / Top-P / Context Window /
// Max Output Tokens / Stop Sequences / Description / Custom Params.
// Sealed into agents.meta.inference (PostgreSQL via /api/agents).
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { LazyTextarea } from "@/components/lazy-textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { X, Plus, Minus, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

export interface InferenceCustomParam { id: string; name: string; value: string }
/** Per-agent loop-guard override. Any field left undefined falls back to the
 * global RAG-panel value. UI = single source of truth; no hidden clamp beyond
 * LOCAL_runner's own min/max safety bounds. */
export interface InferenceLoopGuard {
  line_min_chars?: number | null;
  line_repeat?: number | null;
  substr_win?: number | null;
  substr_repeat?: number | null;
  phrase_repeat?: number | null;
}
export interface InferenceParams {
  temperature: number;
  top_p: number;
  repetition_penalty: number;
  no_repeat_ngram_size: number;
  context_window: number;
  max_output_tokens: number;
  stop_sequences: string[];
  description: string;
  /** Optional billion-parameter count used by VRAM estimator. */
  n_params_b?: number;
  custom_params: InferenceCustomParam[];
  /** Optional per-agent loop-guard override (global fallback when empty). */
  loop_guard?: InferenceLoopGuard;
}

export const DEFAULT_INFERENCE: InferenceParams = {
  temperature: 0.2,
  top_p: 0.85,
  repetition_penalty: 1.25,
  no_repeat_ngram_size: 4,
  context_window: 8192,
  max_output_tokens: 1200,
  stop_sequences: ["\n\n\n"],
  description: "",
  n_params_b: 0,
  custom_params: [],
  loop_guard: {},
};

const CTX_SNAPS = [4096, 8192, 16384, 32768, 65536, 131072];

const decodeStopToken = (raw: string) => raw
  .replace(/\\n/g, "\n")
  .replace(/\\t/g, "\t")
  .replace(/\\r/g, "\r");

const stopLabel = (raw: string) => raw
  .replace(/\n/g, "\\n")
  .replace(/\t/g, "\\t")
  .replace(/\r/g, "\\r");

interface Props {
  value: InferenceParams;
  onChange: (next: InferenceParams) => void;
  /** System total RAM in GB (defaults 128 — Mac Ultra). Used for VRAM estimator coloring. */
  totalRamGb?: number;
}

export function InferenceParamsForm({ value, onChange, totalRamGb = 128 }: Props) {
  const [vramOpen, setVramOpen] = useState(false);
  const [lgOpen, setLgOpen] = useState(false);
  const set = <K extends keyof InferenceParams>(k: K, v: InferenceParams[K]) =>
    onChange({ ...value, [k]: v });

  const lg = value.loop_guard ?? {};
  const lgCount = Object.values(lg).filter((x) => x != null && Number.isFinite(Number(x))).length;
  const setLg = (k: keyof InferenceLoopGuard, v: number | null) =>
    set("loop_guard", { ...lg, [k]: v });

  // VRAM estimate runs even when collapsed so the warning badge stays honest.
  const estVramGb = useMemo(() => {
    const ctx = Number(value.context_window) || 0;
    const nb = Number(value.n_params_b) || 0;
    if (!ctx || !nb) return 0;
    // Rough rule of thumb: ctx * params_in_billions * 2 bytes per token per param,
    // scaled for kv-cache overhead. Result in GB.
    return (ctx * nb * 2) / 1024;
  }, [value.context_window, value.n_params_b]);

  const vramRatio = totalRamGb > 0 ? estVramGb / totalRamGb : 0;
  const vramTone =
    vramRatio < 0.6 ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" :
    vramRatio < 0.8 ? "text-amber-300 border-amber-500/40 bg-amber-500/10" :
                      "text-destructive border-destructive/40 bg-destructive/10";
  const vramOverThreshold = vramRatio >= 0.8 && estVramGb > 0;

  const addStop = (raw: string) => {
    const v = decodeStopToken(raw.trim());
    if (!v || value.stop_sequences.includes(v)) return;
    set("stop_sequences", [...value.stop_sequences, v]);
  };
  const onStopKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const t = e.currentTarget;
      addStop(t.value);
      t.value = "";
    }
  };

  const addCp = () =>
    set("custom_params", [...value.custom_params, { id: `p${Date.now()}`, name: "", value: "" }]);
  const updCp = (id: string, k: "name" | "value", v: string) =>
    set("custom_params", value.custom_params.map((p) => (p.id === id ? { ...p, [k]: v } : p)));
  const delCp = (id: string) => set("custom_params", value.custom_params.filter((p) => p.id !== id));

  return (
    <div className="space-y-4">
      {/* Temperature */}
      <SliderRow
        label="Temperature" hint="0 = deterministic · 1 = creative"
        min={0} max={0.3} step={0.05}
        value={value.temperature}
        onChange={(v) => set("temperature", v)}
      />

      {/* Top-P */}
      <SliderRow
        label="Top-P" hint="Nucleus sampling focus"
        min={0.05} max={0.85} step={0.01}
        value={value.top_p}
        onChange={(v) => set("top_p", v)}
      />

      <SliderRow
        label="Repetition Penalty" hint="Higher values reduce looped phrases"
        min={1} max={2} step={0.01}
        value={value.repetition_penalty}
        onChange={(v) => set("repetition_penalty", v)}
      />

      <SliderRow
        label="No Repeat N-Gram" hint="4–8 blocks repeated phrase loops"
        min={4} max={8} step={1}
        value={value.no_repeat_ngram_size}
        onChange={(v) => set("no_repeat_ngram_size", Math.round(v))}
      />

      {/* Context Window with snap + VRAM estimator */}
      <div className="rounded-md border border-border bg-card/40 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-xs font-mono uppercase tracking-widest">Context Window</Label>
            <p className="text-[10px] font-mono text-muted-foreground">
              4k–128k · snaps to {CTX_SNAPS.map((c) => `${c / 1024}k`).join(" / ")}
              {vramOverThreshold && (
                <span className="inline-flex items-center gap-1 ml-2 text-destructive">
                  <AlertTriangle className="h-3 w-3" /> VRAM threshold
                </span>
              )}
            </p>
          </div>
          <NumberBox
            min={1024} max={131072} step={1024}
            className="h-8 w-28 font-mono text-xs"
            value={value.context_window}
            onCommit={(n) => set("context_window", Math.max(1024, Math.min(131072, Math.round(n))))}
          />
        </div>
        <Slider
          value={[value.context_window]} min={4096} max={131072} step={4096}
          onValueChange={(v) => {
            const raw = v[0] ?? 8192;
            // Snap to nearest preset for cleaner UX
            const snap = CTX_SNAPS.reduce((p, c) => Math.abs(c - raw) < Math.abs(p - raw) ? c : p, CTX_SNAPS[0]);
            set("context_window", snap);
          }}
        />

        {/* VRAM estimator — collapsed by default per Komutan v2 */}
        <button
          type="button"
          onClick={() => setVramOpen((s) => !s)}
          className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {vramOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {vramOpen ? "Hide" : "Show"} VRAM estimate
        </button>
        {vramOpen && (
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center pt-1">
            <div className="space-y-1">
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Model parameters (B)
              </Label>
              <NumberBox
                min={0} max={500} step={0.5}
                className="h-7 w-24 font-mono text-xs"
                value={value.n_params_b ?? 0}
                onCommit={(n) => set("n_params_b", Math.max(0, Math.min(500, n)))}
                placeholder="e.g. 70"
              />
            </div>
            <Badge variant="outline" className={`font-mono text-[10px] ${vramTone}`}>
              ≈ {estVramGb > 0 ? estVramGb.toFixed(1) : "—"} GB / {totalRamGb} GB
            </Badge>
          </div>
        )}
      </div>

      {/* Max Output Tokens */}
      <SliderRow
        label="Max Output Tokens" hint="Cap on response length (server hard ceiling: 4000)"
        min={64} max={8000} step={128}
        value={value.max_output_tokens}
        onChange={(v) => set("max_output_tokens", v)}
      />

      {/* Stop Sequences */}
      <div className="rounded-md border border-border bg-card/40 px-3 py-2 space-y-2">
        <Label className="text-xs font-mono uppercase tracking-widest">Stop Sequences</Label>
        <p className="text-[10px] font-mono text-muted-foreground">
          Press Enter to add · escapes \n / \t honored as plain text
        </p>
        <div className="flex flex-wrap gap-1">
          {value.stop_sequences.map((s) => (
            <Badge key={s} variant="secondary" className="font-mono text-[10px] gap-1">
              {stopLabel(s)}
              <button
                type="button"
                onClick={() => set("stop_sequences", value.stop_sequences.filter((x) => x !== s))}
                className="hover:text-destructive"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
        <Input
          className="h-8 font-mono text-xs"
          placeholder="<|endoftext|>"
          onKeyDown={onStopKey}
        />
      </div>

      {/* Custom params — placed above Description per operator request (2026-06-14). */}
      <div className="rounded-md border border-border bg-card/40 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-mono uppercase tracking-widest">Custom Parameters</Label>
          <Button size="sm" variant="outline" className="h-7" onClick={addCp} disabled={value.custom_params.length >= 16}>
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        </div>
        {value.custom_params.length === 0 && (
          <p className="text-[11px] font-mono text-muted-foreground">No custom parameters.</p>
        )}
        {value.custom_params.map((p) => {
          const nameErr = p.name.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name);
          const valueErr = p.value.length > 512;
          return (
            <div key={p.id} className="space-y-1">
              <div className="flex gap-2">
                <Input
                  className={`h-8 font-mono text-xs ${nameErr ? "border-destructive" : ""}`}
                  placeholder="name"
                  value={p.name}
                  onChange={(e) => updCp(p.id, "name", e.target.value)}
                />
                <Input
                  className={`h-8 font-mono text-xs ${valueErr ? "border-destructive" : ""}`}
                  placeholder="value"
                  value={p.value}
                  onChange={(e) => updCp(p.id, "value", e.target.value)}
                />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => delCp(p.id)}>
                  <Minus className="h-3 w-3" />
                </Button>
              </div>
              {(nameErr || valueErr) && (
                <p className="text-[10px] font-mono text-destructive pl-1">
                  {nameErr ? "Name must match /^[A-Za-z_][A-Za-z0-9_]*$/." : null}
                  {nameErr && valueErr ? " " : null}
                  {valueErr ? "Value too long (max 512 chars)." : null}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Loop Guard override — per-agent. Empty field = use global RAG-panel value. */}
      <div className="rounded-md border border-border bg-card/40 px-3 py-2 space-y-2">
        <button
          type="button"
          onClick={() => setLgOpen((s) => !s)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex items-center gap-1">
            {lgOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Label className="text-xs font-mono uppercase tracking-widest cursor-pointer">Loop Guard Override</Label>
          </span>
          {lgCount > 0 && (
            <Badge variant="outline" className="font-mono text-[10px]">{lgCount} set</Badge>
          )}
        </button>
        {lgOpen && (
          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-mono text-muted-foreground">
              Per-agent watchdog. Leave empty to inherit the global RAG-panel value. Higher = more tolerant of repeated lines.
            </p>
            {([
              { k: "line_min_chars", label: "Line Min Chars", min: 10, max: 200, ph: "40" },
              { k: "line_repeat",    label: "Line Repeat",    min: 3,  max: 20,  ph: "14" },
              { k: "substr_win",     label: "Substr Window",  min: 20, max: 200, ph: "120" },
              { k: "substr_repeat",  label: "Substr Repeat",  min: 3,  max: 20,  ph: "20" },
              { k: "phrase_repeat",  label: "Phrase Repeat",  min: 3,  max: 20,  ph: "12" },
            ] as const).map((row) => (
              <div key={row.k} className="grid grid-cols-[1fr_5rem_1.5rem] items-center gap-2">
                <Label className="text-[11px] font-mono text-muted-foreground truncate">{row.label}</Label>
                <NumberBox
                  min={row.min} max={row.max} step={1}
                  className="h-7 w-full font-mono text-xs"
                  value={lg[row.k] ?? NaN}
                  onCommit={(n) => setLg(row.k, Number.isFinite(n) ? Math.max(row.min, Math.min(row.max, Math.round(n))) : null)}
                  placeholder={row.ph}
                />
                {lg[row.k] != null ? (
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={() => setLg(row.k, null)} title="Reset to global">
                    <X className="h-3 w-3" />
                  </Button>
                ) : (
                  <span className="h-6 w-6" aria-hidden />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Description */}
      <div className="rounded-md border border-border bg-card/40 px-3 py-2 space-y-1">
        <Label className="text-xs font-mono uppercase tracking-widest">Description</Label>
        <LazyTextarea
          rows={2}
          className="font-mono text-xs"
          placeholder="Free-form notes about this agent's mission, tactics, output style…"
          value={value.description}
          onChange={(v) => set("description", v)}
          commitOnChange={false}
        />
      </div>
    </div>
  );
}

function SliderRow({
  label, hint, min, max, step, value, onChange,
}: {
  label: string; hint?: string;
  min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  const safe = Number.isFinite(value) ? value : min;
  return (
    <div className="rounded-md border border-border bg-card/40 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-xs font-mono uppercase tracking-widest">{label}</Label>
          {hint && <p className="text-[10px] font-mono text-muted-foreground">{hint}</p>}
        </div>
        <NumberBox
          min={min} max={max} step={step}
          className="h-8 w-24 font-mono text-xs"
          value={safe}
          onCommit={(n) => onChange(Math.max(min, Math.min(max, n)))}
        />
      </div>
      <Slider
        value={[safe]} min={min} max={max} step={step}
        onValueChange={(v) => onChange(v[0] ?? min)}
      />
    </div>
  );
}

/**
 * Number input with local draft state. Avoids per-keystroke clamp that
 * would snap the cursor / value while the user is still typing (e.g.
 * typing "2112" into a min=64 box: "2" → clamped to 64 → stuck).
 * Commits on blur or Enter; slider/parent updates sync the displayed value.
 */
function NumberBox({
  value, min, max, step, onCommit, className, placeholder,
}: {
  value: number;
  min: number; max: number; step: number;
  onCommit: (n: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const fmt = (n: number) => (Number.isFinite(n) ? String(n) : "");
  const [draft, setDraft] = useState<string>(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(fmt(value));
  }, [value, focused]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(fmt(value)); return; }
    const clamped = Math.max(min, Math.min(max, n));
    setDraft(fmt(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={min} max={max} step={step}
      className={className}
      placeholder={placeholder}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
        if (e.key === "Escape") { setDraft(fmt(value)); (e.currentTarget as HTMLInputElement).blur(); }
      }}
    />
  );
}

export function sanitizeInference(raw: unknown): InferenceParams {
  const r = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const arr = Array.isArray(r.stop_sequences) ? (r.stop_sequences as unknown[]).map(String) : [];
  const cp = Array.isArray(r.custom_params)
    ? (r.custom_params as unknown[]).map((x, i) => {
        const o = (x && typeof x === "object") ? x as Record<string, unknown> : {};
        return {
          id: String(o.id ?? `p${i}`),
          name: String(o.name ?? ""),
          value: String(o.value ?? ""),
        };
      })
    : [];
  const num = (v: unknown, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const clamp = (v: unknown, fb: number, min: number, max: number) => Math.max(min, Math.min(max, num(v, fb)));
  const lgRaw = (r.loop_guard && typeof r.loop_guard === "object") ? r.loop_guard as Record<string, unknown> : {};
  const optInt = (v: unknown, min: number, max: number): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : null;
  };
  const loop_guard: InferenceLoopGuard = {
    line_min_chars: optInt(lgRaw.line_min_chars, 10, 200),
    line_repeat:    optInt(lgRaw.line_repeat, 3, 20),
    substr_win:     optInt(lgRaw.substr_win, 20, 200),
    substr_repeat:  optInt(lgRaw.substr_repeat, 3, 20),
    phrase_repeat:  optInt(lgRaw.phrase_repeat, 3, 20),
  };
  return {
    temperature: clamp(r.temperature, DEFAULT_INFERENCE.temperature, 0, 0.3),
    top_p: clamp(r.top_p, DEFAULT_INFERENCE.top_p, 0.05, 0.85),
    repetition_penalty: clamp(r.repetition_penalty, DEFAULT_INFERENCE.repetition_penalty, 1.25, 2),
    no_repeat_ngram_size: Math.round(clamp(r.no_repeat_ngram_size, DEFAULT_INFERENCE.no_repeat_ngram_size, 4, 8)),
    context_window: num(r.context_window, DEFAULT_INFERENCE.context_window),
    max_output_tokens: Math.round(clamp(r.max_output_tokens, DEFAULT_INFERENCE.max_output_tokens, 64, 8000)),
    stop_sequences: arr.includes("\n\n\n") ? arr : ["\n\n\n", ...arr].slice(0, 8),
    description: String(r.description ?? ""),
    n_params_b: num(r.n_params_b, 0),
    custom_params: cp,
    loop_guard,
  };
}

/**
 * UI validation hook for inference params. Backend (agent-env.mjs / config_center.py)
 * already clamps; this surfaces problems to the operator before save.
 * Returns { ok, errors } — errors keyed by field path.
 */
export function validateInferenceParams(v: InferenceParams): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
  if (!inRange(v.temperature, 0, 2)) errors.temperature = "Must be 0–2.";
  if (!inRange(v.top_p, 0, 1)) errors.top_p = "Must be 0–1.";
  if (!inRange(v.repetition_penalty, 1, 2)) errors.repetition_penalty = "Must be 1.0–2.0.";
  if (!inRange(v.no_repeat_ngram_size, 0, 10)) errors.no_repeat_ngram_size = "Must be 0–10.";
  if (!Number.isFinite(v.max_output_tokens) || v.max_output_tokens < 1 || v.max_output_tokens > 8000) {
    errors.max_output_tokens = "Must be 1–8000.";
  }
  if (!Array.isArray(v.stop_sequences) || v.stop_sequences.length > 8) {
    errors.stop_sequences = "Maximum 8 stop sequences.";
  } else if (v.stop_sequences.some((s) => typeof s !== "string" || s.length > 32)) {
    errors.stop_sequences = "Each stop sequence ≤ 32 chars.";
  }
  const cps = Array.isArray(v.custom_params) ? v.custom_params : [];
  if (cps.length > 16) errors.custom_params = "Maximum 16 custom parameters.";
  const nameRe = /^[A-Za-z_][A-Za-z0-9_]*$/;
  cps.forEach((p, i) => {
    if (!p.name || !nameRe.test(p.name)) errors[`custom_params.${i}.name`] = "Invalid name.";
    if (typeof p.value === "string" && p.value.length > 512) errors[`custom_params.${i}.value`] = "Value too long.";
  });
  return { ok: Object.keys(errors).length === 0, errors };
}
