import { toast } from "sonner";
import { readEnforcement } from "./rbac-store";
import { isQueueEnabled, requestApproval, type ApprovalDraft } from "./approval-store";

/**
 * Gate helper — the single code path every sensitive surface uses.
 *
 * Two switches decide the behaviour:
 *  1. Approval Queue master switch (Approval Queue page) — off by default, so a
 *     fresh studio never nags anyone. While off, gates only log.
 *  2. ENFORCEMENT ARMED (RBAC) — with the queue on, armed parks the action in
 *     the queue instead of executing it; disarmed logs and runs.
 */
export async function gateAction(draft: ApprovalDraft, run: () => void | Promise<void>): Promise<boolean> {
  const armedConfig = await isQueueEnabled();
  if (!armedConfig) {
    await run();
    return true;
  }

  const armed = readEnforcement();

  if (!armed) {
    toast.message("Gate logged · enforcement disarmed", {
      description: `${draft.title} would require approval once enforcement is armed.`,
    });
    await run();
    return true;
  }

  const ticket = await requestApproval(draft);
  toast.warning(ticket.duplicate ? "Already awaiting review" : "Parked → Approval Queue", {
    description: `${ticket.id} · ${draft.title}`,
  });
  return false;
}

/** Park an action without an executable body (informational gates). */
export async function parkForApproval(draft: ApprovalDraft) {
  const armedConfig = await isQueueEnabled();
  if (!armedConfig) {
    toast.message("Approval queue is off", {
      description: `${draft.title} ran without review — enable the queue to gate this action.`,
    });
    return { id: "—", duplicate: false };
  }
  const ticket = await requestApproval(draft);
  toast.warning(ticket.duplicate ? "Already awaiting review" : "Parked → Approval Queue", {
    description: `${ticket.id} · ${draft.title}`,
  });
  return ticket;
}
