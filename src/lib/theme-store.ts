/** Studio theme presets — pure presentation tokens applied to :root. */

export type ThemeVars = {
  canvas: string;
  canvasDeep: string;
  raised: string;
  panel?: string;
  sapphire: string;
  emerald: string;
  amethyst: string;
  topaz: string;
  ruby: string;
};

export type ThemePreset = {
  id: string;
  label: string;
  hint: string;
  /** rails lighter than the canvas — flips rail-side surfaces and hairlines */
  invert?: boolean;
  vars: ThemeVars;
};

export const themePresets: ThemePreset[] = [
  {
    id: "obsidian",
    label: "Obsidian",
    hint: "deep navy charcoal",
    vars: {
      canvas: "oklch(0.235 0.003 260)",
      canvasDeep: "oklch(0.205 0.003 260)",
      raised: "oklch(0.305 0.003 260)",
      sapphire: "oklch(0.62 0.155 260)",
      emerald: "oklch(0.774 0.136 156)",
      amethyst: "oklch(0.68 0.155 305)",
      topaz: "oklch(0.8 0.13 85)",
      ruby: "oklch(0.64 0.19 22)",
    },
  },
  {
    id: "midnight",
    label: "Midnight Sapphire",
    hint: "cooler canvas · brighter blue",
    vars: {
      canvas: "oklch(0.222 0.012 262)",
      canvasDeep: "oklch(0.188 0.014 262)",
      raised: "oklch(0.295 0.014 262)",
      sapphire: "oklch(0.68 0.17 258)",
      emerald: "oklch(0.78 0.13 162)",
      amethyst: "oklch(0.7 0.16 300)",
      topaz: "oklch(0.82 0.13 88)",
      ruby: "oklch(0.66 0.19 20)",
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    hint: "neutral · low chroma workbench",
    vars: {
      canvas: "oklch(0.24 0.001 0)",
      canvasDeep: "oklch(0.205 0.001 0)",
      raised: "oklch(0.31 0.002 0)",
      sapphire: "oklch(0.66 0.09 250)",
      emerald: "oklch(0.76 0.09 158)",
      amethyst: "oklch(0.7 0.09 300)",
      topaz: "oklch(0.8 0.09 88)",
      ruby: "oklch(0.65 0.13 24)",
    },
  },
  {
    id: "verdant",
    label: "Verdant Vault",
    hint: "emerald-led · terminal warmth",
    vars: {
      canvas: "oklch(0.232 0.008 178)",
      canvasDeep: "oklch(0.198 0.01 178)",
      raised: "oklch(0.3 0.01 178)",
      sapphire: "oklch(0.66 0.13 214)",
      emerald: "oklch(0.8 0.15 156)",
      amethyst: "oklch(0.68 0.14 308)",
      topaz: "oklch(0.82 0.13 96)",
      ruby: "oklch(0.65 0.18 20)",
    },
  },
  {
    id: "amethyst-noir",
    label: "Amethyst Noir",
    hint: "violet bloom · high contrast",
    vars: {
      canvas: "oklch(0.226 0.012 300)",
      canvasDeep: "oklch(0.19 0.014 300)",
      raised: "oklch(0.3 0.016 300)",
      sapphire: "oklch(0.65 0.16 272)",
      emerald: "oklch(0.78 0.13 160)",
      amethyst: "oklch(0.73 0.18 305)",
      topaz: "oklch(0.83 0.13 82)",
      ruby: "oklch(0.67 0.2 12)",
    },
  },
  {
    id: "ember",
    label: "Ember Forge",
    hint: "warm charcoal · topaz + ruby",
    vars: {
      canvas: "oklch(0.235 0.008 60)",
      canvasDeep: "oklch(0.2 0.01 60)",
      raised: "oklch(0.305 0.012 60)",
      sapphire: "oklch(0.64 0.13 250)",
      emerald: "oklch(0.77 0.12 152)",
      amethyst: "oklch(0.68 0.14 320)",
      topaz: "oklch(0.84 0.15 78)",
      ruby: "oklch(0.68 0.2 26)",
    },
  },
  {
    id: "inverse-onyx",
    label: "Inverse Onyx",
    hint: "anthracite rails · onyx canvas",
    invert: true,
    vars: {
      /* deliberately inverted: rails sit lighter than the writing surface */
      canvas: "oklch(0.145 0.004 260)",
      canvasDeep: "oklch(0.272 0.004 260)",
      panel: "oklch(0.178 0.004 260)",
      raised: "oklch(0.212 0.004 260)",
      sapphire: "oklch(0.66 0.16 258)",
      emerald: "oklch(0.79 0.14 158)",
      amethyst: "oklch(0.71 0.16 303)",
      topaz: "oklch(0.83 0.13 86)",
      ruby: "oklch(0.66 0.19 22)",
    },
  },
  {
    id: "onyx-graphite",
    label: "Onyx Graphite",
    hint: "graphite rails & cards · black canvas",
    invert: true,
    vars: {
      /* rails, panels and cards sit at #171717 over a near-black stage */
      canvas: "oklch(0.145 0 0)",
      canvasDeep: "oklch(0.209 0 0)",
      panel: "oklch(0.209 0 0)",
      raised: "oklch(0.245 0 0)",
      sapphire: "oklch(0.66 0.16 258)",
      emerald: "oklch(0.79 0.14 158)",
      amethyst: "oklch(0.71 0.16 303)",
      topaz: "oklch(0.83 0.13 86)",
      ruby: "oklch(0.66 0.19 22)",
    },
  },
];

const STORAGE_KEY = "sovereign.theme";

export function applyTheme(preset: ThemePreset) {
  const root = document.documentElement;
  const v = preset.vars;
  root.style.setProperty("--canvas", v.canvas);
  root.style.setProperty("--canvas-deep", v.canvasDeep);
  root.style.setProperty("--canvas-low", v.canvas);
  root.style.setProperty("--raised", v.raised);
  /* keep mid surfaces in the same family, otherwise panels edge against the canvas */
  root.style.setProperty("--panel", v.panel ?? `color-mix(in oklab, ${v.canvas} 50%, ${v.raised})`);
  root.style.setProperty("--muted", `color-mix(in oklab, ${v.raised} 70%, ${v.canvas})`);
  root.style.setProperty("--sapphire", v.sapphire);
  root.style.setProperty("--emerald", v.emerald);
  root.style.setProperty("--amethyst", v.amethyst);
  root.style.setProperty("--topaz", v.topaz);
  root.style.setProperty("--ruby", v.ruby);
  root.classList.toggle("studio-invert", preset.invert === true);

  /* clear any leftovers from previously shipped light presets */
  root.classList.remove("studio-light");
  root.style.removeProperty("color-scheme");
  for (const k of [
    "--foreground",
    "--muted-foreground",
    "--platinum",
    "--hairline",
    "--border",
    "--input",
    "--primary-foreground",
    "--secondary-foreground",
    "--accent-foreground",
    "--shadow-panel",
  ]) {
    root.style.removeProperty(k);
  }

  try {
    localStorage.setItem(STORAGE_KEY, preset.id);
  } catch {
    /* storage unavailable */
  }
}

export function storedThemeId(): string {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return themePresets.some((p) => p.id === id) ? (id as string) : "onyx-graphite";
  } catch {
    return "onyx-graphite";
  }
}
