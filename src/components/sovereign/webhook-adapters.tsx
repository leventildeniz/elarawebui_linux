import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { JewelButton, Tag } from "@/components/sovereign/primitives";
import { useWebhooks, webhookUrl } from "@/lib/webhook-store";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const label = "mono-label mb-1.5 block";

function Switch({
  checked,
  onChange,
  tone = "sapphire",
  ...rest
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  tone?: "sapphire" | "emerald";
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-[40px] shrink-0 rounded-full border transition-colors duration-200",
        checked
          ? tone === "emerald"
            ? "border-emerald/50 bg-emerald/25"
            : "border-sapphire/50 bg-sapphire/25"
          : "border-white/10 bg-raised/60",
      )}
      {...rest}
    >
      <motion.span
        animate={{ x: checked ? 19 : 2 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={cn(
          "absolute top-[2px] block h-[16px] w-[16px] rounded-full",
          checked
            ? tone === "emerald"
              ? "bg-emerald shadow-[0_0_12px_-2px_var(--emerald)]"
              : "bg-sapphire shadow-[0_0_12px_-2px_var(--sapphire)]"
            : "bg-muted-foreground/60",
        )}
      />
    </button>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h3 className="text-[14px] font-medium text-foreground">{title}</h3>
      <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-muted-foreground/70">
        {hint}
      </p>
    </div>
  );
}

function WebhookCard({ id }: { id: string }) {
  const k = useWebhooks();
  const w = k.webhooks.find((x) => x.id === id);
  const [copied, setCopied] = useState(false);
  const [draftSecret, setDraftSecret] = useState(() => {
    try {
      return JSON.parse(w?.config || "{}").secret || "";
    } catch {
      return "";
    }
  });
  const [draftUrlOverride, setDraftUrlOverride] = useState(w?.urlOverride || "");

  useEffect(() => {
    if (w) {
      try {
        setDraftSecret(JSON.parse(w.config || "{}").secret || "");
      } catch {
        setDraftSecret("");
      }
      setDraftUrlOverride(w.urlOverride);
    }
  }, [w?.config, w?.urlOverride]);

  if (!w) return null;
  const url = webhookUrl(w);
  const secret = (() => {
    try {
      return JSON.parse(w.config || "{}").secret || "";
    } catch {
      return "";
    }
  })();
  const dirty = draftSecret !== secret || draftUrlOverride !== w.urlOverride;

  const handleSave = () => {
    k.update(w.id, { config: JSON.stringify({ secret: draftSecret, urlOverride: draftUrlOverride }) });
  };

  const handleReset = async () => {
    const ok = await confirmAction({
      title: `Reset ${w.name}?`,
      body: "This will revert the secret / token and URL override to the last saved values. The adapter stays enabled unless you turn it off.",
      confirmLabel: "Reset",
      tone: "ruby",
    });
    if (!ok) return;
    try {
      setDraftSecret(JSON.parse(w.config || "{}").secret || "");
    } catch {
      setDraftSecret("");
    }
    setDraftUrlOverride(w.urlOverride);
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-raised/25 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Tag tone="platinum">{w.name}</Tag>
          <code className="truncate font-mono text-[12.5px] text-sapphire">{url}</code>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button
            type="button"
            aria-label="Copy webhook URL"
            onClick={() => {
              navigator.clipboard?.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            className="rounded-md p-1.5 text-muted-foreground/70 transition-colors hover:bg-raised hover:text-foreground"
            title="Copy webhook URL"
          >
            {copied ? <Check size={14} className="text-emerald" /> : <Copy size={14} />}
          </button>
          <Tag tone={draftSecret ? "emerald" : "topaz"}>
            {draftSecret ? "secret set" : "no secret"}
          </Tag>
          <Switch
            checked={w.enabled}
            onChange={(v) => k.update(w.id, { enabled: v })}
            aria-label={`Enable ${w.name}`}
          />
          {!w.tags?.includes("builtin") && (
            <button
              type="button"
              aria-label={`Remove ${w.name}`}
              onClick={() => k.remove(w.id)}
              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-ruby/10 hover:text-ruby"
              title={`Remove ${w.name}`}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <span className={label}>secret / token</span>
          <input
            type="password"
            className={field}
            placeholder="••••••••"
            value={draftSecret}
            onChange={(e) => setDraftSecret(e.target.value)}
          />
        </div>
        <div>
          <span className={label}>url override (optional)</span>
          <input
            className={field}
            placeholder={url}
            value={draftUrlOverride}
            onChange={(e) => setDraftUrlOverride(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <JewelButton variant="outline" size="sm" onClick={handleReset}>
          <RefreshCw size={13} /> Reset
        </JewelButton>
        <JewelButton variant="primary" size="sm" disabled={!dirty} onClick={handleSave}>
          <Check size={13} /> Save
        </JewelButton>
      </div>
    </div>
  );
}

/** Full webhook adapter configuration — lives on the Adapters page. */
export function WebhookAdaptersPanel() {
  const k = useWebhooks();
  const [newLabel, setNewLabel] = useState("");
  const builtins = k.webhooks.filter((w) => w.tags?.includes("builtin"));
  const customs = k.webhooks.filter((w) => !w.tags?.includes("builtin"));

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle
          title="Built-in adapters"
          hint="Five fixed protocols — auto-active when their secret is set in the bridge .env. You can override them locally here."
        />
        <div className="mt-4 space-y-3">
          {builtins.map((w) => (
            <WebhookCard key={w.id} id={w.id} />
          ))}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionTitle
            title="Custom subscribers"
            hint="Operator-defined webhook subscribers. They run through the Generic adapter."
          />
          <div className="flex items-center gap-2">
            <input
              className={cn(field, "w-[200px]")}
              placeholder="subscriber name"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newLabel.trim()) {
                  k.create({ name: newLabel.trim() } as any);
                  setNewLabel("");
                }
              }}
            />
            <JewelButton
              size="sm"
              disabled={!newLabel.trim()}
              onClick={() => {
                if (!newLabel.trim()) return;
                k.create({ name: newLabel.trim() } as any);
                setNewLabel("");
              }}
            >
              <Plus size={13} /> Add new
            </JewelButton>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {customs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/[0.08] px-4 py-5 text-center font-mono text-[12.5px] text-muted-foreground/70">
              No custom webhooks yet.
            </div>
          ) : (
            customs.map((w) => <WebhookCard key={w.id} id={w.id} />)
          )}
        </div>

        <p className="mt-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground/60">
          Note: this panel is a registry. The bridge .env is managed separately; new secrets are not
          honoured until the service is restarted.
        </p>
      </div>
    </div>
  );
}

/** Routing only — decides which configured adapter feeds the RAG layer. */
export function WebhookIngestRouting() {
  const k = useWebhooks();

  return (
    <div className="space-y-3">
      <p className="max-w-[620px] text-[12.5px] leading-relaxed text-muted-foreground/70">
        Adapters are configured on the Adapters page. Here you only decide which inbound channel
        writes into the knowledge index.
      </p>
      {k.webhooks.map((w) => (
        <div
          key={w.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-raised/25 px-4 py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Tag tone="platinum">{w.name}</Tag>
            <code className="truncate font-mono text-[12px] text-muted-foreground/70">
              {webhookUrl(w)}
            </code>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Tag tone={w.enabled ? "emerald" : "platinum"}>
              {w.enabled ? "adapter on" : "adapter off"}
            </Tag>
            <span className="font-mono text-[11.5px] text-muted-foreground/70">ingest → rag</span>
            <Switch
              tone="emerald"
              checked={w.ingestToRag}
              onChange={(v) => k.update(w.id, { ingestToRag: v })}
              aria-label={`Ingest ${w.name} into RAG`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
