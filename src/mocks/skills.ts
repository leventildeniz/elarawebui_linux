// Isolated mock/demo data. UI + stores read from here; no placeholder data lives in components.
import type { StudioSkill } from "@/lib/skill-store";

export const emptySkill: Omit<StudioSkill, "id" | "createdAt"> = {
  name: "",
  description: "",
  instructions: "",
  squad: "Unassigned",
  icon: "Sparkles",
  jewel: "sapphire",
  type: "native",
  params: [],
  scriptPath: "",
  runtimeId: "",
  workflowId: "",
  mcpClientId: "",
  enabled: true,
  system: false,
  stats: { calls: 0, success: 100, latencyMs: 0 },
};

function skill(
  partial: Partial<StudioSkill> & Pick<StudioSkill, "id" | "name">,
): StudioSkill {
  return { ...emptySkill, createdAt: Date.now(), ...partial } as StudioSkill;
}
  export const seedSkills: StudioSkill[] = [];

export const seedSkillSquadMap: Record<string, string> = {};
