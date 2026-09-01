// Brand store — single source of truth for app/persona/owner labels.
// Fetches /api/brand once on mount; falls back to neutral defaults until the
// middleware responds, so SSR + offline preview never renders a vendor name.
//
// Consumers: useBrand() returns the live brand object plus a refresh() helper.
// All UI literals that used to hard-code "ELARA / Eagle Eye / Komutan / Sovereign"
// must read from here so the same code can ship as any product.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveApiBaseUrl, isBridgeUnreachableContext } from "@/lib/api-client";

export interface Brand {
  app_name: string;
  short_name: string;
  persona_name: string;
  owner_title: string;
  default_locale: string;
  tagline: string;
  support_email: string;
  library_root: string;
}

export const DEFAULT_BRAND: Brand = Object.freeze({
  app_name: "AI OS",
  short_name: "OS",
  persona_name: "Assistant",
  owner_title: "Operator",
  default_locale: "en",
  tagline: "Local-first AI operating system",
  support_email: "",
  library_root: "",
});

interface BrandCtx {
  brand: Brand;
  ready: boolean;
  refresh: () => Promise<void>;
  save: (patch: Partial<Brand>) => Promise<Brand>;
}

const Ctx = createContext<BrandCtx>({
  brand: DEFAULT_BRAND,
  ready: false,
  refresh: async () => {},
  save: async () => DEFAULT_BRAND,
});

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (isBridgeUnreachableContext()) { setReady(true); return; }
    try {
      const r = await fetch(`${resolveApiBaseUrl()}/api/brand`, { headers: { "content-type": "application/json" } });
      if (!r.ok) throw new Error(`brand fetch ${r.status}`);
      const j = (await r.json()) as Partial<Brand>;
      setBrand({ ...DEFAULT_BRAND, ...j });
    } catch {
      // Middleware not running → keep defaults; UI stays generic, no crash.
    } finally {
      setReady(true);
    }
  }, []);

  const save = useCallback(async (patch: Partial<Brand>) => {
    const r = await fetch(`${resolveApiBaseUrl()}/api/brand`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text().catch(() => `brand save ${r.status}`));
    const j = (await r.json()) as Partial<Brand>;
    const next = { ...DEFAULT_BRAND, ...j };
    setBrand(next);
    return next;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Keep <title> in sync with whatever the operator chose.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const t = brand.tagline ? `${brand.app_name} — ${brand.tagline}` : brand.app_name;
    document.title = t;
  }, [brand.app_name, brand.tagline]);

  const value = useMemo<BrandCtx>(() => ({ brand, ready, refresh, save }), [brand, ready, refresh, save]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useBrand = () => useContext(Ctx);
