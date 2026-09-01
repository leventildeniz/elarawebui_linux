import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "./api";

/**
 * Telemetry source registry — where machine / AI runtime metrics are collected from.
 * UI host and model host can live on different machines, so every collector is
 * declared here (endpoint, auth, interval, labels) instead of being hardcoded.
 */

export type TelemetryKind = "snmp" | "prometheus" | "http" | "agent" | "postgres" | "dcgm";

export type TelemetryAuth = "none" | "community" | "bearer" | "basic" | "mtls";

export type TelemetrySource = {
  id: string;
  name: string;
  kind: TelemetryKind;
  host: string;
  port: string;
  path: string;
  auth: TelemetryAuth;
  /** vault key name or manual secret reference — never the raw secret */
  credentialRef: string;
  intervalSec: number;
  timeoutSec: number;
  tls: boolean;
  enabled: boolean;
  labels: string;
  lastProbe: null | { at: number; ok: boolean; latencyMs: number };
  createdAt?: number;
};

export const telemetryKinds: {
  id: TelemetryKind;
  label: string;
  hint: string;
  defaultPort: string;
  defaultPath: string;
  defaultInterval: number;
}[] = [
  {
    id: "snmp",
    label: "SNMP · host",
    hint: "CPU, RAM, disk, interface counters from bare metal / VM",
    defaultPort: "161",
    defaultPath: "1.3.6.1.2.1",
    defaultInterval: 60,
  },
  {
    id: "prometheus",
    label: "Prometheus · scrape",
    hint: "node_exporter, cAdvisor or any /metrics endpoint",
    defaultPort: "9100",
    defaultPath: "/metrics",
    defaultInterval: 15,
  },
  {
    id: "http",
    label: "HTTP · runtime API",
    hint: "AI runtime stats (TTFT, tokens/s, cache hit) over JSON",
    defaultPort: "8080",
    defaultPath: "/v1/telemetry",
    defaultInterval: 10,
  },
  {
    id: "agent",
    label: "Agent · stream",
    hint: "Push stream from a host agent (gRPC / WebSocket)",
    defaultPort: "7443",
    defaultPath: "/stream",
    defaultInterval: 1,
  },
  {
    id: "postgres",
    label: "PostgreSQL · pg_stat",
    hint: "Connections, QPS, index hit ratio, WAL pressure",
    defaultPort: "5432",
    defaultPath: "pg_stat_database",
    defaultInterval: 30,
  },
  {
    id: "dcgm",
    label: "NVIDIA · DCGM",
    hint: "GPU utilisation, VRAM, temperature, power draw",
    defaultPort: "9400",
    defaultPath: "/metrics",
    defaultInterval: 10,
  },
];

export const telemetryAuths: { id: TelemetryAuth; label: string }[] = [
  { id: "none", label: "None" },
  { id: "community", label: "SNMP community" },
  { id: "bearer", label: "Bearer token" },
  { id: "basic", label: "Basic auth" },
  { id: "mtls", label: "mTLS client cert" },
];

export const kindTone: Record<TelemetryKind, string> = {
  snmp: "text-sapphire",
  prometheus: "text-topaz",
  http: "text-emerald",
  agent: "text-amethyst",
  postgres: "text-sapphire",
  dcgm: "text-ruby",
};

const uid = () => `tsrc_${Math.random().toString(36).slice(2, 9)}`;

export function blankSource(kind: TelemetryKind = "snmp"): TelemetrySource {
  const preset = telemetryKinds.find((k) => k.id === kind)!;
  return {
    id: uid(),
    name: "",
    kind,
    host: "",
    port: preset.defaultPort,
    path: preset.defaultPath,
    auth: kind === "snmp" ? "community" : "bearer",
    credentialRef: "",
    intervalSec: preset.defaultInterval,
    timeoutSec: 5,
    tls: kind !== "snmp",
    enabled: true,
    labels: "",
    lastProbe: null,
  };
}

export function useTelemetrySources() {
  const [sources, setSources] = useState<TelemetrySource[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchApi("/api/telemetry/sources");
      if (Array.isArray(data)) {
        setSources(data);
      }
    } catch (e) {
      console.error("Failed to load telemetry sources", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const upsert = useCallback(
    async (src: TelemetrySource) => {
      // Optimistic update
      setSources((prev) => {
        const exists = prev.some((s) => s.id === src.id);
        return exists ? prev.map((s) => (s.id === src.id ? src : s)) : [...prev, src];
      });

      try {
        const res = await fetchApi("/api/telemetry/sources", {
          method: "POST",
          body: JSON.stringify(src),
        });
        if (res.ok && res.source) {
          setSources((prev) => prev.map((s) => (s.id === src.id ? res.source : s)));
        }
      } catch (e) {
        console.error("Failed to save telemetry source", e);
        loadData(); // Resync on error
      }
    },
    [loadData],
  );

  const patch = useCallback(
    async (id: string, p: Partial<TelemetrySource>) => {
      const target = sources.find(s => s.id === id);
      if (!target) return;
      await upsert({ ...target, ...p });
    },
    [sources, upsert],
  );

  const remove = useCallback(
    async (id: string) => {
      setSources((prev) => prev.filter((s) => s.id !== id));
      try {
        await fetchApi(`/api/telemetry/sources/${id}`, { method: "DELETE" });
      } catch (e) {
        console.error("Failed to delete telemetry source", e);
        loadData();
      }
    },
    [loadData],
  );

  const reset = useCallback(async () => {
    // Left empty deliberately: reset should probably trigger a batch delete or nothing in production API.
    await loadData();
  }, [loadData]);

  return { sources, upsert, patch, remove, reset, loading };
}
