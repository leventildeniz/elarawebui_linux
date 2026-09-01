import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeName =
  | "midnight"
  | "matrix"
  | "cyberpunk"
  | "obsidian"
  | "sunset"
  | "arctic"
  | "rose"
  | "forest"
  | "platinum"
  | "executive"
  | "azure"
  | "graphite"
  | "imperial"
  | "monarch"
  | "pearl"
  | "nebula"
  | "carbon"
  | "solaris"
  | "abyss"
  | "aurora"
  | "crimson"
  | "quantum"
  | "anthracite"
  | "custom";
export type Mode = "dark" | "light" | "system";

export type FontFamily =
  | "display" | "inter" | "manrope" | "ibm" | "dm-sans" | "plus-jakarta"
  | "outfit" | "sora" | "work-sans" | "nunito" | "poppins" | "rubik"
  | "serif" | "playfair" | "lora" | "merriweather" | "eb-garamond" | "cormorant"
  | "roboto-slab" | "bitter"
  | "mono" | "fira-code" | "ibm-mono" | "source-code"
  | "bebas" | "oswald" | "archivo-black";

/** Root font-size in pixels. Free-form 10–24 range. */
export type FontSize = number;

export const FONT_CATEGORIES: { label: string; items: { id: FontFamily; name: string }[] }[] = [
  { label: "Sans", items: [
    { id: "display", name: "Space Grotesk" },
    { id: "inter", name: "Inter" },
    { id: "manrope", name: "Manrope" },
    { id: "ibm", name: "IBM Plex Sans" },
    { id: "dm-sans", name: "DM Sans" },
    { id: "plus-jakarta", name: "Plus Jakarta Sans" },
    { id: "outfit", name: "Outfit" },
    { id: "sora", name: "Sora" },
    { id: "work-sans", name: "Work Sans" },
    { id: "nunito", name: "Nunito" },
    { id: "poppins", name: "Poppins" },
    { id: "rubik", name: "Rubik" },
  ]},
  { label: "Serif", items: [
    { id: "serif", name: "Source Serif" },
    { id: "playfair", name: "Playfair Display" },
    { id: "lora", name: "Lora" },
    { id: "merriweather", name: "Merriweather" },
    { id: "eb-garamond", name: "EB Garamond" },
    { id: "cormorant", name: "Cormorant Garamond" },
  ]},
  { label: "Slab / Editorial", items: [
    { id: "roboto-slab", name: "Roboto Slab" },
    { id: "bitter", name: "Bitter" },
  ]},
  { label: "Mono", items: [
    { id: "mono", name: "JetBrains Mono" },
    { id: "fira-code", name: "Fira Code" },
    { id: "ibm-mono", name: "IBM Plex Mono" },
    { id: "source-code", name: "Source Code Pro" },
  ]},
  { label: "Display", items: [
    { id: "bebas", name: "Bebas Neue" },
    { id: "oswald", name: "Oswald" },
    { id: "archivo-black", name: "Archivo Black" },
  ]},
];

export interface CustomPalette {
  background: string; // hex
  primary: string;
  accent: string;
}

const DEFAULT_CUSTOM: CustomPalette = {
  background: "#0a0a0a",
  primary: "#4f8cff",
  accent: "#9b6bff",
};

interface ThemeCtx {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  font: FontFamily;
  setFont: (f: FontFamily) => void;
  fontSize: FontSize;
  setFontSize: (s: FontSize) => void;
  custom: CustomPalette;
  setCustom: (c: CustomPalette) => void;
}

const Ctx = createContext<ThemeCtx>({
  theme: "midnight", setTheme: () => {},
  mode: "dark", setMode: () => {},
  font: "display", setFont: () => {},
  fontSize: 14, setFontSize: () => {},
  custom: DEFAULT_CUSTOM, setCustom: () => {},
});

export const FONT_FAMILY_MAP: Record<FontFamily, string> = {
  display:        '"Space Grotesk", system-ui, sans-serif',
  inter:          'Inter, system-ui, sans-serif',
  manrope:        'Manrope, system-ui, sans-serif',
  ibm:            '"IBM Plex Sans", system-ui, sans-serif',
  "dm-sans":      '"DM Sans", system-ui, sans-serif',
  "plus-jakarta": '"Plus Jakarta Sans", system-ui, sans-serif',
  outfit:         'Outfit, system-ui, sans-serif',
  sora:           'Sora, system-ui, sans-serif',
  "work-sans":    '"Work Sans", system-ui, sans-serif',
  nunito:         'Nunito, system-ui, sans-serif',
  poppins:        'Poppins, system-ui, sans-serif',
  rubik:          'Rubik, system-ui, sans-serif',
  serif:          '"Source Serif Pro", Georgia, serif',
  playfair:       '"Playfair Display", Georgia, serif',
  lora:           'Lora, Georgia, serif',
  merriweather:   'Merriweather, Georgia, serif',
  "eb-garamond":  '"EB Garamond", Georgia, serif',
  cormorant:      '"Cormorant Garamond", Georgia, serif',
  "roboto-slab":  '"Roboto Slab", Georgia, serif',
  bitter:         'Bitter, Georgia, serif',
  mono:           '"JetBrains Mono", ui-monospace, monospace',
  "fira-code":    '"Fira Code", ui-monospace, monospace',
  "ibm-mono":     '"IBM Plex Mono", ui-monospace, monospace',
  "source-code":  '"Source Code Pro", ui-monospace, monospace',
  bebas:          '"Bebas Neue", Impact, sans-serif',
  oswald:         'Oswald, Impact, sans-serif',
  "archivo-black":'"Archivo Black", Impact, sans-serif',
};

const LEGACY_FONT_SIZE: Record<string, number> = { sm: 13, md: 14, lg: 16, xl: 18 };
function clampSize(n: number): number { return Math.min(24, Math.max(10, Math.round(n))); }

function applyAll(theme: ThemeName, mode: Mode, font: FontFamily, fontSize: FontSize, custom: CustomPalette) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove(
    "theme-midnight","theme-matrix","theme-cyberpunk",
    "theme-obsidian","theme-sunset","theme-arctic","theme-rose","theme-forest",
    "theme-platinum","theme-executive","theme-azure","theme-graphite",
    "theme-imperial","theme-monarch","theme-pearl",
    "theme-nebula","theme-carbon","theme-solaris","theme-abyss",
    "theme-aurora","theme-crimson","theme-quantum","theme-anthracite",
    "theme-custom",
    "light","dark",
  );
  root.classList.add(`theme-${theme}`);
  const resolved = mode === "system"
    ? window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
    : mode;
  root.classList.add(resolved);

  if (theme === "custom") {
    root.style.setProperty("--background", custom.background);
    root.style.setProperty("--primary", custom.primary);
    root.style.setProperty("--ring", custom.primary);
    root.style.setProperty("--accent", custom.accent);
    root.style.setProperty("--gradient-primary", `linear-gradient(135deg, ${custom.primary}, ${custom.accent})`);
  } else {
    root.style.removeProperty("--background");
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
    root.style.removeProperty("--accent");
    root.style.removeProperty("--gradient-primary");
  }

  root.style.setProperty("--font-display", FONT_FAMILY_MAP[font]);
  root.style.fontSize = `${clampSize(fontSize)}px`;
}

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(() => load("theme", "midnight" as ThemeName));
  const [mode, setMode] = useState<Mode>(() => load("mode", "dark" as Mode));
  const [font, setFont] = useState<FontFamily>(() => load("font", "display" as FontFamily));
  const [fontSize, setFontSizeRaw] = useState<FontSize>(() => {
    const raw = load<unknown>("fontSize", 14);
    if (typeof raw === "number") return clampSize(raw);
    if (typeof raw === "string" && raw in LEGACY_FONT_SIZE) return LEGACY_FONT_SIZE[raw];
    const n = Number(raw);
    return Number.isFinite(n) ? clampSize(n) : 14;
  });
  const setFontSize = (s: FontSize) => setFontSizeRaw(clampSize(s));
  const [custom, setCustom] = useState<CustomPalette>(() => load("customPalette", DEFAULT_CUSTOM));

  useEffect(() => {
    applyAll(theme, mode, font, fontSize, custom);
    localStorage.setItem("theme", JSON.stringify(theme));
    localStorage.setItem("mode", JSON.stringify(mode));
    localStorage.setItem("font", JSON.stringify(font));
    localStorage.setItem("fontSize", JSON.stringify(fontSize));
    localStorage.setItem("customPalette", JSON.stringify(custom));
  }, [theme, mode, font, fontSize, custom]);

  return (
    <Ctx.Provider value={{ theme, setTheme, mode, setMode, font, setFont, fontSize, setFontSize, custom, setCustom }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
