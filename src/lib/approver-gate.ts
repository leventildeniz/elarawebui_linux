import { useCallback, useEffect, useMemo, useState } from "react";
import { currentAccount, useIdentity, type Account, type Group } from "./group-store";
import { emitRbac } from "./rbac-events";
import {
  isSovereign,
  readEnforcement,
  roleActions,
  useRoles,
  type Role,
  type RoleAction,
} from "./rbac-store";

/**
 * Approval authority.
 *
 * Meta-Forge and the Approval Queue are the two human-in-the-loop gates in the
 * studio. Who may clear them is not a separate list: it is the `approve` verb
 * granted in RBAC, inherited by a principal through their role (directly, or
 * via the default role of the group they belong to).
 */

const IDENTITY_EVT = "sovereign:identity";
const RBAC_EVT = "sovereign:rbac";

export type ApprovalAuthority = {
  /** Signed-in principal, resolved from the session handle. */
  account: Account | undefined;
  handle: string;
  role: Role | undefined;
  verbs: RoleAction[];
  enforced: boolean;
  sovereign: boolean;
  /** True when the principal may clear gates (or enforcement is disarmed). */
  canApprove: boolean;
  /** Roles that carry the `approve` verb. */
  approverRoles: Role[];
  /** Groups whose default role carries the `approve` verb. */
  approverGroups: Group[];
  /** Accounts bound to an approver role. */
  approverAccounts: Account[];
  /**
   * Delegation check for a single ticket: routed approvers clear their own
   * scope, sovereign roles clear everything, unrouted tickets fall to the
   * shared pool of `approve` verb holders.
   */
  canDecide: (req: { assignedTo?: string[]; requester?: string; risk?: string; requesterGroup?: string }) => boolean;
  /** Records a blocked attempt in the RBAC audit spine. */
  denied: (target: string, detail: string) => void;
};

export function useApprovalAuthority(): ApprovalAuthority {
  const { roles, active } = useRoles();
  const { groups, accounts } = useIdentity();
  const [account, setAccount] = useState<Account | undefined>(undefined);
  const [enforced, setEnforced] = useState(false);

  useEffect(() => {
    const sync = () => {
      setAccount(currentAccount());
      setEnforced(readEnforcement());
    };
    sync();
    window.addEventListener(IDENTITY_EVT, sync);
    window.addEventListener(RBAC_EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(IDENTITY_EVT, sync);
      window.removeEventListener(RBAC_EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [accounts]);

  const byName = useMemo(() => {
    if (!account) return undefined;
    const direct = roles.find((r) => r.name.toLowerCase() === account.role.toLowerCase());
    if (direct) return direct;
    // Inheritance: first group the principal belongs to decides the role.
    const group = groups.find((g) => g.members.includes(account.id));
    return group
      ? roles.find((r) => r.name.toLowerCase() === group.defaultRole.toLowerCase())
      : undefined;
  }, [account, groups, roles]);

  const role = byName ?? roles.find((r) => r.id === active) ?? roles[0];
  const verbs = roleActions(role);
  const sovereign = isSovereign(role);
  const canApprove = !enforced || sovereign || verbs.includes("approve");

  const tenantId = account?.tenantId || (account as any)?.tenant_id || "default";
  const isSuperUser = account?.role ? /^admin(istrator)?s?$/i.test(account.role.trim()) : false;

  // Identify groups the active user belongs to for departmental approval routing
  const myGroups = useMemo(() => {
    if (!account) return [];
    return groups.filter((g) => {
      const userGroupIds = Array.isArray((account as any).groups) ? (account as any).groups : [];
      return userGroupIds.includes(g.id) || g.members?.includes(account.id);
    });
  }, [account, groups]);

  const myGroupIds = useMemo(() => new Set(myGroups.map((g) => g.id)), [myGroups]);

  const approverRoles = useMemo(
    () => roles.filter((r) => isSovereign(r) || roleActions(r).includes("approve")),
    [roles],
  );

  // Scoped to the active user's actual department groups
  const approverGroups = myGroups;

  // Designated approver accounts explicitly assigned to user's department groups
  const approverAccounts = useMemo(() => {
    if (!account) return [];
    const approverUserIds = new Set<string>();

    for (const g of myGroups) {
      if (Array.isArray(g.approvers)) {
        for (const id of g.approvers) approverUserIds.add(id);
      }
      // Also include accounts mapped via approverDirectoryGroups / local approver groups
      const claims = g.approverDirectoryGroups || [];
      for (const claim of claims) {
        const targetGroup = groups.find((tg) => tg.id === claim || tg.name === claim);
        if (targetGroup?.members) {
          for (const mId of targetGroup.members) approverUserIds.add(mId);
        }
      }
    }

    return accounts.filter((a) => {
      const aTenant = (a as any).tenant_id || (a as any).tenantId || "default";
      if (aTenant !== tenantId && aTenant !== "default") return false;
      return approverUserIds.has(a.id);
    });
  }, [account, myGroups, groups, accounts, tenantId]);

  const handle = account?.username ?? "operator";

  const canDecide = useCallback(
    (req: { assignedTo?: string[]; requester?: string; risk?: string; requesterGroup?: string }) => {
      if (!canApprove) return false;
      if (!enforced || sovereign || isSuperUser) return true;

      const isTenantAdmin = role?.name?.toLowerCase() === "admin" || account?.role?.toLowerCase() === "admin";
      if (isTenantAdmin) {
        // TenantAdmin can clear any ticket in their tenant, but cannot self-approve high/critical risk
        const isSelf = req.requester ? req.requester.toLowerCase() === handle.toLowerCase() : false;
        if (isSelf && (req.risk === "high" || req.risk === "critical")) return false;
        return true;
      }

      const isRequester = req.requester ? req.requester.toLowerCase() === handle.toLowerCase() : false;
      if (isRequester) {
        // High / Critical risk requires mandatory Four-Eyes approval
        if (req.risk === "high" || req.risk === "critical") return false;
        // Low / Medium risk: check requester's group self-approval policy
        const myGroup = groups.find((g) => myGroupIds.has(g.id));
        const allowSelf = myGroup ? myGroup.selfApproval !== false && myGroup.self_approval !== false : false;
        return allowSelf;
      }

      // Caller is NOT requester:
      const routed = req.assignedTo ?? [];
      if (routed.length > 0) {
        return routed.some((u) => u.toLowerCase() === handle.toLowerCase());
      }

      // If no specific approver declared, peer review inside same group:
      if (req.requesterGroup) {
        const matchingGroup = groups.find(
          (g) => g.name.toLowerCase() === req.requesterGroup?.toLowerCase() || g.id === req.requesterGroup
        );
        if (matchingGroup) {
          const isMember = myGroupIds.has(matchingGroup.id);
          const isApprover = (matchingGroup.approvers || []).includes(account?.id || "");
          return isMember || isApprover;
        }
      }

      return false;
    },
    [canApprove, enforced, sovereign, isSuperUser, role, account, handle, groups, myGroupIds],
  );

  const denied = useCallback(
    (target: string, detail: string) => {
      emitRbac({
        action: "rbac.denied",
        role: role?.name ?? "unknown",
        target,
        actor: handle,
        detail,
      });
    },
    [handle, role],
  );

  return {
    account,
    handle,
    role,
    verbs,
    enforced,
    sovereign,
    canApprove,
    canDecide,
    approverRoles,
    approverGroups,
    approverAccounts,
    denied,
  };
}
