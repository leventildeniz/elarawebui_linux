// Vision Service On/Off — Models → Vision sekmesinin üst bandı.
import { useVisiblePoll } from "@/lib/use-visible-poll";
// LOCAL Vision motoru (port 8011) elle açılır/kapanır; sistemle otomatik başlamaz.
// Aktifken 0.0.0.0:8011'i dinler — LAN istemcileri (örn. Dell) erişebilir.
import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Eye, PlugZap, Terminal, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { VisionServiceAPI, type VisionServiceStatus } from "@/lib/api-client";
import { useVisionConfig } from "@/lib/vision-config-store";
import { useI18n } from "@/lib/i18n";

function fmtUptime(ms: number): string {
  if (!ms || ms < 1000) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function VisionServiceCard() {
  const { t } = useI18n();
  const { config } = useVisionConfig();
  const [status, setStatus] = useState<VisionServiceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastCheck, setLastCheck] = useState<number>(0);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const timerRef = useRef<number | null>(null);

  const refresh = async () => {
    const s = await VisionServiceAPI.status();
    setStatus(s);
    setLastCheck(Date.now());
  };

  useEffect(() => { void refresh(); }, []);
  useVisiblePoll(() => { void refresh(); }, 15000);

  const onToggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const r = await VisionServiceAPI.start(config.model);
        if (r.ok) toast.success(t("vision.service.start_ok"));
        else toast.error(`${t("vision.service.start_fail")}: ${r.error || ""}`);
      } else {
        const r = await VisionServiceAPI.stop();
        if (r.ok) toast.success(t("vision.service.stop_ok"));
        else toast.error(`${t("vision.service.stop_fail")}: ${r.error || ""}`);
      }
      // give the process a moment, then refresh
      await new Promise((r) => setTimeout(r, 600));
      await refresh();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const r = await VisionServiceAPI.logs(80);
      setLogs(r.lines || []);
    } finally { setLogsLoading(false); }
  };

  const onLogsClick = async () => {
    const next = !showLogs;
    setShowLogs(next);
    if (next) await loadLogs();
  };

  const running = !!status?.running;
  const reachable = !!status?.reachable;
  const stateLabel = busy
    ? t("vision.service.starting")
    : running && reachable
      ? t("vision.service.online")
      : running && !reachable
        ? t("vision.service.starting")
        : t("vision.service.offline");
  const stateClass = running && reachable
    ? "text-emerald-400 border-emerald-400/40"
    : running
      ? "text-amber-400 border-amber-400/40"
      : "text-muted-foreground";

  return (
    <Card className="glass border-primary/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2 rounded-md ${running ? "bg-emerald-400/10 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
              <Eye className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                {t("vision.service.title")}
                <Badge variant="outline" className={`font-mono text-[10px] ${stateClass}`}>
                  {stateLabel} · {status?.host || "0.0.0.0"}:{status?.port || 8011}
                </Badge>
              </h3>
              <p className="text-[11px] font-mono text-muted-foreground truncate max-w-[640px]">
                {t("vision.service.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] font-mono text-muted-foreground">{t("vision.service.toggle")}</span>
            <Switch checked={running} disabled={busy} onCheckedChange={(v) => void onToggle(v)} />
            <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={busy}>
              <PlugZap className="h-3.5 w-3.5 mr-1" />{t("vision.service.health")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void onLogsClick()}>
              <Terminal className="h-3.5 w-3.5 mr-1" />{t("vision.service.logs")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono text-muted-foreground">
          <div><span className="opacity-60">model:</span> <span className="text-foreground/80 truncate inline-block max-w-[220px] align-bottom">{(status?.model || config.model).split("/").pop()}</span></div>
          <div><span className="opacity-60">{t("vision.service.pid")}:</span> {status?.pid ?? "—"}</div>
          <div><span className="opacity-60">{t("vision.service.uptime")}:</span> {fmtUptime(status?.uptimeMs || 0)}</div>
          <div><span className="opacity-60">{t("vision.service.last_check")}:</span> {lastCheck ? new Date(lastCheck).toLocaleTimeString() : "—"}</div>
        </div>

        <div className="flex items-start gap-2 text-[11px] font-mono text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <div>{t("vision.service.bind_hint")}</div>
            <div className="text-muted-foreground">{t("vision.service.warn_manual")}</div>
            {status?.lastError && <div className="text-destructive">err: {status.lastError}</div>}
          </div>
        </div>

        {showLogs && (
          <div className="rounded-md border border-border bg-card/40 p-3 max-h-64 overflow-auto">
            {logsLoading && <p className="text-[11px] font-mono text-muted-foreground">…</p>}
            {!logsLoading && logs.length === 0 && (
              <p className="text-[11px] font-mono text-muted-foreground">{t("vision.service.no_logs")}</p>
            )}
            {!logsLoading && logs.length > 0 && (
              <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {logs.join("\n")}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
