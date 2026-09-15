export class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = "ApiError";
  }
}

export function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const h: Record<string, string> = {};
  const sessionId = localStorage.getItem("sovereign.sessionId");
  if (sessionId) h["x-session-id"] = sessionId;
  const operator = sessionStorage.getItem("sovereign.operator");
  if (operator) h["x-user"] = operator;
  const userRaw = localStorage.getItem("sovereign.user");
  if (userRaw) {
    try {
      const u = JSON.parse(userRaw);
      if (u?.username && !h["x-user"]) h["x-user"] = u.username;
      if (u?.id) h["x-user-id"] = u.id;
      if (u?.role) h["x-user-role"] = u.role;
      if (u?.tenantId || u?.tenant_id) h["x-tenant-id"] = u.tenantId || u.tenant_id;
    } catch {}
  }
  return h;
}

/**
 * Standard fetch wrapper for ELARA Sovereign Studio.
 * Automatically injects the `x-session-id` and actor identity headers.
 */
export async function fetchApi<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const extra = authHeaders();
  for (const [k, v] of Object.entries(extra)) {
    if (!headers.has(k)) {
      headers.set(k, v);
    }
  }

  const endpointUrl = endpoint.startsWith("http") ? endpoint : `/api${endpoint.replace(/^\/api/, "")}`;

  const response = await fetch(endpointUrl, {
    ...options,
    headers,
  });

  let data;
  try {
    data = await response.json();
  } catch (e) {
    data = null;
  }

  if (!response.ok) {
    throw new ApiError(
      data?.error || `Request failed with status ${response.status}`,
      response.status,
      data
    );
  }

  return data;
}
