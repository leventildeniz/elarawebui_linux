import { useEffect, useState } from "react";
import type { JewelTone } from "@/lib/rbac-store";
import type { AvatarStyle, JewelName } from "@/lib/avatar-library";
import { readTemplates } from "@/lib/user-template-store";

export type AccountStatus = "active" | "suspended" | "invited";

export type Account = {
  id: string;
  username: string;
  name: string;
  email: string;
  /** Role actually assigned to the principal. */
  role: string;
  provider: string;
  status: AccountStatus;
  lastSeen: string;
  /** Default template id applied to this principal ("" = inherit from group). */
  template?: string;
  /** Avatar picked from the studio avatar library. */
  avatarStyle?: AvatarStyle;
  avatarJewel?: JewelName;
  avatarSeed?: string;
  /** Account expiry (ISO yyyy-mm-dd, "" = never expires). */
  validUntil?: string;
  /** Admin lock — blocks sign-in without deleting the principal. */
  locked?: boolean;
  /** ISO timestamp of the last credential rotation. */
  passwordChangedAt?: string;
};

export type Group = {
  id: string;
  name: string;
  provider: string;
  /** Role every member of this group inherits. */
  defaultRole: string;
  /** User model template id applied to members ("" = none). */
  defaultTemplate: string;
  description: string;
  members: string[];
  tone: JewelTone;
  /**
   * Accounts that clear approval requests raised by this group's members.
   * Empty → requests fall back to the shared pool (any principal holding the
   * `approve` verb). This is the delegation chain: marketing requests go to
   * marketing's approver, technical-service requests to Ahmet's manager.
   */
  approvers?: string[];
  /**
   * Directory groups (AD / Entra / LDAP distinguished names) acting as
   * approvers. Everyone landing from the directory carrying one of these
   * claims may clear this group's requests, and the group's `mail` attribute
   * receives the notice.
   */
  approverDirectoryGroups?: string[];
  /**
   * Directory groups (AD / Entra / LDAP distinguished names) mapped onto this
   * studio group. Everyone landing from the identity source carrying one of
   * these claims inherits this group's role and template.
   */
  directoryGroups?: string[];
};



const TONES: JewelTone[] = ["sapphire", "emerald", "amethyst", "topaz", "ruby"];

export const defaultAccounts: Account[] = [];

export const defaultGroups: Group[] = [];

import { fetchApi } from "@/lib/api";

const G_KEY = "sovereign:identity:groups:v1";
const A_KEY = "sovereign:identity:accounts:v1";
const EVENT = "sovereign:identity";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Non-hook read of the persisted group roster (SSR safe). */
export function readGroups(): Group[] {
  return read(G_KEY, defaultGroups);
}

/** Non-hook read of the persisted account roster (SSR safe). */
export function readAccounts(): Account[] {
  return read(A_KEY, defaultAccounts);
}

/**
 * Effective RBAC role for a principal. Precedence:
 *   1. "Bound RBAC Roles" on the template assigned to the account
 *   2. the same grant on the template inherited from the account's group
 *   3. the group's default role
 *   4. the role provisioned directly on the account
 * Without this the template's role grant would be decorative — a template
 * could promise a role and sign-in would still bind the provisioned one.
 */
export function resolveEffectiveRole(account: Account): string {
  const groups = readGroups();
  const group = groups.find((g) => g.members.includes(account.id));
  const templateId = account.template || group?.defaultTemplate || "";
  if (templateId) {
    const tpl = readTemplates().find((t) => t.id === templateId);
    const bound = tpl?.grants?.roles?.[0];
    if (bound) return bound;
  }
  if (!account.role && group?.defaultRole) return group.defaultRole;
  return account.role || group?.defaultRole || "";
}

/**
 * Principals that may clear a group's requests: the accounts named directly on
 * the group, plus every account inheriting one of the approver directory
 * groups through a studio group that maps the same claim.
 */
export function approverPrincipals(group: Group): string[] {
  const accounts = readAccounts();
  const direct = (group.approvers ?? [])
    .map((id) => accounts.find((a) => a.id === id)?.username)
    .filter((u): u is string => Boolean(u));

  const claims = group.approverDirectoryGroups ?? [];
  const viaDirectory = claims.length
    ? readGroups()
        .filter((g) => (g.directoryGroups ?? []).some((dn) => claims.includes(dn)))
        .flatMap((g) => g.members)
        .map((id) => accounts.find((a) => a.id === id)?.username)
        .filter((u): u is string => Boolean(u))
    : [];

  return Array.from(new Set([...direct, ...viaDirectory]));
}

/** Resolve the signed-in principal from the session username. */

export function currentAccount(): Account | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const userRaw = window.localStorage.getItem("sovereign.user");
    if (userRaw) {
      const user = JSON.parse(userRaw);
      return {
        id: user.id || "usr.unknown",
        username: user.username,
        name: user.name || user.username, // Use actual name from backend
        email: user.email || "",
        role: user.role,
        provider: user.provider,
        status: user.status || "active",
        lastSeen: "—",
        template: user.templateId || "",
        validUntil: user.validUntil || "",
        avatarStyle: user.avatarUrl || "sigil",
        avatarJewel: "sapphire",
      } as Account;
    }
  } catch {}

  return undefined;
}

export function useIdentity() {
  const [groups, setGroups] = useState<Group[]>(defaultGroups);
  const [accounts, setAccounts] = useState<Account[]>(defaultAccounts);

  useEffect(() => {
    // 1. Sayfa ilk açıldığında gerçek veritabanından (API) verileri 1 kez çek.
    const fetchInitial = async () => {
      try {
        const usersData = await fetchApi("/api/identity/users");
        const mappedAccounts: Account[] = usersData.map((u: any) => ({
          id: u.id,
          username: u.username,
          name: u.name || u.username,
          email: u.email || "",
          role: u.role,
          provider: u.provider,
          status: u.status,
          lastSeen: "—",
          template: u.templateId || "",
          avatarStyle: u.avatarStyle || "sigil",
          avatarJewel: u.avatarJewel || "sapphire",
          avatarSeed: u.avatarSeed || "",
          validUntil: u.validUntil || "",
          locked: u.locked || false,
          passwordChangedAt: u.passwordChangedAt,
        }));
        const finalAccounts = mappedAccounts.length ? mappedAccounts : defaultAccounts;
        setAccounts(finalAccounts);
        window.localStorage.setItem(A_KEY, JSON.stringify(finalAccounts));
      } catch (err) {
        console.error("Failed to fetch accounts from DB", err);
      }

      try {
        const groupsData = await fetchApi("/api/identity/groups");
        const mappedGroups: Group[] = groupsData.map((g: any) => ({
          id: g.id,
          name: g.name,
          provider: g.provider,
          defaultRole: g.defaultRole,
          defaultTemplate: g.defaultTemplate || "",
          description: g.description || "",
          members: g.members || [],
          tone: g.tone || "sapphire",
          approvers: g.approvers || [],
          directoryGroups: g.directoryGroups || [],
          approverDirectoryGroups: g.approverDirectoryGroups || [],
        }));
        const finalGroups = mappedGroups.length ? mappedGroups : defaultGroups;
        setGroups(finalGroups);
        window.localStorage.setItem(G_KEY, JSON.stringify(finalGroups));
      } catch (err) {
        console.error("Failed to fetch groups", err);
      }
    };

    fetchInitial();

    // 2. Olay (EVENT) geldiğinde API'ye gitme, sadece güncel localStorage'dan oku!
    const syncLocal = () => {
      setGroups(read(G_KEY, defaultGroups));
      setAccounts(read(A_KEY, defaultAccounts));
    };

    window.addEventListener(EVENT, syncLocal);
    window.addEventListener("storage", syncLocal);

    return () => {
      window.removeEventListener(EVENT, syncLocal);
      window.removeEventListener("storage", syncLocal);
    };
  }, []);

  const commitGroups = (next: Group[]) => {
    setGroups(next);
    write(G_KEY, next);
  };

  const commitAccounts = (next: Account[]) => {
    setAccounts(next);
    write(A_KEY, next);
  };

  const addGroup = async () => {
    const id = `grp.${Math.random().toString(36).slice(2, 7)}`;
    const group: Group = {
      id,
      name: "New group",
      provider: "Local",
      defaultRole: "Viewer",
      defaultTemplate: "",
      description: "",
      members: [],
      approvers: [],
      directoryGroups: [],
      approverDirectoryGroups: [],
      tone: TONES[groups.length % TONES.length]!,
    };

    setGroups(prev => {
      const next = [...prev, group];
      write(G_KEY, next);
      return next;
    });

    try {
      await fetchApi("/api/identity/groups", {
        method: "POST",
        body: JSON.stringify(group)
      });
    } catch (err) {
      console.error("Failed to create group", err);
    }
    return id;
  };

  const updateGroup = async (id: string, patch: Partial<Group>) => {
    // Optimistic update - without dispatching global EVENT on every keystroke
    setGroups(prev => {
      const next = prev.map((g) => (g.id === id ? { ...g, ...patch } : g));
      window.localStorage.setItem(G_KEY, JSON.stringify(next));
      return next;
    });
    try {
      await fetchApi(`/api/identity/groups/${id}`, {
        method: "PUT",
        body: JSON.stringify(patch)
      });
    } catch (err) {
      console.error("Failed to update group", err);
    }
  };

  const removeGroup = async (id: string) => {
    try {
      await fetchApi(`/api/identity/groups/${id}`, { method: "DELETE" });
      setGroups(prev => {
        const next = prev.filter((g) => g.id !== id);
        write(G_KEY, next);
        return next;
      });
    } catch (err) {
      console.error("Failed to delete group", err);
    }
  };

  const toggleMember = async (id: string, userId: string) => {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    const isMember = g.members.includes(userId);
    const newMembers = isMember ? g.members.filter((m) => m !== userId) : [...g.members, userId];
    await updateGroup(id, { members: newMembers });
  };

  const toggleApprover = async (id: string, userId: string) => {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    const current = g.approvers ?? [];
    const newApprovers = current.includes(userId) ? current.filter((m) => m !== userId) : [...current, userId];
    await updateGroup(id, { approvers: newApprovers });
  };

  const toggleApproverGroup = async (id: string, dn: string) => {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    const current = g.approverDirectoryGroups ?? [];
    const newApprovers = current.includes(dn) ? current.filter((d) => d !== dn) : [...current, dn];
    await updateGroup(id, { approverDirectoryGroups: newApprovers });
  };

  const updateAccount = async (id: string, patch: Partial<Account>) => {
    // Optimistic update - without dispatching global EVENT on every keystroke
    setAccounts(prev => {
      const next = prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
      window.localStorage.setItem(A_KEY, JSON.stringify(next));
      return next;
    });
    try {
      // Map UI names back to backend names if necessary
      const payload: any = { ...patch };
      if (patch.template !== undefined) payload.templateId = patch.template;
      
      await fetchApi(`/api/identity/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error("Failed to update account", err);
    }
  };

  const addAccount = async (seed?: Partial<Account>) => {
    try {
      const payload = {
        username: seed?.username || `operator-${Math.random().toString(36).slice(2, 6)}`,
        email: seed?.email || "",
        role: seed?.role || "Viewer",
        provider: seed?.provider || "local",
        status: seed?.status || "invited"
      };
      
      const newUser = await fetchApi("/api/identity/users", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      
      const mappedAccount: Account = {
        id: newUser.id,
        username: newUser.username,
        name: newUser.username,
        email: newUser.email,
        role: newUser.role,
        provider: newUser.provider,
        status: newUser.status,
        lastSeen: "—",
        template: newUser.templateId || "",
        avatarStyle: "sigil",
        avatarJewel: "sapphire"
      };

      setAccounts(prev => {
        const exists = prev.some(a => a.id === mappedAccount.id);
        if (exists) return prev;
        const next = [...prev, mappedAccount];
        write(A_KEY, next);
        return next;
      });
      return mappedAccount.id;
    } catch (err) {
      console.error("Failed to add account", err);
      throw err;
    }
  };


  const groupsOf = (userId: string) => groups.filter((g) => g.members.includes(userId));

  /** Role the group model expects for a principal — first matching group wins. */
  const expectedRole = (userId: string) => groupsOf(userId)[0]?.defaultRole ?? "Viewer";

  const removeAccount = async (id: string) => {
    try {
      await fetchApi(`/api/identity/users/${id}`, { method: "DELETE" });
      setAccounts(prev => {
        const next = prev.filter((a) => a.id !== id);
        write(A_KEY, next);
        return next;
      });

      const stripped = groups.map((g) =>
        g.members.includes(id) ? { ...g, members: g.members.filter((m) => m !== id) } : g,
      );
      if (stripped.some((g, i) => g !== groups[i])) commitGroups(stripped);
    } catch (err) {
      console.error("Failed to remove account", err);
    }
  };

  return {
    groups,
    accounts,
    addGroup,
    updateGroup,
    removeGroup,
    toggleMember,
    toggleApprover,
    toggleApproverGroup,
    updateAccount,
    addAccount,
    removeAccount,
    groupsOf,
    expectedRole,
  };
}
