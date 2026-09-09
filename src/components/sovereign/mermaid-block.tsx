import { useEffect, useId, useRef, useState } from "react";
import { Check, Code2, Copy, Download, Eye, Image as ImageIcon } from "lucide-react";
import { HighlightedCode } from "./code-highlight";
import { cn } from "@/lib/utils";

let _mermaidInitialized = false;

async function getMermaid() {
  const m = await import("mermaid");
  const mermaid = m.default || m;
  if (!_mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        darkMode: true,
        background: "transparent",
        mainBkg: "#0c1017",
        textColor: "#eff6fb",
        lineColor: "#4f8cff",
        primaryColor: "#0d2035",
        primaryTextColor: "#eff6fb",
        primaryBorderColor: "#3b82f6",
        secondaryColor: "#0e291e",
        secondaryTextColor: "#eff6fb",
        secondaryBorderColor: "#10b981",
        tertiaryColor: "#261d0a",
        tertiaryTextColor: "#eff6fb",
        tertiaryBorderColor: "#f59e0b",
        nodeBorder: "#3b82f6",
        clusterBkg: "#070b10",
        clusterBorder: "#ffffff18",
        edgeLabelBackground: "#090d14",
        fontSize: "12.5px",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
      },
      flowchart: {
        curve: "basis",
        htmlLabels: true,
        padding: 12,
      },
      securityLevel: "loose",
    });
    _mermaidInitialized = true;
  }
  return mermaid;
}

function useCopy() {
  const [done, setDone] = useState(false);
  return {
    done,
    copy: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      } catch {
        /* clipboard unavailable */
      }
    },
  };
}

function downloadFile(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function MermaidBlock({ code }: { code: string }) {
  const rawId = useId();
  const id = `mm_${rawId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const [view, setView] = useState<"diagram" | "code">("diagram");
  const [svg, setSvg] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const { copy, done } = useCopy();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const cleanCode = code.trim();

    if (!cleanCode) {
      setSvg(null);
      setRenderError(null);
      return;
    }

    getMermaid()
      .then(async (mermaid) => {
        if (!active) return;
        try {
          // Render SVG
          const renderId = `${id}_${Date.now()}`;
          const { svg: renderedSvg } = await mermaid.render(renderId, cleanCode);
          if (active) {
            setSvg(renderedSvg);
            setRenderError(null);
          }
        } catch (err: any) {
          if (active) {
            setRenderError(err?.message || "Invalid diagram syntax");
            // Remove any error DOM artifacts inserted by mermaid
            const errorDom = document.getElementById(`d${id}`);
            if (errorDom) errorDom.remove();
          }
        }
      })
      .catch((e) => {
        if (active) setRenderError(e?.message || "Mermaid load failed");
      });

    return () => {
      active = false;
    };
  }, [code, id]);

  const hasDiagram = !!svg && !renderError;

  return (
    <div className="my-4 overflow-hidden rounded-[14px] border border-sapphire/25 bg-[var(--canvas-deep)] shadow-[0_4px_24px_-10px_rgba(0,0,0,0.5)]">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-raised/20 px-3.5 py-2">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.2em] text-sapphire">
            mermaid diagram
          </span>
          {hasDiagram && (
            <div className="flex items-center gap-1 rounded-md border border-border/60 bg-canvas/60 p-0.5">
              <button
                type="button"
                onClick={() => setView("diagram")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
                  view === "diagram"
                    ? "bg-sapphire/15 text-sapphire"
                    : "text-muted-foreground/60 hover:text-foreground"
                )}
              >
                <Eye size={11} /> Diagram
              </button>
              <button
                type="button"
                onClick={() => setView("code")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
                  view === "code"
                    ? "bg-sapphire/15 text-sapphire"
                    : "text-muted-foreground/60 hover:text-foreground"
                )}
              >
                <Code2 size={11} /> Code
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {hasDiagram && view === "diagram" && (
            <button
              type="button"
              aria-label="Download SVG"
              title="Download SVG Diagram"
              onClick={() => svg && downloadFile(`diagram-${Date.now()}.svg`, svg, "image/svg+xml")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-raised/70 hover:text-foreground"
            >
              <Download className="h-[13.5px] w-[13.5px]" strokeWidth={1.7} />
            </button>
          )}
          <button
            type="button"
            aria-label="Copy Mermaid Code"
            title="Copy Code"
            onClick={() => void copy(code)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              done ? "text-emerald" : "text-muted-foreground/60 hover:bg-raised/70 hover:text-foreground"
            )}
          >
            {done ? <Check className="h-[13.5px] w-[13.5px]" /> : <Copy className="h-[13.5px] w-[13.5px]" strokeWidth={1.7} />}
          </button>
        </div>
      </div>

      {/* Content Body */}
      {view === "diagram" && hasDiagram ? (
        <div
          ref={containerRef}
          className="flex min-h-[140px] items-center justify-center overflow-x-auto p-5 transition-all [&_svg]:max-w-full [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <pre className="overflow-x-auto px-4 py-3">
          <code className="font-mono text-[13px] leading-[1.7] text-foreground/90">
            <HighlightedCode code={code} />
          </code>
        </pre>
      )}
    </div>
  );
}
