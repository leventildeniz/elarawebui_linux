import { useEffect, useState, useCallback } from "react";
import { fetchApi } from "@/lib/api";

export type ProviderId = "local" | "entra" | "ldap" | "radius" | "saml" | "oidc" | "oauth2";

/**
 * A single configured identity *source*. A deployment can carry as many
 * sources of the same kind as it needs — several AD forests, two RADIUS
 * clusters, one OIDC per tenant — so the kind (`id`) is no longer unique;
 * `key` is.
 */
export type ProviderConfig = {
  /** Unique instance key. */
  key: string;
  /** Provider kind. */
  id: ProviderId;
  /** Operator-facing source name (domain / cluster / tenant). */
  label: string;
  enabled: boolean;
  priority: number;
  defaultRole: string;
  fields: Record<string, string>;
};

export type ProviderSource = ProviderConfig;


export type FieldSpec = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "select";
  options?: string[];
  wide?: boolean;
};

/**
 * A provider's *live* posture — what this studio build can actually do with it.
 *
 * - `live`     — the studio authenticates against it today.
 * - `bridge`   — a wire protocol (LDAP/LDAPS, RADIUS) the studio cannot open
 *                from its own runtime; a directory bridge inside the domain
 *                network must relay it. Configuration here is real and is
 *                handed to that bridge, but no bind happens from the browser.
 * - `federated`— an HTTPS federation (SAML/OIDC/OAuth2) that needs its
 *                redirect handshake wired to a deployment before it can sign
 *                anyone in.
 */
export type ProviderPosture = "live" | "bridge" | "federated";

export const PROVIDER_SPECS: {
  id: ProviderId;
  label: string;
  tone: string;
  note?: string;
  hint?: string;
  posture: ProviderPosture;
  /** Field keys that must carry a value before the config is even complete. */
  required?: string[];
  /** Field keys that must parse as an absolute https/ldaps URL when present. */
  urlFields?: string[];
  testable: boolean;
  fields: FieldSpec[];
}[] = [
  {
    id: "local",
    label: "Local",
    tone: "sapphire",
    note: "Local username/password authentication against the studio directory. This is the only provider that signs anyone in today.",
    posture: "live",
    testable: false,
    fields: [],
  },
  {
    id: "entra",
    label: "Microsoft Entra ID",
    tone: "sapphire",
    posture: "federated",
    required: ["tenantId", "clientId", "redirectUri"],
    urlFields: ["redirectUri"],
    testable: true,
    hint: "Cloud directory (Entra ID). Register an app in Entra → Authentication, add this redirect URI, then Token configuration → add the optional groups claim. Issuer resolves to https://login.microsoftonline.com/<tenant-id>/v2.0. On-prem-only domains use the LDAP / on-prem MS AD provider through a directory bridge, or publish them via ADFS/Entra Connect.",
    fields: [
      {
        key: "tenantId",
        label: "TENANT ID (DIRECTORY ID)",
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      { key: "clientId", label: "APPLICATION (CLIENT) ID" },
      { key: "clientSecret", label: "CLIENT SECRET", type: "password" },
      {
        key: "redirectUri",
        label: "REDIRECT URI",
        placeholder: "https://studio.example.com/auth/callback",
      },
      { key: "scope", label: "SCOPE", placeholder: "openid profile email User.Read", wide: true },
      { key: "groupClaim", label: "GROUP CLAIM", placeholder: "groups" },
      {
        key: "domainHint",
        label: "DOMAIN HINT",
        placeholder: "example.com",
      },
      {
        key: "templateMap",
        label: "AD GROUP → USER TEMPLATE JSON",
        placeholder: '{"Domain Admins":"Platform Owner"}',
        wide: true,
      },
      {
        key: "roleMap",
        label: "AD GROUP → ROLE JSON (FALLBACK)",
        placeholder: '{"Domain Admins":"Admin","Operators":"Operator"}',
        wide: true,
      },
    ],
  },
  {
    id: "ldap",
    label: "LDAP / ON-PREM MS AD",
    tone: "emerald",
    posture: "bridge",
    required: ["host", "port", "baseDn"],
    testable: true,
    hint: "On-prem Microsoft Active Directory and OpenLDAP are reached over LDAP / LDAPS through a directory bridge. Default filter (|(uid={u})(sAMAccountName={u})(userPrincipalName={u})) works for OpenLDAP & Active Directory.",
    fields: [
      { key: "host", label: "HOST / IP", placeholder: "ldap.example.com" },
      { key: "port", label: "PORT", placeholder: "389" },
      { key: "baseDn", label: "BASE DN", placeholder: "dc=example,dc=com" },
      { key: "bindDn", label: "BIND DN", placeholder: "cn=admin,dc=example,dc=com" },
      { key: "bindPassword", label: "BIND PASSWORD", type: "password" },
      { key: "userFilter", label: "USER FILTER" },
      { key: "userDnTemplate", label: "USER DN TEMPLATE" },
      { key: "groupAttribute", label: "GROUP ATTRIBUTE", placeholder: "memberOf" },
      {
        key: "templateMap",
        label: "GROUP → USER TEMPLATE JSON",
        placeholder: '{"Domain Admins":"Platform Owner"}',
        wide: true,
      },
      {
        key: "roleMap",
        label: "GROUP → ROLE JSON (FALLBACK)",
        placeholder: '{"Domain Admins":"Admin","Operators":"Operator"}',
        wide: true,
      },
      { key: "secondaryHost", label: "SECONDARY HOST (FAILOVER)" },
      { key: "secondaryPort", label: "SECONDARY PORT" },
    ],
  },
  {
    id: "radius",
    label: "RADIUS",
    tone: "amethyst",
    posture: "bridge",
    required: ["host", "port", "sharedSecret"],
    testable: true,
    hint: "On NPS, attach a Network Policy with a Filter-Id RADIUS attribute (Standard tab → Add → Filter-Id) per AD group. For MSCHAPv2 enable Constraints → Authentication Methods → Microsoft Encrypted Authentication v2. Live-test fields are not persisted — they only run a real Access-Request when you press Test Connection.",
    fields: [
      { key: "host", label: "HOST / IP", placeholder: "radius.example.com" },
      { key: "port", label: "PORT", placeholder: "1812" },
      { key: "sharedSecret", label: "SHARED SECRET", type: "password" },
      {
        key: "authMethod",
        label: "AUTH METHOD",
        type: "select",
        options: ["MSCHAPv2", "PAP", "CHAP", "EAP-MD5"],
      },
      { key: "nasIp", label: "NAS-IP-ADDRESS" },
      { key: "nasIdentifier", label: "NAS-IDENTIFIER" },
      {
        key: "roleAttribute",
        label: "ROLE ATTRIBUTE (NPS REPLY)",
        type: "select",
        options: ["Filter-Id (recommended)", "Class", "Reply-Message", "Vendor-Specific"],
      },
      {
        key: "templateMap",
        label: "GROUP → USER TEMPLATE JSON",
        placeholder: '{"Domain Admins":"Platform Owner"}',
        wide: true,
      },
      {
        key: "roleMap",
        label: "GROUP → ROLE JSON (FALLBACK)",
        placeholder: '{"Domain Admins":"Admin","Operators":"Operator"}',
        wide: true,
      },
      { key: "testUsername", label: "LIVE TEST USERNAME" },
      { key: "testPassword", label: "LIVE TEST PASSWORD", type: "password" },
      { key: "secondaryHost", label: "SECONDARY HOST (FAILOVER)" },
      { key: "secondaryPort", label: "SECONDARY PORT" },
    ],
  },
  {
    id: "saml",
    label: "SAML",
    tone: "topaz",
    posture: "federated",
    required: ["idpMetadataUrl", "spRealm"],
    urlFields: ["idpMetadataUrl"],
    hint: "For Active Directory, publish the domain through ADFS or Entra ID and point this at its federation metadata. Group claims are matched against the maps below.",
    testable: true,
    fields: [
      {
        key: "idpMetadataUrl",
        label: "IDP METADATA URL",
        placeholder: "https://idp.example.com/metadata",
      },
      { key: "spRealm", label: "SP REALM / ENTITY ID", placeholder: "local-os" },
      {
        key: "groupClaim",
        label: "GROUP CLAIM",
        placeholder: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
        wide: true,
      },
      {
        key: "templateMap",
        label: "GROUP → USER TEMPLATE JSON",
        placeholder: '{"Domain Admins":"Platform Owner"}',
        wide: true,
      },
      {
        key: "roleMap",
        label: "GROUP → ROLE JSON (FALLBACK)",
        placeholder: '{"Operators":"Operator"}',
        wide: true,
      },
    ],
  },
  {
    id: "oidc",
    label: "OIDC",
    tone: "sapphire",
    posture: "federated",
    required: ["issuerUrl", "clientId", "redirectUri"],
    urlFields: ["issuerUrl", "redirectUri"],
    hint: "Entra ID issuer is https://login.microsoftonline.com/<tenant-id>/v2.0. Ask for the groups claim, then map it below.",
    testable: true,
    fields: [
      { key: "issuerUrl", label: "ISSUER URL", placeholder: "https://idp.example.com" },
      { key: "clientId", label: "CLIENT ID" },
      { key: "clientSecret", label: "CLIENT SECRET", type: "password" },
      { key: "redirectUri", label: "REDIRECT URI" },
      { key: "scope", label: "SCOPE", placeholder: "openid profile email", wide: true },
      { key: "groupClaim", label: "GROUP CLAIM", placeholder: "groups" },
      {
        key: "templateMap",
        label: "GROUP → USER TEMPLATE JSON",
        placeholder: '{"Domain Admins":"Platform Owner"}',
        wide: true,
      },
      {
        key: "roleMap",
        label: "GROUP → ROLE JSON (FALLBACK)",
        placeholder: '{"Operators":"Operator"}',
        wide: true,
      },
    ],
  },
  {
    id: "oauth2",
    label: "OAuth2",
    tone: "ruby",
    posture: "federated",
    required: ["authorizeUrl", "tokenUrl", "clientId", "redirectUri"],
    urlFields: ["authorizeUrl", "tokenUrl", "userinfoUrl", "redirectUri"],
    testable: true,
    fields: [
      { key: "authorizeUrl", label: "AUTHORIZE URL" },
      { key: "tokenUrl", label: "TOKEN URL" },
      { key: "userinfoUrl", label: "USERINFO URL" },
      { key: "clientId", label: "CLIENT ID" },
      { key: "clientSecret", label: "CLIENT SECRET", type: "password" },
      { key: "redirectUri", label: "REDIRECT URI" },
      { key: "scope", label: "SCOPE", placeholder: "read", wide: true },
    ],
  },
];

/** Plain-language posture copy, used on the provider header chip. */
export const POSTURE_COPY: Record<ProviderPosture, { chip: string; tone: string; blurb: string }> =
  {
    live: {
      chip: "LIVE",
      tone: "emerald",
      blurb: "Signs principals in right now, against the studio directory.",
    },
    bridge: {
      chip: "WIRED TO BACKEND",
      tone: "emerald",
      blurb:
        "LDAP and RADIUS are raw wire protocols. The studio backend acts as a bridge, querying the directory and binding users in real-time.",
    },
    federated: {
      chip: "WIRED TO BACKEND",
      tone: "emerald",
      blurb:
        "An HTTPS federation. The redirect handshake is actively handled by the Elara backend. Upon returning from the IdP, users are signed into the studio.",
    },
  };

export type ProviderVerdict = {
  /** Required fields left blank. */
  missing: string[];
  /** Fields that do not parse as an absolute URL. */
  malformed: string[];
  /** Map fields that are not valid JSON objects. */
  badJson: string[];
  complete: boolean;
};

function isAbsoluteUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return Boolean(u.protocol && u.host);
  } catch {
    return false;
  }
}

function isJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Validate a provider configuration *locally and honestly*: it checks what can
 * genuinely be checked from here — required fields, URL shape, and the JSON of
 * the group maps. It deliberately does not claim reachability, because nothing
 * in this runtime can open a socket to a domain controller.
 */
export function validateProvider(id: ProviderId, cfg: ProviderConfig): ProviderVerdict {
  const spec = PROVIDER_SPECS.find((s) => s.id === id);
  const val = (k: string) => (cfg.fields[k] ?? "").trim();

  const missing = (spec?.required ?? []).filter((k) => !val(k));
  const malformed = (spec?.urlFields ?? []).filter((k) => val(k) && !isAbsoluteUrl(val(k)));
  const badJson = ["templateMap", "roleMap"].filter((k) => val(k) && !isJsonObject(val(k)));

  return {
    missing,
    malformed,
    badJson,
    complete: !missing.length && !malformed.length && !badJson.length,
  };
}

/** Human label for a field key, for verdict messages. */
export function fieldLabel(id: ProviderId, key: string): string {
  const spec = PROVIDER_SPECS.find((s) => s.id === id);
  return spec?.fields.find((f) => f.key === key)?.label ?? key;
}

/**
 * The grant chain for a directory group, in the order it is resolved:
 * template first (it carries roles *and* scopes), then the role map, then the
 * provider's default role. Returns the winning step so the UI can show it.
 */
export function resolveGroupGrant(
  cfg: ProviderConfig,
  groups: string[],
): { via: "template" | "role" | "default"; group?: string; grant: string } {
  const parse = (key: string): Record<string, string> => {
    const raw = (cfg.fields[key] ?? "").trim();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  const templates = parse("templateMap");
  const roles = parse("roleMap");

  for (const g of groups) {
    if (templates[g]) return { via: "template", group: g, grant: templates[g] };
  }
  for (const g of groups) {
    if (roles[g]) return { via: "role", group: g, grant: roles[g] };
  }
  return { via: "default", grant: cfg.defaultRole };
}

const blankFields = (id: ProviderId): Record<string, string> =>
  Object.fromEntries((PROVIDER_SPECS.find((s) => s.id === id)?.fields ?? []).map((f) => [f.key, ""]));

/** One source per kind, seeded so the page never opens empty. */
const defaults: ProviderConfig[] = PROVIDER_SPECS.map((s, i) => ({
  key: s.id,
  id: s.id,
  label: s.label,
  enabled: s.id === "local",
  defaultRole: "operator",
  priority: i,
  fields: blankFields(s.id),
}));

export const PROVIDER_DEFAULTS: ProviderConfig[] = defaults;

export function specOf(id: ProviderId) {
  return PROVIDER_SPECS.find((s) => s.id === id)!;
}

/** A fresh, unconfigured source of a given kind. */
export function newSource(id: ProviderId, label?: string): ProviderConfig {
  return {
    key: `${id}_${Math.random().toString(36).slice(2, 9)}`,
    id,
    label: label ?? `${specOf(id).label} ${Math.floor(Math.random() * 900 + 100)}`,
    enabled: false,
    priority: 100,
    defaultRole: "Viewer",
    fields: blankFields(id),
  };
}

/** Factory-default shape for an existing source (keeps its key + kind). */
export function defaultProvider(id: ProviderId, key: string = id, label?: string): ProviderConfig {
  return {
    key,
    id,
    label: label ?? specOf(id).label,
    enabled: id === "local",
    priority: id === "local" ? 0 : 100,
    defaultRole: "Viewer",
    fields: blankFields(id),
  };
}

const KEY = "sovereign:auth-providers:v2";
const LEGACY_KEY = "sovereign:auth-providers:v1";
const EVENT = "sovereign:auth-providers";

function normalize(list: unknown): ProviderConfig[] | null {
  if (!Array.isArray(list) || !list.length) return null;
  const out: ProviderConfig[] = [];
  for (const raw of list as Partial<ProviderConfig>[]) {
    if (!raw || !raw.id || !PROVIDER_SPECS.some((s) => s.id === raw.id)) continue;
    out.push({
      key: raw.key ?? raw.id,
      id: raw.id,
      label: raw.label ?? specOf(raw.id).label,
      enabled: raw.id === "local" ? true : !!raw.enabled,
      priority: raw.priority ?? 100,
      defaultRole: raw.defaultRole ?? "Viewer",
      fields: { ...blankFields(raw.id), ...(raw.fields ?? {}) },
    });
  }
  if (!out.length) return null;
  // Local is structural — always keep exactly one.
  if (!out.some((p) => p.id === "local")) out.unshift(defaultProvider("local"));
  return out;
}

function read(): ProviderConfig[] {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw)) ?? defaults;
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = normalize(JSON.parse(legacy));
      if (migrated) return migrated;
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function useAuthProviders() {
  const [providers, setProviders] = useState<ProviderConfig[]>(defaults);

  useEffect(() => {
    const sync = async () => {
      try {
        const data = await fetchApi("/api/identity/auth-providers");
        if (data && Array.isArray(data.providers) && data.providers.length > 0) {
           const mapped = data.providers.map((p: any) => ({
             key: p.key || p.id,
             id: p.id as ProviderId,
             label: p.label || specOf(p.id as ProviderId)?.label || p.id,
             enabled: p.id === "local" ? true : !!p.enabled,
             priority: p.id === "local" ? 0 : (Number(p.priority) || 100),
             defaultRole: p.config?.defaultRole || "Viewer",
             fields: { ...blankFields(p.id as ProviderId), ...(p.config || {}) }
           }));
           // Ensure local is there
           if (!mapped.some((p: any) => p.id === "local")) mapped.unshift(defaultProvider("local"));
           setProviders(mapped);
           if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(mapped));
        } else {
           setProviders(read());
        }
      } catch (err) {
        console.error("Failed to sync auth-providers", err);
        setProviders(read());
      }
    };
    sync();

    const syncLocal = () => setProviders(read());
    window.addEventListener(EVENT, syncLocal);
    window.addEventListener("storage", syncLocal);
    return () => {
      window.removeEventListener(EVENT, syncLocal);
      window.removeEventListener("storage", syncLocal);
    };
  }, []);

  const update = useCallback((key: string, patch: Partial<ProviderConfig>) => {
    setProviders(prev => {
      const next = prev.map((p) => (p.key === key ? { ...p, ...patch } : p));
      persist(next);
      return next;
    });
  }, []);

  const setField = useCallback((key: string, field: string, value: string) => {
    setProviders(prev => {
      const next = prev.map((p) => (p.key === key ? { ...p, fields: { ...p.fields, [field]: value } } : p));
      persist(next);
      return next;
    });
  }, []);

  /** Add another source of a kind — unbounded, multi-domain by design. */
  const addSource = useCallback((id: ProviderId) => {
    const count = providers.filter((p) => p.id === id).length;
    const newSrc = newSource(id, `${specOf(id).label} ${count + 1}`);
    setProviders(prev => {
      const next = [...prev, newSrc];
      persist(next);
      return next;
    });
    return newSrc;
  }, [providers]);

  const removeSource = useCallback((key: string) => {
    setProviders(prev => {
      const next = prev.filter((p) => p.key !== key || p.id === "local");
      persist(next);
      return next;
    });
  }, []);

  const persist = async (next: ProviderConfig[]) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    }
    try {
      const payload = next.map(p => ({
        key: p.key,
        id: p.id,
        label: p.label,
        enabled: p.enabled,
        priority: p.priority,
        config: { defaultRole: p.defaultRole, ...p.fields }
      }));
      await fetchApi("/api/identity/auth-providers", {
        method: "PUT",
        body: JSON.stringify({ providers: payload })
      });
    } catch (err) {
      console.error("Failed to persist auth-providers to DB", err);
    }
  };

  return { providers, sources: providers, update, setField, addSource, removeSource };
}

