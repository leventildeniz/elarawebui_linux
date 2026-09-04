import { fetchApi } from "./api";

export type ProviderKind = "llm" | "search";

export type ProviderEntry = {
  id: string;
  name: string;
  kind: ProviderKind;
  priority: number;
  baseUrl: string;
  model: string;
  secretId: string;
  active: boolean;
  isCheapest: boolean;
  createdAt: number;
};

export type RoutingMode =
  "failover" | "smart_router" | "manual_only" | "single" | "multi" | "round_robin" | "cheapest";

export const routingModes: { key: RoutingMode; label: string; hint: string }[] = [
  { key: "failover", label: "Failover", hint: "priority order, fall through on error" },
  { key: "smart_router", label: "Smart router", hint: "regex rules → provider" },
  { key: "manual_only", label: "Manual only", hint: "user picks every time" },
  { key: "single", label: "Single (lock)", hint: "always use the top active provider" },
  { key: "multi", label: "Multi (parallel fan-out)", hint: "query all active, merge results" },
  { key: "round_robin", label: "Round robin", hint: "rotate across active providers" },
  { key: "cheapest", label: "Cheapest first", hint: "lowest cost provider that can serve" },
];

export type SmartRouteRule = {
  id: string;
  pattern: string; // The regex pattern
  providerId: string; // ID of the target AI provider
};

export type OverrideAudience = "everyone" | "admins" | "groups" | "users" | "roles";

export type RoutingPolicy = {
  mode: RoutingMode;
  allowUserOverride: boolean;
  overrideAudience: OverrideAudience;
  overrideGroups: string[];
  overrideUsers: string[];
  overrideRoles: string[];
  retries: number;
  timeoutMs: number;
  smartRules: SmartRouteRule[];
};

export const defaultRouting: RoutingPolicy = {
  mode: "failover",
  allowUserOverride: true,
  overrideAudience: "everyone",
  overrideGroups: [],
  overrideUsers: [],
  overrideRoles: ["Admin", "Operator"],
  retries: 2,
  timeoutMs: 30000,
  smartRules: [],
};

import { useCallback, useEffect, useState } from "react";

export function useProviders() {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [routing, setRouting] = useState<RoutingPolicy>(defaultRouting);
  const [loading, setLoading] = useState(true);

  // Fetch Providers and Routing Policy on mount
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [provData, routingData] = await Promise.all([
          fetchApi("/system/providers").catch(() => []),
          fetchApi("/system/config/routing_policy").catch(() => null),
        ]);

        if (!active) return;

        if (Array.isArray(provData)) {
          setProviders(provData);
        }
        if (routingData) {
          setRouting({ ...defaultRouting, ...routingData });
        }
      } catch (e) {
        console.error("Failed to load providers config", e);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const add = useCallback(async (draft: Omit<ProviderEntry, "id" | "createdAt">) => {
    try {
      const res = await fetchApi("/system/providers", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      if (res.ok && res.provider) {
        setProviders((prev) => [...prev, res.provider]);
      }
    } catch (e) {
      console.error("Failed to add provider", e);
    }
  }, []);

  const update = useCallback(async (id: string, patch: Partial<ProviderEntry>) => {
    try {
      // Optimistic update
      setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

      // In real scenario, wait for the actual patched provider back
      const payload = { ...patch };
      const res = await fetchApi(`/system/providers/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      if (res.ok && res.provider) {
        setProviders((prev) => prev.map((p) => (p.id === id ? res.provider : p)));
      }
    } catch (e) {
      console.error("Failed to update provider", e);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      setProviders((prev) => prev.filter((p) => p.id !== id));
      await fetchApi(`/system/providers/${id}`, { method: "DELETE" });
    } catch (e) {
      console.error("Failed to delete provider", e);
    }
  }, []);

  const patchRouting = useCallback(
    async (patch: Partial<RoutingPolicy>) => {
      try {
        const next = { ...routing, ...patch };
        setRouting(next); // optimistic
        await fetchApi("/system/config/routing_policy", {
          method: "PUT",
          body: JSON.stringify(next),
        });
      } catch (e) {
        console.error("Failed to save routing policy", e);
      }
    },
    [routing],
  );

  return { providers, routing, add, update, remove, patchRouting, loading };
}
