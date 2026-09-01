/**
 * Elara Sovereign Studio — local credential plane.
 *
 * The studio directory (group-store) holds *who* a principal is; this store
 * holds the local passphrase digest that lets them through the gate. Only
 * `Local` style bootstrap credentials live here — federated providers (LDAP,
 * SAML, OIDC…) are verified upstream in a real deployment.
 *
 * NOTE: this is a browser-side studio preview, so the digest is a salted
 * non-cryptographic hash — enough to avoid storing the passphrase in the
 * clear, never a substitute for server-side hashing.
 */

const KEY = "sovereign:credentials";
const SALT = "elara::sovereign::v1";

import { fetchApi } from "@/lib/api";

export type CredentialRecord = { hash: string; at: string };

function readAll(): Record<string, CredentialRecord> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, CredentialRecord>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, CredentialRecord>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
}

function digest(value: string): string {
  const input = `${SALT}:${value}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** True when the principal has rotated a passphrase of their own. */
export function hasPassphrase(accountId: string): boolean {
  return Boolean(readAll()[accountId]);
}

export async function updateAccountPassword(id: string, password: string) {
  try {
    await fetchApi(`/api/identity/users/${id}/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    });
    // Write local mock digest so UI verify doesn't reject it in browser preview
    const map = readAll();
    map[id] = { hash: digest(password), at: new Date().toISOString() };
    writeAll(map);
  } catch (err) {
    console.error("Failed to update password", err);
    throw err;
  }
}

export function clearPassphrase(accountId: string) {
  const map = readAll();
  delete map[accountId];
  writeAll(map);
}

export type VerifyResult = "ok" | "bootstrap" | "rejected";

/**
 * Verify a passphrase for a principal.
 *
 * - A rotated passphrase must match its digest.
 * - An account that never rotated one is still in **bootstrap**: any of the
 *   principal's own handles (operator ID, e-mail local part, first name) is
 *   the first-use credential, exactly like a freshly provisioned appliance
 *   account. The gate reports this so the UI can nudge a rotation.
 */
export function verifyPassphrase(
  accountId: string,
  handles: string | string[],
  passphrase: string,
): VerifyResult {
  const record = readAll()[accountId];
  if (record) return record.hash === digest(passphrase) ? "ok" : "rejected";
  const attempt = passphrase.trim().toLowerCase();
  const accepted = (Array.isArray(handles) ? handles : [handles])
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return accepted.includes(attempt) ? "bootstrap" : "rejected";
}
