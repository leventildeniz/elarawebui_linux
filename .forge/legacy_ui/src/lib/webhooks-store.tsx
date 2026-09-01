// Webhooks store — Mimar tarafından düzenlenebilir webhook kayıtları.
// İki katman:
//   1) builtins  → 5 sabit protokol adaptörü (Telegram/Teams/WhatsApp/Signal/Generic)
//                  için Mimar yerel override (etkin/pasif + secret + URL).
//   2) customs   → Mimar'ın elle eklediği serbest webhook abonelikleri.
// Tüm veri tarayıcıda tutulur (localStorage). Bridge tarafına yazma yapılmaz —
// Mimar bridge .env'sini fiziksel olarak ayrı yönetir; bu panel kayıt defteridir.
import { useSyncExternalStore } from "react";

export type BuiltinWebhookKey = "telegram" | "teams" | "whatsapp" | "signal" | "generic";

export interface BuiltinOverride {
  enabled: boolean;
  secret: string;       // local copy / draft — secret value the operator pasted
  urlOverride: string;  // optional — override the URL shown by the bridge
  notes: string;
}

export interface CustomWebhook {
  id: string;
  label: string;
  url: string;
  secret: string;
  tag: string;
  enabled: boolean;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface WebhooksState {
  builtins: Record<BuiltinWebhookKey, BuiltinOverride>;
  customs: CustomWebhook[];
}

const KEY = "sys.webhooks.v1";

const emptyBuiltin = (): BuiltinOverride => ({
  enabled: false, secret: "", urlOverride: "", notes: "",
});

const DEFAULT_STATE: WebhooksState = {
  builtins: {
    telegram: emptyBuiltin(),
    teams:    emptyBuiltin(),
    whatsapp: emptyBuiltin(),
    signal:   emptyBuiltin(),
    generic:  emptyBuiltin(),
  },
  customs: [],
};

function load(): WebhooksState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<WebhooksState>;
    return {
      builtins: { ...DEFAULT_STATE.builtins, ...(parsed.builtins || {}) },
      customs: Array.isArray(parsed.customs) ? parsed.customs : [],
    };
  } catch { return DEFAULT_STATE; }
}

let state: WebhooksState = load();
const listeners = new Set<() => void>();
function emit() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
  listeners.forEach((l) => l());
}

export function getWebhooksSnapshot(): WebhooksState { return state; }
export function subscribeWebhooks(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// Stable empty-state snapshot for SSR — useSyncExternalStore requires a constant ref.
const SSR_SNAPSHOT: WebhooksState = DEFAULT_STATE;

export function useWebhooks(): WebhooksState {
  return useSyncExternalStore(subscribeWebhooks, getWebhooksSnapshot, () => SSR_SNAPSHOT);
}

// ---- Mutations ----------------------------------------------------------
export function updateBuiltin(key: BuiltinWebhookKey, patch: Partial<BuiltinOverride>) {
  state = {
    ...state,
    builtins: { ...state.builtins, [key]: { ...state.builtins[key], ...patch } },
  };
  emit();
}

export function resetBuiltin(key: BuiltinWebhookKey) {
  updateBuiltin(key, emptyBuiltin());
}

export function addCustom(input: Omit<CustomWebhook, "id" | "createdAt" | "updatedAt">) {
  const now = Date.now();
  const id = `wh_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  state = { ...state, customs: [...state.customs, { ...input, id, createdAt: now, updatedAt: now }] };
  emit();
  return id;
}

export function updateCustom(id: string, patch: Partial<Omit<CustomWebhook, "id" | "createdAt">>) {
  state = {
    ...state,
    customs: state.customs.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)),
  };
  emit();
}

export function removeCustom(id: string) {
  state = { ...state, customs: state.customs.filter((c) => c.id !== id) };
  emit();
}
