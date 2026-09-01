import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Eye, Mic, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, Sheen, StatusDot, Tag } from "@/components/sovereign/primitives";
import { AvatarPicker, EntityAvatar } from "@/components/sovereign/identity";
import { avatarSeedGallery } from "@/lib/avatar-library";
import {
  emptyVisionModel,
  useVisionModels,
  voiceLanguages,
  type VisionModel,
  type VoiceLang,
} from "@/lib/vision-store";
import { cn } from "@/lib/utils";

type Draft = Omit<VisionModel, "id" | "createdAt">;

const input =
  "w-full rounded-lg border border-input bg-raised/50 px-3 py-2 text-[14px] outline-none transition-colors focus:border-sapphire/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono-label mb-2 block">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center justify-between rounded-lg border px-3 py-2.5 text-[13px] transition-colors duration-200",
        on
          ? "border-emerald/35 bg-emerald/[0.07] text-foreground"
          : "border-border/70 text-muted-foreground/70",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-md border px-2 py-0.5 font-mono text-[10.5px]",
          on ? "border-emerald/40 text-emerald" : "border-border/70 text-muted-foreground/60",
        )}
      >
        {on ? "on" : "off"}
      </span>
    </button>
  );
}

function VoicePicker({
  value,
  onChange,
  compact,
}: {
  value: VoiceLang;
  onChange: (v: VoiceLang) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {voiceLanguages.map((l) => (
        <button
          key={l.id}
          type="button"
          title={l.hint}
          onClick={() => onChange(l.id)}
          className={cn(
            "rounded-lg border font-medium transition-all duration-150 ease-in-out",
            compact ? "px-2.5 py-1 text-[12px]" : "px-3 py-[5px] text-[13px]",
            value === l.id
              ? "border-sapphire/50 bg-sapphire/10 text-foreground shadow-[0_0_18px_-8px_var(--sapphire)]"
              : "border-white/[0.06] bg-raised/30 text-muted-foreground/80 hover:border-sapphire/30 hover:text-foreground",
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function VisionPage() {
  const { models, defaultId, create, update, remove, setDefault } = useVisionModels();
  const [editing, setEditing] = useState<VisionModel | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [globalVoice, setGlobalVoice] = useState<VoiceLang>("en");

  const enabled = models.filter((m) => m.enabled).length;
  const defaultModel = models.find((m) => m.id === defaultId);

  return (
    <Surface
      title="Vision"
      meta={`${models.length} vision models · ${enabled} enabled · default ${defaultModel?.name ?? "—"}`}
      crumb="Vision"
      wide
      action={
        <JewelButton onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Add vision model
        </JewelButton>
      }
    >
      <div className="mb-8">
        <Link
          to="/models"
          className="inline-flex items-center gap-2 font-mono text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> back to models
        </Link>
      </div>

      <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
        Vision models read images, video frames and documents. Voice language controls how vision
        results are narrated back in the chat composer.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-raised/25 p-3">
        <Mic className="h-4 w-4 text-sapphire" strokeWidth={1.6} />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
          default voice language
        </span>
        <VoicePicker value={globalVoice} onChange={setGlobalVoice} />
        <span className="font-mono text-[11px] text-muted-foreground/55">
          {voiceLanguages.find((l) => l.id === globalVoice)!.hint}
        </span>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <AnimatePresence initial={false}>
          {models.map((m, i) => {
            const isDefault = m.id === defaultId;
            return (
              <motion.article
                key={m.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.24, delay: i * 0.018, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "glass relative overflow-hidden rounded-xl p-5 transition-shadow duration-300 hover:shadow-[0_0_38px_-24px_var(--sapphire)]",
                  isDefault && "border-sapphire/35 shadow-[0_0_44px_-28px_var(--sapphire)]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <EntityAvatar
                      seed={m.avatar.seed}
                      label={m.name}
                      style={m.avatar.style}
                      jewel={m.avatar.jewel}
                      size={44}
                    />
                    <div className="min-w-0">
                      <h2 className="flex items-center gap-2 truncate text-[15.5px] font-medium tracking-tight text-foreground">
                        {m.name}
                        <Eye className="h-3.5 w-3.5 text-sapphire" strokeWidth={1.6} />
                        {isDefault && (
                          <span className="rounded-md border border-sapphire/35 bg-sapphire/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-sapphire">
                            default
                          </span>
                        )}
                      </h2>
                      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/60">
                        {m.modelId}
                      </div>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusDot tone={m.enabled ? "emerald" : "ruby"} pulse={m.enabled} />
                    <Tag tone={m.enabled ? "emerald" : "ruby"}>{m.enabled ? "enabled" : "off"}</Tag>
                  </span>
                </div>

                <Sheen className="my-4" />

                <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/75">
                  {m.note || m.systemPrompt || "No description set."}
                </p>

                <dl className="mt-4 grid grid-cols-2 gap-y-2 font-mono text-[11.5px]">
                  <dt className="text-muted-foreground/55">vendor</dt>
                  <dd className="truncate text-right text-foreground/85">{m.vendor}</dd>
                  <dt className="text-muted-foreground/55">base url</dt>
                  <dd className="truncate text-right text-foreground/70" title={m.baseUrl}>
                    {m.baseUrl}
                  </dd>
                  <dt className="text-muted-foreground/55">max image</dt>
                  <dd className="text-right text-foreground/85">{m.maxImage}</dd>
                  <dt className="text-muted-foreground/55">ocr</dt>
                  <dd className="truncate text-right text-foreground/85">{m.ocr}</dd>
                  <dt className="text-muted-foreground/55">video frames</dt>
                  <dd
                    className={cn(
                      "text-right",
                      m.video ? "text-emerald" : "text-muted-foreground/60",
                    )}
                  >
                    {m.video ? "supported" : "—"}
                  </dd>
                  <dt className="text-muted-foreground/55">voice narration</dt>
                  <dd className="text-right text-foreground/85">
                    {m.voice ? voiceLanguages.find((l) => l.id === m.voiceLang)!.label : "—"}
                  </dd>
                  <dt className="text-muted-foreground/55">sampling</dt>
                  <dd className="text-right text-foreground/70">
                    temp {m.temperature} · {m.maxTokens} tok
                  </dd>
                </dl>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <JewelButton
                    size="sm"
                    variant={isDefault ? "outline" : "ghost"}
                    className={cn("gap-1.5", isDefault && "text-sapphire")}
                    onClick={() => setDefault(m.id)}
                  >
                    <Star
                      className="h-3.5 w-3.5"
                      strokeWidth={1.75}
                      fill={isDefault ? "currentColor" : "none"}
                    />
                    {isDefault ? "Default" : "Set default"}
                  </JewelButton>
                  <JewelButton
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => update(m.id, { enabled: !m.enabled })}
                  >
                    <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {m.enabled ? "Disable" : "Enable"}
                  </JewelButton>
                  <JewelButton
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => setEditing(m)}
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Edit
                  </JewelButton>
                  <JewelButton
                    size="sm"
                    variant="ghost"
                    className="ml-auto gap-1.5 text-ruby hover:text-ruby"
                    onClick={() => setConfirm(m.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Delete
                  </JewelButton>
                </div>

                <AnimatePresence>
                  {confirm === m.id && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-canvas/80 backdrop-blur-[3px]"
                    >
                      <p className="px-6 text-center text-[13.5px] text-foreground/85">
                        Remove <span className="font-mono text-ruby">{m.name}</span> from the vision
                        registry?
                      </p>
                      <div className="flex gap-2">
                        <JewelButton
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            remove(m.id);
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
            );
          })}
        </AnimatePresence>

        <motion.button
          layout
          onClick={() => setCreating(true)}
          className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-muted-foreground/70 transition-colors hover:border-sapphire/40 hover:bg-raised/20 hover:text-sapphire"
        >
          <Plus className="h-5 w-5" strokeWidth={1.5} />
          <span className="font-mono text-[11px] uppercase tracking-[0.2em]">add vision model</span>
        </motion.button>
      </div>

      <VisionDialog
        open={creating || editing !== null}
        initial={editing ?? undefined}
        defaultVoice={globalVoice}
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

function VisionDialog({
  open,
  initial,
  defaultVoice,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: VisionModel | undefined;
  defaultVoice: VoiceLang;
  onClose: () => void;
  onSubmit: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({ ...emptyVisionModel, voiceLang: defaultVoice });
  const [key, setKey] = useState("");

  const signature = `${open}:${initial?.id ?? "new"}`;
  if (open && key !== signature) {
    setKey(signature);
    if (initial) {
      const { id: _id, createdAt: _c, ...rest } = initial;
      setDraft(rest);
    } else {
      setDraft({ ...emptyVisionModel, voiceLang: defaultVoice });
    }
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
            aria-label={initial ? "Edit vision model" : "Add vision model"}
            initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="obsidian-slab fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(96vw,980px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[16px] p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-medium tracking-tight">
                {initial ? "Edit vision model" : "Add vision model"}
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
                if (!draft.name.trim() || !draft.modelId.trim()) return;
                onSubmit({ ...draft, name: draft.name.trim(), modelId: draft.modelId.trim() });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="display name">
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Oculus Prime"
                    className={input}
                  />
                </Field>
                <Field label="model id">
                  <input
                    value={draft.modelId}
                    onChange={(e) => setDraft((d) => ({ ...d, modelId: e.target.value }))}
                    placeholder="google/gemini-3.6-flash"
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
              </div>

              <Field label="avatar">
                <AvatarPicker
                  seed={draft.avatar.seed}
                  label={draft.name || draft.modelId}
                  style={draft.avatar.style}
                  jewel={draft.avatar.jewel}
                  seeds={avatarSeedGallery}
                  onChange={(avatar) => setDraft((d) => ({ ...d, avatar }))}
                />
              </Field>

              <Field label="description">
                <input
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  placeholder="Frame-accurate scene understanding…"
                  className={input}
                />
              </Field>

              <Field label="system directive">
                <textarea
                  value={draft.systemPrompt}
                  onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
                  rows={3}
                  placeholder="You are …"
                  className={cn(input, "resize-y leading-relaxed")}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="base url">
                  <input
                    value={draft.baseUrl}
                    onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
                <Field label="api key reference">
                  <input
                    value={draft.apiKeyRef}
                    onChange={(e) => setDraft((d) => ({ ...d, apiKeyRef: e.target.value }))}
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="vendor">
                  <input
                    value={draft.vendor}
                    onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value }))}
                    className={input}
                  />
                </Field>
                <Field label="max image">
                  <input
                    value={draft.maxImage}
                    onChange={(e) => setDraft((d) => ({ ...d, maxImage: e.target.value }))}
                    placeholder="4096 × 4096"
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
                <Field label="ocr coverage">
                  <input
                    value={draft.ocr}
                    onChange={(e) => setDraft((d) => ({ ...d, ocr: e.target.value }))}
                    placeholder="latin + turkish"
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`temperature — ${draft.temperature}`}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={draft.temperature}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, temperature: Number(e.target.value) }))
                    }
                    className="w-full accent-[var(--sapphire)]"
                  />
                </Field>
                <Field label="max tokens">
                  <input
                    type="number"
                    min={64}
                    value={draft.maxTokens}
                    onChange={(e) => setDraft((d) => ({ ...d, maxTokens: Number(e.target.value) }))}
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Toggle
                  label="Video frames"
                  on={draft.video}
                  onToggle={() => setDraft((d) => ({ ...d, video: !d.video }))}
                />
                <Toggle
                  label="Voice narration"
                  on={draft.voice}
                  onToggle={() => setDraft((d) => ({ ...d, voice: !d.voice }))}
                />
                <Toggle
                  label="Enabled"
                  on={draft.enabled}
                  onToggle={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
                />
              </div>

              <Field label="voice language">
                <VoicePicker
                  value={draft.voiceLang}
                  compact
                  onChange={(voiceLang) => setDraft((d) => ({ ...d, voiceLang }))}
                />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                <JewelButton type="button" variant="outline" onClick={onClose}>
                  Cancel
                </JewelButton>
                <JewelButton type="submit">
                  {initial ? "Save changes" : "Add vision model"}
                </JewelButton>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export const Route = createFileRoute("/vision")({
  head: () => ({
    meta: [
      { title: "Vision Models — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Vision model registry: add, edit and delete vision models with OCR, video frames and Turkish/English voice narration.",
      },
      { property: "og:title", content: "Vision Models — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Register vision models with avatars, OCR coverage, video frame support and voice narration language.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VisionPage,
});
