import { useState, useEffect, useRef, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  Download,
  Terminal,
  FileText,
  Layers,
  ChevronDown,
  ChevronRight,
  Square,
  Sparkles,
  Wrench,
  Bot,
  Zap,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import { RichMessage } from "./rich-message";
import { fetchApi } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface RunStepTrace {
  node?: string;
  kind?: string;
  ts?: number;
  output?: unknown;
  error?: string;
  toolId?: string;
  skillSlug?: string;
  agentId?: string;
  agentName?: string;
  workflowId?: string;
  expression?: string;
  result?: boolean;
  [key: string]: unknown;
}

export interface RunOutputData {
  ok?: boolean;
  runId: string;
  wfId?: string;
  chainId?: string;
  status: "running" | "done" | "failed" | "stopped" | "completed";
  startedAt: number;
  endedAt?: number | null;
  durationMs: number;
  stepsDone: number;
  stepsTotal: number;
  currentNode?: string | null;
  trace?: RunStepTrace[];
  output?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  error?: string | null;
}

export interface RunOutputDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string | null;
  type: "workflow" | "chain";
  title?: string;
  onStop?: () => void;
}

export function RunOutputDrawer({
  open,
  onOpenChange,
  runId,
  type,
  title,
  onStop,
}: RunOutputDrawerProps) {
  const [data, setData] = useState<RunOutputData | null>(null);
  const [activeTab, setActiveTab] = useState<"report" | "trace" | "raw">("report");
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0]));
  const [isStopping, setIsStopping] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll live run status
  useEffect(() => {
    if (!open || !runId) {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    let isMounted = true;
    const endpoint =
      type === "workflow"
        ? `/api/workflows/runs/${encodeURIComponent(runId)}`
        : `/api/chains/runs/${encodeURIComponent(runId)}`;

    const fetchStatus = async () => {
      try {
        const res = await fetchApi<RunOutputData>(endpoint);
        if (!isMounted) return;

        setData(res);

        const currentStatus = res.status === "completed" ? "done" : res.status;
        if (currentStatus === "running") {
          pollTimerRef.current = setTimeout(fetchStatus, 600);
        }
      } catch (err) {
        if (!isMounted) return;
        console.warn("[RunOutputDrawer] Status poll error:", err);
      }
    };

    void fetchStatus();

    return () => {
      isMounted = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [open, runId, type]);

  // Extract primary markdown report if available
  const reportMarkdown = useMemo(() => {
    if (!data) return null;
    const out = data.output || data.context;
    if (out && typeof out === "object") {
      const mr = out["markdown_report"];
      if (typeof mr === "string" && mr.trim()) {
        return mr.trim();
      }
      const rep = out["report"];
      if (typeof rep === "string" && rep.trim()) {
        return rep.trim();
      }
      const sum = out["summary"];
      if (typeof sum === "string" && sum.trim()) {
        return `### Execution Summary\n\n${sum.trim()}`;
      }
    }
    if (data.error) {
      return `### Execution Error\n\n\`\`\`text\n${data.error}\n\`\`\``;
    }
    return null;
  }, [data]);

  const handleStop = async () => {
    if (!runId || isStopping) return;
    setIsStopping(true);
    try {
      const stopEndpoint =
        type === "workflow"
          ? `/api/workflows/runs/${encodeURIComponent(runId)}/stop`
          : `/api/chains/runs/${encodeURIComponent(runId)}/stop`;
      await fetchApi(stopEndpoint, { method: "POST" });
      toast.info("Execution stop requested");
      onStop?.();
    } catch (e) {
      toast.error("Failed to stop run", { description: String(e) });
    } finally {
      setIsStopping(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Clipboard write denied");
    }
  };

  const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const statusTone = (status?: string) => {
    switch (status) {
      case "done":
      case "completed":
        return {
          badge: "border-emerald/40 bg-emerald/10 text-emerald",
          dot: "bg-emerald",
          label: "DONE",
        };
      case "running":
        return {
          badge: "border-topaz/40 bg-topaz/10 text-topaz",
          dot: "bg-topaz animate-pulse",
          label: "RUNNING",
        };
      case "failed":
        return {
          badge: "border-ruby/40 bg-ruby/10 text-ruby",
          dot: "bg-ruby",
          label: "FAILED",
        };
      case "stopped":
        return {
          badge: "border-amber-500/40 bg-amber-500/10 text-amber-400",
          dot: "bg-amber-400",
          label: "STOPPED",
        };
      default:
        return {
          badge: "border-border bg-raised/40 text-muted-foreground",
          dot: "bg-muted-foreground",
          label: status?.toUpperCase() || "IDLE",
        };
    }
  };

  const currentStatus = data?.status === "completed" ? "done" : data?.status;
  const tone = statusTone(currentStatus);
  const traceList = data?.trace || [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border/80 bg-panel/95 p-0 backdrop-blur-2xl sm:max-w-2xl lg:max-w-3xl"
      >
        {/* Header */}
        <SheetHeader className="border-b border-border/70 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sapphire/30 bg-sapphire/10 text-sapphire">
                {type === "workflow" ? (
                  <Zap className="h-4 w-4" strokeWidth={1.8} />
                ) : (
                  <GitBranch className="h-4 w-4" strokeWidth={1.8} />
                )}
              </span>
              <div className="min-w-0">
                <SheetTitle className="truncate font-mono text-[14px] font-semibold text-foreground">
                  {title || (type === "workflow" ? "Workflow Execution" : "Chain Execution")}
                </SheetTitle>
                <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground/60">
                  <span>run · {runId || "—"}</span>
                  {data?.durationMs != null && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-foreground/80">
                        <Clock className="h-3 w-3" strokeWidth={1.5} />
                        {data.durationMs < 1000
                          ? `${data.durationMs}ms`
                          : `${(data.durationMs / 1000).toFixed(2)}s`}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Status & Actions */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider",
                  tone.badge,
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                {tone.label}
              </span>

              {currentStatus === "running" && (
                <button
                  onClick={() => void handleStop()}
                  disabled={isStopping}
                  className="flex items-center gap-1 rounded-md border border-ruby/40 bg-ruby/10 px-2.5 py-1 font-mono text-[11px] text-ruby hover:bg-ruby/20 disabled:opacity-50"
                  title="Stop execution"
                >
                  <Square className="h-3 w-3 fill-ruby" />
                  Stop
                </button>
              )}
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-4 flex items-center gap-1 border-t border-border/40 pt-3">
            <button
              onClick={() => setActiveTab("report")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11.5px] transition-colors",
                activeTab === "report"
                  ? "border border-sapphire/40 bg-sapphire/15 text-sapphire font-medium"
                  : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.6} />
              Report
            </button>
            <button
              onClick={() => setActiveTab("trace")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11.5px] transition-colors",
                activeTab === "trace"
                  ? "border border-sapphire/40 bg-sapphire/15 text-sapphire font-medium"
                  : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              <Layers className="h-3.5 w-3.5" strokeWidth={1.6} />
              Execution Trace ({traceList.length})
            </button>
            <button
              onClick={() => setActiveTab("raw")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11.5px] transition-colors",
                activeTab === "raw"
                  ? "border border-sapphire/40 bg-sapphire/15 text-sapphire font-medium"
                  : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              <Terminal className="h-3.5 w-3.5" strokeWidth={1.6} />
              Raw JSON
            </button>
          </div>
        </SheetHeader>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* TAB 1: REPORT VIEW */}
          {activeTab === "report" && (
            <div className="space-y-4">
              {reportMarkdown ? (
                <>
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60">
                      Generated Markdown Artifact
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => void copyText(reportMarkdown, "Markdown report")}
                        className="flex items-center gap-1 rounded border border-border/70 bg-raised/40 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" />
                        Copy
                      </button>
                      <button
                        onClick={() =>
                          downloadFile(
                            `report-${runId || "output"}.md`,
                            reportMarkdown,
                            "text/markdown;charset=utf-8",
                          )
                        }
                        className="flex items-center gap-1 rounded border border-border/70 bg-raised/40 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/6 bg-canvas/40 p-5">
                    <RichMessage text={reportMarkdown} />
                  </div>
                </>
              ) : currentStatus === "running" ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border border-topaz/30 bg-topaz/10 text-topaz">
                    <RefreshCw className="h-6 w-6 animate-spin" />
                  </span>
                  <h4 className="mt-4 font-mono text-[13px] font-semibold text-foreground">
                    Workflow is executing…
                  </h4>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground/60">
                    Step {data?.stepsDone || 0} of {data?.stepsTotal || "—"} nodes completed. Report
                    will display upon finish.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-raised/20 p-8 text-center">
                  <FileText className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <h4 className="mt-3 font-mono text-[13px] text-foreground/80">
                    No Markdown Report generated
                  </h4>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground/60">
                    This graph executed successfully without generating a dedicated
                    `markdown_report` key. Check the Execution Trace or Raw JSON tab to inspect the
                    full output.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: TRACE VIEW */}
          {activeTab === "trace" && (
            <div className="space-y-3">
              {traceList.length === 0 ? (
                <div className="rounded-xl border border-border/60 bg-raised/20 p-8 text-center font-mono text-[11px] text-muted-foreground/60">
                  No execution trace steps recorded yet.
                </div>
              ) : (
                traceList.map((step, idx) => {
                  const isExpanded = expandedSteps.has(idx);
                  const isError = Boolean(step.error);
                  const nodeTitle = String(
                    step["nodeLabel"] ||
                    step.node ||
                    step.toolId ||
                    step.skillSlug ||
                    step.agentId ||
                    `Step #${idx + 1}`
                  );

                  return (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-xl border transition-all duration-200",
                        isError
                          ? "border-ruby/40 bg-ruby/5"
                          : "border-border/60 bg-raised/20 hover:border-border",
                      )}
                    >
                      <button
                        onClick={() => toggleStep(idx)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left font-mono text-[12px]"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-raised/60 text-[10px] text-muted-foreground">
                            {idx + 1}
                          </span>
                          {isError ? (
                            <XCircle className="h-4 w-4 shrink-0 text-ruby" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald" />
                          )}
                          <span className="truncate font-semibold text-foreground/90">
                            {nodeTitle}
                          </span>
                          {step.kind && (
                            <span className="rounded bg-canvas/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground/70">
                              {step.kind}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground/60">
                          {step.ts && (
                            <span className="text-[10px]">
                              {new Date(step.ts).toLocaleTimeString()}
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-border/40 px-4 py-3 font-mono text-[11px]">
                          {step.error && (
                            <div className="mb-2 rounded bg-ruby/10 p-2 text-ruby">
                              Error: {step.error}
                            </div>
                          )}
                          {step.output != null && (
                            <div>
                              <span className="text-[10px] uppercase text-muted-foreground/60">
                                Step Output:
                              </span>
                              <pre className="mt-1 max-h-56 overflow-x-auto rounded-lg bg-canvas/80 p-3 text-[11px] leading-relaxed text-foreground/80">
                                {typeof step.output === "object"
                                  ? JSON.stringify(step.output, null, 2)
                                  : String(step.output)}
                              </pre>
                            </div>
                          )}
                          {step.expression != null && (
                            <div className="mt-2">
                              <span className="text-[10px] uppercase text-muted-foreground/60">
                                Condition Evaluation:
                              </span>
                              <p className="text-foreground/85">
                                <code className="text-sapphire">{step.expression}</code> →{" "}
                                <strong className={step.result ? "text-emerald" : "text-ruby"}>
                                  {String(step.result)}
                                </strong>
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 3: RAW JSON */}
          {activeTab === "raw" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60">
                  Full Payload Response
                </span>
                <button
                  onClick={() =>
                    void copyText(JSON.stringify(data, null, 2), "Raw output JSON")
                  }
                  className="flex items-center gap-1 rounded border border-border/70 bg-raised/40 px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                  Copy JSON
                </button>
              </div>
              <pre className="max-h-160 overflow-x-auto rounded-xl border border-white/6 bg-canvas/70 p-4 font-mono text-[11.5px] leading-relaxed text-foreground/85">
                {JSON.stringify(data || { runId, status: "pending" }, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
