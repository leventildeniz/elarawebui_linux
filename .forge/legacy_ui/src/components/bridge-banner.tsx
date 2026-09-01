// Persistent bridge status banner with inline LAN override.
// Hidden on loopback; LAN clients infer the Mac bridge from the current URL host.
// On Lovable preview (HTTPS) browsers block plain HTTP — operator must paste their Mac IP.
import { useEffect, useState } from "react";
import { AlertTriangle, Save, Wand2, Cloud } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { resolveApiBaseUrl, isLoopbackFrontendHost, setBridgeOverride, getBridgeOverride, getMdnsHosts, isCloudPreviewHost } from "@/lib/api-client";
import { useChatStreamingFlag } from "@/lib/use-visible-poll";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

export function BridgeBanner() {
  const { locale } = useI18n();
  const isLocal = isLoopbackFrontendHost();
  const isCloud = isCloudPreviewHost();
  const hasOverride = !!getBridgeOverride();
  const [online, setOnline] = useState<boolean | null>(null);
  const [base, setBase] = useState<string>(() => resolveApiBaseUrl());
  const [override, setOverride] = useState<string>(() => getBridgeOverride() ?? "");
  const [, setFails] = useState(0);
  const [, setRecoveryStreak] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const chatStreaming = useChatStreamingFlag();
  const isHttpsContext = typeof window !== "undefined" && window.location.protocol === "https:";

  useEffect(() => {
    // Only act on successful pings emitted by the health probe; ignore
    // failures from RAG/voice/brand/heartbeat fetches so they can't trip
    // the offline banner.
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail as { ok: boolean } | undefined;
      if (!detail?.ok) return;
      setStatusMsg(null);
      setFails(0);
      setBase(resolveApiBaseUrl());
      setRecoveryStreak(() => {
        setOnline(true);
        return 1;
      });
    };
    window.addEventListener("bridge:status", onStatus as EventListener);
    return () => window.removeEventListener("bridge:status", onStatus as EventListener);
  }, []);

  useEffect(() => {
    // Cloud preview without operator override → bridge is unreachable by design.
    // Skip pinging entirely; the banner renders an info-tone notice below.
    if (isCloud && !hasOverride) return;
    let alive = true;
    let lastSuccessAt = 0;
    const ping = async () => {
      if (chatStreaming) return;
      try {
        const r = await fetch(`${base}/api/health`, { mode: "cors", signal: AbortSignal.timeout(60000) });
        const body = await r.json().catch(() => null) as { status?: string } | null;
        const ok = r.ok && body?.status === "ok";
        if (!alive) return;
        if (ok) {
          lastSuccessAt = Date.now();
          setStatusMsg(null);
          setFails(0);
          setRecoveryStreak(() => { setOnline(true); return 1; });
        } else {
          setRecoveryStreak(0);
          setFails((f) => {
            const n = f + 1;
            if (n >= 2) setOnline(false);
            return n;
          });
        }
      } catch (e) {
        if (!alive) return;
        await new Promise(r => setTimeout(r, 1500));
        try {
          const r2 = await fetch(`${base}/api/health`, { mode: "cors", signal: AbortSignal.timeout(60000) });
          const body2 = await r2.json().catch(() => null) as { status?: string } | null;
          if (r2.ok && body2?.status === "ok") {
            lastSuccessAt = Date.now();
            setFails(0); setStatusMsg(null);
            setRecoveryStreak(() => { setOnline(true); return 1; });
            return;
          }
        } catch {}
        if (Date.now() - lastSuccessAt < 10000) return;
        setRecoveryStreak(0);
        setFails((f) => { const n = f + 1; if (n >= 2) setOnline(false); return n; });
      }
    };
    ping();
    const id = setInterval(() => { if (typeof document !== "undefined" && document.hidden) return; ping(); }, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [base, chatStreaming, online, isCloud, hasOverride]);

  useEffect(() => {
    if (chatStreaming || isLocal) return;
    if (online !== false) return;
    const t = setTimeout(() => {
      fetch(`${base}/api/health`, { mode: "cors", signal: AbortSignal.timeout(60000) })
        .then(r => r.json().catch(() => null))
        .then((b: { status?: string } | null) => {
          if (b?.status === "ok") {
            setFails(0);
            setRecoveryStreak(() => { setOnline(true); return 1; });
          }
        }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [chatStreaming, base, online, isLocal]);

  const saveOverride = () => {
    const v = override.trim();
    setBridgeOverride(v || null);
    setBase(resolveApiBaseUrl());
    setOnline(null); setFails(0);
    toast.success(v ? `Bridge URL saved: ${v}` : "Bridge URL cleared");
  };

  const [autoBusy, setAutoBusy] = useState(false);
  const tryMdnsAuto = async () => {
    setAutoBusy(true);
    const hosts = getMdnsHosts();
    if (!hosts.length) { setAutoBusy(false); toast.error("No candidate hosts configured"); return; }
    try {
      const probes = hosts.map(async (h) => {
        const url = `http://${h}:3005`;
        const r = await fetch(`${url}/api/health`, { mode: "cors", signal: AbortSignal.timeout(60000) });
        const body = await r.json().catch(() => null) as { status?: string } | null;
        if (!r.ok || body?.status !== "ok") throw new Error(`${h} unreachable`);
        return url;
      });
      const winner = await Promise.any(probes);
      setOverride(winner);
      setBridgeOverride(winner);
      setBase(resolveApiBaseUrl());
      setOnline(null); setFails(0);
      toast.success(`Bridge found: ${winner}`);
    } catch {
      toast.error(`No known host responded (${hosts.join(", ")})`);
    } finally { setAutoBusy(false); }
  };

  if (isLocal) return null;

  // Cloud preview without operator override → render an info-tone notice
  // explaining the architectural limit. No red alarm, no probe spam.
  if (isCloud && !hasOverride) {
    return (
      <div className="border-b border-primary/30 bg-primary/5 px-4 py-2 flex flex-wrap items-center gap-3 text-xs font-mono">
        <Cloud className="h-4 w-4 text-primary shrink-0" />
        <span className="text-primary font-bold uppercase tracking-widest">
          {"Cloud preview"}
        </span>
        <span className="text-muted-foreground">
          {"This preview environment cannot reach on-premise services. For operational use, open the system from an authorized workstation on the local network, or paste a bridge URL below."}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <Input
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder={`http://${(getMdnsHosts()[0] ?? "your-host.local")}:3005`}
            className="h-7 w-56 text-[11px] font-mono"
          />
          <Button size="sm" variant="outline" className="h-7" onClick={saveOverride}>
            <Save className="h-3 w-3 mr-1" /> {"Save"}
          </Button>
        </div>
        {isHttpsContext && (
          <span className="basis-full text-[10px] text-muted-foreground/80">
            {"⚠ HTTPS preview · plain http://...:3005 is blocked by the browser (mixed content). Place the bridge behind an HTTPS reverse proxy."}
          </span>
        )}
      </div>
    );
  }

  if (online !== false) return null;

  return (
    <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 flex flex-wrap items-center gap-3 text-xs font-mono">
      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
      <span className="text-destructive font-bold uppercase tracking-widest">
        {online === null ? "Checking bridge…" : "Bridge offline"}
      </span>
      <span className="text-muted-foreground">
        {statusMsg ?? "Cannot reach bridge service"} · base:&nbsp;<span className="text-foreground">{base}</span>
      </span>
      {suggestion && (
        <Button size="sm" variant="secondary" className="h-7" onClick={() => { setOverride(suggestion); setBridgeOverride(suggestion); setBase(resolveApiBaseUrl()); setOnline(null); setFails(0); toast.success(`Bridge URL saved: ${suggestion}`); }}>
          <Wand2 className="h-3 w-3 mr-1" /> {`Use ${suggestion}`}
        </Button>
      )}
      <div className="flex items-center gap-2 ml-auto">
        <Button size="sm" variant="secondary" className="h-7" disabled={autoBusy} onClick={tryMdnsAuto} title={`Probe ${getMdnsHosts().join(", ")}`}>
          <Wand2 className="h-3 w-3 mr-1" /> {autoBusy ? "Detecting…" : "Auto-detect"}
        </Button>
        <Input
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          placeholder={`http://${(getMdnsHosts()[0] ?? "your-host.local")}:3005`}
          className="h-7 w-56 text-[11px] font-mono"
        />
        <Button size="sm" variant="outline" className="h-7" onClick={saveOverride}>
          <Save className="h-3 w-3 mr-1" /> {"Save"}
        </Button>
      </div>
      {isHttpsContext && (
        <span className="basis-full text-[10px] text-muted-foreground/80">
          {"⚠ HTTPS preview · plain http://...:3005 is blocked by the browser (mixed content). Open from an authorized workstation on the local network, or place the bridge behind an HTTPS reverse proxy."}
        </span>
      )}
    </div>
  );
}
