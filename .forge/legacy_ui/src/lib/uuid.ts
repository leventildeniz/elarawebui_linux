// Safe UUID generator with fallback for non-secure contexts (HTTP/IP access).
// Browsers expose crypto.randomUUID only in Secure Contexts (HTTPS/localhost).
export function getUUID(): string {
  try {
    if (typeof globalThis !== "undefined" && (globalThis as any).crypto?.randomUUID) {
      return (globalThis as any).crypto.randomUUID();
    }
  } catch {
    // ignore and fall through to fallback
  }
  // RFC4122 v4-ish fallback using Math.random (good enough for client-side IDs)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
