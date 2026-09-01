import { useEffect, useMemo, useState } from "react";
import { useForge } from "./forge-store";
import { useSkills } from "./skill-store";
import { useMcp } from "./mcp-store";
import type { PlannerKind } from "./planner-store";

/**
 * The live tool universe the planner can scope over.
 *
 * Builtin runtime tools + every definition an operator forges in the Forge
 * Factory. New tools appear here the moment they are created, so a planner's
 * allow/deny list always sees the real catalog.
 */

export type ToolSource = "builtin" | "forge" | "skill" | "mcp";

export type ToolEntry = {
  id: string;
  label: string;
  source: ToolSource;
  note?: string;
};

/** Forge display name → dotted runtime id (e.g. "PDF Splitter" → pdf.splitter). */
export function toolId(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
}

export function useToolUniverse(): ToolEntry[] {
  const { items } = useForge();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  return useMemo(() => {
    const builtin: ToolEntry[] = []; // Replaced by dynamic toolList from backend later if needed
    if (!ready) return builtin;
    const seen = new Set(builtin.map((b) => b.id));
    const forged: ToolEntry[] = [];
    items.forEach((i) => {
      const id = i.id;
      if (!id || seen.has(id)) return;
      seen.add(id);
      forged.push({ id, label: i.name, source: "forge", note: i.category || i.kind });
    });
    return [...builtin, ...forged.sort((a, b) => a.id.localeCompare(b.id))];
  }, [items, ready]);
}

/** Skills registered in the Skills Engine, as planner-scopable capabilities. */
export function useSkillUniverse(): ToolEntry[] {
  const { skills } = useSkills();
  return useMemo(
    () =>
      skills.map((s) => ({
        id: s.id,
        label: s.name,
        source: "skill" as const,
        note: s.squad,
      })),
    [skills],
  );
}

/** Registered MCP client servers, namespaced as mcp.<server>. */
export function useMcpUniverse(): ToolEntry[] {
  const { clients } = useMcp();
  return useMemo(
    () =>
      (clients ?? []).map((c) => ({
        id: `mcp.${c.id}`,
        label: c.name,
        source: "mcp" as const,
        note: `${c.transport} · ${c.tools} tools`,
      })),
    [clients],
  );
}

/** Plane-aware catalog used by the planner scope pickers. */
export function useCapabilityUniverse(kind: PlannerKind): ToolEntry[] {
  const tools = useToolUniverse();
  const skills = useSkillUniverse();
  const mcp = useMcpUniverse();
  return kind === "skill" ? skills : kind === "mcp" ? mcp : tools;
}
