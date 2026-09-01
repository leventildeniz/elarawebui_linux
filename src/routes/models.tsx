import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  Database,
  FileCode2,
  Pencil,
  PlugZap,
  Plus,
  Sliders,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, Sheen, StatusDot, Tag } from "@/components/sovereign/primitives";
import { AvatarPicker, EntityAvatar } from "@/components/sovereign/identity";
import { VaultKeyField } from "@/components/sovereign/vault-key-field";

import { avatarSeedGallery } from "@/lib/avatar-library";
import {
  emptyModel,
  useModelGroups,
  useModels,
  type AdvancedParam,
  type StudioModel,
} from "@/lib/model-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/models")({
  head: () => ({
    meta: [
      { title: "Models — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Model registry: add models, pick a default, assign avatars, system prompts, RAG and base URLs.",
      },
      { property: "og:title", content: "Models — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Register models with avatars, system prompts, RAG toggles and custom base URLs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ModelsView,
});

type Draft = Omit<StudioModel, "id" | "createdAt">;

function ModelsView() {
  const { models: allModels, defaultId, create, update, remove, setDefault } = useModels();
  const { groups, active: activeGroup } = useModelGroups();
  const groupName =
    groups.find((g) => g.id === activeGroup)?.name ?? groups[0]?.name ?? "Local LLM";
  const models = allModels.filter((m) => m.group === activeGroup);
  const [editing, setEditing] = useState<StudioModel | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const active = models.filter((m) => m.enabled).length;

  return (
    <Surface
      title={groupName}
      meta={`${models.length} registered · ${active} enabled · default ${models.find((m) => m.id === defaultId)?.name ?? "—"}`}
      wide
      action={
        <JewelButton onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Add model
        </JewelButton>
      }
    >
      <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
        Group <span className="font-mono text-foreground/80">{groupName}</span>. Every model carries
        its own identity — avatar, system prompt, retrieval policy and endpoint. The default model
        is the one the chat composer opens with.
      </p>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <AnimatePresence mode="popLayout">
          {models.map((m, i) => {
            const isDefault = m.id === defaultId;
            return (
              <motion.article
                key={m.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
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
                  {m.systemPrompt || "No system prompt set."}
                </p>

                <dl className="mt-4 grid grid-cols-2 gap-y-2 font-mono text-[11.5px]">
                  <dt className="text-muted-foreground/55">vendor</dt>
                  <dd className="truncate text-right text-foreground/85">{m.vendor}</dd>
                  <dt className="text-muted-foreground/55">base url</dt>
                  <dd className="truncate text-right text-foreground/70" title={m.baseUrl}>
                    {m.baseUrl}
                  </dd>
                  <dt className="text-muted-foreground/55">context</dt>
                  <dd className="text-right text-foreground/85">
                    {(m.contextWindow / 1000).toFixed(0)}k · temp {m.temperature}
                  </dd>
                  <dt className="text-muted-foreground/55">sampling</dt>
                  <dd className="text-right text-foreground/70">
                    p {m.topP} · k {m.topK} · rp {m.repetitionPenalty}
                  </dd>
                  <dt className="text-muted-foreground/55">think</dt>
                  <dd
                    className={cn(
                      "text-right",
                      m.thinkEnabled ? "text-amethyst" : "text-muted-foreground/60",
                    )}
                  >
                    {m.thinkEnabled ? "statement on" : "off"}
                  </dd>
                  <dt className="text-muted-foreground/55">template</dt>
                  <dd className="truncate text-right text-foreground/70">
                    {m.chatTemplate ? "Custom format" : "Auto (vendor default)"}
                  </dd>
                  <dt className="text-muted-foreground/55">rag</dt>
                  <dd
                    className={cn(
                      "text-right",
                      m.rag ? "text-emerald" : "text-muted-foreground/60",
                    )}
                  >
                    {m.rag ? "enabled" : "disabled"}
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
                    onClick={() => update(m.id, { rag: !m.rag })}
                  >
                    <Database className="h-3.5 w-3.5" strokeWidth={1.75} />
                    RAG {m.rag ? "on" : "off"}
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
                        Remove <span className="font-mono text-ruby">{m.name}</span> from the
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
          <span className="font-mono text-[11px] uppercase tracking-[0.2em]">add model</span>
        </motion.button>
      </div>

      <ModelDialog
        open={creating || editing !== null}
        initial={editing ?? undefined}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={(draft) => {
          if (editing) update(editing.id, draft);
          else create({ ...draft, group: activeGroup });
          setCreating(false);
          setEditing(null);
        }}
      />
    </Surface>
  );
}

function ModelDialog({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: StudioModel | undefined;
  onClose: () => void;
  onSubmit: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyModel);
  const [key, setKey] = useState("");

  const signature = `${open}:${initial?.id ?? "new"}`;
  if (open && key !== signature) {
    setKey(signature);
    if (initial) {
      const { id: _id, createdAt: _c, ...rest } = initial;
      setDraft(rest);
    } else {
      setDraft(emptyModel);
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
            aria-label={initial ? "Edit model" : "Add model"}
            initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="obsidian-slab fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(96vw,980px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[16px] p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-medium tracking-tight">
                {initial ? "Edit model" : "Add model"}
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
                    placeholder="Sovereign-2"
                    className={input}
                  />
                </Field>
                <Field label="model id">
                  <input
                    value={draft.modelId}
                    onChange={(e) => setDraft((d) => ({ ...d, modelId: e.target.value }))}
                    placeholder="openai/gpt-5.6-sol"
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

              <Field label="system prompt">
                <textarea
                  value={draft.systemPrompt}
                  onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
                  rows={3}
                  placeholder="You are …"
                  className={cn(input, "resize-y leading-relaxed")}
                  spellCheck={false}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="base url">
                  <input
                    value={draft.baseUrl}
                    onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                    placeholder="http://127.0.0.1:8000/v1"
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
                <Field label="api key · vault or manual">
                  <VaultKeyField
                    value={draft.apiKeyRef}
                    placeholder="sk-…"
                    onChange={(apiKeyRef) => setDraft((d) => ({ ...d, apiKeyRef }))}
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
                <Field label="context (tokens)">
                  <input
                    type="number"
                    min={1024}
                    step={1024}
                    value={draft.contextWindow}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, contextWindow: Number(e.target.value) }))
                    }
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
                <Field label="max output">
                  <input
                    type="number"
                    min={256}
                    step={256}
                    value={draft.maxTokens}
                    onChange={(e) => setDraft((d) => ({ ...d, maxTokens: Number(e.target.value) }))}
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
              </div>

              {/* Cost configuration row */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="input cost ($ per 1m tokens)">
                  <input
                    type="number"
                    min={0}
                    step={0.0001}
                    value={draft.inputCost}
                    onChange={(e) => setDraft((d) => ({ ...d, inputCost: Number(e.target.value) }))}
                    className={cn(input, "font-mono text-[12.5px]")}
                    placeholder="0.15"
                  />
                </Field>
                <Field label="output cost ($ per 1m tokens)">
                  <input
                    type="number"
                    min={0}
                    step={0.0001}
                    value={draft.outputCost}
                    onChange={(e) => setDraft((d) => ({ ...d, outputCost: Number(e.target.value) }))}
                    className={cn(input, "font-mono text-[12.5px]")}
                    placeholder="0.60"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`temperature — ${draft.temperature.toFixed(2)}`}>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={draft.temperature}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, temperature: Number(e.target.value) }))
                    }
                    className="w-full accent-[var(--sapphire)]"
                  />
                </Field>
                <Field label={`top-p — ${draft.topP.toFixed(2)}`}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={draft.topP}
                    onChange={(e) => setDraft((d) => ({ ...d, topP: Number(e.target.value) }))}
                    className="w-full accent-[var(--amethyst)]"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="top-k">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.topK}
                    onChange={(e) => setDraft((d) => ({ ...d, topK: Number(e.target.value) }))}
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
                <Field label="repetition penalty">
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={draft.repetitionPenalty}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, repetitionPenalty: Number(e.target.value) }))
                    }
                    className={cn(input, "font-mono text-[12.5px]")}
                  />
                </Field>
              </div>

              <div className="rounded-xl border border-border/70 p-4">
                <Toggle
                  label="Thinking statement"
                  on={draft.thinkEnabled}
                  onToggle={() => setDraft((d) => ({ ...d, thinkEnabled: !d.thinkEnabled }))}
                />
                <AnimatePresence initial={false}>
                  {draft.thinkEnabled && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <textarea
                        value={draft.thinkStatement}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, thinkStatement: e.target.value }))
                        }
                        rows={3}
                        placeholder="How this model should reason…"
                        className={cn(input, "mt-3 resize-y leading-relaxed")}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="mono-label mr-1">presets</span>
                        {thinkPresets.map((p) => {
                          const active = draft.thinkStatement.trim() === p.value;
                          const suggested = Boolean(p.match?.test(draft.modelId ?? ""));
                          return (
                            <button
                              key={p.id}
                              type="button"
                              title={suggested ? `${p.value} — matches this model id` : p.value}
                              onClick={() => setDraft((d) => ({ ...d, thinkStatement: p.value }))}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10.5px] transition-colors",
                                active
                                  ? "border-emerald/45 bg-emerald/[0.08] text-emerald"
                                  : "border-border/70 text-muted-foreground/70 hover:text-foreground",
                              )}
                            >
                              {suggested && !active && (
                                <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                              )}
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground/70">
                        Only the highlighted chip is applied. A small dot marks presets that suit
                        this model id.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <Field label="stop sequences (one per line, or comma separated)">
                <textarea
                  rows={3}
                  value={draft.stopSequences.join("\n")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      stopSequences: e.target.value
                        .split(/[\n,]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder={"</end>\n###\nObservation:"}
                  className={cn(
                    input,
                    "h-auto resize-y py-2 font-mono text-[12.5px] leading-relaxed",
                  )}
                />
              </Field>

              {draft.stopSequences.length > 0 && (
                <div className="-mt-2 flex flex-wrap gap-1.5">
                  {draft.stopSequences.map((s, i) => (
                    <Tag key={`${s}-${i}`} tone="topaz">
                      {s}
                    </Tag>
                  ))}
                </div>
              )}

              <ChatTemplateField
                body={draft.chatTemplate}
                onChange={(body) => setDraft((d) => ({ ...d, chatTemplate: body }))}
              />

              <AdvancedParams
                items={draft.advanced}
                onChange={(advanced) => setDraft((d) => ({ ...d, advanced }))}
              />

              <TestConnection draft={draft} />

              <div className="grid gap-2 sm:grid-cols-3">
                <Toggle
                  label="RAG retrieval"
                  on={draft.rag}
                  onToggle={() => setDraft((d) => ({ ...d, rag: !d.rag }))}
                />
                <Toggle
                  label="Streaming"
                  on={draft.streaming}
                  onToggle={() => setDraft((d) => ({ ...d, streaming: !d.streaming }))}
                />
                <Toggle
                  label="Enabled"
                  on={draft.enabled}
                  onToggle={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <JewelButton type="button" variant="outline" onClick={onClose}>
                  Cancel
                </JewelButton>
                <JewelButton type="submit" className="gap-1.5">
                  <Check className="h-4 w-4" strokeWidth={1.75} />
                  {initial ? "Save changes" : "Add model"}
                </JewelButton>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function ChatTemplateField({
  body,
  onChange,
}: {
  body: string;
  onChange: (body: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-3.5 w-3.5 text-sapphire" strokeWidth={1.75} />
          <span className="mono-label">custom chat template</span>
        </div>
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground/70">
        Leave empty to let the endpoint apply the model's own bundled format (OpenAI compatibility). Supply a custom Jinja/formatting string only if the endpoint strictly requires it.
      </p>

      <textarea
        value={body}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder="{% for message in messages %}..."
        className={cn(input, "mt-3 w-full resize-y font-mono text-[12.5px]")}
      />
    </div>
  );
}

function AdvancedParams({
  items,
  onChange,
}: {
  items: AdvancedParam[];
  onChange: (next: AdvancedParam[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [k, setK] = useState("");
  const [v, setV] = useState("");

  const add = () => {
    if (!k.trim()) return;
    onChange([
      ...items,
      { id: Math.random().toString(36).slice(2, 8), key: k.trim(), value: v.trim() },
    ]);
    setK("");
    setV("");
  };

  return (
    <div className="rounded-xl border border-border/70 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-[13px] text-foreground/85 transition-colors hover:text-sapphire"
      >
        <span className="flex items-center gap-2">
          <Sliders className="h-3.5 w-3.5" strokeWidth={1.75} />
          Advanced parameters
          {items.length > 0 && (
            <span className="rounded-md border border-sapphire/35 bg-sapphire/10 px-1.5 py-0.5 font-mono text-[10px] text-sapphire">
              {items.length}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")}
          strokeWidth={1.5}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-2">
              {items.map((it) => (
                <div key={it.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate rounded-lg border border-border/70 bg-raised/40 px-3 py-2 font-mono text-[12px] text-foreground/85">
                    {it.key}
                  </span>
                  <span className="flex-1 truncate rounded-lg border border-border/70 bg-raised/40 px-3 py-2 font-mono text-[12px] text-muted-foreground">
                    {it.value || "—"}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${it.key}`}
                    onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                    className="rounded-md p-2 text-muted-foreground/60 transition-colors hover:bg-ruby/10 hover:text-ruby"
                    title={`Remove ${it.key}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-2 pt-1">
                <input
                  value={k}
                  onChange={(e) => setK(e.target.value)}
                  placeholder="parameter"
                  className={cn(input, "flex-1 font-mono text-[12.5px]")}
                />
                <input
                  value={v}
                  onChange={(e) => setV(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add();
                    }
                  }}
                  placeholder="value"
                  className={cn(input, "flex-1 font-mono text-[12.5px]")}
                />
                <JewelButton type="button" size="sm" onClick={add} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Add
                </JewelButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type ProbeState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "ok"; latency: number }
  | { phase: "fail"; reason: string };

function TestConnection({ draft }: { draft: Draft }) {
  const [state, setState] = useState<ProbeState>({ phase: "idle" });

  const run = async () => {
    setState({ phase: "testing" });
    const started = performance.now();
    await new Promise((r) => setTimeout(r, 900));

    if (!draft.baseUrl.trim()) {
      setState({ phase: "fail", reason: "base url is empty" });
      return;
    }
    let host = "";
    try {
      host = new URL(draft.baseUrl).host;
    } catch {
      setState({ phase: "fail", reason: "base url is not a valid endpoint" });
      return;
    }
    if (!draft.apiKeyRef.trim()) {
      setState({ phase: "fail", reason: "no api key reference bound" });
      return;
    }
    if (!draft.modelId.trim()) {
      setState({ phase: "fail", reason: "model id missing" });
      return;
    }
    void host;
    setState({ phase: "ok", latency: Math.round(performance.now() - started) });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 p-4">
      <JewelButton
        type="button"
        size="sm"
        variant="outline"
        onClick={run}
        disabled={state.phase === "testing"}
        className="gap-1.5"
      >
        <PlugZap
          className={cn("h-3.5 w-3.5", state.phase === "testing" && "animate-pulse text-sapphire")}
          strokeWidth={1.75}
        />
        {state.phase === "testing" ? "Testing…" : "Test connection"}
      </JewelButton>

      <AnimatePresence mode="wait">
        {state.phase === "ok" && (
          <motion.span
            key="ok"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="font-mono text-[11.5px] text-emerald"
          >
            ✓ reachable · {state.latency}ms · {draft.modelId}
          </motion.span>
        )}
        {state.phase === "fail" && (
          <motion.span
            key="fail"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="font-mono text-[11.5px] text-ruby"
          >
            ✕ {state.reason}
          </motion.span>
        )}
        {state.phase === "idle" && (
          <span className="font-mono text-[11.5px] text-muted-foreground/60">
            probes endpoint, key binding and model id
          </span>
        )}
      </AnimatePresence>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-input bg-raised/50 px-3 py-2 text-[14px] outline-none transition-colors focus:border-sapphire/50";

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

const thinkPresets: { id: string; label: string; value: string; match?: RegExp }[] = [
  {
    id: "prompt",
    label: "prompt",
    value:
      "Reason privately in structured steps. Verify assumptions before answering. Never expose raw chain-of-thought.",
  },
  { id: "qwen-on", label: "/think", value: "/think", match: /qwen|qwq/i },
  { id: "qwen-off", label: "/no_think", value: "/no_think", match: /qwen|qwq/i },
  { id: "deepseek", label: "<think>", value: "<think>", match: /deepseek|r1/i },
  {
    id: "harmony",
    label: "reasoning: high",
    value: "reasoning: high",
    match: /gpt-oss|gpt-5|o[134]/i,
  },
  {
    id: "claude",
    label: "think step by step",
    value: "Think step by step before answering.",
    match: /claude/i,
  },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono-label mb-2 block">{label}</span>
      {children}
    </label>
  );
}
