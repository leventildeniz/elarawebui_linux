// Tur-5 closure — Capability Registry tek mercii artık ayrı sayfa.
// System Engine'dan söküldü; sidebar RUNTIME grubunda Tools'un altında.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { CapabilityPacksCard, CapabilityRegistryCard } from "@/components/capability-registry-card";
import { useRbac } from "@/lib/rbac";
import { Layers } from "lucide-react";

export const Route = createFileRoute("/_app/capabilities")({
  component: CapabilitiesPage,
});

function CapabilitiesPage() {
  const { isAdmin } = useRbac();
  if (!isAdmin) {
    return (
      <PageShell>
        <PageHeader
          title="Capabilities"
          subtitle="Admin only — capability registry and sectoral packs"
        />
        <p className="text-xs font-mono text-muted-foreground">
          You don't have permission to view this page.
        </p>
      </PageShell>
    );
  }
  return (
    <PageShell>
      <PageHeader
        title="Capabilities"
        subtitle="Capability Registry · Sectoral Packs — single source of truth for tools + skills bound to agents"
        actions={
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <Layers className="h-3.5 w-3.5 text-primary" /> Admin
          </span>
        }
      />
      <div className="space-y-4">
        <CapabilityPacksCard />
        <CapabilityRegistryCard />
      </div>
    </PageShell>
  );
}
