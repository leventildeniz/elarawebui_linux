// Faz 1 — Dell → Mac tek-bakış bağlantı doğrulayıcı.
// Mevcut SystemAPI.health, BridgeAPI.health gibi çağrıları KIRMADAN üzerine
// "Dell tarayıcısından Mac bridge'e gerçekten ulaşıyor muyum?" sorusunu tek
// fonksiyonla cevaplayan ince bir helper. UI bunu rozet/teşhis panelinde
// kullanacak. Auth (Faz 2) ve queue (Faz 4) eklenince aynı yapı genişleyecek.

import {
  resolveApiBaseUrl,
  getBridgeCandidates,
  isBridgeUnreachableContext,
  isCloudPreviewHost,
} from "./api-client";

export type BridgeLinkLevel = "ok" | "degraded" | "down" | "skipped";

export interface BridgeLinkProbe {
  /** Çözülen base URL — `http(s)://<host>:<port>` */
  baseUrl: string;
  /** Sondajlanan tüm adaylar (override + current-origin + mDNS). */
  candidates: string[];
  /** Cloud preview gibi LAN'a hiç çıkmayan ortam mı? */
  reachable: boolean;
  /** Genel durum. */
  level: BridgeLinkLevel;
  /** İnsan okunur kısa mesaj (UI rozeti için). */
  message: string;
  /** Bridge `/api/health` cevabı (varsa). */
  bridge: { ok: boolean; status?: number; latencyMs: number; error?: string };
  /** Auth gate Faz 2'de eklenecek; şimdilik passthrough. */
  auth: { required: boolean; ok: boolean; note: string };
  /** Probe zamanı. */
  ts: number;
}

const DEFAULT_TIMEOUT_MS = 1500;

async function timedFetch(url: string, ms: number): Promise<{ ok: boolean; status: number; latencyMs: number; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), ms);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "GET", mode: "cors", signal: ctrl.signal });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - t0 };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - t0,
      error: String((e as Error)?.message || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dell → Mac bridge bağlantısını tek seferde doğrular. Hızlı, idempotent,
 * yan etkisiz. UI'da "bağlandın mı / nereye / ne kadar sürdü" rozeti için.
 */
export async function probeBridgeLink(opts: { timeoutMs?: number } = {}): Promise<BridgeLinkProbe> {
  const ts = Date.now();
  const candidates = getBridgeCandidates();
  const baseUrl = resolveApiBaseUrl();

  // Cloud preview origin → LAN bridge tasarımı gereği erişilemez.
  if (isBridgeUnreachableContext()) {
    return {
      baseUrl,
      candidates,
      reachable: false,
      level: "skipped",
      message: isCloudPreviewHost()
        ? "Cloud önizlemesi LAN köprüsünü göremez (operatör URL'i tanımlı değil)"
        : "Köprü hedefi tanımsız",
      bridge: { ok: false, latencyMs: 0, error: "unreachable_context" },
      auth: { required: false, ok: true, note: "skipped" },
      ts,
    };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probe = await timedFetch(`${baseUrl}/api/health`, timeoutMs);

  const bridge = {
    ok: probe.ok,
    status: probe.status || undefined,
    latencyMs: probe.latencyMs,
    error: probe.error,
  };

  const level: BridgeLinkLevel = probe.ok ? (probe.latencyMs > 800 ? "degraded" : "ok") : "down";
  const message = probe.ok
    ? `Mac bridge cevap verdi · ${probe.latencyMs} ms`
    : `Mac bridge cevap vermedi${probe.error ? ` · ${probe.error}` : ""}`;

  return {
    baseUrl,
    candidates,
    reachable: true,
    level,
    message,
    bridge,
    // Faz 2'de buraya gerçek session probe gelecek.
    auth: { required: false, ok: true, note: "auth gate Faz 2'de eklenecek" },
    ts,
  };
}
