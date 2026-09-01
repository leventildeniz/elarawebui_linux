// Preset sliders for common LLM sampling parameters.
// Values are stored inside the same params[] array as custom params,
// matched by `name`. Toggle a preset off to remove it from the array.
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";

export interface KV { id: string; name: string; value: string; }

export interface ParamPreset {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  hint?: string;
  hintTr?: string;
}

// Server defaults mirror the LOCAL payload defaults in local-server/server.mjs
// (LOCAL_TOP_P=0.9, LOCAL_FREQUENCY_PENALTY=0.3, LOCAL_REPETITION_PENALTY=1.25).
// UI defaults MUST match these so toggling a preset ON does not silently
// change sampling behavior. `serverDefault` is the muted hint shown to the
// operator next to each slider.
export const PARAM_PRESETS: ParamPreset[] = [
  { name: "temperature",        label: "Temperature",        min: 0,   max: 2,     step: 0.05, default: 0.7,  hint: "Creativity · 0 = deterministic · LOCAL default when unset" },
  { name: "top_p",              label: "Top-P",              min: 0,   max: 1,     step: 0.01, default: 0.9,  hint: "Nucleus sampling · server env LOCAL_TOP_P=0.9" },
  { name: "top_k",              label: "Top-K",              min: 0,   max: 200,   step: 1,    default: 40,   hint: "0 = disabled" },
  { name: "max_tokens",         label: "Max Tokens",         min: 64,  max: 32768, step: 64,   default: 2048, hint: "Overrides intent caps (smalltalk=220, query=1000, rag=2000)" },
  { name: "frequency_penalty",  label: "Frequency Penalty",  min: -2,  max: 2,     step: 0.05, default: 0.3,  hint: "Server env LOCAL_FREQUENCY_PENALTY=0.3" },
  { name: "presence_penalty",   label: "Presence Penalty",   min: -2,  max: 2,     step: 0.05, default: 0 },
  { name: "repetition_penalty", label: "Repetition Penalty", min: 1.0, max: 2.0,   step: 0.01, default: 1.25, hint: "LOCAL-LM token repeat damp · server env LOCAL_REPETITION_PENALTY=1.25 (NAT loop fix)" },
];

export const PRESET_NAMES = new Set(PARAM_PRESETS.map((p) => p.name));

// Legacy key remap — DB rows saved before the rename keep `repeat_penalty`.
// Server-side `resolveModelParams` also remaps on read; this constant exists
// so the UI can flag legacy rows visibly if needed in the future.
export const LEGACY_PARAM_RENAMES: Record<string, string> = {
  repeat_penalty: "repetition_penalty",
};


interface Props {
  params: KV[];
  onChange: (next: KV[]) => void;
}

export function ModelParamPresets({ params, onChange }: Props) {
  const { locale } = useI18n();
  const find = (name: string) => params.find((p) => p.name === name);

  const writeValue = (preset: ParamPreset, value: string) => {
    const existing = find(preset.name);
    if (existing) {
      onChange(params.map((p) => (p.name === preset.name ? { ...p, value } : p)));
    } else {
      onChange([...params, { id: `preset_${preset.name}`, name: preset.name, value }]);
    }
  };

  const setValue = (preset: ParamPreset, raw: number) => {
    const clamped = Math.min(preset.max, Math.max(preset.min, raw));
    writeValue(preset, String(clamped));
  };

  const toggle = (preset: ParamPreset, on: boolean) => {
    if (on) {
      if (find(preset.name)) return;
      onChange([...params, { id: `preset_${preset.name}`, name: preset.name, value: String(preset.default) }]);
    } else {
      onChange(params.filter((p) => p.name !== preset.name));
    }
  };

  return (
    <div className="space-y-3">
      {PARAM_PRESETS.map((preset) => {
        const entry = find(preset.name);
        const enabled = !!entry;
        const numeric = entry ? Number(entry.value) : preset.default;
        const safe = Number.isFinite(numeric) ? numeric : preset.default;
        return (
          <div
            key={preset.name}
            className={`rounded-md border border-border bg-card/40 px-3 py-2 transition-opacity ${enabled ? "" : "opacity-60"}`}
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="min-w-0">
                <Label className="text-xs font-mono uppercase tracking-widest">{preset.label}</Label>
                <p className="text-[10px] font-mono text-muted-foreground truncate">
                  {preset.name} · {preset.min}–{preset.max}{(() => { const h = locale === "tr" && preset.hintTr ? preset.hintTr : preset.hint; return h ? ` · ${h}` : ""; })()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Input
                  type="number"
                  value={enabled ? (entry?.value ?? "") : ""}
                  placeholder={String(preset.default)}
                  min={preset.min}
                  max={preset.max}
                  step={preset.step}
                  disabled={!enabled}
                  onChange={(e) => writeValue(preset, e.target.value)}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v === "") { setValue(preset, preset.default); return; }
                    const n = Number(v);
                    if (Number.isFinite(n)) setValue(preset, n);
                  }}
                  className="h-8 w-24 font-mono text-xs"
                />
                <Switch checked={enabled} onCheckedChange={(v) => toggle(preset, v)} />
              </div>
            </div>
            <Slider
              value={[safe]}
              min={preset.min}
              max={preset.max}
              step={preset.step}
              disabled={!enabled}
              onValueChange={(v) => setValue(preset, v[0] ?? preset.default)}
            />
          </div>
        );
      })}
    </div>
  );
}
