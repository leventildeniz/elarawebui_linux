import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Sparkles, Trash2, Volume2 } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { GlassPanel, JewelButton, SectionLabel, Tag } from "@/components/sovereign/primitives";
import {
  emptyVoiceProfile,
  useVoiceProfiles,
  voiceEngines,
  type VoiceProfile,
} from "@/lib/voice-store";
import { cn } from "@/lib/utils";

const description =
  "Voice profiles for Turkish and English narration — engine, voice, rate, pitch and playback speed.";

export const Route = createFileRoute("/vision-audio")({
  head: () => ({
    meta: [
      { title: "Vision Audio — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Vision Audio — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VisionAudioPage,
});

const input =
  "w-full rounded-lg border border-input bg-raised/50 px-3 py-2 text-[14px] outline-none transition-colors focus:border-sapphire/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60">
        {label}
      </span>
      {children}
    </label>
  );
}

function VisionAudioPage() {
  const { profiles, speed, save, remove, makeDefault, setSpeed } = useVoiceProfiles();
  const [draft, setDraft] = useState({ ...emptyVoiceProfile });
  const [voices, setVoices] = useState<{ uri: string; name: string; lang: string }[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () =>
      setVoices(
        window.speechSynthesis
          .getVoices()
          .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang })),
      );
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const preview = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(
      draft.lang === "tr" ? "Sovereign Studio hazır, komutan." : "Sovereign Studio is ready.",
    );
    const v = window.speechSynthesis.getVoices().find((x) => x.voiceURI === draft.voiceUri);
    if (v) u.voice = v;
    u.rate = draft.rate * speed;
    u.pitch = draft.pitch;
    window.speechSynthesis.speak(u);
  };

  return (
    <Surface
      title="Vision Audio"
      meta={`${profiles.length} voice profiles · playback ${speed}x`}
      wide
    >
      <GlassPanel className="p-5">
        <SectionLabel>
          <Sparkles className="mr-2 inline h-3.5 w-3.5 text-amethyst" strokeWidth={1.6} />
          Add voice profile (TR · EN)
        </SectionLabel>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <Field label="language">
            <select
              value={draft.lang}
              onChange={(e) =>
                setDraft((d) => ({ ...d, lang: e.target.value as VoiceProfile["lang"] }))
              }
              className={input}
            >
              <option value="en">English (en)</option>
              <option value="tr">Turkish (tr)</option>
            </select>
          </Field>
          <Field label="label">
            <input
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="TR · Yelda · warm"
              className={cn(input, "font-mono text-[12.5px]")}
            />
          </Field>
          <Field label="engine">
            <select
              value={draft.engine}
              onChange={(e) =>
                setDraft((d) => ({ ...d, engine: e.target.value as VoiceProfile["engine"] }))
              }
              className={input}
            >
              {voiceEngines.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="voice">
            <select
              value={draft.voiceUri}
              onChange={(e) => setDraft((d) => ({ ...d, voiceURI: e.target.value }))}
              className={input}
            >
              <option value="">Pick voice</option>
              {voices
                .filter((v) => v.lang.toLowerCase().startsWith(draft.lang))
                .map((v) => (
                  <option key={v.uri} value={v.uri}>
                    {v.name} · {v.lang}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={`rate · ${draft.rate.toFixed(2)}x`}>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={draft.rate}
              onChange={(e) => setDraft((d) => ({ ...d, rate: Number(e.target.value) }))}
              className="mt-3 w-full accent-[var(--sapphire)]"
            />
          </Field>
          <Field label={`pitch · ${draft.pitch.toFixed(2)}`}>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={draft.pitch}
              onChange={(e) => setDraft((d) => ({ ...d, pitch: Number(e.target.value) }))}
              className="mt-3 w-full accent-[var(--amethyst)]"
            />
          </Field>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, isDefault: !d.isDefault }))}
            className="flex items-center gap-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span
              className={cn(
                "relative h-5 w-9 rounded-full border transition-colors",
                draft.isDefault
                  ? "border-emerald/50 bg-emerald/25"
                  : "border-white/10 bg-raised/60",
              )}
            >
              <span
                className={cn(
                  "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-foreground/80 transition-all",
                  draft.isDefault ? "left-[18px]" : "left-[3px]",
                )}
              />
            </span>
            Default for this language (auto-switch)
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={preview}
              className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-2 text-[13px] text-foreground/85 transition-colors hover:border-sapphire/40"
            >
              <Volume2 className="h-4 w-4" strokeWidth={1.6} /> Preview
            </button>
            <JewelButton
              className="gap-2"
              onClick={() => {
                if (!draft.label.trim()) return;
                save({ ...draft, label: draft.label.trim() });
                setDraft({ ...emptyVoiceProfile });
              }}
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} /> Save
            </JewelButton>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel className="mt-5 flex flex-wrap items-center justify-between gap-3 p-5">
        <SectionLabel>Global playback speed</SectionLabel>
        <div className="flex items-center gap-2">
          {[0.8, 1, 1.25, 1.5].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={cn(
                "rounded-md border px-2.5 py-1 font-mono text-[12px] transition-colors",
                speed === s
                  ? "border-amethyst/50 bg-amethyst/10 text-foreground"
                  : "border-white/[0.08] bg-raised/35 text-muted-foreground/80 hover:text-foreground",
              )}
            >
              {s}x
            </button>
          ))}
        </div>
      </GlassPanel>

      <div className="mt-5 space-y-3">
        <AnimatePresence initial={false}>
          {profiles.map((p) => (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="glass flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[14px] text-foreground">
                  {p.label}
                  <Tag tone={p.lang === "tr" ? "topaz" : "sapphire"}>{p.lang}</Tag>
                  {p.isDefault && <Tag tone="emerald">default</Tag>}
                </div>
                <div className="mt-1 font-mono text-[11.5px] text-muted-foreground/60">
                  {voiceEngines.find((e) => e.id === p.engine)?.label} · rate {p.rate.toFixed(2)}x ·
                  pitch {p.pitch.toFixed(2)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!p.isDefault && (
                  <button
                    onClick={() => makeDefault(p.id)}
                    className="rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Make default
                  </button>
                )}
                <button
                  onClick={() => remove(p.id)}
                  aria-label="Delete voice profile"
                  className="rounded-lg border border-white/[0.08] bg-raised/40 p-2 text-muted-foreground/70 transition-colors hover:border-ruby/40 hover:text-ruby"
                  title="Delete voice profile"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {!profiles.length && (
          <p className="font-mono text-[12px] text-muted-foreground/55">
            No voice profiles yet. Add one above for TR / EN.
          </p>
        )}
      </div>
    </Surface>
  );
}
