import { GraphTabs } from "./graph-tabs";
import { useChains } from "@/lib/orchestration-store";

/** Header tabs for the Orchestration designer — one tab per chain. */
export function OrchestrationTabs() {
  const { chains, activeId, setActiveId, create, update, remove } = useChains();
  return (
    <GraphTabs
      items={chains.map((c) => ({ id: c.id, name: c.name, jewel: c.jewel }))}
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
