import { useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import { motion } from "motion/react";
import { Check, ChevronDown, Radio, Save, ShieldCheck, Wifi } from "lucide-react";
import { toast } from "sonner";
import { JewelButton, StatusDot } from "@/components/sovereign/primitives";
import {
  siemFormats,
  siemProtocols,
  siemStreams,
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
  const [streamsOpen, setStreamsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!streamsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setStreamsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [streamsOpen]);

  const test = async () => {
    setProbe("running");
    try {
      const res = await fetchApi("/system/siem/test", {
        method: "POST",
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setProbe("ok");
        toast.success(`Reached ${config.host}:${config.port} over ${config.protocol.toUpperCase()}`);
      } else {
        setProbe("fail");
        toast.error(`Collector unreachable — ${res.error || 'check host and port'}`);
      }
    } catch(e) {
      setProbe("fail");
      toast.error("Collector unreachable — connection timeout or network error");
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

        <div className="mt-6 max-w-md">
          <Label>Forwarded streams</Label>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setStreamsOpen((v) => !v)}
              className={cn(fieldCls, "flex items-center justify-between text-left")}
            >
              <span className="truncate">
                {config.streams.length === 0
                  ? "none selected"
                  : config.streams.length === siemStreams.length
                    ? `all streams (${siemStreams.length})`
                    : config.streams.join(", ")}
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
                className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-lg border border-white/[0.09] bg-canvas p-1 shadow-[0_24px_60px_-24px_oklch(0_0_0/0.9)]"
              >
                {siemStreams.map((s) => {
                  const on = config.streams.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStream(s)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 font-mono text-[11.5px] transition-colors hover:bg-raised/60"
                    >
                      <span
                        className={cn(
                          "flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border",
                          on ? "border-sapphire/60 bg-sapphire/25" : "border-white/[0.14]",
                        )}
                      >
                        {on && <Check className="h-2.5 w-2.5 text-sapphire" strokeWidth={3} />}
                      </span>
                      <span className={on ? "text-sapphire" : "text-muted-foreground/75"}>{s}</span>
                    </button>
                  );
                })}
              </motion.div>
            )}
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
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} /> handshake ok
            </span>
          )}
          {probe === "fail" && (
            <span className="font-mono text-[11px] text-ruby">handshake failed</span>
          )}
        </div>
      </section>
    </div>
  );
}
