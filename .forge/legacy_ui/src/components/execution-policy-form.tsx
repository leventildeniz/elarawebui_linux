// Execution Policy form — shared between Tools (Forge) and Skills.
// Sealed into action_library.execution_policy / skills.execution_policy.
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Plus, Minus, Lock, Unlock } from "lucide-react";

export type TempMode = "off" | "force_zero" | "safe_low" | "custom";
export type OutputFormat = "raw" | "markdown_table" | "json" | "csv";

export interface PolicyCustomParam { id: string; name: string; value: string }

export interface ExecutionPolicy {
  enforce_strict: boolean;
  override_temperature_mode: TempMode;
  override_temperature_value: number | null;
  override_top_p: number | null;
  retry_count: number;
  retry_backoff_ms: number;
  timeout_ms: number;
  output_format: OutputFormat;
  custom_params: PolicyCustomParam[];
}

export const DEFAULT_POLICY: ExecutionPolicy = {
  enforce_strict: true,
  override_temperature_mode: "force_zero",
  override_temperature_value: null,
  override_top_p: null,
  retry_count: 2,
  retry_backoff_ms: 500,
  timeout_ms: 30000,
  output_format: "raw",
  custom_params: [],
};

interface Props {
  value: ExecutionPolicy;
  onChange: (next: ExecutionPolicy) => void;
  disabled?: boolean;
}

export function ExecutionPolicyForm({ value, onChange, disabled }: Props) {
  const set = <K extends keyof ExecutionPolicy>(k: K, v: ExecutionPolicy[K]) =>
    onChange({ ...value, [k]: v });

  const totalMaxMs = useMemo(
    () => Math.max(0, value.retry_count + 1) * Math.max(1, value.timeout_ms),
    [value.retry_count, value.timeout_ms],
  );
  const exceeds5min = totalMaxMs > 5 * 60 * 1000;

  const addCp = () =>
    set("custom_params", [...value.custom_params, { id: `cp${Date.now()}`, name: "", value: "" }]);
  const updCp = (id: string, k: "name" | "value", v: string) =>
    set("custom_params", value.custom_params.map((p) => (p.id === id ? { ...p, [k]: v } : p)));
  const delCp = (id: string) => set("custom_params", value.custom_params.filter((p) => p.id !== id));

  const overrideTopActive = value.override_top_p !== null;

  return (
    <div className="space-y-3 rounded-md border border-border bg-card/30 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {value.enforce_strict ? <Lock className="h-3.5 w-3.5 text-primary" /> : <Unlock className="h-3.5 w-3.5 text-muted-foreground" />}
          <Label className="text-xs font-mono uppercase tracking-widest">Execution Policy</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">Enforce Strict</span>
          <Switch
            disabled={disabled}
            checked={value.enforce_strict}
            onCheckedChange={(v) => set("enforce_strict", v)}
          />
        </div>
      </div>

      {/* Temperature override */}
      <div>
        <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Override Temperature
        </Label>
        <div className="flex gap-1 mt-1">
          {(["off", "force_zero", "safe_low", "custom"] as TempMode[]).map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={value.override_temperature_mode === m ? "default" : "outline"}
              disabled={disabled}
              className="h-7 text-[10px] font-mono flex-1"
              onClick={() => set("override_temperature_mode", m)}
            >
              {m === "off"
                ? "Off"
                : m === "force_zero"
                ? "Force-Zero (0.0)"
                : m === "safe_low"
                ? "Safe-Low (0.01)"
                : "Custom"}
            </Button>
          ))}
        </div>
        {value.override_temperature_mode === "custom" && (
          <div className="mt-2 flex items-center gap-2">
            <Label className="text-[10px] font-mono text-muted-foreground shrink-0">
              Custom value (0.0 – 1.0)
            </Label>
            <Input
              type="number" min={0} max={1} step={0.01}
              disabled={disabled}
              className="h-7 font-mono text-xs w-28"
              value={value.override_temperature_value ?? ""}
              placeholder="0.00"
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") { set("override_temperature_value", null); return; }
                const n = Number(raw);
                set("override_temperature_value", Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null);
              }}
            />
          </div>
        )}
        <p className="text-[10px] font-mono text-muted-foreground mt-1">
          {value.override_temperature_mode === "off" && "Inherit temperature from agent."}
          {value.override_temperature_mode === "force_zero" && "Force temperature = 0.0 (fully deterministic; some models loop)."}
          {value.override_temperature_mode === "safe_low" && "Force temperature = 0.01 (deterministic-ish, loop-safe)."}
          {value.override_temperature_mode === "custom" && (
            value.override_temperature_value === null
              ? "Enter a value between 0.00 and 1.00 to seal as fixed override."
              : `Force temperature = ${Number(value.override_temperature_value).toFixed(2)} (sealed per-tool override).`
          )}
        </p>
      </div>

      {/* Override Top-P */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div>
          <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Override Top-P
          </Label>
          <Input
            type="number" min={0} max={1} step={0.01}
            disabled={disabled || !overrideTopActive}
            className="h-8 font-mono text-xs mt-1"
            value={value.override_top_p ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              set("override_top_p", Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null);
            }}
            placeholder="inherit"
          />
        </div>
        <div className="flex items-center gap-1 pb-1.5">
          <span className="text-[10px] font-mono text-muted-foreground">on</span>
          <Switch
            disabled={disabled}
            checked={overrideTopActive}
            onCheckedChange={(v) => set("override_top_p", v ? 0.9 : null)}
          />
        </div>
      </div>

      {/* Retry + Timeout */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Retry Count
          </Label>
          <Input
            type="number" min={0} max={10} step={1}
            disabled={disabled}
            className="h-8 font-mono text-xs mt-1"
            value={value.retry_count}
            onChange={(e) => set("retry_count", Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
          />
        </div>
        <div>
          <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Timeout (ms)
          </Label>
          <Input
            type="number" min={1000} max={600000} step={1000}
            disabled={disabled}
            className="h-8 font-mono text-xs mt-1"
            value={value.timeout_ms}
            onChange={(e) => set("timeout_ms", Math.max(1000, Math.min(600000, Number(e.target.value) || 1000)))}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          max total ≈ {Math.round(totalMaxMs / 1000)}s
        </Badge>
        {exceeds5min && (
          <Badge variant="outline" className="font-mono text-[10px] text-destructive border-destructive/40 bg-destructive/10 gap-1">
            <AlertTriangle className="h-3 w-3" /> retry × timeout &gt; 5min
          </Badge>
        )}
      </div>

      {/* Output Format */}
      <div>
        <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Output Format Enforcer
        </Label>
        <Select
          value={value.output_format}
          onValueChange={(v) => set("output_format", v as OutputFormat)}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="raw">Raw (no enforcement)</SelectItem>
            <SelectItem value="markdown_table">Markdown table</SelectItem>
            <SelectItem value="json">JSON (structured-output)</SelectItem>
            <SelectItem value="csv">CSV</SelectItem>
          </SelectContent>
        </Select>
        {value.output_format === "json" && (
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            JSON mode triggers LOCAL response_format=json — format failure becomes structured-mode retry, not blind retry.
          </p>
        )}
      </div>

      {/* Custom params (per Tool/Skill — overrides agent params) */}
      <div className="rounded border border-border/60 bg-background/40 p-2 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Custom Params (override agent)
          </Label>
          <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={disabled} onClick={addCp}>
            <Plus className="h-2.5 w-2.5 mr-1" /> Add
          </Button>
        </div>
        {value.custom_params.length === 0 && (
          <p className="text-[10px] font-mono text-muted-foreground">e.g. top_k=40, repetition_penalty=1.1, mirostat_eta=0.1</p>
        )}
        {value.custom_params.map((p) => (
          <div key={p.id} className="flex gap-1">
            <Input className="h-7 font-mono text-[11px]" placeholder="name" value={p.name}
              disabled={disabled}
              onChange={(e) => updCp(p.id, "name", e.target.value)} />
            <Input className="h-7 font-mono text-[11px]" placeholder="value" value={p.value}
              disabled={disabled}
              onChange={(e) => updCp(p.id, "value", e.target.value)} />
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={disabled} onClick={() => delCp(p.id)}>
              <Minus className="h-2.5 w-2.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function sanitizePolicy(raw: unknown): ExecutionPolicy {
  const r = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const num = (v: unknown, fb: number) => {
    const n = Number(v); return Number.isFinite(n) ? n : fb;
  };
  const mode = ((): TempMode => {
    const v = String(r.override_temperature_mode ?? "");
    return (v === "off" || v === "force_zero" || v === "safe_low" || v === "custom") ? v : "force_zero";
  })();
  const customTemp = ((): number | null => {
    const v = r.override_temperature_value;
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
  })();
  const fmt = ((): OutputFormat => {
    const v = String(r.output_format ?? "");
    return (v === "raw" || v === "markdown_table" || v === "json" || v === "csv") ? v : "raw";
  })();
  const top = r.override_top_p === null || r.override_top_p === undefined
    ? null
    : Number(r.override_top_p);
  const cp = Array.isArray(r.custom_params)
    ? (r.custom_params as unknown[]).map((x, i) => {
        const o = (x && typeof x === "object") ? x as Record<string, unknown> : {};
        return {
          id: String(o.id ?? `cp${i}`),
          name: String(o.name ?? ""),
          value: String(o.value ?? ""),
        };
      })
    : [];
  return {
    enforce_strict: r.enforce_strict !== false,
    override_temperature_mode: mode,
    override_temperature_value: customTemp,
    override_top_p: top !== null && Number.isFinite(top) ? top : null,
    retry_count: num(r.retry_count, DEFAULT_POLICY.retry_count),
    retry_backoff_ms: num(r.retry_backoff_ms, DEFAULT_POLICY.retry_backoff_ms),
    timeout_ms: num(r.timeout_ms, DEFAULT_POLICY.timeout_ms),
    output_format: fmt,
    custom_params: cp,
  };
}
