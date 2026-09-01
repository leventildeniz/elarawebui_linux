// Vision Console — operatörün aktif vizyon profilini düzenlediği panel.
// Tüm değerler localStorage + Mac middleware cache ikilisinde tutulur.
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, RotateCcw, PlugZap, Save, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  useVisionConfig, buildVisionPayload,
  type VisionExtraParam, type VisionVoiceMode, type VisionVoiceLang,
} from "@/lib/vision-config-store";
import { VisionAPI, VisionConfigAPI } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

// 1×1 transparent PNG — boot warmup ile aynı yöntem.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function uid() { return Math.random().toString(36).slice(2, 10); }

export function VisionConsole() {
  const { config, set, reset } = useVisionConfig();
  const { t } = useI18n();
  const [testing, setTesting] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [lastTest, setLastTest] = useState<{ ok: boolean; latencyMs: number; source?: string; text?: string; error?: string } | null>(null);

  const updateExtra = (id: string, patch: Partial<VisionExtraParam>) => {
    set({ extra: config.extra.map((p) => p.id === id ? { ...p, ...patch } : p) });
  };
  const addExtra = () => set({ extra: [...config.extra, { id: uid(), key: "", value: "" }] });
  const rmExtra = (id: string) => set({ extra: config.extra.filter((p) => p.id !== id) });

  const sealNow = async () => {
    setSealing(true);
    try {
      const r = await VisionConfigAPI.push(buildVisionPayload(config));
      if (r.ok) toast.success(t("vision.console.applied_ok"));
      else toast.error(t("vision.console.applied_fail"));
    } finally { setSealing(false); }
  };

  const runTest = async () => {
    setTesting(true);
    setLastTest(null);
    try {
      const t0 = Date.now();
      const res = await VisionAPI.analyze(TINY_PNG, {
        ...buildVisionPayload(config),
        // Test hızlı olsun — kısa max_tokens override.
        maxTokens: Math.min(64, config.maxTokens),
      });
      setLastTest({
        ok: res.ok,
        latencyMs: res.latencyMs ?? Date.now() - t0,
        source: res.source,
        text: res.text?.slice(0, 220),
        error: res.error,
      });
      if (res.ok) toast.success(`${t("vision.console.online")} · ${res.latencyMs}ms`);
      else toast.error(`${t("vision.console.offline")} · ${res.error || res.source}`);
    } catch (e) {
      setLastTest({ ok: false, latencyMs: 0, error: (e as Error).message });
      toast.error(`${t("vision.console.offline")}: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const VoiceModeRadio = ({ value, label }: { value: VisionVoiceMode; label: string }) => {
    const on = config.voiceMode === value;
    return (
      <button
        type="button"
        onClick={() => set({ voiceMode: value })}
        className={`text-left text-[12px] font-mono border rounded px-3 py-2 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
      >
        <span className="mr-2">{on ? "●" : "○"}</span>{label}
      </button>
    );
  };

  const LangRadio = ({ value, label }: { value: VisionVoiceLang; label: string }) => {
    const on = config.voiceLang === value;
    return (
      <button
        type="button"
        onClick={() => set({ voiceLang: value })}
        className={`text-[12px] font-mono border rounded px-3 py-1.5 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
      >
        {on ? "✓ " : ""}{label}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-base font-semibold">{t("vision.console.title")}</h3>
            <p className="text-[11px] font-mono text-muted-foreground">
              {t("vision.console.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastTest && (
            <Badge variant="outline" className={`font-mono text-[10px] ${lastTest.ok ? "text-emerald-400" : "text-destructive"}`}>
              {lastTest.ok ? t("vision.console.online") : t("vision.console.offline")} · {lastTest.latencyMs}ms
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => reset()}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />{t("vision.console.restore")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void sealNow()} disabled={sealing}>
            <Save className="h-3.5 w-3.5 mr-1" />{sealing ? t("vision.console.applying") : t("vision.console.apply")}
          </Button>
          <Button size="sm" className="bg-gradient-primary text-primary-foreground" onClick={() => void runTest()} disabled={testing}>
            <PlugZap className="h-3.5 w-3.5 mr-1" />{testing ? t("vision.console.verifying") : t("vision.console.verify")}
          </Button>
        </div>
      </div>

      <Card className="glass">
        <CardContent className="p-6 space-y-5">
          <div>
            <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("vision.console.system_label")}</Label>
            <textarea
              value={config.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              className="w-full mt-2 h-32 p-3 rounded-md bg-card/50 border border-border text-sm font-mono"
            />
          </div>

          <div>
            <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("vision.console.user_label")}</Label>
            <textarea
              value={config.userPromptTemplate}
              onChange={(e) => set({ userPromptTemplate: e.target.value })}
              className="w-full mt-2 h-20 p-3 rounded-md bg-card/50 border border-border text-sm font-mono"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t("vision.console.endpoint")} value={config.baseUrl} on={(v) => set({ baseUrl: v })} placeholder="http://127.0.0.1:8011" />
            <Field label={t("vision.console.model")} value={config.model} on={(v) => set({ model: v })} placeholder="local-community/Qwen2-VL-7B-Instruct-4bit" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("vision.console.temperature")}</Label>
              <span className="text-xs font-mono text-primary">{config.temperature.toFixed(2)}</span>
            </div>
            <Slider
              value={[config.temperature]}
              onValueChange={([v]) => set({ temperature: Number(v.toFixed(2)) })}
              min={0} max={1} step={0.05}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <NumberField label={t("vision.console.max_tokens")} value={config.maxTokens} on={(v) => set({ maxTokens: v })} />
            <NumberField label={t("vision.console.max_frames")} value={config.maxFrames} on={(v) => set({ maxFrames: v })} />
            <NumberField label={t("vision.console.timeout")} value={config.timeoutMs} on={(v) => set({ timeoutMs: v })} />
          </div>

          {/* ---- Ses & Aktarım ---- */}
          <div className="rounded-md border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-primary">{t("vision.voice.section")}</h4>
            </div>
            <div>
              <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{t("vision.voice.mode")}</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                <VoiceModeRadio value="silent" label={t("vision.voice.mode.silent")} />
                <VoiceModeRadio value="via_elara" label={t("vision.voice.mode.via_elara")} />
                <VoiceModeRadio value="direct" label={t("vision.voice.mode.direct")} />
              </div>
            </div>
            <div>
              <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{t("vision.voice.lang")}</Label>
              <div className="flex gap-2 mt-2">
                <LangRadio value="tr" label={t("vision.voice.lang.tr")} />
                <LangRadio value="en" label={t("vision.voice.lang.en")} />
              </div>
            </div>
            <div>
              <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{t("vision.voice.context_label")}</Label>
              <Input
                value={config.contextLabel}
                onChange={(e) => set({ contextLabel: e.target.value })}
                className="font-mono text-xs mt-2"
                disabled={config.voiceMode !== "via_elara"}
              />
              <p className="text-[10px] font-mono text-muted-foreground mt-1">{t("vision.voice.context_label_hint")}</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("vision.console.custom_params")}</Label>
              <Button size="sm" variant="outline" onClick={addExtra}><Plus className="h-3.5 w-3.5 mr-1" />{t("vision.console.add")}</Button>
            </div>
            {config.extra.length === 0 && (
              <p className="text-[11px] font-mono text-muted-foreground">{t("vision.console.custom_hint")}</p>
            )}
            <div className="space-y-2 mt-2">
              {config.extra.map((p) => (
                <div key={p.id} className="flex gap-2">
                  <Input value={p.key} onChange={(e) => updateExtra(p.id, { key: e.target.value })} placeholder="parameter" className="font-mono text-xs h-9" />
                  <Input value={p.value} onChange={(e) => updateExtra(p.id, { value: e.target.value })} placeholder="value" className="font-mono text-xs h-9" />
                  <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => rmExtra(p.id)}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {lastTest && (
            <div className="rounded-md border border-border bg-card/40 p-3 text-xs font-mono space-y-1">
              <div className="flex items-center gap-2">
                <span className={lastTest.ok ? "text-emerald-400" : "text-destructive"}>
                  {lastTest.ok ? "OK" : "ERR"}
                </span>
                <span className="text-muted-foreground">{lastTest.source || "—"}</span>
                <span className="ml-auto">{lastTest.latencyMs}ms</span>
              </div>
              {lastTest.text && <p className="text-muted-foreground whitespace-pre-wrap">{lastTest.text}</p>}
              {lastTest.error && <p className="text-destructive whitespace-pre-wrap">{lastTest.error}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, on, placeholder }: { label: string; value: string; on: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => on(e.target.value)} placeholder={placeholder} className="font-mono mt-2" />
    </div>
  );
}

function NumberField({ label, value, on }: { label: string; value: number; on: (v: number) => void }) {
  return (
    <div>
      <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) on(n);
        }}
        className="font-mono mt-2"
      />
    </div>
  );
}
