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

/**
 * Standard fetch wrapper for ELARA Sovereign Studio.
 * Automatically injects the `x-session-id` header if present in localStorage.
 */
export async function fetchApi(endpoint: string, options: RequestInit = {}): Promise<any> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  // In SSR environments (if any), localStorage might be undefined.
  if (typeof window !== "undefined") {
    const sessionId = localStorage.getItem("sovereign.sessionId");
    if (sessionId) {
      headers.set("x-session-id", sessionId);
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
