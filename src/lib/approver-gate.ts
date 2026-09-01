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
  canDecide: (req: { assignedTo?: string[] }) => boolean;
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

  const approverRoles = useMemo(
    () => roles.filter((r) => isSovereign(r) || roleActions(r).includes("approve")),
    [roles],
  );
  const approverNames = useMemo(
    () => new Set(approverRoles.map((r) => r.name ? r.name.toLowerCase() : "")),
    [approverRoles],
  );
  const approverGroups = useMemo(
    () => groups.filter((g) => g.defaultRole && approverNames.has(g.defaultRole.toLowerCase())),
    [groups, approverNames],
  );
  const approverAccounts = useMemo(
    () => accounts.filter((a) => a.role && approverNames.has(a.role.toLowerCase())),
    [accounts, approverNames],
  );

  const handle = account?.username ?? "operator";

  const canDecide = useCallback(
    (req: { assignedTo?: string[] }) => {
      if (!canApprove) return false;
      if (!enforced || sovereign) return true;
      const routed = req.assignedTo ?? [];
      if (!routed.length) return true; // shared pool
      return routed.some((u) => u.toLowerCase() === handle.toLowerCase());
    },
    [canApprove, enforced, sovereign, handle],
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
