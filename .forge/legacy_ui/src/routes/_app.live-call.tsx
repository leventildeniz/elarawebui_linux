// Faz 19 — Live Call WS Diagnostics panel. Consumes /ws/live-call to expose
// connection state, latency, and the protocol-level echo/ping helpers we
// hardened in Faz 18. Useful both as a developer tool and as a smoke probe
// surfaced inside the UI.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { LiveCallSocket, type LiveServerMsg } from "@/lib/live-call-ws";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Plug, Unplug, Send, RadioTower, Activity } from "lucide-react";

export const Route = createFileRoute("/_app/live-call")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && !localStorage.getItem("user")) {
      throw redirect({ to: "/login" });
    }
  },
  component: LiveCallDiagPage,
});

type LogLine = { ts: number; dir: "in" | "out" | "sys"; text: string };
type Status = "idle" | "connecting" | "open" | "closed" | "error";

const STATUS_COLORS: Record<Status, string> = {
  idle: "bg-muted",
  connecting: "bg-yellow-500",
  open: "bg-emerald-500",
  closed: "bg-muted-foreground",
  error: "bg-destructive",
};

function LiveCallDiagPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [bridgeInfo, setBridgeInfo] = useState<{ url: string; candidateIndex: number; candidateCount: number } | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [lastReadyMs, setLastReadyMs] = useState<number | null>(null);
  const [lastPongMs, setLastPongMs] = useState<number | null>(null);
  const sockRef = useRef<LiveCallSocket | null>(null);
  const connectedAtRef = useRef<number>(0);
  const pingSentAtRef = useRef<number>(0);

  const append = useCallback((dir: LogLine["dir"], text: string) => {
    setLogs((prev) => [{ ts: Date.now(), dir, text }, ...prev].slice(0, 200));
  }, []);

  const onMessage = useCallback((msg: LiveServerMsg) => {
    append("in", JSON.stringify(msg));
    if (msg.type === "ready") {
      setLastReadyMs(Date.now() - connectedAtRef.current);
    } else if (msg.type === "pong") {
      if (pingSentAtRef.current) setLastPongMs(Date.now() - pingSentAtRef.current);
    }
  }, [append]);

  const onStatus = useCallback((s: Status, info?: { url: string; candidateIndex: number; candidateCount: number }) => {
    setStatus(s);
    if (info) setBridgeInfo({ url: info.url, candidateIndex: info.candidateIndex, candidateCount: info.candidateCount });
    append("sys", info ? `status: ${s} · ${info.url} (${info.candidateIndex === 0 ? "primary" : `fallback #${info.candidateIndex}`})` : `status: ${s}`);
  }, [append]);

  const connect = useCallback(() => {
    if (sockRef.current) return;
    connectedAtRef.current = Date.now();
    setLastReadyMs(null);
    setLastPongMs(null);
    const sock = new LiveCallSocket(onMessage, onStatus);
    sockRef.current = sock;
    sock.connect();
  }, [onMessage, onStatus]);

  const disconnect = useCallback(() => {
    sockRef.current?.close();
    sockRef.current = null;
    setStatus("closed");
  }, []);

  useEffect(() => () => { sockRef.current?.close(); sockRef.current = null; }, []);

  const sendPing = () => {
    if (!sockRef.current || status !== "open") return;
    pingSentAtRef.current = Date.now();
    sockRef.current.send({ type: "ping" });
    append("out", '{"type":"ping"}');
  };

  const sendEcho = () => {
    if (!sockRef.current || status !== "open") return;
    const payload = { n: Math.floor(Math.random() * 1000), at: Date.now() };
    sockRef.current.send({ type: "echo", payload });
    append("out", JSON.stringify({ type: "echo", payload }));
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RadioTower className="h-6 w-6" /> Live Call Diagnostics
          </h1>
          <p className="text-sm text-muted-foreground font-mono">/ws/live-call · protocol-level echo + heartbeat</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {bridgeInfo && (
            <Badge
              variant="outline"
              className={`font-mono text-[10px] ${bridgeInfo.candidateIndex === 0 ? "border-emerald-500/50 text-emerald-500" : "border-orange-500/50 text-orange-500"}`}
              title={bridgeInfo.url}
            >
              {bridgeInfo.candidateIndex === 0
                ? `PRIMARY · ${new URL(bridgeInfo.url).host}`
                : `FALLBACK #${bridgeInfo.candidateIndex} · ${new URL(bridgeInfo.url).host}`}
            </Badge>
          )}
          <Badge variant="outline" className="font-mono text-[10px] gap-2">
            <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[status]} ${status === "open" ? "animate-pulse" : ""}`} />
            {status.toUpperCase()}
          </Badge>
          {status !== "open" ? (
            <Button size="sm" onClick={connect} disabled={status === "connecting"}>
              <Plug className="h-4 w-4 mr-2" /> Connect
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={disconnect}>
              <Unplug className="h-4 w-4 mr-2" /> Disconnect
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-1"><span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Ready Latency</span></CardHeader>
          <CardContent className="text-2xl font-mono">{lastReadyMs == null ? "—" : `${lastReadyMs} ms`}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Last Pong RTT</span></CardHeader>
          <CardContent className="text-2xl font-mono">{lastPongMs == null ? "—" : `${lastPongMs} ms`}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Message Count</span></CardHeader>
          <CardContent className="text-2xl font-mono">{logs.length}</CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={sendPing} disabled={status !== "open"}>
          <Activity className="h-4 w-4 mr-2" /> Send Ping
        </Button>
        <Button size="sm" variant="secondary" onClick={sendEcho} disabled={status !== "open"}>
          <Send className="h-4 w-4 mr-2" /> Send Echo
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2"><span className="text-sm font-mono uppercase tracking-widest text-muted-foreground">Message Stream</span></CardHeader>
        <CardContent>
          <div className="font-mono text-[11px] space-y-1 max-h-[420px] overflow-auto">
            {logs.length === 0 && <p className="text-muted-foreground">No messages yet.</p>}
            {logs.map((l, i) => (
              <div key={`${l.ts}_${i}`} className="flex gap-2 items-start">
                <span className="text-muted-foreground shrink-0">{new Date(l.ts).toLocaleTimeString()}</span>
                <Badge
                  variant="outline"
                  className={`text-[9px] font-mono shrink-0 ${
                    l.dir === "in" ? "border-emerald-500/50 text-emerald-500" :
                    l.dir === "out" ? "border-blue-500/50 text-blue-500" :
                    "border-muted-foreground/50 text-muted-foreground"
                  }`}
                >{l.dir}</Badge>
                <span className="break-all">{l.text}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
