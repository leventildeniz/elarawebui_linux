import { useCallback, useEffect, useState } from "react";

import { fetchApi } from "./api";

export type SiemProtocol = "udp" | "tcp" | "tls";
export type SiemFormat = "cef" | "leef" | "json" | "rfc5424";

export type SiemConfig = {
  enabled: boolean;
  host: string;
  port: string;
  protocol: SiemProtocol;
  format: SiemFormat;
  facility: string;
  /** event classes forwarded */
  streams: string[];
  heartbeatSec: number;
  queueLimit: number;
  sealedAt: number | null;
};

export const siemProtocols: { id: SiemProtocol; label: string }[] = [
  { id: "udp", label: "UDP (Fast / Standard Syslog)" },
  { id: "tcp", label: "TCP (Reliable Stream)" },
  { id: "tls", label: "TCP + TLS (Encrypted Transport)" },
];

export const siemFormats: { id: SiemFormat; label: string }[] = [
  { id: "cef", label: "CEF · ArcSight / Splunk" },
  { id: "leef", label: "LEEF · IBM QRadar" },
  { id: "json", label: "JSON · Splunk HEC / Elastic / Wazuh" },
  { id: "rfc5424", label: "RFC5424 · Syslog / LogRhythm" },
];

export type SiemStreamItem = {
  id: string;
  name: string;
  category: "Security" | "Identity" | "Platform" | "Execution";
  description: string;
};

export const siemStreamsList: SiemStreamItem[] = [
  { id: "auth", name: "Authentication & SSO", category: "Identity", description: "OIDC/SAML claims, logins, logouts, session revocations" },
  { id: "rbac", name: "RBAC & Permissions", category: "Identity", description: "Role grants, user group changes, workspace permissions" },
  { id: "tenants", name: "Multi-Tenant Governance", category: "Identity", description: "Organization enrollments, SSO domain mappings, quota overrides" },
  { id: "genguard", name: "GenGuard & AI Firewall", category: "Security", description: "Prompt injection blocks, LLMFort/Lakera external violations" },
  { id: "policy", name: "Policy Engine & Limits", category: "Security", description: "Model routing decisions, spend threshold caps, output redactions" },
  { id: "secrets", name: "Secret Vault (BYOK)", category: "Security", description: "Key creations, rotations, credential resolutions, cipher state" },
  { id: "integrity", name: "Cryptographic Audit Ledger", category: "Security", description: "Merkle hash chain verification, tamper detection alerts" },
  { id: "api_tokens", name: "Developer Hub & API Keys", category: "Platform", description: "API key usage, rate-limit 429 throttles, quota alarms" },
  { id: "approvals", name: "Human-in-the-Loop Approvals", category: "Platform", description: "Approval tickets, operator sign-offs, rejections" },
  { id: "rag", name: "Knowledge Hub & RAG", category: "Platform", description: "Document ingestions, vector search queries, space access" },
  { id: "agents", name: "Autonomous Agents & Runs", category: "Execution", description: "Agent autonomous turns, goal completions, execution errors" },
  { id: "tools", name: "Tool & Python Sandboxes", category: "Execution", description: "Sandbox syscall blocks, network egress violations" },
  { id: "workflows", name: "Workflows & DAG Pipelines", category: "Execution", description: "DAG synthesis, pipeline executions, inbound webhooks" },
  { id: "mcp", name: "Model Context Protocol", category: "Execution", description: "Remote MCP server connects, client exposures, tools" },
  { id: "system", name: "System Lifecycle & Cluster", category: "Platform", description: "Service restarts, node health, DB pool, retention purges" },
];

export const siemStreams = siemStreamsList.map((s) => s.id);

export const defaultSiem: SiemConfig = {
  enabled: false,
  host: "10.255.255.1",
  port: "514",
  protocol: "udp",
  format: "cef",
  facility: "local0",
  streams: ["auth", "rbac", "genguard", "policy", "secrets", "api_tokens", "system"],
  heartbeatSec: 60,
  queueLimit: 10000,
  sealedAt: null,
};

const KEY = "elara.siem.v1";

export function useSiem() {
  const [config, setConfig] = useState<SiemConfig>(defaultSiem);

  useEffect(() => {
    let active = true;
    fetchApi("/system/siem")
      .then((data) => {
        if (active && data) {
          setConfig({ ...defaultSiem, ...data });
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const patch = useCallback((p: Partial<SiemConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...p };
      fetchApi("/system/siem", {
        method: "PUT",
        body: JSON.stringify(next)
      }).catch(console.error);
      return next;
    });
  }, []);

  const toggleStream = useCallback(
    (s: string) =>
      setConfig((prev) => {
        const next = {
          ...prev,
          streams: prev.streams.includes(s)
            ? prev.streams.filter((x) => x !== s)
            : [...prev.streams, s],
        };
        fetchApi("/system/siem", {
          method: "PUT",
          body: JSON.stringify(next)
        }).catch(console.error);
        return next;
      }),
    [],
  );

  return { config, patch, toggleStream };
}
