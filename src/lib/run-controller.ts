import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type RunState = "idle" | "starting" | "running" | "stopping" | "stopped" | "done";

export type RunStep = { id: string; label: string };

/**
 * Drives a staged execution over graph nodes: start → step-by-step → stop / restart.
 * Purely presentational simulation of a dispatch, but with real controllable state.
 */
export function useRunController(opts: {
  steps: RunStep[];
  label: string;
  intervalMs?: number;
  onComplete?: () => void;
  /** Return false to abort the start (e.g. signature verification failed). */
  preflight?: () => boolean;
  onStop?: () => void;
  onRestart?: () => void;
}) {
  const { steps, label, intervalMs = 900, onComplete } = opts;
  const preflightRef = useRef(opts.preflight);
  preflightRef.current = opts.preflight;
  const stopRef = useRef(opts.onStop);
  stopRef.current = opts.onStop;
  const restartRef = useRef(opts.onRestart);
  restartRef.current = opts.onRestart;
  const [state, setState] = useState<RunState>("idle");
  const [index, setIndex] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => clear, []);

  const tick = useCallback(
    (i: number) => {
      const list = stepsRef.current;
      if (i >= list.length) {
        setState("done");
        setIndex(-1);
        completeRef.current?.();
        toast.success(`${label} finished`, { description: `${list.length} stages executed` });
        return;
      }
      setIndex(i);
      timer.current = setTimeout(() => tick(i + 1), intervalMs);
    },
    [intervalMs, label],
  );

  const start = useCallback(() => {
    if (!stepsRef.current.length) {
      toast.error("Nothing to run", { description: "Add at least one node to the canvas" });
      return;
    }
    if (preflightRef.current && preflightRef.current() === false) return;
    clear();
    setState("starting");
    toast.info(`${label} starting…`, { description: `${stepsRef.current.length} stages queued` });
    timer.current = setTimeout(() => {
      setState("running");
      tick(0);
    }, 450);
  }, [label, tick]);

  const stop = useCallback(() => {
    clear();
    setState("stopping");
    if (stopRef.current) stopRef.current();
    timer.current = setTimeout(() => {
      setState("stopped");
      setIndex(-1);
      toast.warning(`${label} stopped`, { description: "Execution halted by operator" });
    }, 350);
  }, [label]);

  const restart = useCallback(() => {
    if (preflightRef.current && preflightRef.current() === false) return;
    clear();
    setState("stopping");
    setIndex(-1);
    if (restartRef.current) restartRef.current();
    timer.current = setTimeout(() => {
      setState("starting");
      toast.info(`${label} restarting…`);
      timer.current = setTimeout(() => {
        setState("running");
        tick(0);
      }, 400);
    }, 300);
  }, [label, tick]);

  const active = state === "starting" || state === "running" || state === "stopping";
  const current = index >= 0 ? (steps[index] ?? null) : null;
  const progress = steps.length && index >= 0 ? Math.round(((index + 1) / steps.length) * 100) : 0;

  return { state, active, current, index, progress, start, stop, restart };
}
