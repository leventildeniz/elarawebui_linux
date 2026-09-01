import { GraphTabs } from "./graph-tabs";
import { useWorkflows } from "@/lib/workflow-store";

/** Header tabs for the Workflow Designer — one tab per workflow. */
export function WorkflowTabs() {
  const { workflows, activeId, setActiveId, create, update, remove } = useWorkflows();
  return (
    <GraphTabs
      items={workflows.map((w) => ({ id: w.id, name: w.name, jewel: w.jewel }))}
      activeId={activeId}
      createLabel="New workflow"
      onSelect={setActiveId}
      onRename={(id, name) => update(id, { name })}
      onRecolour={(id, jewel) => update(id, { jewel })}
      onRemove={remove}
      onCreate={() => create()}
    />
  );
}
