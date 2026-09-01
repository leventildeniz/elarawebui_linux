import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Surface, Row } from "@/components/sovereign/surface";
import { Tag } from "@/components/sovereign/primitives";

function titleize(slug: string) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function CardDetail() {
  const { section, card } = Route.useParams();
  const router = useRouter();
  const title = `${titleize(section)} — ${card.replace(/^.*?-(\d+)$/, "$1")}`;

  return (
    <Surface title={titleize(card)} meta={`${section} · template module · ready`} wide>
      <div className="mb-8">
        <button
          type="button"
          onClick={() => router.history.back()}
          className="inline-flex items-center gap-2 font-mono text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> back to {section}
        </button>
      </div>

      <p className="max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
        Template workspace module for <span className="font-mono text-foreground/90">{title}</span>.
        Wire real data into this surface later — layout, spacing and jewel accents are final.
      </p>

      <div className="mt-10 rounded-xl border border-border/80">
        {[
          {
            id: `${section}.status`,
            label: "Module state",
            value: "nominal",
            tone: "emerald" as const,
          },
          {
            id: `${section}.owner`,
            label: "Assigned operator",
            value: "system",
            tone: "sapphire" as const,
          },
          {
            id: `${section}.revision`,
            label: "Template revision",
            value: "v1.0",
            tone: "amethyst" as const,
          },
          {
            id: `${section}.updated`,
            label: "Last synchronised",
            value: "2m ago",
            tone: "topaz" as const,
          },
        ].map((p) => (
          <Row key={p.id} className="grid-cols-[minmax(0,1fr)_auto] px-6">
            <div className="min-w-0">
              <div className="truncate font-mono text-[13px] text-foreground/95">{p.id}</div>
              <div className="mt-1.5 text-[13.5px] text-muted-foreground">{p.label}</div>
            </div>
            <Tag tone={p.tone}>{p.value}</Tag>
          </Row>
        ))}
      </div>
    </Surface>
  );
}

export const Route = createFileRoute("/w/$section/$card")({
  head: () => ({
    meta: [
      { title: "Workspace Module — Elara Sovereign Studio" },
      { name: "description", content: "Template workspace module inside Elara Sovereign Studio." },
      { property: "og:title", content: "Workspace Module — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Template workspace module inside Elara Sovereign Studio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CardDetail,
});
