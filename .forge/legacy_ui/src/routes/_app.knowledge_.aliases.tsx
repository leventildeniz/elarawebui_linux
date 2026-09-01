import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { BrandAliasesPanel } from "@/components/brand-aliases-panel";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/knowledge_/aliases")({
  component: BrandAliasesPage,
});

function BrandAliasesPage() {
  return (
    <PageShell>
      <PageHeader
        title="Brand Aliases"
        subtitle="Add alternate spellings, abbreviations, legacy names, or product families for a brand. Aliases are baked into each chunk's context preamble as an 'Also known as: …' line so retrieval picks them up naturally — no runtime dictionary, no regex. Edit aliases, then run Re-enrich brand to rebuild that brand's chunks."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/knowledge">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Knowledge
            </Link>
          </Button>
        }
      />
      <BrandAliasesPanel />
    </PageShell>
  );
}
