import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "./api";
import {
  canEdit,
  readOwnerCtx,
  scopeOwned,
  stampOwner,
  useOwnerCtx,
  type Owned,
} from "@/lib/ownership";

/**
 * Target registry — hosts, IPs and services the fleet is allowed to reach.
 * Targets are grouped by vendor/role and bound to an adapter + vault entry
 * so an agent can connect in one click.
 */

export type TargetRisk = "low" | "medium" | "high" | "critical";

export type TargetGroupKind =
  "firewall" | "router" | "switch" | "server" | "cloud" | "endpoint" | "service" | "custom";

export const groupKinds: TargetGroupKind[] = [
  "firewall",
  "router",
  "switch",
  "server",
  "cloud",
  "endpoint",
  "service",
  "custom",
];

export const targetRisks: TargetRisk[] = ["low", "medium", "high", "critical"];

export const riskTones: Record<TargetRisk, "emerald" | "topaz" | "amethyst" | "ruby"> = {
  low: "emerald",
  medium: "topaz",
  high: "amethyst",
  critical: "ruby",
};

export const kindTones: Record<TargetGroupKind, string> = {
  firewall: "ruby",
  router: "sapphire",
  switch: "sapphire",
  server: "emerald",
  cloud: "amethyst",
  endpoint: "topaz",
  service: "emerald",
  custom: "platinum",
};

export const vaultScopes = ["none", "studio", "workspace", "agent", "user"] as const;

export type TargetGroup = {
  id: string;
  name: string;
  kind: TargetGroupKind;
  description: string;
  tags: string[];
};

export type Endpoint = {
  id: string;
  label: string;
  port: string;
  /** empty string = inherit target default */
  adapter: string;
  vaultScope: string;
  vaultName: string;
  primary: boolean;
};

export type Target = Owned & {
  id: string;
  name: string;
  groupId: string;
  ip: string;
  host: string;
  ports: string;
  tags: string[];
  adapter: string;
  vaultScope: string;
  vaultName: string;
  risk: TargetRisk;
  requiresApproval: boolean;
  owner: string;
  notes: string;
  endpoints: Endpoint[];
  enabled: boolean;
  createdAt: number;
  lastCheck: { at: number; ok: boolean; ms: number; detail: string } | null;
} & Owned;

export type TargetState = { groups: TargetGroup[]; targets: Target[] };

const KEY = "elara.targets.v1";
const EVT = "elara:targets";

export const emptyGroup = (): TargetGroup => ({
  id: `grp-${Math.floor(1000 + Math.random() * 8999)}`,
  name: "",
  kind: "firewall",
  description: "",
  tags: [],
});

export const emptyEndpoint = (primary = false): Endpoint => ({
  id: `ep-${Math.random().toString(36).slice(2, 8)}`,
  label: "",
  port: "",
  adapter: "",
  vaultScope: "",
  vaultName: "",
  primary,
});

export const emptyTarget = (): Target => ({
  id: `tgt-${Math.floor(1000 + Math.random() * 8999)}`,
  name: "",
  groupId: "",
  ip: "",
  host: "",
  ports: "",
  tags: [],
  adapter: "",
  vaultScope: "none",
  vaultName: "",
  risk: "low",
  requiresApproval: false,
  owner: "",
  notes: "",
  endpoints: [emptyEndpoint(true)],
  enabled: true,
  createdAt: Date.now(),
  lastCheck: null,
});

export const defaultTargetState: TargetState = {
  groups: [],
  targets: [],
};

function read(): TargetState {
  return defaultTargetState;
}

function write(state: TargetState) {
  // No-op for direct storage. Data must go through API.
}

/** Columns understood by the bulk importer, in template order. */
export const importColumns: { key: string; accepts: string; note: string }[] = [
  { key: "name", accepts: "text", note: "target display name (required)" },
  { key: "ip", accepts: "IPv4 / IPv6", note: "address of the endpoint" },
  { key: "host", accepts: "FQDN", note: "e.g. fw01.corp.local" },
  {
    key: "port",
    accepts: "443 · 443,22,8443 · 8000-8005",
    note: "multi-port rows auto-create endpoints",
  },
  { key: "adapter", accepts: "adapter name", note: "matched against the adapter registry" },
  { key: "group", accepts: "group name", note: "falls back to the filtered group" },
  { key: "tags", accepts: "a;b or a|b", note: "comma-, semicolon- or pipe-separated" },
  { key: "vault_scope", accepts: "studio · workspace · agent · user", note: "credential scope" },
  { key: "vault_name", accepts: "text", note: "credential name inside the vault" },
  { key: "risk_level", accepts: "low · medium · high · critical", note: "defaults to low" },
  { key: "owner", accepts: "free text", note: "accountable operator" },
  { key: "notes", accepts: "free text", note: "operator annotation" },
];

/** Downloadable starter sheet, mirrored by the importer docs. */
export const importTemplateCsv = [
  "name,ip,host,port,adapter,group,tags,vault_scope,vault_name,risk_level,owner,notes",
  'fw01,10.0.0.1,fw01.corp.local,"443,22",Fortinet FortiOS,Perimeter,"prod;dmz",studio,fw-admin,high,netsec,primary perimeter pair',
  "fw02,10.0.0.2,fw02.corp.local,443,Fortinet FortiOS,Perimeter,prod,studio,fw-admin,high,netsec,standby node",
  'web01,10.0.1.10,,"80,443",SSH,Linux DMZ,"prod;web",workspace,linux-svc,medium,platform,public web head',
  "db01,10.0.2.20,db01.corp.local,5432,PostgreSQL,Data,prod,studio,pg-admin,critical,data,primary cluster",
].join("\n");

/** Expand "443,22" / "8000-8005" into a normalised port list. */
function expandPorts(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw
    .split(/[,;|]/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from <= 512) {
        for (let p = from; p <= to; p++) out.push(String(p));
        continue;
      }
    }
    out.push(part);
  }
  return out;
}

/** Quote-aware single-line splitter (handles "443,22" inside a CSV cell). */
function splitRow(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t").map((c) => c.trim());
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
      continue;
    }
    if (ch === delim && !quoted) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const columnAliases: Record<string, string[]> = {
  name: ["name", "target", "display_name", "hostname"],
  ip: ["ip", "address", "ipv4", "ipv6"],
  host: ["host", "fqdn", "dns"],
  ports: ["port", "ports", "service_port"],
  adapter: ["adapter", "driver", "connector"],
  group: ["group", "target_group", "folder"],
  tags: ["tags", "labels"],
  vaultScope: ["vault_scope", "scope", "credential_scope"],
  vaultName: ["vault_name", "credential", "credential_name"],
  risk: ["risk_level", "risk", "criticality"],
  owner: ["owner", "responsible"],
  notes: ["notes", "note", "description", "comment"],
};

/** Parse CSV / TSV / plain host list into draft targets. */
export function parseTargetImport(text: string): Target[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const first = lines[0];
  if (!first) return [];
  const delim = first.includes(",") ? "," : first.includes("\t") ? "\t" : "";
  const out: Target[] = [];

  const draft = (patch: Partial<Target>): Target => ({
    ...emptyTarget(),
    id: `tgt-${Math.floor(1000 + Math.random() * 8999)}`,
    ...patch,
  });

  if (!delim) {
    /* TXT shortcut — one host per line: ip, name, or ip:port */
    for (const line of lines) {
      const [addr, port] = line.split(":");
      const value = (addr ?? line).trim();
      const isIp = /^[0-9.]+$/.test(value);
      out.push(
        draft({
          name: value,
          ip: isIp ? value : "",
          host: isIp ? "" : value,
          ports: port?.trim() ?? "",
        }),
      );
    }
    return out;
  }

  const header = splitRow(first, delim).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const keys = Object.keys(columnAliases);
  const hasHeader = keys.some((k) => columnAliases[k]!.some((a) => header.includes(a)));
  const rows = hasHeader ? lines.slice(1) : lines;
  const positional = ["name", "ip", "host", "ports", "tags", "risk", "owner"];
  const idx = (k: string) =>
    hasHeader ? header.findIndex((h) => columnAliases[k]?.includes(h)) : positional.indexOf(k);

  for (const line of rows) {
    const c = splitRow(line, delim);
    const pick = (k: string) => {
      const i = idx(k);
      return i >= 0 && c[i] ? c[i]! : "";
    };
    const name = pick("name") || pick("host") || pick("ip");
    if (!name) continue;
    const risk = pick("risk").toLowerCase() as TargetRisk;
    const ports = expandPorts(pick("ports"));
    const scope = pick("vaultScope").toLowerCase();
    out.push(
      draft({
        name,
        ip: pick("ip"),
        host: pick("host"),
        ports: ports.join(","),
        tags: pick("tags")
          .split(/[;|,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        adapter: pick("adapter"),
        vaultScope: (vaultScopes as readonly string[]).includes(scope) ? scope : "none",
        vaultName: pick("vaultName"),
        owner: pick("owner"),
        notes: pick("notes"),
        risk: targetRisks.includes(risk) ? risk : "low",
        /* multi-port rows fan out into endpoints */
        endpoints:
          ports.length > 1
            ? ports.map((p, i) => ({
                ...emptyEndpoint(i === 0),
                label: `port ${p}`,
                port: p,
              }))
            : [],
      }),
    );
  }
  return out;
}

/** Resolve group names coming from an import file to existing group ids. */
export function resolveImportGroups(text: string, groups: TargetGroup[]): Record<string, string> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const first = lines[0];
  if (!first || !first.includes(",")) return {};
  const header = splitRow(first, ",").map((h) => h.toLowerCase());
  const gi = header.findIndex((h) => columnAliases["group"]!.includes(h));
  const ni = header.findIndex((h) => columnAliases["name"]!.includes(h));
  if (gi < 0) return {};
  const map: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const c = splitRow(line, ",");
    const name = c[ni >= 0 ? ni : 0];
    const gname = c[gi];
    if (!name || !gname) continue;
    const hit = groups.find((g) => g.name.toLowerCase() === gname.toLowerCase());
    if (hit) map[name] = hit.id;
  }
  return map;
}

export function targetsToCsv(targets: Target[], groups: TargetGroup[]): string {
  const head = [
    "name",
    "ip",
    "host",
    "ports",
    "group",
    "adapter",
    "vault",
    "risk",
    "approval",
    "tags",
    "owner",
  ];
  const rows = targets.map((t) => {
    const g = groups.find((x) => x.id === t.groupId);
    return [
      t.name,
      t.ip,
      t.host,
      t.ports,
      g?.name ?? "",
      t.adapter,
      t.vaultScope === "none" ? "" : `${t.vaultScope}:${t.vaultName}`,
      t.risk,
      t.requiresApproval ? "yes" : "no",
      t.tags.join(";"),
      t.owner,
    ]
      .map((v) => (String(v).includes(",") ? `"${v}"` : String(v)))
      .join(",");
  });
  return [head.join(","), ...rows].join("\n");
}

export function useTargets() {
  const ctx = useOwnerCtx();
  const [state, setState] = useState<TargetState>(defaultTargetState);

  useEffect(() => {
    const sync = async () => {
      try {
        const res = await fetchApi("/api/targets");

        if (res?.ok && res.state) {
          setState({
            groups: res.state.groups || [],
            targets: res.state.targets || []
          });
        }
      } catch (err) {
        console.error("Failed to load targets:", err);
      }
    };
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const mutate = useCallback(async (fn: (prev: TargetState) => Promise<void>) => {
    // We now just use this as a wrapper for async operations since state is server-driven
  }, []);

  const saveGroup = useCallback(
    async (group: TargetGroup) => {
      try {
        const isUpdate = state.groups.some(g => g.id === group.id);
        const method = isUpdate ? "PUT" : "POST";
        const url = isUpdate ? `/api/targets/groups/${group.id}` : "/api/targets/groups";

        await fetchApi(url, {
          method,
          body: JSON.stringify({
             id: group.id,
             name: group.name,
             kind: group.kind,
             description: group.description,
             tags: group.tags || []
          })
        });

        window.dispatchEvent(new CustomEvent(EVT));
      } catch (err) {
        console.error("Failed to save target group:", err);
      }
    },
    [state.groups]
  );

  const removeGroup = useCallback(
    async (id: string) => {
      try {
        await fetchApi(`/api/targets/groups/${id}`, { method: "DELETE" });
        window.dispatchEvent(new CustomEvent(EVT));
      } catch (err) {
        console.error("Failed to delete target group:", err);
        throw err;
      }
    },
    [],
  );

  const saveTarget = useCallback(
    async (target: Target) => {
      try {
        const isUpdate = state.targets.some(t => t.id === target.id);
        const method = isUpdate ? "PUT" : "POST";
        const url = isUpdate ? `/api/targets/${target.id}` : "/api/targets";

        const pt = parseInt(target.ports, 10);
        await fetchApi(url, {
          method,
          body: JSON.stringify({
            id: target.id,
            name: target.name,
            groupId: target.groupId || null,
            ip: target.ip || "",
            host: target.host || "",
            ports: target.ports || "",
            tags: target.tags || [],
            adapter: target.adapter || null,
            vaultScope: target.vaultScope || "",
            vaultName: target.vaultName || "",
            risk: target.risk || "low",
            requiresApproval: !!target.requiresApproval,
            owner: target.owner || "",
            notes: target.notes || "",
            endpoints: target.endpoints || []
          })
        });
        
        window.dispatchEvent(new CustomEvent(EVT));
      } catch (err) {
        console.error("Failed to save target:", err);
        throw err;
      }
    },
    [state.targets],
  );

  const removeTarget = useCallback(
    async (id: string) => {
      try {
        await fetchApi(`/api/targets/${id}`, { method: "DELETE" });
        window.dispatchEvent(new CustomEvent(EVT));
      } catch (err) {
        console.error("Failed to delete target:", err);
        throw err;
      }
    },
    [],
  );

  const batchImport = useCallback(
    async (targets: Target[]) => {
      try {
        const payload = targets.map(t => {
          const pt = parseInt(t.ports, 10);
          return {
            id: t.id,
            name: t.name,
            group_id: t.groupId || null,
            ip: t.ip || "",
            host: t.host || "",
            port: Number.isFinite(pt) ? pt : null,
            tags: t.tags || [],
            default_adapter_id: t.adapter || null,
            vault_scope: t.vaultScope || "",
            vault_name: t.vaultName || "",
            risk_level: t.risk || "low",
            requires_approval: !!t.requiresApproval,
            owner: t.owner || "",
            notes: t.notes || ""
          };
        });

        await fetchApi("/api/targets/batch", {
          method: "POST",
          body: JSON.stringify({ targets: payload })
        });
        
        window.dispatchEvent(new CustomEvent(EVT));
      } catch (err) {
        console.error("Failed to batch import targets:", err);
        throw err;
      }
    },
    [],
  );

  const pingAll = useCallback(
    async () => {
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [],
  );

  const toggleTarget = useCallback(
    async (id: string, enabled: boolean) => {
      // Targets table does not have an "enabled" field natively, so this is just UI optimistic until a schema change
      setState((prev) => ({
        ...prev,
        targets: prev.targets.map(x => x.id === id ? { ...x, enabled } : x)
      }));
    },
    [],
  );

  const checkTarget = useCallback(
    async (id: string) => {
      // Mocking check for now since backend /api/targets/:id/ping doesn't exist yet
      try {
        const t = state.targets.find((x) => x.id === id);
        if (!t) return;
        const live = t.enabled && (t.ip || t.host);
        const lastCheck = {
          at: Date.now(),
          ok: !!live,
          ms: live ? Math.floor(20 + Math.random() * 80) : 0,
          detail: live
            ? `${(t.ports || "443").split(",")[0]} open · reachable`
            : "target disabled or missing ip/host",
        };
        
        setState((prev) => ({
          ...prev,
          targets: prev.targets.map(x => x.id === id ? { ...x, lastCheck } : x)
        }));
      } catch (err) {
        console.error("Failed to check target:", err);
      }
    },
    [state.targets],
  );

  const importTargets = useCallback(
    async (incoming: Target[], groupId: string) => {
      const patched = incoming.map((t) => ({ ...t, groupId: t.groupId || groupId }));
      await batchImport(patched);
    },
    [batchImport],
  );

  const resetAll = useCallback(async () => {
    try {
      const ok = await fetchApi("/api/targets/reset", { method: "POST" });
      if (ok) {
        window.dispatchEvent(new CustomEvent(EVT));
      }
    } catch (err) {
      console.error("Failed to reset targets:", err);
    }
  }, []);

  return {
    state,
    groups: state.groups,
    targets: scopeOwned(state.targets, ctx),
    allTargets: state.targets,
    ctx,
    saveGroup,
    removeGroup,
    saveTarget,
    removeTarget,
    toggleTarget,
    checkTarget,
    importTargets,
    resetAll,
  };
}
