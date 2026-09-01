import { useEffect, useRef, useState } from "react";

/**
 * RAF freeze detector — ana thread'in kaç ms boyunca bloklandığını ölçer.
 * 60fps'te frame aralığı ~16ms; `thresholdMs`'in üstüne çıkan her tick
 * "freeze" sayılır ve son N tanesi tutulur.
 *
 * Hafif: tek RAF döngüsü, state set'i SADECE freeze tespit edildiğinde tetiklenir.
 */
export interface FreezeSample {
  ts: number;
  blockedMs: number;
}

export function useFreezeDetector(enabled: boolean, thresholdMs = 250, maxSamples = 20) {
  const [samples, setSamples] = useState<FreezeSample[]>([]);
  const [lastFrameGapMs, setLastFrameGapMs] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let lastTs = performance.now();
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      const gap = now - lastTs;
      lastTs = now;
      setLastFrameGapMs(Math.round(gap));
      if (gap >= thresholdMs) {
        const evt: FreezeSample = { ts: Date.now(), blockedMs: Math.round(gap) };
        // eslint-disable-next-line no-console
        console.warn(`[chat-freeze] main thread blocked ${evt.blockedMs}ms`);
        setSamples((prev) => [...prev, evt].slice(-maxSamples));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, thresholdMs, maxSamples]);

  return { samples, lastFrameGapMs };
}
