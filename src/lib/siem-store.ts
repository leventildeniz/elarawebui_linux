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
  { id: "udp", label: "UDP" },
  { id: "tcp", label: "TCP" },
  { id: "tls", label: "TCP + TLS" },
];

export const siemFormats: { id: SiemFormat; label: string }[] = [
  { id: "cef", label: "CEF · ArcSight" },
  { id: "leef", label: "LEEF · QRadar" },
  { id: "json", label: "JSON · Splunk" },
  { id: "rfc5424", label: "RFC5424 · Syslog" },
];

export const siemStreams = [
  "auth",
  "rbac",
  "policy",
  "secrets",
  "agents",
  "workflows",
  "mcp",
  "system",
];

export const defaultSiem: SiemConfig = {
  enabled: false,
  host: "10.255.255.1",
  port: "514",
  protocol: "udp",
  format: "cef",
  facility: "local0",
  streams: ["auth", "rbac", "policy", "secrets"],
  heartbeatSec: 60,
  queueLimit: 10000,
  sealedAt: null,
};

const KEY = "elara.siem.v1";

export function useSiem() {
  const [config, setConfig] = useState<SiemConfig>(defaultSiem);

  useEffect(() => {
    let active = true;
    fetchApi("/system/config/siem_config")
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
      fetchApi("/system/config/siem_config", {
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
        fetchApi("/system/config/siem_config", {
          method: "PUT",
          body: JSON.stringify(next)
        }).catch(console.error);
        return next;
      }),
    [],
  );

  return { config, patch, toggleStream };
}
