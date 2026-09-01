// Users & Groups store — LOCAL PostgreSQL via the sovereign bridge is the only source of truth.
import { createContext, useContext, useState, type ReactNode } from "react";
import { useChatStreamingFlag, useVisiblePoll } from "./use-visible-poll";
import type { Role } from "./auth";
import type { AuthProviderConfig } from "./auth";
import { IdentityAPI, type IdentityUserDTO, type IdentityGroupDTO } from "./api-client";

export type AccountStatus = "active" | "locked" | "disabled";

export interface Account {
  id: string;
  username: string;
  email: string;
  phone: string;
  password: string;          // plaintext only on the wire when changed; bridge re-hashes (scrypt)
  provider: AuthProviderConfig["id"];
  role: Role;
  groups: string[];
  templateId?: string;
  status: AccountStatus;
  validUntil?: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
  avatarUrl?: string;
  allowedProviders: string[];     // empty = use global routing policy / all active
  canOverrideProvider: boolean;   // false = user can't change provider in chat
  allowedModels: string[];        // empty = no model-id restriction (subject to template)
  canOverrideModel: boolean;      // false = template model restriction is binding
  allowedAgents: string[];        // empty = all agents (subject to template)
  allowedTools: string[];         // empty = all tools (subject to template)
  allowedSkills: string[];        // empty = all skills (subject to template)
}

export interface Group {
  id: string;
  name: string;
  description: string;
  role: Role;
  provider: AuthProviderConfig["id"];
  templateId?: string;
  members: string[];
}

const EMPTY_GROUPS: Group[] = [];
const EMPTY_ACCOUNTS: Account[] = [];

interface Store {
  accounts: Account[]; setAccounts: (a: Account[]) => void;
  groups: Group[];     setGroups: (g: Group[]) => void;
  refresh: () => Promise<void>;
  bridgeOnline: boolean;
  syncing: boolean;
}

function dtoToAccount(u: IdentityUserDTO): Account {
  return {
    id: u.id, username: u.username, email: u.email, phone: u.phone,
    password: "",
    provider: (u.provider as Account["provider"]) ?? "local",
    role: (u.role as Role) ?? "Viewer",
    groups: u.groups ?? [],
    templateId: u.templateId,
    status: u.status,
    validUntil: u.validUntil,
    mustChangePassword: u.mustChangePassword,
    avatarUrl: u.avatarUrl,
    allowedProviders: u.allowedProviders ?? [],
    canOverrideProvider: u.canOverrideProvider !== false,
    allowedModels: u.allowedModels ?? [],
    canOverrideModel: u.canOverrideModel !== false,
    allowedAgents: u.allowedAgents ?? [],
    allowedTools: u.allowedTools ?? [],
    allowedSkills: u.allowedSkills ?? [],
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}
function dtoToGroup(g: IdentityGroupDTO): Group {
  return {
    id: g.id, name: g.name, description: g.description,
    role: (g.role as Role) ?? "Viewer",
    provider: (g.provider as AuthProviderConfig["id"]) ?? "local",
    templateId: g.templateId,
    members: g.members ?? [],
  };
}

const Ctx = createContext<Store | null>(null);

export function UsersProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccountsState] = useState<Account[]>(EMPTY_ACCOUNTS);
  const [groups, setGroupsState]     = useState<Group[]>(EMPTY_GROUPS);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const chatStreaming = useChatStreamingFlag();

  const refresh = async () => {
    setSyncing(true);
    try {
      const [users, grps] = await Promise.all([IdentityAPI.listUsers(), IdentityAPI.listGroups()]);
      setAccountsState(users.map(dtoToAccount));
      setGroupsState(grps.map(dtoToGroup));
      setBridgeOnline(true);
    } catch {
      setAccountsState([]);
      setGroupsState([]);
      setBridgeOnline(false);
    }
    finally { setSyncing(false); }
  };

  useVisiblePoll(refresh, 15000, !chatStreaming);

  // Diff-and-sync wrappers — push every write to PostgreSQL.
  const setAccounts = (next: Account[]) => {
    const prev = accounts;
    setAccountsState(next);
    void (async () => {
      const prevById = new Map(prev.map(a => [a.id, a]));
      const nextById = new Map(next.map(a => [a.id, a]));
      let changed = false;
      for (const a of next) {
        const old = prevById.get(a.id);
        if (!old) { try { await IdentityAPI.createUser(a); changed = true; } catch (e) { console.warn("[user create]", e); } }
        else if (JSON.stringify(old) !== JSON.stringify(a)) {
          try { await IdentityAPI.updateUser(a.id, a); changed = true; } catch (e) { console.warn("[user update]", e); }
        }
      }
      for (const a of prev) {
        if (!nextById.has(a.id)) { try { await IdentityAPI.deleteUser(a.id); changed = true; } catch (e) { console.warn("[user delete]", e); } }
      }
      if (changed) await refresh();
    })();
  };

  const setGroups = (next: Group[]) => {
    const prev = groups;
    setGroupsState(next);
    void (async () => {
      const prevById = new Map(prev.map(g => [g.id, g]));
      const nextById = new Map(next.map(g => [g.id, g]));
      let changed = false;
      for (const g of next) {
        const old = prevById.get(g.id);
        if (!old || JSON.stringify(old) !== JSON.stringify(g)) {
          try { await IdentityAPI.saveGroup(g); changed = true; } catch (e) { console.warn("[group save]", e); }
        }
      }
      for (const g of prev) {
        if (!nextById.has(g.id)) { try { await IdentityAPI.deleteGroup(g.id); changed = true; } catch (e) { console.warn("[group delete]", e); } }
      }
      if (changed) await refresh();
    })();
  };

  return <Ctx.Provider value={{ accounts, setAccounts, groups, setGroups, refresh, bridgeOnline, syncing }}>{children}</Ctx.Provider>;
}

export function useUsers(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUsers outside UsersProvider");
  return v;
}
