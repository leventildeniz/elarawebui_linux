import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Info, KeyRound, Lock, ShieldAlert, User } from "lucide-react";
import { useEffect, useState } from "react";
import { bindSessionRole } from "@/lib/rbac-store";
import { fetchApi } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Elara Sovereign Studio access gate: sign in with your operator credentials to enter the orchestration console.",
      },
      { property: "og:title", content: "Sign in — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Operator access gate for the Elara Sovereign Studio orchestration console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

const MAX_ATTEMPTS = 5;
const STORE_KEY = "sovereign.auth.guard";

type Guard = { attempts: number; lockedUntil: number };

function readGuard(): Guard {
  if (typeof window === "undefined") return { attempts: 0, lockedUntil: 0 };
  try {
    return { attempts: 0, lockedUntil: 0, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") };
  } catch {
    return { attempts: 0, lockedUntil: 0 };
  }
}

function writeGuard(g: Guard) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(g));
  } catch {
    /* storage unavailable */
  }
}

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providers, setProviders] = useState<{key: string, id: string, label: string, priority: number}[]>([]);

  const [guard, setGuard] = useState<Guard>({ attempts: 0, lockedUntil: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchApi("/api/identity/auth-providers")
      .then(data => {
        if (data && data.providers) {
          setProviders(data.providers.filter((p: any) => p.enabled).sort((a: any, b: any) => a.priority - b.priority));
        }
      })
      .catch(() => {});

    setGuard(readGuard());
    // If already signed in, go straight to the studio.
    try {
      if (sessionStorage.getItem("sovereign.operator") && localStorage.getItem("sovereign.sessionId")) {
        navigate({ to: "/" });
      }
    } catch {
      /* ignore */
    }
  }, [navigate]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const lockedFor = Math.max(0, Math.ceil((guard.lockedUntil - now) / 1000));
  const locked = lockedFor > 0;



  useEffect(() => {
    if (!username.trim()) {
      setNotice(null);
      return;
    }
  }, [username]);

  const fail = (message: string) => {
    const attempts = guard.attempts + 1;
    // Exponential backoff once the attempt budget is spent.
    const over = attempts - MAX_ATTEMPTS;
    const lockedUntil =
      over >= 0 ? Date.now() + Math.min(15 * 60, 30 * Math.pow(2, over)) * 1000 : 0;
    const next = { attempts, lockedUntil };
    writeGuard(next);
    setGuard(next);
    setNow(Date.now());
    setError(lockedUntil ? "Too many failed attempts. Access temporarily sealed." : message);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked || busy) return;
    setError(null);
    setNotice(null);

    if (!username.trim() || !password) {
      setError("Operator ID and passphrase are required.");
      return;
    }

    setBusy(true);

    try {
      const data = await fetchApi("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password,
          provider: "auto",
        }),
      });

      setBusy(false);

      if (!data.ok) {
        fail(data.error || "Credentials rejected. Verify your operator passphrase.");
        return;
      }

      const clean = { attempts: 0, lockedUntil: 0 };
      writeGuard(clean);
      setGuard(clean);

      try {
        localStorage.setItem("sovereign.sessionId", data.sessionId);
        localStorage.setItem("sovereign.user", JSON.stringify(data.user));
        
        // Ensure A_KEY and G_KEY are also hydrated for standalone store accesses
        const currentAccounts = JSON.parse(localStorage.getItem("sovereign:identity:accounts:v1") || "[]");
        if (!currentAccounts.some((a: any) => a.id === data.user.id)) {
           currentAccounts.push(data.user);
           localStorage.setItem("sovereign:identity:accounts:v1", JSON.stringify(currentAccounts));
        }

        sessionStorage.setItem("sovereign.operator", data.user.username);
        sessionStorage.setItem("sovereign.sidebar.closed", "1");
      } catch {
        /* ignore */
      }

      // Ensure the studio filters every surface based on the real role from the backend
      bindSessionRole(data.user.role);

      navigate({ to: "/" });
    } catch (err) {
      setBusy(false);
      console.error("[Login Error]", err);
      fail("Failed to communicate with authentication service.");
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--canvas-deep)] px-6">
      <div className="pointer-events-none absolute left-1/2 top-[-18%] h-[460px] w-[760px] -translate-x-1/2 rounded-full bg-sapphire/8 blur-[180px]" />
      <div className="pointer-events-none absolute bottom-[-22%] right-[-10%] h-[420px] w-[560px] rounded-full bg-amethyst/6 blur-[190px]" />

      <motion.div
        initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-[420px]"
      >
        <div className="mb-8 text-center">
          <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-raised font-mono text-[15px] font-bold text-foreground/90">
            E
          </span>
          <h1 className="mt-5 font-display text-[30px] font-semibold leading-none tracking-[0.14em] text-foreground">
            ELARA
          </h1>
          <p className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.34em] text-muted-foreground/65">
            sovereign studio
          </p>
        </div>

        <form
          onSubmit={submit}
          className="obsidian-slab rounded-[16px] px-6 pb-6 pt-6 focus-within:border-white/15"
        >
          <label className="block">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground/60">
              operator id
            </span>
            <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-raised/40 px-3">
              <User className="h-4 w-4 text-muted-foreground/55" strokeWidth={1.5} />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={locked}
                placeholder="operator"
                className="h-11 w-full bg-transparent text-[15px] font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50"
              />
            </div>
          </label>

          <label className="mt-4 block">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground/60">
              passphrase
            </span>
            <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-raised/40 px-3">
              <Lock className="h-4 w-4 text-muted-foreground/55" strokeWidth={1.5} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={locked}
                placeholder="••••••••"
                className="h-11 w-full bg-transparent text-[15px] font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50"
              />
            </div>
          </label>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-start gap-2 text-[13px] leading-snug text-ruby"
            >
              <ShieldAlert className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={1.6} />
              {error}
            </motion.p>
          )}

          {!error && notice && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-start gap-2 text-[12.5px] leading-snug text-sapphire/85"
            >
              <Info className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={1.6} />
              {notice}
            </motion.p>
          )}

          <motion.button
            type="submit"
            whileTap={{ scale: 0.985 }}
            transition={{ duration: 0.16, ease: "easeInOut" }}
            disabled={locked || busy}
            className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--sapphire)_36%,transparent)] bg-[color-mix(in_oklab,var(--sapphire)_14%,transparent)] font-mono text-[12px] uppercase tracking-[0.2em] text-sapphire shadow-[0_0_28px_-14px_var(--sapphire)] transition-shadow hover:shadow-[0_0_36px_-8px_var(--sapphire)] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
          >
            <KeyRound className="h-4 w-4" strokeWidth={1.6} />
            {locked ? `sealed · ${lockedFor}s` : busy ? "verifying…" : "enter studio"}
          </motion.button>

          {locked ? (
            <p className="mt-4 text-center font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground/45">
              brute-force guard active
            </p>
          ) : null}
        </form>
      </motion.div>
    </div>
  );
}
