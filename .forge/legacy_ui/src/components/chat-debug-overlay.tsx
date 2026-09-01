import { useEffect, useState } from "react";
import { getChatTrace, type ChatTraceEvent } from "@/lib/api-client";
import { useFreezeDetector } from "@/lib/use-freeze-detector";

/**
 * Chat UI kara-kutu overlay.
 *
 * Aktivasyon:
 *   • URL'e `?debug=chat` ekle, ya da
 *   • DevTools console: `localStorage.setItem("elara_chat_debug","1")` + refresh
 *
 * Gösterir:
 *   • streaming (React state) + busyRef (window.__elaraChat?.busy)
 *   • aktif traceId, son phase, delta count, son delta'dan beri ms
 *   • main thread RAF gap'i (kırmızı = freeze)
 *   • son 8 chat-trace event'i
 *
 * NOT: Hiçbir send() state'ine dokunmuyor; sadece okur ve global event dinler.
 */
interface Props {
  enabled: boolean;
  streaming: boolean;
  activeTraceId: string | null;
}

export function ChatDebugOverlay({ enabled, streaming, activeTraceId }: Props) {
  const [deltaCount, setDeltaCount] = useState(0);
  const [lastDeltaAt, setLastDeltaAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [lastPhase, setLastPhase] = useState<string>("—");
  const [recent, setRecent] = useState<ChatTraceEvent[]>([]);
  const { samples: freezes, lastFrameGapMs } = useFreezeDetector(enabled, 250, 8);

  // chat:delta event listener — api-client her delta'da dispatch eder.
  useEffect(() => {
    if (!enabled) return;
    const onDelta = () => {
      setDeltaCount((c) => c + 1);
      setLastDeltaAt(Date.now());
    };
    const onStream = (e: Event) => {
      const detail = (e as CustomEvent).detail as { active?: boolean } | undefined;
      if (detail?.active) {
        // yeni tur başlıyor — sayaçları sıfırla
        setDeltaCount(0);
        setLastDeltaAt(null);
        setLastPhase("accepted");
      }
    };
    const onPhase = (e: Event) => {
      const detail = (e as CustomEvent).detail as { phase?: string } | undefined;
      if (detail?.phase) setLastPhase(detail.phase);
    };
    window.addEventListener("chat:delta", onDelta);
    window.addEventListener("chat:streaming", onStream);
    window.addEventListener("chat:phase", onPhase);
    return () => {
      window.removeEventListener("chat:delta", onDelta);
      window.removeEventListener("chat:streaming", onStream);
      window.removeEventListener("chat:phase", onPhase);
    };
  }, [enabled]);

  // her 500ms: now tick + trace tail refresh
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => {
      setNowTick(Date.now());
      if (activeTraceId) {
        setRecent(getChatTrace(activeTraceId).slice(-8));
      } else {
        setRecent(getChatTrace().slice(-8));
      }
    }, 500);
    return () => window.clearInterval(t);
  }, [enabled, activeTraceId]);

  if (!enabled) return null;

  const sinceDelta = lastDeltaAt ? nowTick - lastDeltaAt : null;
  const frameWarn = lastFrameGapMs >= 250;
  // busyRef'i window'a yansıt — _app.chat tarafında set ediliyor (opt-in).
  const busy = typeof window !== "undefined"
    ? Boolean((window as unknown as { __elaraChat?: { busy?: boolean } }).__elaraChat?.busy)
    : false;

  return (
    <div
      className="fixed top-2 right-2 z-[9999] max-w-[360px] rounded-md border border-border bg-background/95 backdrop-blur px-3 py-2 text-[11px] font-mono shadow-xl"
      style={{ pointerEvents: "none" }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold text-foreground">chat-debug</span>
        <span className={frameWarn ? "text-destructive font-bold" : "text-muted-foreground"}>
          raf {lastFrameGapMs}ms
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
        <span>streaming</span><span className={streaming ? "text-green-500" : ""}>{String(streaming)}</span>
        <span>busyRef</span><span className={busy ? "text-yellow-500" : ""}>{String(busy)}</span>
        <span>phase</span><span className="text-foreground truncate">{lastPhase}</span>
        <span>deltas</span><span className="text-foreground">{deltaCount}</span>
        <span>since Δ</span><span className={sinceDelta && sinceDelta > 3000 ? "text-destructive" : "text-foreground"}>{sinceDelta !== null ? `${sinceDelta}ms` : "—"}</span>
        <span>freezes</span><span className={freezes.length ? "text-destructive font-bold" : ""}>{freezes.length}</span>
      </div>
      {activeTraceId && (
        <div className="mt-1 text-[10px] text-muted-foreground truncate" title={activeTraceId}>
          tid: {activeTraceId}
        </div>
      )}
      {recent.length > 0 && (
        <div className="mt-1 border-t border-border pt-1 text-[10px] space-y-0.5 max-h-32 overflow-hidden">
          {recent.map((e, i) => (
            <div key={i} className="truncate">
              <span className="text-muted-foreground">+{Math.max(0, Math.round((nowTick - e.ts) / 100) / 10)}s</span>{" "}
              <span className={e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-yellow-500" : "text-foreground"}>{e.stage}</span>
            </div>
          ))}
        </div>
      )}
      {freezes.length > 0 && (
        <div className="mt-1 border-t border-destructive/30 pt-1 text-[10px] text-destructive">
          last freeze: {freezes[freezes.length - 1].blockedMs}ms
        </div>
      )}
    </div>
  );
}
