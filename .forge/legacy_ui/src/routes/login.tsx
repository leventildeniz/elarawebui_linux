import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScanEye, ShieldAlert, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { login, user, ready, attempts, brand, providers } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const router = useRouter();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState(false);
  const needsCaptcha = attempts >= 2;

  // Surface every enabled provider so admins can sign in via LDAP/RADIUS/etc.
  const enabledProviders = providers.filter(pp => pp.enabled);
  const [provider, setProvider] = useState<string>("local");
  useEffect(() => {
    if (!enabledProviders.find(pp => pp.id === provider)) {
      setProvider(enabledProviders[0]?.id ?? "local");
    }
  }, [enabledProviders, provider]);

  useEffect(() => {
    if (ready && user) nav({ to: "/dashboard", replace: true });
  }, [ready, user, nav]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setErr("");
    if (!ready) return;
    if (needsCaptcha && !captcha) { setErr(t("auth.captcha")); return; }
    setLoading(true);
    try {
      await login(u, p, provider);
      await router.invalidate();
      nav({ to: "/dashboard", replace: true });
    } catch (e) {
      setErr((e as Error).message || t("auth.failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="glass rounded-2xl p-8 scanline relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none" style={{ background: "var(--gradient-glow)" }} />
          <div className="relative">
            <div className="flex flex-col items-center mb-6 text-center">
              {brand.logoUrl ? (
                <img src={brand.logoUrl} alt={brand.name} className="h-14 w-14 rounded-xl object-contain mb-3 glow" />
              ) : (
                <div className="h-14 w-14 rounded-xl bg-gradient-primary glow flex items-center justify-center mb-3">
                  <ScanEye className="h-7 w-7 text-primary-foreground" />
                </div>
              )}
              <h1 className="text-2xl font-bold text-gradient">{brand.name}</h1>
              <p className="text-xs text-muted-foreground tracking-wider mt-1 uppercase">{brand.tagline}</p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("auth.username")}</Label>
                <Input value={u} onChange={(e)=>setU(e.target.value)} autoFocus className="h-11 font-mono bg-background/50" placeholder="admin" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("auth.password")}</Label>
                <Input type="password" value={p} onChange={(e)=>setP(e.target.value)} className="h-11 font-mono bg-background/50" placeholder="••••••••" />
              </div>

              {enabledProviders.length > 1 && (
                <div className="space-y-2">
                  <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Authentication source</Label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full h-10 rounded-md border border-border bg-background/50 font-mono text-sm px-3"
                  >
                    {enabledProviders.map((pp) => (
                      <option key={pp.id} value={pp.id}>{pp.id.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              )}

              {needsCaptcha && (
                <div className="border border-border rounded-md p-3 bg-card/40 flex items-center gap-3">
                  <Checkbox checked={captcha} onCheckedChange={(v)=>setCaptcha(!!v)} id="cap" />
                  <Label htmlFor="cap" className="text-xs cursor-pointer flex-1">{t("auth.captcha")}</Label>
                  <Badge variant="outline" className="text-[9px] font-mono">reCAPTCHA</Badge>
                </div>
              )}

              {err && (
                <div className="text-xs text-destructive flex items-center gap-2 p-2 rounded border border-destructive/30 bg-destructive/5">
                  <ShieldAlert className="h-3.5 w-3.5" /> {err}
                </div>
              )}

              <Button type="submit" disabled={loading || !ready} className="w-full h-11 bg-gradient-primary text-primary-foreground font-bold tracking-widest uppercase">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.signin")}
              </Button>

            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
