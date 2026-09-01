// Tiny WebSocket client for /ws/live-call
// Builds ws:// or wss:// from the configured API base URL.
import { resolveApiBaseUrl, getBridgeCandidates } from "@/lib/api-client";

export type LiveServerMsg =
  | { type: "ready"; ts: number }
  | { type: "ack"; session: { threadId: string | null; model: string } }
  | { type: "delta"; chunk: string }
  | { type: "done"; source: string; latencyMs: number }
  | { type: "vision"; ok: boolean; text?: string; source?: string; error?: string }
  | { type: "pong"; ts: number }
  | { type: "echo"; payload: unknown; ts: number }
  | { type: "error"; message: string };

export type LiveClientMsg =
  | { type: "hello"; threadId: string | null; model: string; mode: string; agents: string[]; history?: { role: string; content: string }[] }
  | { type: "user"; text: string }
  | { type: "frame"; image: string; lang?: string }
  | { type: "ping" }
  | { type: "echo"; payload: unknown };

export function liveCallWsUrl(): string {
  const base = resolveApiBaseUrl().replace(/^http/i, (m) => (m.toLowerCase() === "https" ? "wss" : "ws"));
  return `${base}/ws/live-call`;
}

export function liveCallWsUrlForBase(baseUrl: string): string {
  const base = baseUrl.replace(/^http/i, (m) => (m.toLowerCase() === "https" ? "wss" : "ws"));
  return `${base}/ws/live-call`;
}

export type LiveCallStatus = "connecting" | "open" | "closed" | "error";
export interface LiveCallStatusInfo {
  status: LiveCallStatus;
  url: string;
  candidateIndex: number;   // 0 = primary, >0 = fallback
  candidateCount: number;
}

export class LiveCallSocket {
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry = 0;
  private closedByUser = false;
  private queue: string[] = [];
  private candidateIndex = 0;
  private currentUrl = "";
  private candidateCount = 1;

  constructor(
    private onMessage: (msg: LiveServerMsg) => void,
    private onStatus: (status: LiveCallStatus, info?: LiveCallStatusInfo) => void,
  ) {}

  private emit(status: LiveCallStatus) {
    this.onStatus(status, {
      status,
      url: this.currentUrl,
      candidateIndex: this.candidateIndex,
      candidateCount: this.candidateCount,
    });
  }

  connect() {
    this.closedByUser = false;
    this.emit("connecting");
    try {
      const candidates = getBridgeCandidates();
      this.candidateCount = Math.max(1, candidates.length);
      const base = candidates[this.candidateIndex % this.candidateCount] || resolveApiBaseUrl();
      this.currentUrl = liveCallWsUrlForBase(base);
      const ws = new WebSocket(this.currentUrl);
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
        this.emit("open");
        // Flush queued messages from before handshake completed
        for (const m of this.queue) ws.send(m);
        this.queue = [];
        // Heartbeat: keep NAT/proxies happy on the LAN
        this.heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 15000);
      };
      ws.onmessage = (ev) => {
        try { this.onMessage(JSON.parse(String(ev.data))); } catch { /* ignore */ }
      };
      ws.onerror = () => this.emit("error");
      ws.onclose = () => {
        this.emit("closed");
        if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
        if (!this.closedByUser) {
          this.candidateIndex += 1;
          // Exponential backoff up to 8s
          const delay = Math.min(8000, 500 * Math.pow(2, this.retry++));
          setTimeout(() => this.connect(), delay);
        }
      };
    } catch {
      this.emit("error");
    }
  }

  send(msg: LiveClientMsg) {
    const payload = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(payload);
    else this.queue.push(payload);
  }

  close() {
    this.closedByUser = true;
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    try { this.ws?.close(); } catch { /* */ }
    this.ws = null;
  }
}
