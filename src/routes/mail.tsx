import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ChevronDown, Clock, Mail, Plug, RotateCcw, Send, Timer } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { ResetButton, SaveButton } from "@/components/sovereign/action-buttons";
import { cn } from "@/lib/utils";
import { secretSeed } from "@/lib/security-store";
import {
  NTP_PRESETS,
  TIMEZONES,
  defaultMail,
  defaultTime,
  formatInZone,
  loadMail,
  loadTime,
  mailReady,
  saveMail,
  saveTime,
  simulateNtpSync,
  simulateSmtpTest,
  zoneOffsetLabel,
  type AuthMode,
  type Encryption,
  type MailConfig,
  type TestResult,
  type TimeConfig,
} from "@/lib/mail-store";
import { VaultKeyField } from "@/components/sovereign/vault-key-field";
import { clearOutbox, renderTpl, useNotifyPrefs, useOutbox } from "@/lib/notify-store";

const description =
  "SMTP relay definition for scheduled report delivery plus studio timezone and NTP synchronisation.";

export const Route = createFileRoute("/mail")({
  head: () => ({
    meta: [
      { title: "Mail & Time — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Mail & Time — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MailTimePage,
});

/* ---------------------------------------------------------------- atoms -- */

const panelCls = "rounded-xl border border-white/[0.07] bg-white/[0.015] p-6";
const inputCls =
  "w-full rounded-lg border border-white/[0.08] bg-canvas-deep/60 px-3 py-[7px] font-mono text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-sapphire/50";
const btnCls =
  "flex items-center gap-2 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[7px] font-mono text-[11.5px] text-muted-foreground/85 transition-colors hover:border-sapphire/50 hover:text-foreground";

function Field({
  label,
  hint,
  children,
  span,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  span?: boolean;
}) {
  return (
    <label className={cn("block", span && "sm:col-span-2")}>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/50">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <span className="mt-1.5 block font-mono text-[11px] text-muted-foreground/40">{hint}</span>
      )}
    </label>
  );
}

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg border px-3 py-[5px] font-mono text-[11px] tracking-[0.1em] transition-colors",
            value === o.value
              ? "border-sapphire/45 bg-sapphire/12 text-sapphire"
              : "border-white/[0.07] bg-raised/30 text-muted-foreground/70 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  tone = "emerald",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tone?: "emerald" | "sapphire";
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 font-mono text-[11.5px] text-muted-foreground/80 transition-colors hover:text-foreground"
    >
      <span
        className={cn(
          "relative h-[18px] w-[32px] rounded-full border transition-colors",
          checked ? `border-${tone}/50 bg-${tone}/20` : "border-white/[0.09] bg-raised/40",
        )}
      >
        <span
          className="absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all duration-200"
          style={{
            left: checked ? 16 : 3,
            background: checked ? `var(--${tone})` : "rgba(255,255,255,0.28)",
            boxShadow: checked ? `0 0 10px -1px var(--${tone})` : "none",
          }}
        />
      </span>
      {label}
    </button>
  );
}

/* ------------------------------------------------------ collapsible section -- */

function CollapsibleSection({
  title,
  subtitle,
  right,
  defaultOpen = false,
  delay = 0,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  delay?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(panelCls, "overflow-hidden")}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center justify-between gap-4 text-left"
      >
        <div className="min-w-0">
          <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground transition-colors group-hover:text-sapphire">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-2 max-w-[80ch] font-mono text-[12px] text-muted-foreground/60">
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {right}
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-white/[0.08] bg-raised/40 transition-colors group-hover:border-sapphire/40">
            <ChevronDown
              size={14}
              className={cn(
                "text-muted-foreground/70 transition-transform duration-200",
                open && "rotate-180",
              )}
              strokeWidth={1.6}
            />
          </span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function SectionActions({
  onSave,
  onReset,
  title,
  body,
}: {
  onSave: () => void;
  onReset: () => void;
  title: string;
  body: string;
}) {
  return (
    <div className="mt-6 flex items-center justify-end gap-2 border-t border-white/[0.05] pt-4">
      <ResetButton onReset={onReset} title={title} body={body} />
      <SaveButton onSave={onSave} />
    </div>
  );
}

/* ----------------------------------------------------------------- page -- */

function MailTimePage() {
  const [tab, setTab] = useState<"mail" | "time">("mail");
  const [mail, setMail] = useState<MailConfig>(defaultMail);
  const [time, setTime] = useState<TimeConfig>(defaultTime);

  useEffect(() => {
    loadMail().then(m => setMail(m));
    loadTime().then(t => setTime(t));
  }, []);

  const ready = mailReady(mail);

  return (
    <Surface
      wide
      crumb="Mail & Time"
      title="Mail & Time"
      meta="SMTP RELAY · TIMEZONE · NTP SYNC"
      action={
        <div className="flex items-center gap-1.5">
          {(
            [
              { id: "mail", label: "Mail Server", icon: Mail, tone: "sapphire" },
              { id: "time", label: "Time & NTP", icon: Clock, tone: "amethyst" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-[6px] font-mono text-[11.5px] transition-colors",
                tab === t.id
                  ? "border-white/20 bg-raised/60 text-foreground"
                  : "border-white/[0.06] bg-raised/25 text-muted-foreground/75 hover:text-foreground",
              )}
            >
              <t.icon size={13} className={`text-${t.tone}`} strokeWidth={1.6} />
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      {tab === "mail" ? (
        <MailTab cfg={mail} setCfg={setMail} ready={ready} />
      ) : (
        <TimeTab cfg={time} setCfg={setTime} />
      )}
    </Surface>
  );
}

/* ----------------------------------------------------------------- mail -- */

const ENCRYPTIONS: readonly { value: Encryption; label: string }[] = [
  { value: "none", label: "NONE" },
  { value: "starttls", label: "STARTTLS" },
  { value: "ssl", label: "SSL/TLS" },
];

const AUTH_MODES: readonly { value: AuthMode; label: string }[] = [
  { value: "none", label: "NONE" },
  { value: "login", label: "LOGIN" },
  { value: "plain", label: "PLAIN" },
  { value: "cram-md5", label: "CRAM-MD5" },
  { value: "oauth2", label: "OAUTH2" },
];

function MailTab({
  cfg,
  setCfg,
  ready,
}: {
  cfg: MailConfig;
  setCfg: (c: MailConfig) => void;
  ready: boolean;
}) {
  const [testTo, setTestTo] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const set = <K extends keyof MailConfig>(k: K, v: MailConfig[K]) => setCfg({ ...cfg, [k]: v });
  const handleSaveMail = async () => {
    try {
      await saveMail(cfg);
      toast.success("Mail config saved");
    } catch (e) {
      toast.error("Failed to save mail config");
    }
  };

  const resetKeys = async (keys: (keyof MailConfig)[]) => {
    const next = { ...cfg };
    for (const k of keys) (next[k] as MailConfig[typeof k]) = defaultMail[k];
    setCfg(next);
    try {
      await saveMail(next);
    } catch (e) {}
  };

  return (
    <div className="space-y-4">
      <CollapsibleSection
        title="Outbound relay (SMTP)"
        subtitle={
          <>
            Scheduled reports delivered over the <span className="text-sapphire">email</span>{" "}
            channel leave the studio through this relay. Credentials bind to the Secret Vault —
            passwords are never stored on this page.
          </>
        }
        right={
          <span
            className={cn(
              "rounded-lg border px-3 py-[5px] font-mono text-[11px] tracking-[0.12em]",
              ready
                ? "border-emerald/40 bg-emerald/10 text-emerald"
                : "border-topaz/40 bg-topaz/10 text-topaz",
            )}
          >
            {ready ? "TRANSPORT READY" : "NOT CONFIGURED"}
          </span>
        }
      >
        <div className="mt-5">
          <Toggle
            checked={cfg.enabled}
            onChange={(v) => set("enabled", v)}
            label="Enable outbound mail for schedules and alerts"
          />
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Relay host" hint="smtp.yourdomain.com or an internal MTA">
            <input
              className={inputCls}
              value={cfg.host}
              placeholder="smtp.yourdomain.com"
              onChange={(e) => set("host", e.target.value)}
            />
          </Field>
          <Field label="Port" hint="25 · 465 (SSL) · 587 (STARTTLS) · 2525">
            <input
              className={inputCls}
              type="number"
              value={cfg.port}
              onChange={(e) => set("port", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Encryption">
            <Segment
              value={cfg.encryption}
              options={ENCRYPTIONS}
              onChange={(v) => set("encryption", v)}
            />
          </Field>
          <Field label="Authentication">
            <Segment
              value={cfg.authMode}
              options={AUTH_MODES}
              onChange={(v) => set("authMode", v)}
            />
          </Field>
          <Field label="Username">
            <input
              className={inputCls}
              value={cfg.username}
              placeholder="reports@yourdomain.com"
              disabled={cfg.authMode === "none"}
              onChange={(e) => set("username", e.target.value)}
            />
          </Field>
          <Field label="Vault secret" hint="Credential reference resolved at send time">
            <div className={cfg.authMode === "none" ? "pointer-events-none opacity-50" : ""}>
              <VaultKeyField
                value={cfg.secretRef}
                onChange={(v) => set("secretRef", v)}
                placeholder="raw:your_password"
              />
            </div>
          </Field>
        </div>

        <SectionActions
          onSave={handleSaveMail}
          onReset={() =>
            resetKeys([
              "enabled",
              "host",
              "port",
              "encryption",
              "authMode",
              "username",
              "secretRef",
            ])
          }
          title="Reset outbound relay?"
          body="Host, port, encryption, authentication and vault binding revert to factory defaults."
        />
      </CollapsibleSection>

      <CollapsibleSection title="Identity &amp; envelope" delay={0.05}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="From name">
            <input
              className={inputCls}
              value={cfg.fromName}
              onChange={(e) => set("fromName", e.target.value)}
            />
          </Field>
          <Field label="From address">
            <input
              className={inputCls}
              value={cfg.fromAddress}
              placeholder="reports@yourdomain.com"
              onChange={(e) => set("fromAddress", e.target.value)}
            />
          </Field>
          <Field label="Reply-to">
            <input
              className={inputCls}
              value={cfg.replyTo}
              placeholder="ops@yourdomain.com"
              onChange={(e) => set("replyTo", e.target.value)}
            />
          </Field>
          <Field label="Default BCC" hint="Comma separated archive recipients">
            <input
              className={inputCls}
              value={cfg.bcc}
              placeholder="archive@yourdomain.com"
              onChange={(e) => set("bcc", e.target.value)}
            />
          </Field>
          <Field label="Subject prefix">
            <input
              className={inputCls}
              value={cfg.headerPrefix}
              onChange={(e) => set("headerPrefix", e.target.value)}
            />
          </Field>
          <Field label="DKIM domain / selector">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={cfg.dkimDomain}
                placeholder="yourdomain.com"
                onChange={(e) => set("dkimDomain", e.target.value)}
              />
              <input
                className={cn(inputCls, "max-w-[130px]")}
                value={cfg.dkimSelector}
                onChange={(e) => set("dkimSelector", e.target.value)}
              />
            </div>
          </Field>
        </div>

        <SectionActions
          onSave={handleSaveMail}
          onReset={() =>
            resetKeys([
              "fromName",
              "fromAddress",
              "replyTo",
              "bcc",
              "headerPrefix",
              "dkimDomain",
              "dkimSelector",
            ])
          }
          title="Reset identity &amp; envelope?"
          body="Sender identity, reply-to, BCC and DKIM values revert to factory defaults."
        />
      </CollapsibleSection>

      <CollapsibleSection title="Transport policy" delay={0.1}>
        <div className="grid gap-5 sm:grid-cols-4">
          <Field label="Timeout (ms)">
            <input
              className={inputCls}
              type="number"
              value={cfg.timeoutMs}
              onChange={(e) => set("timeoutMs", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Retries">
            <input
              className={inputCls}
              type="number"
              value={cfg.retries}
              onChange={(e) => set("retries", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Rate limit / min">
            <input
              className={inputCls}
              type="number"
              value={cfg.rateLimitPerMin}
              onChange={(e) => set("rateLimitPerMin", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Pool size">
            <input
              className={inputCls}
              type="number"
              value={cfg.poolSize}
              onChange={(e) => set("poolSize", Number(e.target.value) || 0)}
            />
          </Field>
        </div>
        <div className="mt-5">
          <Toggle
            checked={cfg.rejectUnauthorized}
            onChange={(v) => set("rejectUnauthorized", v)}
            label="Reject relays with an untrusted TLS certificate"
            tone="sapphire"
          />
        </div>

        <SectionActions
          onSave={handleSaveMail}
          onReset={() =>
            resetKeys(["timeoutMs", "retries", "rateLimitPerMin", "poolSize", "rejectUnauthorized"])
          }
          title="Reset transport policy?"
          body="Timeouts, retries, rate limit, pool size and TLS strictness revert to factory defaults."
        />
      </CollapsibleSection>

      <CollapsibleSection title="Connection test" delay={0.15}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={cn(inputCls, "max-w-[320px]")}
            value={testTo}
            placeholder="deliver a probe to…"
            onChange={(e) => setTestTo(e.target.value)}
          />
          <button
            className={btnCls}
            onClick={async () => {
              const r = await simulateSmtpTest(cfg, testTo);
              setResult(r);
              if (r.ok) {
                toast.success("SMTP handshake succeeded");
              } else {
                toast.error("SMTP handshake failed");
              }
            }}
          >
            <Plug size={13} /> Test connection
          </button>
          <button
            className={btnCls}
            onClick={async () => {
              const r = await simulateSmtpTest(cfg, testTo);
              setResult(r);
              if (r.ok) {
                toast.success("Probe message queued");
              } else {
                toast.error("Probe not sent");
              }
            }}
          >
            <Send size={13} /> Send test mail
          </button>
        </div>

        {result && (
          <pre className="mt-4 overflow-x-auto rounded-lg border border-white/[0.07] bg-canvas-deep/70 p-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground/75">
            {result.lines.map((l, i) => (
              <div
                key={i}
                className={cn(
                  l.startsWith("!") || l.includes("535")
                    ? "text-ruby"
                    : l.startsWith("<")
                      ? "text-emerald/80"
                      : "text-sapphire/80",
                )}
              >
                {l}
              </div>
            ))}
          </pre>
        )}
      </CollapsibleSection>

      <ApproverNoticeSection />
    </div>
  );
}

/* --------------------------------------------------- approver notices -- */

const RISKS = ["low", "medium", "high", "critical"] as const;

/**
 * Template + delivery rules for the human-in-the-loop gate notices. The
 * per-gate on/off switch lives on the Approval Queue and Meta-Forge pages.
 */
function ApproverNoticeSection() {
  const { prefs, update } = useNotifyPrefs();
  const outbox = useOutbox().slice(0, 6);
  const armed = prefs.approvals || prefs.forge;

  const preview = useMemo(() => {
    const vars = {
      subject: "Run gated skill · perimeter-sweep",
      gate: "approval queue",
      risk: "high",
    };
    return {
      subject: renderTpl(prefs.subjectTpl, vars),
      body: [
        renderTpl(prefs.intro, vars),
        "",
        "requester · ahmet · technical services",
        "risk · high",
        "",
        prefs.signature,
      ].join("\n"),
    };
  }, [prefs]);

  return (
    <CollapsibleSection
      title="Approver notices"
      subtitle="Message template and delivery rules for approval queue and meta-forge pages. Turn the notices on from the switch next to the approvers line on each gate."
      delay={0.2}
      right={
        <span
          className={cn(
            "rounded-md border px-2 py-[3px] font-mono text-[10.5px]",
            armed
              ? "border-emerald/45 bg-emerald/[0.12] text-emerald"
              : "border-white/[0.09] text-muted-foreground/55",
          )}
        >
          {armed
            ? `armed · ${[prefs.approvals && "queue", prefs.forge && "forge"].filter(Boolean).join(" + ")}`
            : "all gates silent"}
        </span>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Subject template" hint="tokens · {subject} {gate} {risk}" span>
          <input
            className={inputCls}
            value={prefs.subjectTpl}
            onChange={(e) => update({ subjectTpl: e.target.value })}
          />
        </Field>
        <Field label="Opening paragraph" hint="tokens · {subject} {gate} {risk}" span>
          <textarea
            rows={3}
            className={cn(inputCls, "resize-y leading-relaxed")}
            value={prefs.intro}
            onChange={(e) => update({ intro: e.target.value })}
          />
        </Field>
        <Field label="Signature">
          <input
            className={inputCls}
            value={prefs.signature}
            onChange={(e) => update({ signature: e.target.value })}
          />
        </Field>
        <Field label="Always copy" hint="comma separated mailboxes">
          <input
            className={inputCls}
            placeholder="soc@sovereign.studio"
            value={prefs.cc}
            onChange={(e) => update({ cc: e.target.value })}
          />
        </Field>
        <Field label="Minimum risk" hint="items below this band never leave the relay" span>
          <Segment
            value={prefs.minRisk}
            options={RISKS.map((r) => ({ value: r, label: r }))}
            onChange={(v) => update({ minRisk: v })}
          />
        </Field>
      </div>

      <div className="mt-5 rounded-lg border border-white/[0.07] bg-canvas-deep/70 p-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/45">
          preview
        </p>
        <p className="mt-2 font-mono text-[12px] text-sapphire">{preview.subject}</p>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-muted-foreground/75">
          {preview.body}
        </pre>
      </div>

      <div className="mt-5 border-t border-white/[0.05] pt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/45">
            outbox
          </span>
          {outbox.length > 0 && (
            <button
              onClick={clearOutbox}
              className="font-mono text-[10.5px] text-muted-foreground/50 transition-colors hover:text-ruby"
            >
              clear
            </button>
          )}
        </div>
        {outbox.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground/45">no notices yet</p>
        ) : (
          <ul className="space-y-1.5">
            {outbox.map((n) => (
              <li key={n.id} className="flex items-start gap-2">
                <Mail
                  size={12}
                  strokeWidth={1.7}
                  className={cn(
                    "mt-[3px] shrink-0",
                    n.state === "sent"
                      ? "text-emerald"
                      : n.state === "blocked"
                        ? "text-ruby"
                        : "text-muted-foreground/50",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11.5px] text-foreground/80">
                    {n.subject}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-muted-foreground/55">
                    {n.state}
                    {n.reason ? ` · ${n.reason}` : ` · ${n.to.length} recipient(s)`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CollapsibleSection>
  );
}

/* ----------------------------------------------------------------- time -- */

function TimeTab({ cfg, setCfg }: { cfg: TimeConfig; setCfg: (c: TimeConfig) => void }) {
  const [now, setNow] = useState(() => new Date());
  const set = <K extends keyof TimeConfig>(k: K, v: TimeConfig[K]) => setCfg({ ...cfg, [k]: v });
  
  const handleSaveTime = async () => {
    try {
      await saveTime(cfg);
      toast.success("Time config saved");
    } catch (e) {
      toast.error("Failed to save time config");
    }
  };

  const resetKeys = async (keys: (keyof TimeConfig)[]) => {
    const next = { ...cfg };
    for (const k of keys) (next[k] as TimeConfig[typeof k]) = defaultTime[k];
    setCfg(next);
    try {
      await saveTime(next);
    } catch (e) {}
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const offset = useMemo(() => zoneOffsetLabel(cfg.timezone), [cfg.timezone]);

  return (
    <div className="space-y-4">
      <CollapsibleSection
        title="Studio wall clock"
        subtitle="Schedule cadences, delivery ledgers and telemetry timestamps resolve against this timezone."
        right={
          <div className="text-right">
            <div className="font-mono text-[24px] tabular-nums tracking-tight text-foreground">
              {formatInZone(now, cfg).split(", ").slice(-1)[0]}
            </div>
            <div className="mt-1 font-mono text-[11px] tracking-[0.14em] text-muted-foreground/55">
              {cfg.timezone} · {offset}
            </div>
          </div>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Timezone">
            <select
              className={inputCls}
              value={cfg.timezone}
              onChange={(e) => set("timezone", e.target.value)}
            >
              {[...new Set([cfg.timezone, ...TIMEZONES])].map((tz) => (
                <option key={tz} value={tz}>
                  {tz} ({zoneOffsetLabel(tz)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Clock format">
            <Segment
              value={cfg.clock}
              options={[
                { value: "24h", label: "24 HOUR" },
                { value: "12h", label: "12 HOUR" },
              ]}
              onChange={(v) => set("clock", v)}
            />
          </Field>
          <Field label="Week starts on">
            <Segment
              value={cfg.weekStart}
              options={[
                { value: "monday", label: "MONDAY" },
                { value: "sunday", label: "SUNDAY" },
              ]}
              onChange={(v) => set("weekStart", v)}
            />
          </Field>
          <Field label="Full timestamp preview">
            <div className="rounded-lg border border-white/[0.07] bg-canvas-deep/60 px-3 py-[7px] font-mono text-[12px] text-muted-foreground/75">
              {formatInZone(now, cfg)}
            </div>
          </Field>
        </div>

        <SectionActions
          onSave={handleSaveTime}
          onReset={() => resetKeys(["timezone", "clock", "weekStart"])}
          title="Reset studio wall clock?"
          body="Timezone, clock format and week start revert to factory defaults."
        />
      </CollapsibleSection>

      <CollapsibleSection title="NTP synchronisation" delay={0.06}>
        <div className="mt-5">
          <Toggle
            checked={cfg.ntpEnabled}
            onChange={(v) => set("ntpEnabled", v)}
            label="Discipline the studio clock from upstream NTP"
          />
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field
            label="NTP servers"
            span
            hint="One host per line — the first entry is the primary source"
          >
            <textarea
              className={cn(inputCls, "min-h-[92px] resize-y leading-relaxed")}
              value={cfg.ntpServers.join("\n")}
              onChange={(e) =>
                set(
                  "ntpServers",
                  e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>
          <Field label="Sync interval (minutes)">
            <input
              className={inputCls}
              type="number"
              value={cfg.syncInterval}
              onChange={(e) => set("syncInterval", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Drift alert threshold (ms)">
            <input
              className={inputCls}
              type="number"
              value={cfg.driftThresholdMs}
              onChange={(e) => set("driftThresholdMs", Number(e.target.value) || 0)}
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground/45">
            PRESETS
          </span>
          {NTP_PRESETS.map((p) => (
            <button key={p.label} className={btnCls} onClick={() => set("ntpServers", p.servers)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <Toggle
            checked={cfg.ntpAuth}
            onChange={(v) => set("ntpAuth", v)}
            label="Require authenticated NTP (symmetric key / NTS)"
            tone="sapphire"
          />
          {cfg.ntpAuth && (
            <div className="mt-4">
              <Field label="NTP Authentication Key" hint="Symmetric key or NTS token">
                <VaultKeyField
                  value={cfg.ntpSecretRef || ""}
                  onChange={(v) => set("ntpSecretRef", v)}
                  placeholder="raw:ntp_key"
                />
              </Field>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className={btnCls}
            onClick={async () => {
              const r = await simulateNtpSync(cfg);
              const next = { ...cfg, lastSync: r.at, lastOffsetMs: r.offsetMs };
              setCfg(next);
              try {
                await saveTime(next);
              } catch(e) {}
              toast.success(`Synced with ${r.server} · offset ${r.offsetMs}ms`);
            }}
          >
            <RotateCcw size={13} /> Sync now
          </button>
          <span className="font-mono text-[11.5px] text-muted-foreground/55">
            {cfg.lastSync
              ? `last sync ${formatInZone(new Date(cfg.lastSync), cfg)} · offset ${cfg.lastOffsetMs}ms`
              : "never synchronised"}
          </span>
          {cfg.lastSync && (
            <span
              className={cn(
                "rounded-lg border px-2.5 py-[3px] font-mono text-[10.5px] tracking-[0.12em]",
                Math.abs(cfg.lastOffsetMs) <= cfg.driftThresholdMs
                  ? "border-emerald/40 bg-emerald/10 text-emerald"
                  : "border-ruby/40 bg-ruby/10 text-ruby",
              )}
            >
              {Math.abs(cfg.lastOffsetMs) <= cfg.driftThresholdMs ? "IN TOLERANCE" : "DRIFT"}
            </span>
          )}
        </div>

        <SectionActions
          onSave={handleSaveTime}
          onReset={() =>
            resetKeys([
              "ntpEnabled",
              "ntpServers",
              "syncInterval",
              "driftThresholdMs",
              "ntpAuth",
              "ntpSecretRef",
              "lastSync",
              "lastOffsetMs",
            ])
          }
          title="Reset NTP synchronisation?"
          body="NTP servers, interval, drift threshold and sync history revert to factory defaults."
        />
      </CollapsibleSection>
    </div>
  );
}
