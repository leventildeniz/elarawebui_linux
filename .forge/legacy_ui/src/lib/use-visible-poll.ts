// Page Visibility-aware polling.
// Background tabs no longer hammer the bridge — wakes immediately on focus.
//
// Drop-in replacement for `useEffect(() => { fn(); const id = setInterval(fn, ms); ... })`.
// Pauses the interval (and the in-flight tick) while the tab is hidden, then
// runs `fn()` again the moment it becomes visible.
import { useEffect, useRef, useState } from "react";

export function useVisiblePoll(fn: () => void | Promise<void>, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const tick = () => { if (!cancelled) void fnRef.current(); };
    const start = () => {
      if (id != null) return;
      tick();
      id = setInterval(tick, ms);
    };
    const stop = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVis = () => { (typeof document !== "undefined" && document.hidden) ? stop() : start(); };
    if (typeof document !== "undefined") {
      if (!document.hidden) start();
      document.addEventListener("visibilitychange", onVis);
    } else {
      start();
    }
    return () => {
      cancelled = true;
      stop();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms, enabled]);
}

export function useChatStreamingFlag() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onStreaming = (e: Event) => {
      const detail = (e as CustomEvent).detail as { active?: boolean } | undefined;
      setActive(!!detail?.active);
    };
    window.addEventListener("chat:streaming", onStreaming as EventListener);
    return () => window.removeEventListener("chat:streaming", onStreaming as EventListener);
  }, []);
  return active;
}
