import type { WorkflowDraft } from "./workflows";

/**
 * Orchestrations are graphs of *workflows* (not single skills):
 * each node is a whole pipeline, wired into the next one.
 */
export type OrchestrationPlan = WorkflowDraft;

export const orchestrationPlans: OrchestrationPlan[] = [];

/** Control nodes available between workflows. */
export const orchestrationLogic = [
  "if · condition",
  "else-if · condition",
  "else",
  "end-if",
  "switch",
  "case",
  "default-case",
  "end-switch",
  "for-each",
  "while",
  "end-loop",
  "break",
  "continue",
  "try",
  "catch",
  "finally",
  "end-try",
  "guard · assert",
];

export const orchestrationControls = [
  "branch-condition",
  "merge-artifacts",
  "fan-out",
  "await-approval",
  "delay",
  "retry-policy",
];

export const orchestrationsMeta = "2 chains · workflow-to-workflow magnetic wiring";
