import { useState } from "react";
import { Globe, Lock, Users, Boxes, ChevronDown, Search, Plus, X } from "lucide-react";
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
      {VISIBILITY_LABELS[band] || "MINE"}
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
  searchable = true,
  onChange,
}: {
  record: Owned;
  disabled?: boolean;
  searchable?: boolean;
  onChange: (patch: Pick<Owned, "visibility" | "sharedWith">) => void;
}) {
  const { groups } = useIdentity();
  const band = visibilityOf(record);
  const shared = record.sharedWith ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const bands: Visibility[] = ["private", "shared", "workspace"];

  const availableGroups = groups.filter((g) => !shared.includes(g.id));
  const filteredGroups = availableGroups.filter((g) =>
    g.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

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
        searchable ? (
          <div className="space-y-2.5">
            {/* Searchable Group Dropdown Trigger */}
            <div className="relative">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setPickerOpen((v) => !v);
                  setSearchQuery("");
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border border-white/10 bg-raised/35 px-3 py-2 font-mono text-[11px] text-muted-foreground transition hover:border-white/20 hover:text-foreground",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Plus size={12} className="text-sapphire" />
                  <span>+ Add group to share…</span>
                </span>
                <ChevronDown
                  size={13}
                  className={cn("text-muted-foreground/60 transition-transform", pickerOpen && "rotate-180")}
                />
              </button>

              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                  <div className="obsidian-slab absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[10px] border border-border/80 bg-panel/95 shadow-xl backdrop-blur-xl">
                    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                      <Search className="size-3.5 shrink-0 text-muted-foreground/50" />
                      <input
                        autoFocus
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search groups…"
                        className="w-full bg-transparent font-mono text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground/40"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto py-1">
                      {filteredGroups.length === 0 && (
                        <p className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground/45">
                          {availableGroups.length === 0 ? "All studio groups are already added" : "No matching groups"}
                        </p>
                      )}
                      {filteredGroups.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => {
                            onChange({
                              visibility: "shared",
                              sharedWith: [...shared, g.id],
                            });
                            setPickerOpen(false);
                          }}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-raised/60 hover:text-foreground"
                        >
                          <span className="font-medium text-foreground/90">[Studio] {g.name}</span>
                          <span className="text-[10.5px] text-muted-foreground/50">
                            {g.members?.length || 0} members · {g.defaultRole || "Role"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Selected Group Badges / Chips */}
            <div className="flex flex-wrap gap-1.5">
              {shared.map((gid) => {
                const g = groups.find((x) => x.id === gid);
                const name = g ? `${g.name} (Local)` : gid;
                return (
                  <span
                    key={gid}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[color-mix(in_oklab,var(--emerald)_46%,transparent)] bg-[color-mix(in_oklab,var(--emerald)_12%,transparent)] px-2.5 py-1 font-mono text-[11px] text-foreground"
                  >
                    <span>{name}</span>
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            visibility: "shared",
                            sharedWith: shared.filter((x) => x !== gid),
                          })
                        }
                        className="text-muted-foreground transition-colors hover:text-ruby"
                        title={`Remove ${name}`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                );
              })}
              {shared.length === 0 && (
                <p className="font-mono text-[11px] text-muted-foreground/45">
                  No groups selected — search and add groups above to widen access.
                </p>
              )}
            </div>
          </div>
        ) : (
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
        )
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
        className="w-[340px] rounded-[14px] border-border bg-panel/95 p-4 backdrop-blur-xl"
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
