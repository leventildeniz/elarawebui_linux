import { fetchApi } from "./api";

/**
 * Directory group representation returned by directory providers (LDAP / Active Directory / Entra ID).
 */
export type DirectoryGroup = {
  /** Distinguished name or Entra object ID — unique identifier claim. */
  dn: string;
  /** Human-readable group name (sAMAccountName / cn / displayName). */
  name: string;
  /** Member count reported by the directory. */
  members: number;
  /** Organizational unit or scope hint. */
  ou: string;
  /** Mail attribute on the directory object. */
  mail?: string;
};

/**
 * Directory principal (user object) returned by directory queries.
 */
export type DirectoryUser = {
  /** Distinguished name or Entra object ID. */
  dn: string;
  /** Account username (sAMAccountName / userPrincipalName prefix / uid). */
  username: string;
  /** Display name. */
  name: string;
  /** Primary email address. */
  mail: string;
  /** Job title or department. */
  title: string;
  /** Distinguished names of the groups this principal belongs to. */
  memberOf: string[];
  /** Directory account state — disabled principals are flagged. */
  disabled?: boolean;
};

/** Provider kinds that expose a browsable directory tree. */
export const DIRECTORY_KINDS = ["entra", "ldap"] as const;

/** Cache of fetched directory groups for in-memory resolution. */
let groupCache: DirectoryGroup[] = [];

/**
 * Enumerate groups from a live identity source via API.
 */
export async function fetchDirectoryGroups(kind: string): Promise<DirectoryGroup[]> {
  try {
    const res = await fetchApi<{ ok?: boolean; data?: DirectoryGroup[] } | DirectoryGroup[]>(
      `/api/identity/directory/${encodeURIComponent(kind)}/groups`
    );
    const groups: DirectoryGroup[] = Array.isArray(res)
      ? res
      : Array.isArray(res?.data)
        ? res.data
        : [];

    groupCache = groups;
    return groups;
  } catch (e) {
    console.warn(`[DirectoryClient] Failed to fetch directory groups for ${kind}:`, e);
    return [];
  }
}

/**
 * Resolve a directory group by distinguished name from the cache.
 */
export function directoryGroupByDn(dn: string): DirectoryGroup | undefined {
  return groupCache.find((g) => g.dn === dn);
}

/**
 * Resolve the email address of a directory group by distinguished name.
 */
export function directoryGroupMail(dn: string): string | undefined {
  return directoryGroupByDn(dn)?.mail;
}

/**
 * Enumerate user principals from a live identity source via API.
 */
export async function fetchDirectoryUsers(kind: string): Promise<DirectoryUser[]> {
  try {
    const res = await fetchApi<{ ok?: boolean; data?: DirectoryUser[] } | DirectoryUser[]>(
      `/api/identity/directory/${encodeURIComponent(kind)}/users`
    );
    return Array.isArray(res)
      ? res
      : Array.isArray(res?.data)
        ? res.data
        : [];
  } catch (e) {
    console.warn(`[DirectoryClient] Failed to fetch directory users for ${kind}:`, e);
    return [];
  }
}
