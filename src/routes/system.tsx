import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ScrollText, Bug } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { AuditPanel } from "@/components/sovereign/audit-panel";
import { DebugConsole } from "@/components/sovereign/debug-console";
import { systemMeta } from "@/mocks";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/system")({
  head: () => ({
    meta: [
      { title: "Logs / Audit — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Unified audit journal and live debug console: every system and operator event, sliced by stream, severity, actor and retention window.",
      },
      { property: "og:title", content: "Logs / Audit — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "One surface for the append-only audit journal and the live debugging stream, with retention windows and CSV / NDJSON / TXT / PDF export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SystemView,
});

const views = [
  { id: "audit", label: "Audit journal", icon: ScrollText },
  { id: "debug", label: "Live debugging", icon: Bug },
] as const;

function SystemView() {
  const [view, setView] = useState<(typeof views)[number]["id"]>("audit");

  return (
    <Surface title="Logs / Audit" meta={systemMeta} full>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          {views.map((v) => {
            const active = v.id === view;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-4 py-2.5 font-mono text-[12.5px] uppercase tracking-[0.14em] transition-colors",
                  active
                    ? "border-sapphire/45 bg-sapphire/10 text-sapphire shadow-[0_0_24px_-14px_var(--sapphire)]"
                    : "border-white/[0.08] bg-black/25 text-muted-foreground/60 hover:border-white/[0.16] hover:text-foreground/80",
                )}
              >
                <v.icon className="h-4 w-4" />
                {v.label}
              </button>
            );
          })}
        </div>

        {view === "audit" ? <AuditPanel /> : <DebugConsole />}
      </div>
    </Surface>
  );
}
