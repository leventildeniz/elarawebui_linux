import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Activity, ChevronDown, Plus, Trash2, Wifi } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, StatusDot } from "@/components/sovereign/primitives";
import { ResetButton, SaveButton } from "@/components/sovereign/action-buttons";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import {
  VaultKeyField,
  isKeyBound,
  useVault,
  vaultKeyLabel,
} from "@/components/sovereign/vault-key-field";
import {
  blankSource,
  kindTone,
  telemetryAuths,
  telemetryKinds,
  useTelemetrySources,
  type TelemetryAuth,
  type TelemetryKind,
  type TelemetrySource,
} from "@/lib/telemetry-sources-store";
import { cn } from "@/lib/utils";

const description =
  "Telemetry sources — declare where machine and AI runtime metrics are collected from: SNMP hosts, Prometheus scrapes, runtime APIs, agents, PostgreSQL and GPU exporters.";

export const Route = createFileRoute("/telemetry-sources")({
  head: () => ({
    meta: [
      { title: "Telemetry Sources — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Telemetry Sources — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TelemetrySourcesPage,
});

const fieldCls =
  "w-full rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
      {children}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.012] px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
        {label}
      </div>
      <div className={cn("mt-1.5 font-mono text-[16px] text-foreground/90", tone)}>{value}</div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        on ? "border-emerald/50 bg-emerald/25" : "border-white/[0.1] bg-black/30",
      )}
      title={label}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={cn(
          "absolute top-[2px] h-3.5 w-3.5 rounded-full",
          on
            ? "left-[18px] bg-emerald shadow-[0_0_12px_-2px_var(--emerald)]"
            : "left-[2px] bg-muted-foreground/60",
        )}
      />
    </button>
  );
}

function SourceCard({
  source,
  onPatch,
  onRemove,
  onProbe,
  probing,
  dirty,
  onSave,
  onRevert,
  defaultOpen,
}: {
  source: TelemetrySource;
  onPatch: (p: Partial<TelemetrySource>) => void;
  onRemove: () => void;
  onProbe: () => void;
  probing: boolean;
  dirty: boolean;
  onSave: () => void;
  onRevert: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const vault = useVault();
  const bound = isKeyBound(source.credentialRef, vault.items);
  const kind = telemetryKinds.find((k) => k.id === source.kind)!;
  const probeTone = !source.lastProbe ? "topaz" : source.lastProbe.ok ? "emerald" : "ruby";

  return (
    <div
      className={cn(
        "glass overflow-hidden rounded-xl border transition-colors",
        dirty ? "border-topaz/35" : "border-white/[0.07]",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150",
              open && "rotate-180",
            )}
            strokeWidth={1.8}
          />
          <StatusDot
            tone={source.enabled ? (probeTone as never) : "ruby"}
            pulse={source.enabled && probing}
          />
          <span className="truncate font-mono text-[13px] text-foreground/90">
            {source.name || "unnamed source"}
          </span>
          <span
            className={cn(
              "shrink-0 font-mono text-[10.5px] uppercase tracking-[0.16em]",
              kindTone[source.kind],
            )}
          >
            {kind.label}
          </span>
          <span className="hidden truncate font-mono text-[11.5px] text-muted-foreground/60 md:inline">
            {source.host || "—"}:{source.port} · {source.intervalSec}s
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-2">
          {dirty && (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-topaz">
              unsaved
            </span>
          )}
          <ResetButton
            onReset={onRevert}
            title={`Reset ${source.name || "this source"}?`}
            body="Unsaved edits on this collector are discarded."
          />
          <SaveButton onSave={onSave} disabled={!dirty} />
          <JewelButton size="sm" variant="outline" onClick={onProbe} disabled={probing}>
            <Wifi className="h-3.5 w-3.5" strokeWidth={1.7} />
            {probing ? "Probing" : "Probe"}
          </JewelButton>

          <Toggle
            on={source.enabled}
            onClick={() => onPatch({ enabled: !source.enabled })}
            label={`Toggle ${source.name}`}
          />
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${source.name}`}
            className="rounded-lg border border-white/[0.06] p-1.5 text-muted-foreground/60 transition-colors hover:border-ruby/40 hover:text-ruby"
            title={`Remove ${source.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
          </button>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-white/[0.06]"
          >
            <div className="grid gap-5 px-5 py-5 md:grid-cols-3">
              <label className="block">
                <Label>Source name</Label>
                <input
                  className={fieldCls}
                  value={source.name}
                  onChange={(e) => onPatch({ name: e.target.value })}
                  placeholder="model-runtime-a100"
                />
              </label>
              <label className="block">
                <Label>Collector type</Label>
                <select
                  className={fieldCls}
                  value={source.kind}
                  onChange={(e) => {
                    const k = e.target.value as TelemetryKind;
                    const preset = telemetryKinds.find((x) => x.id === k)!;
                    onPatch({
                      kind: k,
                      port: preset.defaultPort,
                      path: preset.defaultPath,
                      intervalSec: preset.defaultInterval,
                    });
                  }}
                >
                  {telemetryKinds.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label>Labels</Label>
                <input
                  className={fieldCls}
                  value={source.labels}
                  onChange={(e) => onPatch({ labels: e.target.value })}
                  placeholder="role=inference, region=eu-central"
                />
              </label>

              <label className="block">
                <Label>Host / IP</Label>
                <input
                  className={fieldCls}
                  value={source.host}
                  onChange={(e) => onPatch({ host: e.target.value })}
                  placeholder="10.20.9.32"
                />
              </label>
              <label className="block">
                <Label>Port</Label>
                <input
                  className={fieldCls}
                  value={source.port}
                  onChange={(e) => onPatch({ port: e.target.value })}
                />
              </label>
              <label className="block">
                <Label>Path / OID / relation</Label>
                <input
                  className={fieldCls}
                  value={source.path}
                  onChange={(e) => onPatch({ path: e.target.value })}
                />
              </label>

              <label className="block">
                <Label>Auth mode</Label>
                <select
                  className={fieldCls}
                  value={source.auth}
                  onChange={(e) => onPatch({ auth: e.target.value as TelemetryAuth })}
                >
                  {telemetryAuths.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="block md:col-span-2">
                <Label>
                  Credential — vault binding or manual entry
                  {source.auth !== "none" && (
                    <span
                      className={cn(
                        "ml-2 normal-case tracking-normal",
                        bound ? "text-emerald" : "text-muted-foreground/50",
                      )}
                    >
                      {vaultKeyLabel(source.credentialRef, vault.items)}
                    </span>
                  )}
                </Label>
                {source.auth === "none" ? (
                  <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-2 font-mono text-[11.5px] text-muted-foreground/50">
                    no credential required
                  </p>
                ) : (
                  <VaultKeyField
                    value={source.credentialRef}
                    onChange={(next) => onPatch({ credentialRef: next })}
                    placeholder={source.auth === "community" ? "public" : "token / password"}
                  />
                )}
              </div>

              <label className="block">
                <Label>Poll interval (s)</Label>
                <input
                  className={fieldCls}
                  value={source.intervalSec}
                  onChange={(e) =>
                    onPatch({ intervalSec: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </label>
              <label className="block">
                <Label>Timeout (s)</Label>
                <input
                  className={fieldCls}
                  value={source.timeoutSec}
                  onChange={(e) =>
                    onPatch({ timeoutSec: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </label>
              <div className="flex items-end gap-3 pb-1">
                <Toggle
                  on={source.tls}
                  onClick={() => onPatch({ tls: !source.tls })}
                  label="Toggle TLS"
                />
                <span className="font-mono text-[11.5px] text-muted-foreground/70">
                  TLS transport
                </span>
              </div>

              <p className="md:col-span-3 font-mono text-[11px] leading-relaxed text-muted-foreground/55">
                {kind.hint}
                {source.lastProbe && (
                  <>
                    {" · last probe "}
                    <span className={source.lastProbe.ok ? "text-emerald" : "text-ruby"}>
                      {source.lastProbe.ok ? "reachable" : "unreachable"}
                    </span>
                    {` · ${source.lastProbe.latencyMs}ms`}
                  </>
                )}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TelemetrySourcesPage() {
  const { sources, upsert, remove: removeStored, loading } = useTelemetrySources();
  const [draft, setDraft] = useState<TelemetrySource[]>([]);
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [probing, setProbing] = useState<string | null>(null);

  useEffect(() => {
    setDraft((prev) => {
      const kept = prev.filter((s) => dirtyIds.includes(s.id) || newIds.includes(s.id));
      const merged = sources.map((s) => kept.find((k) => k.id === s.id) ?? s);
      // Append strictly new IDs that haven't been saved yet
      const unsavedNew = kept.filter((k) => !sources.some((s) => s.id === k.id));
      return [...merged, ...unsavedNew];
    });
  }, [sources, dirtyIds, newIds]);

  const markDirty = (id: string) =>
    setDirtyIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  const clearDirty = (id: string) => setDirtyIds((prev) => prev.filter((x) => x !== id));

  const patch = (id: string, p: Partial<TelemetrySource>) => {
    setDraft((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
    markDirty(id);
  };

  const removeCard = async (s: TelemetrySource) => {
    const ok = await confirmAction({
      title: `Remove ${s.name || "this source"}?`,
      body: "The collector endpoint is deleted from the registry.",
      confirmLabel: "Remove",
      tone: "ruby",
    });
    if (!ok) return;
    setDraft((prev) => prev.filter((x) => x.id !== s.id));
    clearDirty(s.id);
    setNewIds((prev) => prev.filter((x) => x !== s.id));
    removeStored(s.id);
  };

  const add = () => {
    const fresh = blankSource();
    setDraft((prev) => [...prev, fresh]);
    setNewIds((prev) => [...prev, fresh.id]);
    markDirty(fresh.id);
  };

  const saveCard = (s: TelemetrySource) => {
    upsert(s);
    clearDirty(s.id);
    setNewIds((prev) => prev.filter((x) => x !== s.id));
  };

  const revertCard = async (s: TelemetrySource) => {
    const stored = sources.find((x) => x.id === s.id);
    const isDirty = dirtyIds.includes(s.id);
    const mode = !stored ? "discard" : isDirty ? "revert" : "clear";
    const ok = await confirmAction({
      title:
        mode === "discard"
          ? "Discard new source?"
          : mode === "revert"
            ? `Reset ${s.name || "this source"}?`
            : `Clear ${s.name || "this source"} fields?`,
      body:
        mode === "discard"
          ? "This unsaved collector card is removed."
          : mode === "revert"
            ? "Unsaved edits on this collector are discarded."
            : "Fields return to the blank collector template — save to persist.",
      confirmLabel: mode === "discard" ? "Discard" : mode === "revert" ? "Reset" : "Clear",
      tone: "ruby",
    });
    if (!ok) return;
    if (mode === "discard") {
      setDraft((prev) => prev.filter((x) => x.id !== s.id));
      setNewIds((prev) => prev.filter((x) => x !== s.id));
      clearDirty(s.id);
      return;
    }
    if (mode === "revert") {
      setDraft((prev) => prev.map((x) => (x.id === s.id ? stored! : x)));
      clearDirty(s.id);
      return;
    }
    const fresh = { ...blankSource(s.kind), id: s.id, enabled: s.enabled };
    setDraft((prev) => prev.map((x) => (x.id === s.id ? fresh : x)));
    markDirty(s.id);
  };

  const active = useMemo(() => draft.filter((s) => s.enabled).length, [draft]);
  const healthy = useMemo(() => draft.filter((s) => s.enabled && s.lastProbe?.ok).length, [draft]);

  const probe = async (s: TelemetrySource) => {
    setProbing(s.id);
    try {
      const { fetchApi } = await import("@/lib/api");
      const res = await fetchApi("/api/telemetry/probe", {
        method: "POST",
        body: JSON.stringify({
          kind: s.kind === "snmp" || s.kind === "dcgm" ? "tcp" : s.kind === "postgres" ? "tcp" : "http",
          url: s.path.startsWith("/") && s.kind !== "postgres" && s.kind !== "snmp" && s.kind !== "dcgm"
            ? `${s.tls ? "https" : "http"}://${s.host}${s.port ? `:${s.port}` : ""}${s.path}`
            : undefined,
          host: s.host,
          port: Number(s.port),
        })
      });
      patch(s.id, {
        lastProbe: { at: Date.now(), ok: res.ok, latencyMs: res.latency || 0 },
      });
      // Optionally save the source so the probe status is persisted
      if (!dirtyIds.includes(s.id) && !newIds.includes(s.id)) {
         upsert({ ...s, lastProbe: { at: Date.now(), ok: res.ok, latencyMs: res.latency || 0 } });
      }
    } catch (err) {
      patch(s.id, {
        lastProbe: { at: Date.now(), ok: false, latencyMs: 0 },
      });
    } finally {
      setProbing(null);
    }
  };

  return (
    <Surface title="Telemetry Sources" meta="COLLECTORS · ENDPOINTS" crumb="Telemetry Sources" wide>
      <div className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-4">
          <Stat label="Sources" value={String(draft.length)} />
          <Stat label="Active" value={String(active)} tone="text-emerald" />
          <Stat label="Reachable" value={`${healthy}/${active}`} tone="text-sapphire" />
          <Stat
            label="Fastest interval"
            value={`${draft.reduce((m, s) => Math.min(m, s.intervalSec), 999)}s`}
            tone="text-amethyst"
          />
        </section>

        <section className="glass rounded-xl border border-white/[0.07] px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <Activity className="h-4 w-4 text-sapphire" strokeWidth={1.6} />
            <h2 className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-foreground/80">
              Collector registry
            </h2>
            <span className="ml-auto flex items-center gap-2">
              {dirtyIds.length > 0 && (
                <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-topaz">
                  {dirtyIds.length} unsaved
                </span>
              )}
              <JewelButton size="sm" onClick={add}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                New source
              </JewelButton>
            </span>
          </div>
          <p className="mt-3 max-w-3xl font-mono text-[11.5px] leading-relaxed text-muted-foreground/70">
            The studio UI and model runtimes can live on separate machines. Declare each collector
            endpoint here — SNMP hosts, Prometheus scrapes, runtime APIs, push agents, PostgreSQL
            stats and GPU exporters — instead of hardcoding them. Each collector is saved and reset
            on its own card.
          </p>
        </section>

        <section className="space-y-3">
          {draft.length === 0 && (
            <div className="glass rounded-xl border border-dashed border-white/[0.08] px-6 py-10 text-center font-mono text-[12px] text-muted-foreground/60">
              No telemetry sources declared — dashboards fall back to simulated metrics.
            </div>
          )}
          {draft.map((s) => (
            <SourceCard
              key={s.id}
              source={s}
              probing={probing === s.id}
              dirty={dirtyIds.includes(s.id)}
              defaultOpen={newIds.includes(s.id)}
              onPatch={(p) => patch(s.id, p)}
              onRemove={() => void removeCard(s)}
              onProbe={() => probe(s)}
              onSave={() => saveCard(s)}
              onRevert={() => void revertCard(s)}
            />
          ))}
        </section>
      </div>
    </Surface>
  );
}
