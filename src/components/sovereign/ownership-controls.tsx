import { Globe, Lock, Users, Boxes } from "lucide-react";
import { useIdentity } from "@/lib/group-store";
import {
  VISIBILITY_HINTS,
  VISIBILITY_LABELS,
  VISIBILITY_TONE,
  visibilityOf,
  type Owned,
  type OwnerCtx,
  type Visibility,
} from "@/lib/ownership";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const ICONS: Record<Visibility, typeof Lock> = {
  private: Lock,
  shared: Users,
  workspace: Globe,
  system: Boxes,
};

/** Quiet chip stating who owns a record and how wide it is shared. */
export function OwnerChip({
  record,
  ctx,
  className,
}: {
  record: Owned | undefined;
  ctx: OwnerCtx;
  className?: string;
}) {
  const band = visibilityOf(record);
  const Icon = ICONS[band];
  const mine = Boolean(record?.ownerId && record.ownerId === ctx.userId);
  const tone = VISIBILITY_TONE[band];

  return (
    <span
      title={`${VISIBILITY_LABELS[band]} — ${VISIBILITY_HINTS[band]}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em]",
        className,
      )}
      style={{
        borderColor: `color-mix(in oklab, var(--${tone}) 34%, transparent)`,
        color: `color-mix(in oklab, var(--${tone}) 82%, white)`,
        background: `color-mix(in oklab, var(--${tone}) 8%, transparent)`,
      }}
    >
      <Icon className="size-3" strokeWidth={1.6} />
      {band === "system"
        ? "system"
        : mine
          ? VISIBILITY_LABELS[band]
          : record?.ownerName || VISIBILITY_LABELS[band]}
    </span>
  );
}

/**
 * Share control — the only way an authored object leaves its owner's desk.
 * Widening visibility never grants write access; the author stays the author.
 */
export function ShareControl({
  record,
  disabled,
  onChange,
}: {
  record: Owned;
  disabled?: boolean;
  onChange: (patch: Pick<Owned, "visibility" | "sharedWith">) => void;
}) {
  const { groups } = useIdentity();
  const band = visibilityOf(record);
  const shared = record.sharedWith ?? [];

  const bands: Visibility[] = ["private", "shared", "workspace"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {bands.map((b) => {
          const Icon = ICONS[b];
          const on = band === b;
          return (
            <button
              key={b}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ visibility: b, sharedWith: b === "shared" ? shared : [] })}
              title={VISIBILITY_HINTS[b]}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.16em] transition",
                on
                  ? "text-foreground"
                  : "border-white/8 text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-40",
              )}
              style={
                on
                  ? {
                      borderColor: `color-mix(in oklab, var(--${VISIBILITY_TONE[b]}) 46%, transparent)`,
                      background: `color-mix(in oklab, var(--${VISIBILITY_TONE[b]}) 12%, transparent)`,
                      boxShadow: `0 0 18px -6px color-mix(in oklab, var(--${VISIBILITY_TONE[b]}) 55%, transparent)`,
                    }
                  : undefined
              }
            >
              <Icon className="size-3" strokeWidth={1.6} />
              {VISIBILITY_LABELS[b]}
            </button>
          );
        })}
      </div>

      {band === "shared" && (
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => {
            const on = shared.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    visibility: "shared",
                    sharedWith: on ? shared.filter((x) => x !== g.id) : [...shared, g.id],
                  })
                }
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.1em] transition",
                  on
                    ? "border-[color-mix(in_oklab,var(--emerald)_46%,transparent)] bg-[color-mix(in_oklab,var(--emerald)_12%,transparent)] text-foreground"
                    : "border-white/8 text-muted-foreground hover:text-foreground",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                {g.name}
              </button>
            );
          })}
          {groups.length === 0 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              no groups in the directory
            </span>
          )}
        </div>
      )}

      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        {VISIBILITY_HINTS[band]} Sharing widens reading only — edits and deletion stay with the
        owner.
      </p>
    </div>
  );
}

/** Banner rendered above a read-only editor when the record is someone else's. */
export function ReadOnlyBanner({ reason }: { reason: string }) {
  if (!reason) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--topaz)_32%,transparent)] bg-[color-mix(in_oklab,var(--topaz)_8%,transparent)] px-3 py-2">
      <Lock className="size-3.5 text-[var(--topaz)]" strokeWidth={1.6} />
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color-mix(in_oklab,var(--topaz)_85%,white)]">
        read-only
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">{reason}</span>
    </div>
  );
}

/**
 * Compact share affordance for surfaces without a settings dialog (canvases,
 * registry cards). Renders the owner chip as the trigger and the full share
 * control in a popover. Locked when the caller is not the author.
 */
export function SharePopover({
  record,
  ctx,
  disabled,
  reason,
  onChange,
  align = "end",
}: {
  record: Owned;
  ctx: OwnerCtx;
  disabled?: boolean;
  reason?: string;
  onChange: (patch: Pick<Owned, "visibility" | "sharedWith">) => void;
  align?: "start" | "center" | "end";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={disabled ? reason || "Read-only" : "Share this object"}
          className="transition hover:opacity-85"
        >
          <OwnerChip record={record} ctx={ctx} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[300px] rounded-[14px] border-border bg-panel/95 p-4 backdrop-blur-xl"
      >
        <div className="mono-label mb-3">Visibility</div>
        {disabled && reason ? (
          <div className="mb-3">
            <ReadOnlyBanner reason={reason} />
          </div>
        ) : null}
        <ShareControl record={record} disabled={disabled ?? false} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
