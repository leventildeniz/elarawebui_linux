import { createFileRoute } from "@tanstack/react-router";
import { Surface } from "@/components/sovereign/surface";
import { SiemPanel } from "@/components/sovereign/siem-panel";

const description =
  "SIEM audit forwarding — stream auth, RBAC, policy, secret and agent events to an external collector.";

export const Route = createFileRoute("/siem")({
  head: () => ({
    meta: [
      { title: "SIEM Forwarder — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "SIEM Forwarder — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SiemPage,
});

function SiemPage() {
  return (
    <Surface title="SIEM" meta="AUDIT · FORWARDER" crumb="SIEM" wide>
      <SiemPanel />
    </Surface>
  );
}
