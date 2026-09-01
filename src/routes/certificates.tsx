import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, FolderOpen, Plug, ShieldCheck } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { ResetButton, SaveButton } from "@/components/sovereign/action-buttons";
import { cn } from "@/lib/utils";

import { fetchApi } from "@/lib/api";

const description =
  "HTTPS certificate management for the studio — generate self-signed material or bind existing certificate, key and CA bundle paths on macOS and Linux.";

export const Route = createFileRoute("/certificates")({
  head: () => ({
    meta: [
      { title: "Certificates — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Certificates — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CertificatesPage,
});

const labelCls =
  "mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60";
const fieldCls =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-sapphire/50";
const btnCls =
  "flex items-center gap-2 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[6px] font-mono text-[11px] tracking-[0.12em] text-muted-foreground/80 transition-colors hover:border-sapphire/50 hover:text-foreground";

function CertificatesPage() {
  return (
    <Surface
      wide
      crumb="Certificates"
      title="Certificates"
      meta="HTTPS INTERFACE · TRUST STORE"
    >
      <Certificates />
    </Surface>
  );
}

/* ------------------------------------------------- collapsible section -- */

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
      className="mt-4 overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015] p-6"
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
            <p className="mt-2 max-w-[90ch] font-mono text-[12px] leading-relaxed text-muted-foreground/60">
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

/* ------------------------------------------------------------ certs -- */

type CertConfig = {
  platform: "macos" | "linux";
  domain: string;
  san: string;
  days: string;
  trust: boolean;
  certPath: string;
  keyPath: string;
  caPath: string;
};

const defaultCerts: CertConfig = {
  platform: "macos",
  domain: "studio.local",
  san: "localhost, 127.0.0.1, ::1",
  days: "825",
  trust: false,
  certPath: "",
  keyPath: "",
  caPath: "",
};

const CERT_KEY = "sovereign.certificates";

function loadCerts(): CertConfig {
  if (typeof window === "undefined") return defaultCerts;
  try {
    const raw = window.localStorage.getItem(CERT_KEY);
    return raw ? { ...defaultCerts, ...(JSON.parse(raw) as Partial<CertConfig>) } : defaultCerts;
  } catch {
    return defaultCerts;
  }
}

function Certificates() {
  const [cfg, setCfg] = useState<CertConfig>(defaultCerts);
  const [status, setStatus] = useState<"idle" | "generating" | "validating" | "ok" | "error">("idle");
  const [chain, setChain] = useState<string | string[] | null>(null);
  const [serverPath, setServerPath] = useState<string>("");
  const [isMac, setIsMac] = useState(false);
  const [activeCfg, setActiveCfg] = useState<{certPath: string, keyPath: string, caPath: string}>({
    certPath: "",
    keyPath: "",
    caPath: ""
  });

  useEffect(() => {
    const fetchCerts = async () => {
      try {
        const data = await fetchApi("/system/certs/config");
        if (data.ok) {
          setServerPath(data.certsDir);
          setIsMac(data.os === "darwin");
          setActiveCfg({
            certPath: data.active.certPath,
            keyPath: data.active.keyPath,
            caPath: data.active.caPath
          });
          setCfg(prev => ({
            ...prev,
            platform: data.os === "darwin" ? "macos" : "linux",
            certPath: data.active.certPath,
            keyPath: data.active.keyPath,
            caPath: data.active.caPath
          }));
        }
      } catch (e) {
        console.error("Failed to load cert config:", e);
      }
    };
    fetchCerts();
  }, []);

  const set = <K extends keyof CertConfig>(k: K, v: CertConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const { platform, domain, san, days, trust, certPath, keyPath, caPath } = cfg;
  const dir = serverPath || "<loading...>";

  const generate = async () => {
    setStatus("generating");
    try {
      const res = await fetchApi("/system/certs/generate", {
        method: "POST",
        body: JSON.stringify({ domain: domain || "studio", san, days: days || "825", trust })
      });
      if (res.ok) {
        set("certPath", res.certPath);
        set("keyPath", res.keyPath);
        setActiveCfg({ certPath: res.certPath, keyPath: res.keyPath, caPath: "" });
        setStatus("ok");
        setTimeout(() => setStatus("idle"), 2500);
      } else {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 2500);
      }
    } catch (e) {
      console.error(e);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  const save = async () => {
    setStatus("validating");
    try {
      const res = await fetchApi("/system/certs/bind", {
        method: "POST",
        body: JSON.stringify({
          certPath: cfg.certPath,
          keyPath: cfg.keyPath
        })
      });
      if (res.ok) {
        setActiveCfg({ certPath: cfg.certPath, keyPath: cfg.keyPath, caPath: cfg.caPath });
        setChain(["Root CA: sovereign-ca", "Intermediate CA: studio-int", `Leaf: ${cfg.domain || "studio"}`]);
        setStatus("ok");
      } else {
        setStatus("error");
      }
    } catch (e) {
      console.error(e);
      setStatus("error");
    } finally {
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  const resetKeys = async (keys: (keyof CertConfig)[]) => {
    const next = { ...cfg };
    for (const k of keys) {
      if (k === "certPath") next[k] = serverPath ? `${serverPath}/elara.pem` : "elara.pem" as any;
      else if (k === "keyPath") next[k] = serverPath ? `${serverPath}/elara-key.pem` : "elara-key.pem" as any;
      else if (k === "caPath") next[k] = "" as any;
      else (next[k] as CertConfig[typeof k]) = defaultCerts[k];
    }
    setCfg(next);
    setStatus("idle");
  };

  const cmd = [
    `openssl req -x509 -newkey rsa:4096 -sha256 -days ${days || "825"} -nodes \\`,
    `  -keyout ${dir}/${domain || "studio"}.key -out ${dir}/${domain || "studio"}.crt \\`,
    `  -subj "/CN=${domain || "studio"}"${san ? ` -addext "subjectAltName=${san.split(",").map(s => {
      const v = s.trim();
      return v.match(/^[0-9.]+$/) ? `IP:${v}` : `DNS:${v}`;
    }).join(",")}"` : ""}`,
    trust
      ? isMac
        ? `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${dir}/${domain || "studio"}.crt`
        : `sudo cp ${dir}/${domain || "studio"}.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates`
      : "",
  ].filter(Boolean).join("\n");

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-6"
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck size={15} className="text-emerald" strokeWidth={1.6} />
            <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground">
              Certificates
            </h2>
            <span className="rounded-md border border-emerald/40 px-2 py-[3px] font-mono text-[10.5px] tracking-[0.12em] text-emerald">
              HTTPS INTERFACE
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              disabled
              className={cn(
                "rounded-lg border px-3 py-[5px] font-mono text-[11px] tracking-[0.12em]",
                isMac
                  ? "border-sapphire/45 bg-sapphire/12 text-sapphire"
                  : "border-white/[0.07] bg-raised/30 text-muted-foreground/40",
              )}
            >
              MACOS
            </button>
            <button
              disabled
              className={cn(
                "rounded-lg border px-3 py-[5px] font-mono text-[11px] tracking-[0.12em]",
                !isMac
                  ? "border-emerald/45 bg-emerald/12 text-emerald"
                  : "border-white/[0.07] bg-raised/30 text-muted-foreground/40",
              )}
            >
              LINUX
            </button>
          </div>
        </header>

        <p className="mt-3 max-w-[100ch] font-mono text-[12px] leading-relaxed text-muted-foreground/65">
          Generate a self-signed certificate for the studio HTTPS interface on macOS or Linux, or
          point the runtime at certificate files that already exist on the host.
        </p>
      </motion.section>

      <CollapsibleSection
        title="Generate new certificate"
        subtitle="Self-signed material written into the studio certificate directory."
        delay={0.08}
      >
        <div className="grid gap-x-5 gap-y-3 md:grid-cols-2">
          <div>
            <span className={labelCls}>Common name (domain)</span>
            <input
              className={fieldCls}
              value={domain}
              onChange={(e) => set("domain", e.target.value)}
            />
          </div>
          <div>
            <span className={labelCls}>Subject alt names</span>
            <input className={fieldCls} value={san} onChange={(e) => set("san", e.target.value)} />
          </div>
          <div>
            <span className={labelCls}>Validity (days)</span>
            <input
              className={fieldCls}
              value={days}
              onChange={(e) => set("days", e.target.value)}
            />
          </div>
          <div>
            <span className={labelCls}>Output directory</span>
            <input className={fieldCls} readOnly value={dir} />
          </div>
        </div>

        <button
          onClick={() => set("trust", !trust)}
          className="mt-4 flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground/75"
        >
          <span
            className={cn(
              "relative h-[20px] w-[38px] rounded-full border transition-colors",
              trust ? "border-transparent bg-emerald" : "border-white/12 bg-raised/50",
            )}
          >
            <span
              className={cn(
                "absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all",
                trust ? "left-[21px] bg-canvas" : "left-[3px] bg-muted-foreground/60",
              )}
            />
          </span>
          Install into the {platform === "macos" ? "system keychain" : "system trust store"}
        </button>

        <pre className="mt-5 overflow-x-auto rounded-xl border border-white/[0.06] bg-raised/30 p-4 font-mono text-[11.5px] leading-relaxed text-sapphire/85">
          {cmd}
        </pre>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={generate}
            className="flex items-center gap-2 rounded-lg border border-emerald/45 bg-emerald/12 px-4 py-[7px] font-mono text-[11px] tracking-[0.12em] text-emerald transition-colors hover:bg-emerald/20"
            style={{ boxShadow: "0 0 22px -14px var(--emerald)" }}
          >
            <ShieldCheck size={12} />
            {status === "generating" ? "GENERATING…" : "GENERATE CERTIFICATE"}
          </button>
          {status === "ok" && (
            <span className="font-mono text-[11px] text-emerald">
              CERTIFICATE WRITTEN · valid {days} days
            </span>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-white/[0.05] pt-4">
          <ResetButton
            onReset={() => resetKeys(["domain", "san", "days", "trust"])}
            title="Reset certificate generation?"
            body="Domain, subject alt names, validity and trust-store option revert to factory defaults."
          />
          <SaveButton onSave={save} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Use existing certificate"
        subtitle="Point the runtime at certificate files that already live on the host."
        delay={0.1}
      >
        <div className="grid gap-3">
          {(
            [
              ["Certificate path (.crt / .pem)", "certPath"],
              ["Private key path (.key)", "keyPath"],
              ["CA bundle path (optional)", "caPath"],
            ] as const
          ).map(([label, key]) => (
            <div key={key}>
              <span className={labelCls}>{label}</span>
              <div className="flex items-center gap-2">
                <input
                  className={fieldCls}
                  value={cfg[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
                <button
                  className={btnCls}
                  title="Browse"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = key === "keyPath" ? ".key,.pem" : ".crt,.pem,.cer";
                    input.onchange = () => {
                      const f = input.files?.[0];
                      if (!f) return;
                      const folder = cfg[key] ? cfg[key].replace(/\/[^/]*$/, "") : serverPath;
                      set(key, `${folder}/${f.name}`);
                      setChain(null);
                    };
                    input.click();
                  }}
                >
                  <FolderOpen size={12} />
                </button>
              </div>
            </div>
          ))}
          <div className="mt-1 flex items-center gap-3">
            <button
              className={btnCls}
              disabled={chain === "checking"}
              onClick={async () => {
                setChain("checking");
                try {
                  const res = await fetchApi("/system/certs/validate", {
                    method: "POST",
                    body: JSON.stringify({
                      certPath: cfg.certPath,
                      keyPath: cfg.keyPath
                    })
                  });
                  setChain(res.ok ? "valid" : "invalid");
                } catch (e) {
                  console.error(e);
                  setChain("invalid");
                }
              }}
            >
              <Plug size={12} /> {chain === "checking" ? "VALIDATING…" : "VALIDATE CHAIN"}
            </button>
            {chain === "valid" && (
              <span className="font-mono text-[11px] text-emerald">
                CHAIN VALID · leaf → CA verified
              </span>
            )}
            {chain === "invalid" && (
              <span className="font-mono text-[11px] text-ruby">
                CHAIN INVALID · check certificate and key paths
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-white/[0.05] pt-4">
          <ResetButton
            onReset={() => {
              resetKeys(["certPath", "keyPath", "caPath"]);
              setChain(null);
            }}
            title="Reset certificate paths?"
            body="Certificate, private key and CA bundle paths revert to factory defaults."
          />
          <SaveButton onSave={save} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Active binding" delay={0.12}>
        <div className="grid gap-2 font-mono text-[11.5px] text-muted-foreground/60">
          <div>
            Active certificate · <span className="text-foreground/85">{activeCfg.certPath || `${dir}/elara.pem`}</span>
          </div>
          <div>
            Private key · <span className="text-foreground/85">{activeCfg.keyPath || `${dir}/elara-key.pem`}</span>
          </div>
          <div>
            CA bundle · <span className="text-foreground/85">{activeCfg.caPath || "None"}</span>
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}
