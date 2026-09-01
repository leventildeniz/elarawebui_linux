// Shared color palette picker — used by Agents, Skills, Forge.
// Replaces native <input type="color"> + hex text input with a curated swatch grid.

export const COLOR_PALETTE = [
  // red → pink
  "#7f1d1d", "#b91c1c", "#ef4444", "#fb7185", "#f43f5e", "#ec4899",
  // magenta → violet
  "#d946ef", "#c026d3", "#a855f7", "#8b5cf6", "#7c3aed", "#6366f1",
  // blue → cyan
  "#1d4ed8", "#3b82f6", "#0ea5e9", "#0284c7", "#06b6d4", "#22d3ee",
  // teal → green
  "#14b8a6", "#10b981", "#16a34a", "#22c55e", "#65a30d", "#84cc16",
  // yellow → orange
  "#eab308", "#fbbf24", "#fde047", "#facc15", "#f59e0b", "#f97316",
  // orange → brown
  "#fb923c", "#ea580c", "#c2410c", "#92400e", "#78350f", "#a16207",
  // neutrals
  "#f8fafc", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#1e293b",
  // signature
  "#10b981", "#22d3ee", "#a3e635", "#ffd166", "#f472b6", "#c084fc",
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function ColorPalettePicker({ value, onChange, disabled }: Props) {
  const norm = (value || "").toLowerCase();
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {COLOR_PALETTE.map((c) => {
        const active = c.toLowerCase() === norm;
        return (
          <button
            type="button"
            key={c}
            disabled={disabled}
            onClick={() => onChange(c)}
            title={c}
            className={`h-7 w-7 rounded-full border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              active
                ? "border-foreground scale-110 ring-2 ring-primary/40"
                : "border-transparent hover:scale-110"
            }`}
            style={{ background: c }}
          />
        );
      })}
    </div>
  );
}
