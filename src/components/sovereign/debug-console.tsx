import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Download, Eraser, Pause, Play, Radio, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Dropdown, Option } from "@/components/sovereign/audit-panel";
import { download } from "@/lib/audit-store";
import {
  bufferSizes,
  debugChannels,
  debugLevels,
  framesToText,
  levelTone,
  useDebugBus,
  type DebugGroup,
  type DebugLevel,
} from "@/lib/debug-bus";
import { cn } from "@/lib/utils";

const groups: { id: DebugGroup; label: string }[] = [
  { id: "sources", label: "sources" },
  { id: "workflow", label: "workflow" },
  { id: "infra", label: "infra" },
  { id: "integrations", label: "integrations" },
  { id: "governance", label: "governance" },
];

function MasterSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors",
        on ? "border-emerald/45 bg-emerald/10" : "border-white/[0.09] bg-black/25",
      )}
    >
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border",
          on ? "border-emerald/50 bg-emerald/25" : "border-white/[0.12] bg-black/40",
        )}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className={cn(
            "absolute top-[2px] h-3.5 w-3.5 rounded-full",
            on
              ? "left-[18px] bg-emerald shadow-[0_0_12px_-2px_var(--emerald)]"
              : "left-[2px] bg-muted-foreground/60",
          )}
        />
      </span>
      <span
        className={cn(
          "font-mono text-[11px] uppercase tracking-[0.18em]",
          on ? "text-emerald" : "text-muted-foreground/60",
        )}
      >
        debugging {on ? "on" : "off"}
      </span>
    </button>
  );
}

export function DebugConsole() {
  const bus = useDebugBus();
  const [query, setQuery] = useState("");
  const [autoscroll, setAutoscroll] = useState(true);
  const [wrap, setWrap] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bus.frames;
    return bus.frames.filter((f) => `${f.scope} ${f.msg} ${f.tag}`.toLowerCase().includes(q));
  }, [bus.frames, query]);

  useEffect(() => {
    if (autoscroll) endRef.current?.scrollIntoView({ block: "end" });
  }, [visible.length, autoscroll]);

  return (
    <section className="space-y-5">
      {/* master row */}
      <div className="flex flex-wrap items-center gap-3.5">
        <MasterSwitch on={bus.on} onToggle={() => bus.setOn(!bus.on)} />

        <Dropdown label="verbosity" value={bus.level} width="w-[180px]">
          {(close) =>
            debugLevels.map((l) => (
              <Option
                key={l}
                active={l === bus.level}
                onClick={() => {
                  bus.setLevel(l as DebugLevel);
                  close();
                }}
              >
                <span className={levelTone[l]}>{l}</span>
              </Option>
            ))
          }
        </Dropdown>

        <Dropdown
          label="features"
          value={bus.armed.length ? `${bus.armed.length} armed` : "none"}
          width="w-[320px]"
        >
          {() => (
            <>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/45">
                  channels
                </span>
                <span className="flex gap-2 font-mono text-[11px] uppercase tracking-[0.14em]">
                  <button
                    type="button"
                    onClick={bus.armAll}
                    className="text-sapphire/80 hover:text-sapphire"
                  >
                    all
                  </button>
                  <button
                    type="button"
                    onClick={bus.armNone}
                    className="text-muted-foreground/60 hover:text-foreground"
                  >
                    none
                  </button>
                </span>
              </div>
              {groups.map((g) => (
                <div key={g.id}>
                  <div className="px-3 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/35">
                    {g.label}
                  </div>
                  {debugChannels
                    .filter((c) => c.group === g.id)
                    .map((c) => (
                      <Option
                        key={c.id}
                        active={bus.armed.includes(c.id)}
                        onClick={() => bus.toggleChannel(c.id)}
                        hint={c.hint}
                      >
                        {c.label}
                      </Option>
                    ))}
                </div>
              ))}
            </>
          )}
        </Dropdown>

        <Dropdown label="buffer" value={`${bus.buffer} lines`} width="w-[180px]">
          {(close) =>
            bufferSizes.map((b) => (
              <Option
                key={b}
                active={b === bus.buffer}
                onClick={() => {
                  bus.setBuffer(b);
                  close();
                }}
              >
                {b} lines
              </Option>
            ))
          }
        </Dropdown>

        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="grep the stream"
            className="w-full rounded-lg border border-white/[0.08] bg-black/25 py-2.5 pl-9 pr-3 font-mono text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-sapphire/50"
          />
        </div>
      </div>

      {/* per-group channel dropdowns + armed chips */}
      <div className="space-y-4 rounded-xl border border-white/[0.07] bg-white/[0.012] px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          {groups.map((g) => {
            const items = debugChannels.filter((c) => c.group === g.id);
            const armedCount = items.filter((c) => bus.armed.includes(c.id)).length;
            return (
              <Dropdown
                key={g.id}
                label={g.label}
                value={armedCount ? `${armedCount} / ${items.length} armed` : "none"}
                width="w-[280px]"
              >
                {() => (
                  <>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/45">
                        {g.label}
                      </span>
                      <span className="flex gap-2 font-mono text-[11px] uppercase tracking-[0.14em]">
                        <button
                          type="button"
                          onClick={() =>
                            items.forEach(
                              (c) => !bus.armed.includes(c.id) && bus.toggleChannel(c.id),
                            )
                          }
                          className="text-sapphire/80 hover:text-sapphire"
                        >
                          all
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            items.forEach(
                              (c) => bus.armed.includes(c.id) && bus.toggleChannel(c.id),
                            )
                          }
                          className="text-muted-foreground/60 hover:text-foreground"
                        >
                          none
                        </button>
                      </span>
                    </div>
                    {items.map((c) => (
                      <Option
                        key={c.id}
                        active={bus.armed.includes(c.id)}
                        onClick={() => bus.toggleChannel(c.id)}
                        hint={c.hint}
                      >
                        {c.label}
                        <span className="ml-2 rounded bg-white/[0.06] px-1.5 font-mono text-[10.5px] text-foreground/55">
                          {bus.counts[c.id] ?? 0}
                        </span>
                      </Option>
                    ))}
                  </>
                )}
              </Dropdown>
            );
          })}
          <button
            type="button"
            onClick={bus.armNone}
            className="rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60 transition-colors hover:border-ruby/40 hover:text-ruby"
          >
            clear all
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {bus.armed.length === 0 ? (
            <span className="font-mono text-[11.5px] text-muted-foreground/40">
              no channels armed — pick features from the dropdowns above
            </span>
          ) : (
            debugChannels
              .filter((c) => bus.armed.includes(c.id))
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.hint}
                  onClick={() => bus.toggleChannel(c.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-sapphire/45 bg-sapphire/10 px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.12em] text-sapphire shadow-[0_0_20px_-12px_var(--sapphire)] transition-colors hover:border-ruby/50 hover:text-ruby"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-sapphire" />
                  {c.label}
                  <span className="rounded bg-white/[0.06] px-1.5 text-[10.5px] text-foreground/60">
                    {bus.counts[c.id] ?? 0}
                  </span>
                  <X className="h-3 w-3 opacity-60" />
                </button>
              ))
          )}
        </div>
      </div>

      {/* console */}
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/35">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-3.5 py-2">
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/55">
            <Radio
              className={cn(
                "h-3.5 w-3.5",
                bus.on && !bus.paused ? "text-emerald" : "text-muted-foreground/40",
              )}
            />
            live console · {visible.length}
          </span>
          <button
            type="button"
            onClick={() => bus.setPaused(!bus.paused)}
            disabled={!bus.on}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-black/25 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/70 transition-colors hover:border-sapphire/40 disabled:opacity-40"
          >
            {bus.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {bus.paused ? "resume" : "pause"}
          </button>
          <label className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/55">
            <input
              type="checkbox"
              checked={autoscroll}
              onChange={(e) => setAutoscroll(e.target.checked)}
              className="accent-[color:var(--sapphire)]"
            />
            autoscroll
          </label>
          <label className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/55">
            <input
              type="checkbox"
              checked={wrap}
              onChange={(e) => setWrap(e.target.checked)}
              className="accent-[color:var(--sapphire)]"
            />
            wrap
          </label>
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                download(
                  `debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.log`,
                  framesToText(visible),
                  "text/plain",
                );
                toast.success(`${visible.length} frames exported`);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-black/25 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/70 transition-colors hover:border-sapphire/40"
            >
              <Download className="h-3 w-3" /> export
            </button>
            <button
              type="button"
              onClick={bus.clear}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-black/25 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60 transition-colors hover:border-ruby/40 hover:text-ruby"
            >
              <Eraser className="h-3 w-3" /> clear
            </button>
          </span>
        </div>

        <div className="h-[460px] overflow-y-auto px-3.5 py-3">
          {!bus.on ? (
            <p className="font-mono text-[11.5px] text-muted-foreground/45">
              [off] Debugging is disabled. Flip the switch to attach the studio emitters to this
              console.
            </p>
          ) : visible.length === 0 ? (
            <p className="font-mono text-[11.5px] text-muted-foreground/45">
              [idle] No frames yet. Arm channels above — chat.request, agent.step.start,
              rag.search.start, model.first_token and model.responded land here.
            </p>
          ) : (
            <ol className="space-y-[3px]">
              {visible.map((fr) => (
                <li
                  key={fr.id}
                  className={cn(
                    "flex gap-3 font-mono text-[11.5px] leading-relaxed",
                    wrap ? "whitespace-pre-wrap break-words" : "overflow-hidden whitespace-nowrap",
                  )}
                >
                  <span className="shrink-0 text-muted-foreground/35">
                    {(() => {
                      const d = new Date(fr.at);
                      const pad = (n: number) => n.toString().padStart(2, "0");
                      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, "0")}`;
                    })()}
                  </span>
                  <span className={cn("w-[46px] shrink-0 uppercase", levelTone[fr.level])}>
                    {fr.level}
                  </span>
                  <span className="w-[46px] shrink-0 text-amethyst/70">{fr.tag}</span>
                  <span className="shrink-0 text-sapphire/75">{fr.scope}</span>
                  <span className="min-w-0 text-foreground/75">{fr.msg}</span>
                  {fr.ms !== null && <span className="shrink-0 text-topaz/60">{fr.ms}ms</span>}
                </li>
              ))}
              <div ref={endRef} />
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
