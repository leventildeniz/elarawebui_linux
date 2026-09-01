import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { applyTheme, storedThemeId, themePresets } from "@/lib/theme-store";
import { Surface } from "@/components/sovereign/surface";

const description =
  "Studio theme presets: canvas depth, raised surfaces and jewel accent tokens applied live across Elara Sovereign Studio.";

export const Route = createFileRoute("/theme")({
  head: () => ({
    meta: [
      { title: "Theme — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Theme — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ThemeRoute,
});

function ThemeRoute() {
  const [active, setActive] = useState<string>("obsidian");

  useEffect(() => {
    setActive(storedThemeId());
  }, []);

  return (
    <Surface
      title="Theme"
      meta={`${themePresets.length} PRESETS · CANVAS DEPTH · JEWEL ACCENTS`}
      wide
      crumb="Theme"
    >
      <div className="space-y-8">
        <div className="flex items-baseline gap-3">
          <h2 className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-foreground/80">
            Studio themes
          </h2>
          <span className="text-[12px] text-muted-foreground/70">
            canvas depth · jewel accents · applied live
          </span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground/60">
            {themePresets.length}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {themePresets.map((preset) => {
            const isActive = preset.id === active;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  applyTheme(preset);
                  setActive(preset.id);
                }}
                className={`glass group rounded-xl border p-5 text-left transition-colors duration-200 ease-in-out ${
                  isActive
                    ? "border-sapphire/45 bg-white/[0.03]"
                    : "border-white/[0.07] hover:border-white/20 hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-[13px] text-foreground">{preset.label}</div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {preset.hint}
                    </div>
                  </div>
                  <span
                    className={`rounded-md border px-2 py-[3px] font-mono text-[10.5px] tracking-[0.12em] ${
                      isActive
                        ? "border-emerald/45 text-emerald"
                        : "border-white/[0.08] text-muted-foreground/60"
                    }`}
                  >
                    {isActive ? "ACTIVE" : "APPLY"}
                  </span>
                </div>

                <div
                  className="mt-4 flex h-16 items-end gap-2 rounded-lg border border-white/[0.06] p-3"
                  style={{ background: preset.vars.canvas }}
                >
                  <span
                    className="h-full w-8 rounded-md"
                    style={{ background: preset.vars.canvasDeep }}
                  />
                  <span
                    className="h-full w-8 rounded-md"
                    style={{ background: preset.vars.raised }}
                  />
                  <span className="ml-auto flex items-center gap-2">
                    {(["sapphire", "emerald", "amethyst", "topaz", "ruby"] as const).map((k) => (
                      <span
                        key={k}
                        className="h-4 w-4 rounded-full"
                        style={{
                          background: preset.vars[k],
                          boxShadow: `0 0 12px -3px ${preset.vars[k]}`,
                        }}
                      />
                    ))}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <p className="max-w-[68ch] text-[12.5px] leading-relaxed text-muted-foreground">
          Themes rewrite the canvas, raised-surface and jewel accent tokens on the document root, so
          every panel, glow and monospaced data field re-tunes at once. The selection is remembered
          on this device.
        </p>
      </div>
    </Surface>
  );
}
