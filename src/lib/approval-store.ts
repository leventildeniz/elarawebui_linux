import { useCallback, useEffect, useState } from "react";
import { approverPrincipals, currentAccount, readGroups } from "./group-store";
import { notifyApprovers } from "./notify-store";
import { fetchApi } from "@/lib/api";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type Risk = "low" | "medium" | "high" | "critical";

export type ApprovalOrigin =
  | "seed"
  | "policy"
  | "target"
  | "skill"
  | "adapter"
  | "data"
  | "credential"
  | "budget"
  | "isolation";

export const originLabel: Record<ApprovalOrigin, string> = {
  seed: "demo",
  policy: "policy challenge",
  target: "gated target",
  skill: "gated skill",
  adapter: "gated adapter",
  data: "destructive data op",
  credential: "credential action",
  budget: "budget override",
  isolation: "isolation escape",
};

export type ApprovalRequest = {
  id: string;
  title: string;
  requester: string;
  agent: string;
  tool: string;
  target: string;
  policy: string;
  risk: Risk;
  args: string;
  status: ApprovalStatus;
  note: string;
  createdAt: number;
  ttl: number;
  origin?: ApprovalOrigin;
  requesterGroup?: string;
  assignedTo?: string[];
  decidedAt?: number;
  decidedBy?: string;
};

const EVT = "sovereign:approvals";

function emitSwitch() {
  window.dispatchEvent(new CustomEvent(EVT));
}

let cachedRequests: ApprovalRequest[] = [];
let cachedConfig = { queue_armed: false, allow_self_approve: false };
let isFetching = false;

async function syncBackend() {
  if (isFetching) return;
  isFetching = true;
  try {
    const data = await fetchApi("/api/approvals");
    if (data?.ok) {
      cachedRequests = (data.requests || []).map((r: any) => ({
        id: r.id,
        title: r.title,
        requester: r.requester,
        requesterGroup: r.requester_group,
        agent: r.agent || "studio.console",
        tool: r.tool,
        target: r.target,
        policy: r.policy,
        risk: r.risk as Risk,
        args: r.args,
        origin: (r.origin || "seed") as ApprovalOrigin,
        status: r.status as ApprovalStatus,
        note: r.note || "",
        createdAt: new Date(r.created_at).getTime(),
        ttl: Math.round(Number(r.ttl_ms) / 60000),
        assignedTo: r.assigned_to || [],
        decidedAt: r.decided_at ? new Date(r.decided_at).getTime() : undefined,
        decidedBy: r.decided_by,
      }));

      // Lazy TTL expiry for pending items
      const now = Date.now();
      cachedRequests = cachedRequests.map((req) => {
        if (req.status === "pending") {
          const left = req.ttl - Math.round((now - req.createdAt) / 60000);
          if (left <= 0) return { ...req, status: "expired" };
        }
        return req;
      });

      cachedConfig = {
        queue_armed: !!data.config?.queue_armed,
        allow_self_approve: !!data.config?.allow_self_approve,
      };
    }
  } catch (e) {
    console.error("Failed to sync approvals", e);
  } finally {
    isFetching = false;
  }
}

export function readApprovals(): ApprovalRequest[] {
  return cachedRequests;
}

export async function isQueueEnabled(): Promise<boolean> {
  await syncBackend();
  return cachedConfig.queue_armed;
}

export const riskTone: Record<Risk, "emerald" | "sapphire" | "topaz" | "ruby"> = {
  low: "emerald",
  medium: "sapphire",
  high: "topaz",
  critical: "ruby",
};

export const statusTone: Record<ApprovalStatus, "emerald" | "topaz" | "ruby" | "amethyst"> = {
  pending: "topaz",
  approved: "emerald",
  rejected: "ruby",
  expired: "amethyst",
};

export type ApprovalDraft = {
  title: string;
  origin: ApprovalOrigin;
  tool: string;
  target: string;
  policy: string;
  risk: Risk;
  args?: string;
  requester?: string;
  agent?: string;
  ttl?: number;
};

export type ApprovalTicket = {
  id: string;
  duplicate: boolean;
};

export function routeFor(requesterId: string | undefined): {
  group: string;
  approvers: string[];
  mailTo: string[];
} {
  if (!requesterId) return { group: "", approvers: [], mailTo: [] };
  const groups = readGroups();
  const group = groups.find((g) => g.members.includes(requesterId));
  if (!group) return { group: "", approvers: [], mailTo: [] };
  const approvers = approverPrincipals(group);
  // Group tabanlı mail dizini mock'tan kurtuldu, simdilik bos ataniyor.
  // Ilerleyen fazlarda gercek Active Directory entegrasyonuna baglanacak.
  const mailTo: string[] = [];
  return { group: group.name, approvers, mailTo };
}

function fingerprint(r: { tool: string; target: string; args: string }) {
  return `${r.tool}|${r.target}|${r.args}`;
}

export async function requestApproval(draft: ApprovalDraft): Promise<ApprovalTicket> {
  await syncBackend();
  const args = draft.args ?? "{}";
  const fp = fingerprint({ tool: draft.tool, target: draft.target, args });
  const existing = cachedRequests.find(
    (r) => r.status === "pending" && fingerprint({ ...r, args: r.args }) === fp,
  );
  if (existing) {
    emitSwitch();
    return { id: existing.id, duplicate: true };
  }

  const me = currentAccount();
  const route = routeFor(me?.id);
  const payload = {
    id: `apr.${Math.random().toString(16).slice(2, 6)}`,
    title: draft.title,
    requester: draft.requester ?? currentAccount()?.username ?? "operator",
    requesterGroup: route.group,
    agent: draft.agent ?? "studio.console",
    tool: draft.tool,
    target: draft.target,
    policy: draft.policy,
    risk: draft.risk,
    args,
    origin: draft.origin,
    ttl_ms: (draft.ttl ?? 120) * 60000,
    assignedTo: route.approvers,
  };

  const res = await fetchApi("/api/approvals/request", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (res?.ok) {
    await syncBackend();
    emitSwitch();
  }

  await notifyApprovers({
    kind: "approval",
    subject: `Approval required · ${payload.title}`,
    risk: payload.risk,
    ...(route.group ? { group: route.group } : {}),
    ...(route.approvers.length ? { approvers: route.approvers } : {}),
    ...(route.mailTo.length ? { mailTo: route.mailTo } : {}),
    body: [
      `Requester : ${payload.requester}${payload.requesterGroup ? ` (${payload.requesterGroup})` : ""}`,
      `Tool      : ${payload.tool}`,
      `Target    : ${payload.target}`,
      `Risk      : ${payload.risk}`,
      `Policy    : ${payload.policy}`,
      "",
      "Open the Approval Queue to record a verdict.",
    ].join("\n"),
  });
  return { id: payload.id, duplicate: false };
}

export function usePendingApprovals() {
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  useEffect(() => {
    const sync = async () => {
      await syncBackend();
      setItems(cachedRequests.filter((r) => r.status === "pending"));
    };
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);
  return items;
}

export function useApprovals() {
  const [items, setItems] = useState<ApprovalRequest[]>([]);

  useEffect(() => {
    const sync = async () => {
      await syncBackend();
      setItems(cachedRequests);
    };
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const decide = useCallback(
    async (
      ids: string[],
      status: ApprovalStatus,
      note: string,
      by = currentAccount()?.username ?? "operator",
    ) => {
      await fetchApi("/api/approvals/decide", {
        method: "PATCH",
        body: JSON.stringify({ ids, status, note, by }),
      });
      await syncBackend();
      setItems(cachedRequests);
      emitSwitch();
    },
    [],
  );

  return { items, decide, reset: () => {} };
}

export function sinceLabel(ts: number) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 6e4));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ttlLabel(r: ApprovalRequest) {
  const left = r.ttl - Math.round((Date.now() - r.createdAt) / 6e4);
  if (left <= 0) return "expired";
  if (left < 60) return `${left}m left`;
  return `${Math.round(left / 60)}h left`;
}

export function useQueueSwitch() {
  const [enabled, setEnabled] = useState(false);
  const [selfApproval, setSelf] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = async () => {
      await syncBackend();
      setEnabled(cachedConfig.queue_armed);
      setSelf(cachedConfig.allow_self_approve);
      setReady(true);
    };
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  return {
    enabled,
    selfApproval,
    ready,
    setEnabled: useCallback(async (on: boolean) => {
      await fetchApi("/api/approvals/config", {
        method: "PATCH",
        body: JSON.stringify({ queue_armed: on }),
      });
      await syncBackend();
      setEnabled(on);
      emitSwitch();
    }, []),
    setSelfApproval: useCallback(async (on: boolean) => {
      await fetchApi("/api/approvals/config", {
        method: "PATCH",
        body: JSON.stringify({ allow_self_approve: on }),
      });
      await syncBackend();
      setSelf(on);
      emitSwitch();
    }, []),
  };
}
