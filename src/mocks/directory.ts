import { fetchApi } from "../lib/api";

/**
 * Directory group catalogue — what a real AD / Entra / LDAP query would return
 * when the studio enumerates groups from an identity source. Swap
 * `fetchDirectoryGroups` for the bridge/Graph call later; the UI stays put.
 */

export type DirectoryGroup = {
  /** Distinguished name or Entra object id — the claim value we match on. */
  dn: string;
  /** Human readable group name (sAMAccountName / displayName). */
  name: string;
  /** Rough member count reported by the directory. */
  members: number;
  /** Organisational unit or scope, shown as a hint. */
  ou: string;
  /** `mail` attribute on the directory object — the group's distribution list. */
  mail?: string;
};

const AD_GROUPS: DirectoryGroup[] = [
  { dn: "CN=Domain Admins,OU=Groups,DC=corp,DC=local", name: "Domain Admins", members: 6, ou: "Groups", mail: "domain-admins@corp.local" },
  { dn: "CN=IT-Operations,OU=Groups,DC=corp,DC=local", name: "IT-Operations", members: 34, ou: "Groups", mail: "it-operations@corp.local" },
  { dn: "CN=Security-Engineering,OU=Groups,DC=corp,DC=local", name: "Security-Engineering", members: 12, ou: "Groups", mail: "security-engineering@corp.local" },
  { dn: "CN=Technical-Marketing,OU=Groups,DC=corp,DC=local", name: "Technical-Marketing", members: 21, ou: "Groups", mail: "technical-marketing@corp.local" },
  { dn: "CN=Data-Science,OU=Groups,DC=corp,DC=local", name: "Data-Science", members: 17, ou: "Groups", mail: "data-science@corp.local" },
  { dn: "CN=Finance,OU=Groups,DC=corp,DC=local", name: "Finance", members: 28, ou: "Groups", mail: "finance@corp.local" },
  { dn: "CN=Helpdesk,OU=Groups,DC=corp,DC=local", name: "Helpdesk", members: 45, ou: "Groups", mail: "helpdesk@corp.local" },
  { dn: "CN=Contractors,OU=External,DC=corp,DC=local", name: "Contractors", members: 63, ou: "External", mail: "contractors@corp.local" },
  { dn: "CN=Board,OU=Executive,DC=corp,DC=local", name: "Board", members: 9, ou: "Executive", mail: "board@corp.local" },
  { dn: "CN=All-Staff,OU=Groups,DC=corp,DC=local", name: "All-Staff", members: 412, ou: "Groups", mail: "all-staff@corp.local" },
];

const ENTRA_GROUPS: DirectoryGroup[] = [
  { dn: "3f2a1c94-platform-admins", name: "Platform Admins", members: 8, ou: "Security group", mail: "platform-admins@sovereign.onmicrosoft.com" },
  { dn: "8b41d0e7-ai-guild", name: "AI Guild", members: 26, ou: "Microsoft 365 group", mail: "ai-guild@sovereign.onmicrosoft.com" },
  { dn: "c17e5a22-product-marketing", name: "Product Marketing", members: 31, ou: "Microsoft 365 group", mail: "product-marketing@sovereign.onmicrosoft.com" },
  { dn: "d92f7b60-sre", name: "Site Reliability", members: 14, ou: "Security group", mail: "site-reliability@sovereign.onmicrosoft.com" },
  { dn: "a5c3e881-legal-compliance", name: "Legal & Compliance", members: 11, ou: "Security group", mail: "legal-compliance@sovereign.onmicrosoft.com" },
  { dn: "e60b4f13-interns", name: "Interns", members: 19, ou: "Dynamic group", mail: "interns@sovereign.onmicrosoft.com" },
  { dn: "7d18c2aa-everyone", name: "Everyone", members: 508, ou: "Dynamic group", mail: "everyone@sovereign.onmicrosoft.com" },
];

const LDAP_GROUPS: DirectoryGroup[] = [
  { dn: "cn=admins,ou=groups,dc=sovereign,dc=local", name: "admins", members: 4, ou: "ou=groups", mail: "admins@sovereign.local" },
  { dn: "cn=engineers,ou=groups,dc=sovereign,dc=local", name: "engineers", members: 38, ou: "ou=groups", mail: "engineers@sovereign.local" },
  { dn: "cn=analysts,ou=groups,dc=sovereign,dc=local", name: "analysts", members: 22, ou: "ou=groups", mail: "analysts@sovereign.local" },
  { dn: "cn=operators,ou=groups,dc=sovereign,dc=local", name: "operators", members: 16, ou: "ou=groups", mail: "operators@sovereign.local" },
  { dn: "cn=auditors,ou=groups,dc=sovereign,dc=local", name: "auditors", members: 7, ou: "ou=groups", mail: "auditors@sovereign.local" },
  { dn: "cn=guests,ou=external,dc=sovereign,dc=local", name: "guests", members: 51, ou: "ou=external", mail: "guests@sovereign.local" },
];

/** Provider kinds that expose a browsable group tree. */
export const DIRECTORY_KINDS = ["entra", "ldap"] as const;

const CATALOGUE: Record<string, DirectoryGroup[]> = {
  entra: [...ENTRA_GROUPS, ...AD_GROUPS],
  ldap: LDAP_GROUPS,
};

/**
 * Enumerate groups for an identity source. Simulates the round-trip latency of
 * a Graph / LDAP query so the UI exercises its loading state honestly.
 */
export async function fetchDirectoryGroups(kind: string): Promise<DirectoryGroup[]> {
  try {
    const res = await fetchApi(`/identity/directory/${kind}/groups`);
    if (res.ok) {
      return res.data;
    }
  } catch (e) {
    console.error(`Failed to fetch directory groups for ${kind}`, e);
  }
  // Fallback to mock catalog if API fails or is unconfigured
  await new Promise((r) => setTimeout(r, 420));
  return CATALOGUE[kind] ?? [];
}

const ALL: DirectoryGroup[] = [...ENTRA_GROUPS, ...AD_GROUPS, ...LDAP_GROUPS];

/** Resolve a directory group by distinguished name across every catalogue. */
export function directoryGroupByDn(dn: string): DirectoryGroup | undefined {
  return ALL.find((g) => g.dn === dn);
}

/** `mail` attribute of a mapped directory group, when the object carries one. */
export function directoryGroupMail(dn: string): string | undefined {
  return directoryGroupByDn(dn)?.mail;
}

/**
 * Directory principal (user object) as returned by a Graph / LDAP user query.
 * Swap `fetchDirectoryUsers` for the real bridge call later; the UI stays put.
 */
export type DirectoryUser = {
  /** Distinguished name or Entra object id — the immutable principal key. */
  dn: string;
  /** sAMAccountName / userPrincipalName prefix. */
  username: string;
  /** displayName attribute. */
  name: string;
  /** mail attribute. */
  mail: string;
  /** title / department hint shown in the browser. */
  title: string;
  /** Distinguished names of the groups this principal belongs to. */
  memberOf: string[];
  /** Directory account state — disabled principals are imported locked. */
  disabled?: boolean;
};

const AD_USERS: DirectoryUser[] = [
  { dn: "CN=Levent Ildeniz,OU=Users,DC=corp,DC=local", username: "levent.ildeniz", name: "Levent Ildeniz", mail: "levent.ildeniz@corp.local", title: "Platform Lead · IT", memberOf: ["CN=IT-Operations,OU=Groups,DC=corp,DC=local", "CN=Domain Admins,OU=Groups,DC=corp,DC=local"] },
  { dn: "CN=Mert Duran,OU=Users,DC=corp,DC=local", username: "mert.duran", name: "Mert Duran", mail: "mert.duran@corp.local", title: "Operations Engineer · IT", memberOf: ["CN=IT-Operations,OU=Groups,DC=corp,DC=local"] },
  { dn: "CN=Sara Novak,OU=Users,DC=corp,DC=local", username: "sara.novak", name: "Sara Novak", mail: "sara.novak@corp.local", title: "Security Analyst · SecEng", memberOf: ["CN=Security-Engineering,OU=Groups,DC=corp,DC=local"] },
  { dn: "CN=Deniz Arslan,OU=Users,DC=corp,DC=local", username: "deniz.arslan", name: "Deniz Arslan", mail: "deniz.arslan@corp.local", title: "Technical Marketing", memberOf: ["CN=Technical-Marketing,OU=Groups,DC=corp,DC=local"] },
  { dn: "CN=Elif Kaya,OU=Users,DC=corp,DC=local", username: "elif.kaya", name: "Elif Kaya", mail: "elif.kaya@corp.local", title: "Data Scientist", memberOf: ["CN=Data-Science,OU=Groups,DC=corp,DC=local"] },
  { dn: "CN=Tomas Reiner,OU=External,DC=corp,DC=local", username: "tomas.reiner", name: "Tomas Reiner", mail: "tomas.reiner@partner.io", title: "Contractor · Integrations", memberOf: ["CN=Contractors,OU=External,DC=corp,DC=local"], disabled: true },
  { dn: "CN=Ayse Demir,OU=Users,DC=corp,DC=local", username: "ayse.demir", name: "Ayşe Demir", mail: "ayse.demir@corp.local", title: "Helpdesk Specialist", memberOf: ["CN=Helpdesk,OU=Groups,DC=corp,DC=local"] },
  { dn: "CN=Jonas Weber,OU=Users,DC=corp,DC=local", username: "jonas.weber", name: "Jonas Weber", mail: "jonas.weber@corp.local", title: "Finance Controller", memberOf: ["CN=Finance,OU=Groups,DC=corp,DC=local"] },
];

const ENTRA_USERS: DirectoryUser[] = [
  { dn: "9a11c0de-aylin-kaya", username: "aylin.kaya", name: "Aylin Kaya", mail: "aylin.kaya@sovereign.onmicrosoft.com", title: "AI Engineer · AI Guild", memberOf: ["8b41d0e7-ai-guild", "3f2a1c94-platform-admins"] },
  { dn: "42f7bb01-jide-okafor", username: "jide.okafor", name: "Jide Okafor", mail: "jide.okafor@sovereign.onmicrosoft.com", title: "SRE · Site Reliability", memberOf: ["d92f7b60-sre"] },
  { dn: "5cc9a7f2-mara-lindqvist", username: "mara.lindqvist", name: "Mara Lindqvist", mail: "mara.lindqvist@sovereign.onmicrosoft.com", title: "Product Marketing Manager", memberOf: ["c17e5a22-product-marketing"] },
  { dn: "b7d20e45-rafael-souza", username: "rafael.souza", name: "Rafael Souza", mail: "rafael.souza@sovereign.onmicrosoft.com", title: "Compliance Counsel", memberOf: ["a5c3e881-legal-compliance"] },
  { dn: "1e8f3c60-nina-park", username: "nina.park", name: "Nina Park", mail: "nina.park@sovereign.onmicrosoft.com", title: "Intern · AI Guild", memberOf: ["e60b4f13-interns", "8b41d0e7-ai-guild"] },
];

const LDAP_USERS: DirectoryUser[] = [
  { dn: "uid=root.admin,ou=people,dc=sovereign,dc=local", username: "root.admin", name: "Root Admin", mail: "root.admin@sovereign.local", title: "Directory administrator", memberOf: ["cn=admins,ou=groups,dc=sovereign,dc=local"] },
  { dn: "uid=k.novak,ou=people,dc=sovereign,dc=local", username: "k.novak", name: "Karel Novák", mail: "k.novak@sovereign.local", title: "Backend engineer", memberOf: ["cn=engineers,ou=groups,dc=sovereign,dc=local"] },
  { dn: "uid=s.yilmaz,ou=people,dc=sovereign,dc=local", username: "s.yilmaz", name: "Selin Yılmaz", mail: "s.yilmaz@sovereign.local", title: "Data analyst", memberOf: ["cn=analysts,ou=groups,dc=sovereign,dc=local"] },
  { dn: "uid=o.baran,ou=people,dc=sovereign,dc=local", username: "o.baran", name: "Onur Baran", mail: "o.baran@sovereign.local", title: "NOC operator", memberOf: ["cn=operators,ou=groups,dc=sovereign,dc=local"] },
  { dn: "uid=g.visitor,ou=external,dc=sovereign,dc=local", username: "g.visitor", name: "Guest Visitor", mail: "g.visitor@sovereign.local", title: "External guest", memberOf: ["cn=guests,ou=external,dc=sovereign,dc=local"], disabled: true },
];

const USER_CATALOGUE: Record<string, DirectoryUser[]> = {
  entra: [...ENTRA_USERS, ...AD_USERS],
  ldap: LDAP_USERS,
};

/** Enumerate user principals for an identity source (simulated round-trip). */
export async function fetchDirectoryUsers(kind: string): Promise<DirectoryUser[]> {
  try {
    const res = await fetchApi(`/identity/directory/${kind}/users`);
    if (res.ok) {
      return res.data;
    }
  } catch (e) {
    console.error(`Failed to fetch directory users for ${kind}`, e);
  }
  // Fallback to mock catalog if API fails or is unconfigured
  await new Promise((r) => setTimeout(r, 420));
  return USER_CATALOGUE[kind] ?? [];
}
