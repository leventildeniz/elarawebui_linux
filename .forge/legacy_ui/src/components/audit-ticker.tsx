import { useEffect, useRef, useState } from "react";
import { AuditAPI, type AuditEvent } from "@/lib/api-client";
import { Activity } from "lucide-react";

const MAX = 30;

export function AuditTicker() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    const stop = AuditAPI.subscribe((e) => {
      const key = `${e.ts}:${e.message}`;
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      setEvents((prev) => [e, ...prev].slice(0, MAX));
    });
    return stop;
  }, []);

  if (events.length === 0) {
    return (
      <div className="h-7 border-b border-border/40 bg-card/30 flex items-center gap-2 px-3 text-[10px] font-mono text-muted-foreground/60">
        <Activity className="h-3 w-3" />
        <span>Audit feed pending…</span>
      </div>
    );
  }

  // Build a marquee string from recent events
  const stream = events
    .map((e) => {
      const t = new Date(e.ts).toLocaleTimeString();
      const dot = e.level === "error" ? "●" : e.level === "warn" ? "▲" : "·";
      return `[${t}] ${dot} ${e.agent.toUpperCase()} → ${e.message}`;
    })
    .join("    ");

  return (
    <div className="h-7 border-b border-border/40 bg-card/30 overflow-hidden flex items-center gap-2 px-3">
      <Activity className="h-3 w-3 text-primary shrink-0" />
      <div className="flex-1 overflow-hidden whitespace-nowrap">
        <div className="inline-block animate-audit-scroll text-[10px] font-mono text-muted-foreground">
          <span className="px-2">{stream}</span>
          <span className="px-2 opacity-50">{stream}</span>
        </div>
      </div>
    </div>
  );
}
