import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * LazyTextarea — local-buffer textarea.
 * Holds keystrokes in local state to avoid re-rendering heavy parent forms
 * on every keypress. Commits upstream on blur and on a debounced timer.
 *
 * Drop-in for <textarea>/<Textarea>: value/onChange/placeholder/rows/className.
 */
type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (next: string) => void;
  /** Debounce in ms for upstream commit while typing. 0 disables debounce (commit only on blur). */
  debounceMs?: number;
  /** When false, never commits while typing — only on blur. Overrides debounceMs. */
  commitOnChange?: boolean;
};

export const LazyTextarea = React.forwardRef<HTMLTextAreaElement, Props>(
  ({ value, onChange, debounceMs = 400, commitOnChange = true, className, onBlur, ...rest }, ref) => {
    const [local, setLocal] = React.useState<string>(value ?? "");
    const lastUpstream = React.useRef<string>(value ?? "");
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sync downward when parent value changes from outside (e.g. load, reset).
    React.useEffect(() => {
      if ((value ?? "") !== lastUpstream.current) {
        lastUpstream.current = value ?? "";
        setLocal(value ?? "");
      }
    }, [value]);

    const commit = React.useCallback(
      (next: string) => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        if (next !== lastUpstream.current) {
          lastUpstream.current = next;
          onChange(next);
        }
      },
      [onChange],
    );

    React.useEffect(() => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    return (
      <textarea
        ref={ref}
        {...rest}
        value={local}
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          if (commitOnChange && debounceMs > 0) {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => commit(v), debounceMs);
          }
        }}
        onBlur={(e) => {
          commit(local);
          onBlur?.(e);
        }}
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-left shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      />
    );
  },
);
LazyTextarea.displayName = "LazyTextarea";
