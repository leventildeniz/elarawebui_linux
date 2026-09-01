import { motion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { getIcon, iconCategories, searchIcons, type IconCategory } from "@/lib/icon-library";
import {
  avatarDataUri,
  avatarStyles,
  jewelNames,
  jewelPalette,
  type AvatarStyle,
  type JewelName,
} from "@/lib/avatar-library";

/* ---------------------------------------------------------------- icons -- */

export function EntityIcon({
  name,
  jewel = "sapphire",
  size = 40,
  className,
  variant = "tile",
}: {
  name: string;
  jewel?: JewelName;
  size?: number;
  className?: string;
  variant?: "tile" | "bare";
}) {
  const Icon = getIcon(name);
  const tone = jewelPalette[jewel];
  if (variant === "bare") {
    return (
      <Icon size={size * 0.55} strokeWidth={1.6} style={{ color: tone.to }} className={className} />
    );
  }
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-[10px] border", className)}
      style={{
        width: size,
        height: size,
        borderColor: `${tone.to}38`,
        background: `linear-gradient(140deg, ${tone.from}22, ${tone.to}12)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,.06), 0 0 18px -8px ${tone.to}`,
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.6} style={{ color: tone.to }} />
    </span>
  );
}

/* -------------------------------------------------------------- avatars -- */

export function EntityAvatar({
  seed = "",
  label,
  style = "sigil",
  jewel,
  size = 40,
  className,
}: {
  seed?: string;
  label?: string | undefined;
  style?: AvatarStyle | undefined;
  jewel?: JewelName | undefined;
  size?: number | undefined;
  className?: string | undefined;
}) {
  const safeSeed = typeof seed === "string" ? seed : "";
  const src = useMemo(
    () => avatarDataUri(safeSeed, { style, jewel, label: label ?? safeSeed, size }),
    [safeSeed, style, jewel, label, size],
  );
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={`${label ?? seed} avatar`}
      loading="lazy"
      className={cn("rounded-[10px]", className)}
      style={{ width: size, height: size }}
    />
  );
}

/* -------------------------------------------------------------- pickers -- */

export function JewelSwatches({
  value,
  onChange,
  className,
}: {
  value: JewelName;
  onChange: (jewel: JewelName) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {jewelNames.map((j) => (
        <button
          key={j}
          type="button"
          onClick={() => onChange(j)}
          title={j}
          className="size-6 rounded-full border transition-transform duration-200 ease-in-out hover:scale-105"
          style={{
            background: `linear-gradient(140deg, ${jewelPalette[j].from}, ${jewelPalette[j].to})`,
            borderColor: value === j ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.14)",
            boxShadow: value === j ? `0 0 14px -3px ${jewelPalette[j].to}` : "none",
          }}
        />
      ))}
    </div>
  );
}

/** Heavy grid — memoized so typing elsewhere in a modal never re-renders 270+ cells. */
const IconGrid = memo(function IconGrid({
  results,
  value,
  jewel,
  height,
  onPick,
}: {
  results: ReturnType<typeof searchIcons>;
  value?: string | undefined;
  jewel: JewelName;
  height: number;
  onPick: (name: string) => void;
}) {
  return (
    <div
      className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5 overflow-y-auto pr-1"
      style={{ maxHeight: height }}
    >
      {results.map(({ name, Icon }) => (
        <button
          key={name}
          type="button"
          title={name}
          onClick={() => onPick(name)}
          className={cn(
            "flex aspect-square items-center justify-center rounded-lg border transition-transform duration-150 ease-out hover:scale-105",
            value === name
              ? "border-white/25 bg-white/[0.07]"
              : "border-white/[0.05] hover:border-white/15 hover:bg-white/[0.04]",
          )}
        >
          <Icon
            size={18}
            strokeWidth={1.6}
            style={{ color: value === name ? jewelPalette[jewel].to : undefined }}
            className={value === name ? undefined : "text-muted-foreground"}
          />
        </button>
      ))}
    </div>
  );
});

export function IconPicker({
  value,
  jewel = "sapphire",
  onSelect,
  className,
  height = 300,
}: {
  value?: string;
  jewel?: JewelName;
  onSelect: (name: string) => void;
  className?: string;
  height?: number;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IconCategory | "all">("all");
  const results = useMemo(() => searchIcons(query, category), [query, category]);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);
  const onPick = useCallback((name: string) => selectRef.current(name), []);

  return (
    <div className={cn("glass rounded-xl border border-white/[0.07] p-3", className)}>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3">
        <Search size={15} className="text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons…"
          className="h-9 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <span className="font-mono text-[11px] text-muted-foreground">{results.length}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["all", ...iconCategories.map((c) => c.id)] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setCategory(id as IconCategory | "all")}
            className={cn(
              "rounded-md border px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider transition-colors duration-200 ease-in-out",
              category === id
                ? "border-white/20 bg-white/[0.06] text-foreground"
                : "border-white/[0.06] text-muted-foreground hover:text-foreground",
            )}
          >
            {id}
          </button>
        ))}
      </div>

      <IconGrid results={results} value={value} jewel={jewel} height={height} onPick={onPick} />
    </div>
  );
}

export function AvatarPicker({
  seed,
  label,
  style,
  jewel,
  onChange,
  className,
  seeds,
}: {
  seed: string;
  label?: string | undefined;
  style: AvatarStyle;
  jewel: JewelName;
  onChange: (next: { seed: string; style: AvatarStyle; jewel: JewelName }) => void;
  className?: string;
  seeds: string[];
}) {
  return (
    <div className={cn("glass rounded-xl border border-white/[0.07] p-4", className)}>
      <div className="flex items-center gap-4">
        <EntityAvatar seed={seed} label={label} style={style} jewel={jewel} size={64} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[12px] text-muted-foreground">{seed}</div>
          <JewelSwatches
            value={jewel}
            onChange={(j) => onChange({ seed, style, jewel: j })}
            className="mt-2"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {avatarStyles.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.hint}
            onClick={() => onChange({ seed, style: s.id, jewel })}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider transition-colors duration-200 ease-in-out",
              style === s.id
                ? "border-white/20 bg-white/[0.06] text-foreground"
                : "border-white/[0.06] text-muted-foreground hover:text-foreground",
            )}
          >
            {style === s.id ? <Check size={11} /> : null}
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-2">
        {seeds.map((s) => (
          <motion.button
            key={s}
            type="button"
            title={s}
            whileHover={{ scale: 1.05 }}
            transition={{ duration: 0.16, ease: "easeInOut" }}
            onClick={() => onChange({ seed: s, style, jewel })}
            className={cn(
              "rounded-lg border p-1",
              seed === s
                ? "border-white/25 bg-white/[0.06]"
                : "border-white/[0.05] hover:border-white/15",
            )}
          >
            <EntityAvatar
              seed={s}
              label={s}
              style={style}
              jewel={jewel}
              size={40}
              className="mx-auto"
            />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
