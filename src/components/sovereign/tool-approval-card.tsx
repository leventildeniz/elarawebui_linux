import { MetaForgeApprovalCard } from "@/components/sovereign/metaforge-approval-card";

export type ToolApproval = {
  invocationId: string;
  toolName: string;
  reason: string;
  decided?: "approve" | "reject";
};

/**
 * Human gate for a high-risk tool invocation. The orchestrator halts the SSE
 * stream on `phase: "approval_required"` until this card resolves.
 */
export function ToolApprovalCard({
  approval,
  onDecision,
}: {
  approval: ToolApproval;
  onDecision: (decision: "approve" | "reject") => void;
}) {
  return (
    <MetaForgeApprovalCard
      id={`inv.${approval.invocationId.slice(0, 8)}`}
      title={`Approval required · ${approval.toolName}`}
      description={approval.reason}
      facts={[
        { label: "tool", value: approval.toolName },
        { label: "invocation", value: approval.invocationId },
        { label: "risk", value: "high" },
        { label: "stream", value: "halted" },
      ]}
      open={!approval.decided}
      onApprove={() => onDecision("approve")}
      onReject={() => onDecision("reject")}
    />
  );
}
