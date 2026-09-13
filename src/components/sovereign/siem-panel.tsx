import { useEffect, useMemo, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import { motion } from "motion/react";
import { Check, ChevronDown, Radio, Save, ShieldCheck, Wifi, X, Search, Shield, KeyRound, Server, Zap } from "lucide-react";
import { toast } from "sonner";
import { JewelButton, StatusDot } from "@/components/sovereign/primitives";
import {
  siemFormats,
  siemProtocols,
  siemStreams,
  siemStreamsList,
  useSiem,
  type SiemFormat,
  type SiemProtocol,
} from "@/lib/siem-store";
import { cn } from "@/lib/utils";

const fieldCls =
  "w-full rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
      {children}
    </span>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Toggle SIEM forwarder"
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        on ? "border-emerald/50 bg-emerald/25" : "border-white/[0.1] bg-black/30",
      )}
      title="Toggle SIEM forwarder"
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={cn(
          "absolute top-[2px] h-3.5 w-3.5 rounded-full",
          on
            ? "left-[18px] bg-emerald shadow-[0_0_12px_-2px_var(--emerald)]"
            : "left-[2px] bg-muted-foreground/60",
        )}
      />
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.012] px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
        {label}
      </div>
      <div className={cn("mt-1.5 font-mono text-[16px] text-foreground/90", tone)}>{value}</div>
    </div>
  );
}

export function SiemPanel() {
  const { config, patch, toggleStream } = useSiem();
  const [probe, setProbe] = useState<null | "running" | "ok" | "fail">(null);
  const [probeMsg, setProbeMsg] = useState("");
  const [streamsOpen, setStreamsOpen] = useState(false);
  const [streamFilter, setStreamFilter] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!streamsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setStreamsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [streamsOpen]);

  const filteredStreams = useMemo(() => {
    const q = streamFilter.trim().toLowerCase();
    if (!q) return siemStreamsList;
    return siemStreamsList.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [streamFilter]);

  const selectAll = () => {
    patch({ streams: siemStreamsList.map((s) => s.id) });
  };

  const clearAll = () => {
    patch({ streams: [] });
  };

  const selectSecurityOnly = () => {
    patch({
      streams: siemStreamsList
        .filter((s) => s.category === "Security" || s.category === "Identity")
        .map((s) => s.id),
    });
  };

  const test = async () => {
    setProbe("running");
    setProbeMsg("");
    try {
      const res = await fetchApi("/api/system/siem/test", {
        method: "POST",
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setProbe("ok");
        const msg = res.message || `Reached ${config.host}:${config.port} over ${config.protocol.toUpperCase()}`;
        setProbeMsg(msg);
        toast.success(msg);
      } else {
        setProbe("fail");
        const errMsg = res.error || "Collector unreachable — check host and port";
        setProbeMsg(errMsg);
        toast.error(errMsg);
      }
    } catch(e) {
      setProbe("fail");
      const err = "Collector unreachable — connection timeout or network error";
      setProbeMsg(err);
      toast.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-4">
        <Stat
          label="Forwarder"
          value={config.enabled ? "ENABLED" : "HALTED"}
          tone={config.enabled ? "text-emerald" : "text-muted-foreground/60"}
        />
        <Stat
          label="Streams"
          value={`${config.streams.length}/${siemStreams.length}`}
          tone="text-sapphire"
        />
        <Stat label="Queue limit" value={config.queueLimit.toLocaleString("en-GB")} />
        <Stat label="Heartbeat" value={`${config.heartbeatSec}s`} tone="text-amethyst" />
      </section>

      <section className="glass rounded-xl border border-white/[0.07] p-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <Radio className="h-4 w-4 self-center text-sapphire" strokeWidth={1.6} />
          <h2 className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-foreground/80">
            SIEM forwarder
          </h2>
          <span className="ml-auto flex items-center gap-2">
            <StatusDot tone={config.enabled ? "emerald" : "ruby"} pulse={config.enabled} />
            <Toggle on={config.enabled} onClick={() => patch({ enabled: !config.enabled })} />
          </span>
        </div>
        <p className="mt-3 max-w-3xl font-mono text-[11.5px] leading-relaxed text-muted-foreground/70">
          Streams the studio audit plane — auth, RBAC, policy, secret and agent events — to an
          external collector (ArcSight, QRadar, Splunk or plain syslog).
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <label className="block">
            <Label>SIEM server (IP / host)</Label>
            <input
              className={fieldCls}
              value={config.host}
              onChange={(e) => patch({ host: e.target.value })}
              placeholder="10.255.255.1"
            />
          </label>
          <label className="block">
            <Label>Port</Label>
            <input
              className={fieldCls}
              value={config.port}
              onChange={(e) => patch({ port: e.target.value })}
              placeholder="514"
            />
          </label>
          <label className="block">
            <Label>Protocol</Label>
            <select
              className={fieldCls}
              value={config.protocol}
              onChange={(e) => patch({ protocol: e.target.value as SiemProtocol })}
            >
              {siemProtocols.map((p) => (
                <option key={p.id} value={p.id} className="bg-canvas">
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label>Format</Label>
            <select
              className={fieldCls}
              value={config.format}
              onChange={(e) => patch({ format: e.target.value as SiemFormat })}
            >
              {siemFormats.map((f) => (
                <option key={f.id} value={f.id} className="bg-canvas">
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label>Facility</Label>
            <input
              className={fieldCls}
              value={config.facility}
              onChange={(e) => patch({ facility: e.target.value })}
              placeholder="local0"
            />
          </label>
          <div className="grid grid-cols-2 gap-5">
            <label className="block">
              <Label>Heartbeat (s)</Label>
              <input
                type="number"
                min={10}
                className={fieldCls}
                value={config.heartbeatSec}
                onChange={(e) => patch({ heartbeatSec: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="block">
              <Label>Queue limit</Label>
              <input
                type="number"
                min={100}
                step={100}
                className={fieldCls}
                value={config.queueLimit}
                onChange={(e) => patch({ queueLimit: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
        </div>

        <div className="mt-6 max-w-2xl">
          <div className="flex items-center justify-between mb-2">
            <Label>Forwarded Audit Streams ({config.streams.length}/{siemStreamsList.length})</Label>
            <div className="flex items-center gap-2 font-mono text-[10.5px]">
              <button
                type="button"
                onClick={selectAll}
                className="text-sapphire hover:underline"
              >
                Select All
              </button>
              <span className="text-muted-foreground/40">·</span>
              <button
                type="button"
                onClick={selectSecurityOnly}
                className="text-amber-400 hover:underline"
              >
                Security Only
              </button>
              <span className="text-muted-foreground/40">·</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                Clear
              </button>
            </div>
          </div>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setStreamsOpen((v) => !v)}
              className={cn(fieldCls, "flex items-center justify-between text-left")}
            >
              <span className="truncate">
                {config.streams.length === 0
                  ? "No streams selected (forwarder idle)"
                  : config.streams.length === siemStreamsList.length
                    ? `All streams forwarded (${siemStreamsList.length}/${siemStreamsList.length} active)`
                    : `${config.streams.length} stream${config.streams.length === 1 ? "" : "s"} selected: ${config.streams.join(", ")}`}
              </span>
              <ChevronDown
                className={cn(
                  "ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform",
                  streamsOpen && "rotate-180",
                )}
                strokeWidth={1.8}
              />
            </button>

            {streamsOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute z-30 mt-1.5 max-h-80 w-full overflow-y-auto rounded-xl border border-white/[0.12] bg-[#121216]/98 p-2 shadow-[0_24px_60px_-24px_oklch(0_0_0/0.95)] backdrop-blur-md"
              >
                <div className="relative mb-2 px-1">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
                  <input
                    type="text"
                    placeholder="Search streams..."
                    value={streamFilter}
                    onChange={(e) => setStreamFilter(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-raised/40 pl-8 pr-3 py-1.5 font-mono text-xs text-foreground outline-none focus:border-sapphire placeholder:text-muted-foreground/40"
                  />
                </div>

                <div className="space-y-1">
                  {filteredStreams.map((s) => {
                    const on = config.streams.includes(s.id);
                    const categoryTone =
                      s.category === "Security"
                        ? "text-red-400 border-red-500/30 bg-red-500/10"
                        : s.category === "Identity"
                          ? "text-emerald border-emerald/30 bg-emerald/10"
                          : s.category === "Execution"
                            ? "text-amethyst border-amethyst/30 bg-amethyst/10"
                            : "text-sapphire border-sapphire/30 bg-sapphire/10";

                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleStream(s.id)}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 font-mono text-[11.5px] transition-colors hover:bg-white/[0.05]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                              on ? "border-sapphire bg-sapphire/25" : "border-white/[0.15]",
                            )}
                          >
                            {on && <Check className="h-3 w-3 text-sapphire" strokeWidth={3} />}
                          </span>
                          <div className="text-left min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={cn("font-medium", on ? "text-foreground" : "text-muted-foreground")}>
                                {s.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground/50">({s.id})</span>
                            </div>
                            <div className="truncate text-[10.5px] text-muted-foreground/60 max-w-sm">
                              {s.description}
                            </div>
                          </div>
                        </div>
                        <span className={cn("ml-2 shrink-0 rounded px-1.5 py-0.5 text-[9.5px] uppercase border", categoryTone)}>
                          {s.category}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </div>

          {/* Active Stream Chips */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {config.streams.map((sId) => {
              const item = siemStreamsList.find((s) => s.id === sId);
              return (
                <span
                  key={sId}
                  className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-raised/35 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground"
                >
                  {item?.name || sId}
                  <button
                    type="button"
                    onClick={() => toggleStream(sId)}
                    className="text-muted-foreground/60 hover:text-foreground"
                    title="Remove stream"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <JewelButton
            size="sm"
            onClick={() => {
              patch({ sealedAt: Date.now() });
              toast.success("SIEM configuration saved");
            }}
          >
            <Save className="h-3.5 w-3.5" strokeWidth={2} /> Save
          </JewelButton>
          <JewelButton size="sm" variant="outline" onClick={test} disabled={probe === "running"}>
            <Wifi className="h-3.5 w-3.5" strokeWidth={2} />
            {probe === "running" ? "Probing…" : "Test connection"}
          </JewelButton>
          <span className="rounded-lg border border-white/[0.07] px-3 py-1.5 font-mono text-[11px] text-muted-foreground/65">
            {config.protocol.toUpperCase()} · {config.host || "unset"}:{config.port || "—"} ·{" "}
            {config.format.toUpperCase()}
          </span>
          {probe === "ok" && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-emerald">
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} /> {probeMsg || (config.protocol === "udp" ? "UDP Datagram Dispatched" : "TCP Handshake Verified")}
            </span>
          )}
          {probe === "fail" && (
            <span className="font-mono text-[11px] text-ruby">
              {probeMsg || "Connection failed"}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
