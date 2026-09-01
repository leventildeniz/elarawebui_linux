/**
 * Elara Sovereign Studio — Avatar Library
 *
 * Deterministic, dependency-free SVG avatars. A seed string (agent id, user
 * email, model slug…) always produces the same avatar, so avatars can be stored
 * as `{ seed, style }` instead of uploaded images.
 */

export type AvatarStyle = "sigil" | "orbit" | "mesh" | "prism" | "initials";

export const avatarStyles: { id: AvatarStyle; label: string; hint: string }[] = [
  { id: "sigil", label: "Sigil", hint: "Geometric identicon grid" },
  { id: "orbit", label: "Orbit", hint: "Concentric rings & satellites" },
  { id: "mesh", label: "Mesh", hint: "Soft gradient mesh" },
  { id: "prism", label: "Prism", hint: "Faceted jewel shards" },
  { id: "initials", label: "Initials", hint: "Monogram on gradient" },
];

export type JewelName = "sapphire" | "emerald" | "amethyst" | "topaz" | "ruby" | "platinum";

export const jewelPalette: Record<JewelName, { from: string; to: string; ink: string }> = {
  sapphire: { from: "#1d4ed8", to: "#0f52ba", ink: "#dbeafe" },
  emerald: { from: "#0f766e", to: "#50c878", ink: "#dcfce7" },
  amethyst: { from: "#6d28d9", to: "#a855f7", ink: "#ede9fe" },
  topaz: { from: "#b45309", to: "#f5b544", ink: "#fef3c7" },
  ruby: { from: "#9f1239", to: "#f43f5e", ink: "#ffe4e6" },
  platinum: { from: "#3f4650", to: "#8b93a1", ink: "#e2e8f0" },
};

export const jewelNames = Object.keys(jewelPalette) as JewelName[];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function initialsOf(label: string): string {
  const parts = label
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "EL";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function jewelForSeed(seed: string): JewelName {
  return jewelNames[hash(seed) % jewelNames.length]!;
}

export type AvatarOptions = {
  style?: AvatarStyle | undefined;
  jewel?: JewelName | undefined;
  label?: string | undefined;
  size?: number | undefined;
};

/** Build the raw SVG markup for an avatar. */
export function avatarSvg(seed: string, options: AvatarOptions = {}): string {
  const style = options.style ?? "sigil";
  const jewel = options.jewel ?? jewelForSeed(seed);
  const { from, to, ink } = jewelPalette[jewel];
  const size = options.size ?? 96;
  const h = hash(`${seed}:${style}`);
  const rand = rng(h);
  const id = `g${(h % 99991).toString(36)}`;

  const base = `<defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="${id}b" cx="30%" cy="20%" r="80%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.35"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="26" fill="#1a1c23"/>
  <rect width="100" height="100" rx="26" fill="url(#${id})" opacity="0.92"/>
  <rect width="100" height="100" rx="26" fill="url(#${id}b)"/>`;

  let art = "";

  if (style === "sigil") {
    const cells: string[] = [];
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 5; y++) {
        if (rand() > 0.45) {
          const px = 18 + x * 22;
          const py = 12 + y * 15.5;
          cells.push(
            `<rect x="${px}" y="${py}" width="16" height="11" rx="3" fill="${ink}" opacity="${(0.45 + rand() * 0.5).toFixed(2)}"/>`,
          );
          if (x < 2)
            cells.push(
              `<rect x="${100 - px - 16}" y="${py}" width="16" height="11" rx="3" fill="${ink}" opacity="${(0.45 + rand() * 0.5).toFixed(2)}"/>`,
            );
        }
      }
    }
    art = cells.join("");
  } else if (style === "orbit") {
    art = `<circle cx="50" cy="50" r="26" fill="none" stroke="${ink}" stroke-opacity="0.55" stroke-width="1.5"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="${ink}" stroke-opacity="0.25" stroke-width="1"/>
      <circle cx="50" cy="50" r="${8 + Math.round(rand() * 6)}" fill="${ink}" fill-opacity="0.9"/>`;
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2;
      const r = 26 + (i % 2) * 10;
      art += `<circle cx="${(50 + Math.cos(a) * r).toFixed(1)}" cy="${(50 + Math.sin(a) * r).toFixed(1)}" r="${(2.5 + rand() * 2.5).toFixed(1)}" fill="${ink}" fill-opacity="0.85"/>`;
    }
  } else if (style === "mesh") {
    art = "";
    for (let i = 0; i < 5; i++) {
      art += `<circle cx="${(rand() * 100).toFixed(1)}" cy="${(rand() * 100).toFixed(1)}" r="${(18 + rand() * 26).toFixed(1)}" fill="${ink}" fill-opacity="${(0.06 + rand() * 0.16).toFixed(2)}"/>`;
    }
    art += `<circle cx="50" cy="50" r="15" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-opacity="0.4"/>`;
  } else if (style === "prism") {
    const pts = () =>
      Array.from(
        { length: 3 },
        () => `${(rand() * 100).toFixed(0)},${(rand() * 100).toFixed(0)}`,
      ).join(" ");
    art = Array.from(
      { length: 5 },
      () =>
        `<polygon points="${pts()}" fill="${ink}" fill-opacity="${(0.08 + rand() * 0.22).toFixed(2)}"/>`,
    ).join("");
    art += `<polygon points="50,18 78,50 50,82 22,50" fill="none" stroke="${ink}" stroke-opacity="0.6" stroke-width="1.5"/>`;
  } else {
    art = `<text x="50" y="50" text-anchor="middle" dominant-baseline="central"
      font-family="'Space Grotesk','Inter',sans-serif" font-size="36" font-weight="600"
      letter-spacing="1" fill="${ink}">${initialsOf(options.label ?? seed)}</text>`;
  }

  const frame = `<rect x="0.5" y="0.5" width="99" height="99" rx="25.5" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${base}${art}${frame}</svg>`;
}

/** Data URI version, usable directly in `<img src>` or CSS. */
export function avatarDataUri(seed: string, options: AvatarOptions = {}): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(seed, options))}`;
}

/** A ready-made gallery of seeds for pickers and previews. */
export const avatarSeedGallery = [
  "atlas",
  "orion",
  "vega",
  "lyra",
  "nyx",
  "helios",
  "cygnus",
  "draco",
  "aurora",
  "titan",
  "kepler",
  "rigel",
  "polaris",
  "andromeda",
  "sirius",
  "phoenix",
  "onyx",
  "cobalt",
  "zephyr",
  "quasar",
  "nebula",
  "solstice",
  "eclipse",
  "meridian",
];
