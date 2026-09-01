import { createFileRoute } from "@tanstack/react-router";
import { Surface } from "@/components/sovereign/surface";
import { AiProvidersPanel } from "@/components/sovereign/ai-providers-panel";

const description =
  "Provider registry with multi-provider routing, failover and vault-backed credentials.";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Settings — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <Surface title="Settings" meta="PROVIDERS · ROUTING" wide>
      <AiProvidersPanel />
    </Surface>
  );
}
