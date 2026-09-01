import { forgeKinds, useForge, useForgeKind } from "@/lib/forge-store";
import { cn } from "@/lib/utils";

/** Header kind bar for the Forge Factory — scopes the library to one kind. */
export function ForgeKindTabs() {
  const { items } = useForge();
  const { kind, setKind } = useForgeKind();

  return (
    <div className="ml-2 hidden items-center gap-1.5 md:flex">
      <Tab active={kind === "all"} tone="sapphire" onClick={() => setKind("all")}>
        All · {items.length}
      </Tab>
      {forgeKinds.map((k) => (
        <Tab key={k.id} active={kind === k.id} tone={k.tone} onClick={() => setKind(k.id)}>
          {k.label} · {items.filter((i) => i.kind === k.id).length}
        </Tab>
      ))}
    </div>
  );
}

function Tab({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-colors duration-100 ease-out",
        active
          ? "border-white/20 bg-raised/60 text-foreground"
          : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground",
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: `var(--${tone})`, boxShadow: `0 0 8px -1px var(--${tone})` }}
      />
      {children}
    </button>
  );
}
