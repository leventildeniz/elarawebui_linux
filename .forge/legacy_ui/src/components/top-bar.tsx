import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTheme, type ThemeName, type Mode } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { MetricsAPI, type MetricsFrame } from "@/lib/api-client";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Palette, Sun, Moon, Monitor, LogOut, User2, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const themeLabels: Record<ThemeName, string> = {
  midnight: "Midnight Architect",
  matrix: "Matrix Green",
  cyberpunk: "Cyberpunk Blue",
  obsidian: "Obsidian Mono",
  sunset: "Sunset Ember",
  arctic: "Arctic Light",
  rose: "Rose Luxe",
  forest: "Forest Deep",
  platinum: "Platinum Bank",
  executive: "Executive Noir",
  azure: "Azure Sovereign",
  graphite: "Graphite Wallstreet",
  imperial: "Imperial Gold",
  monarch: "Monarch Violet",
  pearl: "Pearl Boutique",
  nebula: "Nebula Aurora",
  carbon: "Carbon Tactical",
  solaris: "Solaris Daybreak",
  abyss: "Abyss Cobalt",
  aurora: "Aurora Borealis ✦",
  crimson: "Crimson Imperator ✦",
  quantum: "Quantum Mint ✦",
  anthracite: "Anthracite ✦",
  custom: "Custom Palette",
};

export function TopBar() {
  const { theme, setTheme, mode, setMode, custom, setCustom } = useTheme();
  const { t } = useI18n();
  const { user, logout, brand } = useAuth();
  const navigate = useNavigate();
  const handleLogout = () => { logout(); navigate({ to: "/login" }); };
  const [now, setNow] = useState(new Date());
  const [m, setM] = useState<MetricsFrame | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const stop = MetricsAPI.subscribe(setM);
    return stop;
  }, []);

  return (
    <header className="h-14 border-b border-border glass sticky top-0 z-40 flex items-center px-3 gap-3">
      <SidebarTrigger />
      <div className="hidden md:flex items-center gap-2 text-xs font-mono text-muted-foreground">
        {brand.logoUrl && <img src={brand.logoUrl} alt={brand.name} className="h-6 w-6 object-contain rounded" />}
        <span className="pulse-dot" />
        <span>{brand.name.toUpperCase()} · ONLINE</span>
        <span className="opacity-30 mx-1">|</span>
        <span>NTP · synced</span>
      </div>

      <div className="flex-1" />

      {/* live telemetry strip — driven by middleware SSE */}
      <div className="hidden lg:flex items-center gap-3 text-[11px] font-mono">
        <Stat label="TOK/S" value={m?.tps ?? "—"} />
        <Stat label="LOCAL LAT" value={m ? `${m.latency}ms` : "—"} />
        <Stat label="GPU" value={m && m.gpu != null ? `${m.gpu.toFixed(0)}%` : "—"} />
        <Stat
          label="LOCAL"
          value={m ? `${(m.localUsedGb ?? 0).toFixed(1)}/${(m.ramTotalGb ?? 128).toFixed(0)}GB` : "—"}
          tone={m && (m.LOCAL ?? 0) > 70 ? "warn" : "ok"}
        />
        <Stat
          label="RAM"
          value={m ? `${(m.ramUsedGb ?? 0).toFixed(1)}/${(m.ramTotalGb ?? 128).toFixed(0)}GB` : "—"}
          tone={m && (m.ram ?? 0) > 85 ? "warn" : "ok"}
        />
        <Stat label="QUEUE" value={m?.queue ?? "—"} />
        <Stat
          label="HALU"
          value={m ? `${m.hallucination ?? 0}%` : "—"}
          tone={m && (m.hallucination ?? 0) > 50 ? "warn" : "ok"}
        />
      </div>

      <div className="hidden sm:flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded border border-border">
        <Activity className="h-3 w-3 text-primary" />
        {now.toLocaleTimeString("en-US")}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Palette className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="glass w-56">
          <DropdownMenuLabel>{t("common.theme")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(Object.keys(themeLabels) as ThemeName[]).map((th) => (
            <DropdownMenuItem key={th} onClick={() => setTheme(th)} className={theme === th ? "text-primary" : ""}>
              <span className="h-3 w-3 rounded-full mr-2 bg-gradient-primary" />
              {themeLabels[th]}
            </DropdownMenuItem>
          ))}
          {theme === "custom" && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-2 space-y-3" onClick={(e) => e.stopPropagation()}>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Custom Palette</div>
                {(["background", "primary", "accent"] as const).map((k) => {
                  const presets =
                    k === "background"
                      ? ["#0a0a0a", "#0f172a", "#111827", "#1e1b4b", "#1c1917", "#fafafa", "#f5f5f4", "#fefce8"]
                      : k === "primary"
                        ? ["#4f8cff", "#22d3ee", "#10b981", "#f97316", "#ef4444", "#a855f7", "#eab308", "#ec4899"]
                        : ["#9b6bff", "#06b6d4", "#84cc16", "#f59e0b", "#f43f5e", "#8b5cf6", "#14b8a6", "#d946ef"];
                  return (
                    <div key={k} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] font-mono w-20 text-muted-foreground capitalize">{k}</label>
                        <label className="relative h-9 flex-1 rounded border border-border cursor-pointer overflow-hidden" style={{ background: custom[k] }}>
                          <input
                            type="color"
                            value={custom[k]}
                            onChange={(e) => setCustom({ ...custom, [k]: e.target.value })}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono mix-blend-difference text-white pointer-events-none">
                            {custom[k].toUpperCase()}
                          </span>
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-1 pl-22">
                        {presets.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setCustom({ ...custom, [k]: c })}
                            className={`h-5 w-5 rounded border ${custom[k].toLowerCase() === c.toLowerCase() ? "border-primary ring-1 ring-primary" : "border-border"}`}
                            style={{ background: c }}
                            title={c}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <DropdownMenuSeparator />
          {(["dark", "light", "system"] as Mode[]).map((mm) => (
            <DropdownMenuItem key={mm} onClick={() => setMode(mm)} className={mode === mm ? "text-primary" : ""}>
              {mm === "dark" ? <Moon className="h-4 w-4 mr-2" /> : mm === "light" ? <Sun className="h-4 w-4 mr-2" /> : <Monitor className="h-4 w-4 mr-2" />}
              {mm}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 h-8">
              <User2 className="h-4 w-4" />
              <span className="hidden sm:inline">{user.username}</span>
              <Badge variant="outline" className="text-[9px] font-mono">{user.role}</Badge>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass">
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="h-4 w-4 mr-2" /> {t("common.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}

function Stat({ label, value, tone = "ok" }: { label: string; value: string | number; tone?: "ok" | "warn" }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${tone === "warn" ? "border-destructive/60 bg-destructive/10" : "border-border bg-card/40"}`}>
      <span className="text-muted-foreground/60">{label}</span>
      <span className={`font-bold ${tone === "warn" ? "text-destructive" : "text-primary"}`}>{value}</span>
    </div>
  );
}
