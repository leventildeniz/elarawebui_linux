import { GraphTabs } from "./graph-tabs";
import { useChains } from "@/lib/orchestration-store";
import { canEdit as canEditOwned, useOwnerCtx } from "@/lib/ownership";

/** Header tabs for the Orchestration designer — one tab per chain. */
export function OrchestrationTabs() {
  const { chains, activeId, setActiveId, create, update, remove } = useChains();
  const ownerCtx = useOwnerCtx();

  return (
    <GraphTabs
      items={chains.map((c) => ({
        id: c.id,
        name: c.name,
        jewel: c.jewel,
        canEdit: canEditOwned(c, ownerCtx)
      }))}
      activeId={activeId}
      createLabel="New chain"
      onSelect={setActiveId}
      onRename={(id, name) => update(id, { name })}
      onRecolour={(id, jewel) => update(id, { jewel })}
      onRemove={remove}
      onCreate={() => create()}
    />
  );
}
