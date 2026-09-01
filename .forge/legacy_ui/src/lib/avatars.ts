// Built-in avatar gallery — themed minimal SVG icons (no external assets).
// Categories: cyber (security), woman, man, defaults (robot/eagle-eye).

export type AvatarCategory = "cyber" | "woman" | "man" | "default";

export interface AvatarPreset {
  id: string;
  label: string;
  category: AvatarCategory;
  url: string;
}

const enc = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;
const wrap = (id: string, body: string, gradient: [string, string]) => enc(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${gradient[0]}"/><stop offset="100%" stop-color="${gradient[1]}"/>
    </linearGradient></defs>
    <rect width="64" height="64" rx="14" fill="url(#${id})"/>
    ${body}
  </svg>`
);

// — Cyber/security palette
const cyber: [string,string][] = [
  ["#0ea5e9","#1e3a8a"], ["#22d3ee","#0f172a"], ["#10b981","#064e3b"],
  ["#a855f7","#1e1b4b"], ["#f43f5e","#3f1212"], ["#facc15","#7c2d12"],
  ["#38bdf8","#020617"], ["#34d399","#022c22"], ["#f97316","#451a03"],
  ["#e879f9","#3b0764"],
];
const woman: [string,string][] = [
  ["#fbcfe8","#db2777"], ["#fda4af","#9f1239"], ["#fcd34d","#b45309"],
  ["#c4b5fd","#6d28d9"], ["#5eead4","#0f766e"], ["#fca5a5","#7f1d1d"],
  ["#a5f3fc","#0e7490"], ["#fde68a","#92400e"], ["#f0abfc","#86198f"],
  ["#bef264","#3f6212"],
];
const man: [string,string][] = [
  ["#60a5fa","#1e3a8a"], ["#94a3b8","#0f172a"], ["#fb923c","#7c2d12"],
  ["#4ade80","#14532d"], ["#a78bfa","#312e81"], ["#22d3ee","#155e75"],
  ["#f87171","#7f1d1d"], ["#facc15","#713f12"], ["#34d399","#064e3b"],
  ["#818cf8","#1e1b4b"],
];

// SVG body fragments — playful but minimalist
const cyberBodies = [
  // shield
  `<path d="M32 12 L50 20 V34 C50 44 32 54 32 54 C32 54 14 44 14 34 V20 Z" fill="white" opacity=".95"/><path d="M26 32 L31 37 L40 26" stroke="#0f172a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  // lock
  `<rect x="20" y="28" width="24" height="22" rx="4" fill="white"/><path d="M24 28 V22 a8 8 0 0 1 16 0 V28" stroke="white" stroke-width="3" fill="none"/><circle cx="32" cy="38" r="3" fill="#0f172a"/>`,
  // eye (eagle eye)
  `<ellipse cx="32" cy="34" rx="18" ry="11" fill="white"/><circle cx="32" cy="34" r="6" fill="#0f172a"/><circle cx="34" cy="32" r="2" fill="white"/>`,
  // bug
  `<circle cx="32" cy="34" r="12" fill="white"/><path d="M20 34 H10 M44 34 H54 M22 24 L16 18 M42 24 L48 18 M22 44 L16 50 M42 44 L48 50" stroke="white" stroke-width="2" stroke-linecap="round"/><circle cx="28" cy="32" r="1.6" fill="#0f172a"/><circle cx="36" cy="32" r="1.6" fill="#0f172a"/>`,
  // chip
  `<rect x="18" y="18" width="28" height="28" rx="3" fill="white"/><rect x="24" y="24" width="16" height="16" rx="2" fill="#0f172a"/><path d="M14 24 H18 M14 32 H18 M14 40 H18 M46 24 H50 M46 32 H50 M46 40 H50 M24 14 V18 M32 14 V18 M40 14 V18 M24 46 V50 M32 46 V50 M40 46 V50" stroke="white" stroke-width="2"/>`,
  // ghost (anon)
  `<path d="M16 30 a16 16 0 0 1 32 0 V52 l-5-4 -5 4 -5-4 -5 4 -5-4 -5 4 z" fill="white"/><circle cx="27" cy="32" r="2.5" fill="#0f172a"/><circle cx="38" cy="32" r="2.5" fill="#0f172a"/>`,
  // key
  `<circle cx="24" cy="32" r="10" fill="white"/><circle cx="24" cy="32" r="4" fill="#0f172a"/><rect x="32" y="29" width="20" height="6" fill="white"/><rect x="44" y="35" width="4" height="6" fill="white"/>`,
  // radar
  `<circle cx="32" cy="34" r="16" fill="none" stroke="white" stroke-width="2"/><circle cx="32" cy="34" r="10" fill="none" stroke="white" stroke-width="2"/><circle cx="32" cy="34" r="4" fill="none" stroke="white" stroke-width="2"/><path d="M32 34 L46 24" stroke="white" stroke-width="3" stroke-linecap="round"/>`,
  // fingerprint
  `<path d="M32 16 a14 14 0 0 1 14 14 v4 M32 22 a8 8 0 0 1 8 8 v8 a4 4 0 0 1-8 0 M32 30 v8 a8 8 0 0 1-8 0 v-4 a14 14 0 0 1 4-10" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  // network nodes
  `<circle cx="32" cy="20" r="4" fill="white"/><circle cx="18" cy="44" r="4" fill="white"/><circle cx="46" cy="44" r="4" fill="white"/><path d="M32 20 L18 44 M32 20 L46 44 M18 44 L46 44" stroke="white" stroke-width="2"/>`,
];

const womanBodies = [
  // long-hair head
  `<circle cx="32" cy="28" r="12" fill="white"/><path d="M20 28 Q20 14 32 14 Q44 14 44 28 V36 H40 V30 a8 8 0 0 0-16 0 V36 H20 Z" fill="white"/><circle cx="28" cy="28" r="1.6" fill="#0f172a"/><circle cx="36" cy="28" r="1.6" fill="#0f172a"/><path d="M28 33 Q32 36 36 33" stroke="#0f172a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  // bun head
  `<circle cx="32" cy="20" r="5" fill="white"/><circle cx="32" cy="34" r="12" fill="white"/><circle cx="28" cy="33" r="1.6" fill="#0f172a"/><circle cx="36" cy="33" r="1.6" fill="#0f172a"/><path d="M28 38 Q32 41 36 38" stroke="#0f172a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  // ponytail
  `<circle cx="32" cy="30" r="12" fill="white"/><path d="M44 28 Q52 32 50 44" stroke="white" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="29" cy="29" r="1.6" fill="#0f172a"/><circle cx="36" cy="29" r="1.6" fill="#0f172a"/>`,
  // curly
  `<circle cx="22" cy="22" r="5" fill="white"/><circle cx="32" cy="18" r="5" fill="white"/><circle cx="42" cy="22" r="5" fill="white"/><circle cx="32" cy="34" r="12" fill="white"/><circle cx="28" cy="33" r="1.6" fill="#0f172a"/><circle cx="36" cy="33" r="1.6" fill="#0f172a"/><path d="M28 38 Q32 41 36 38" stroke="#0f172a" stroke-width="1.5" fill="none"/>`,
  // bob cut
  `<path d="M18 32 Q18 16 32 16 Q46 16 46 32 V40 H42 V32 Q42 22 32 22 Q22 22 22 32 V40 H18 Z" fill="white"/><circle cx="28" cy="32" r="1.6" fill="#0f172a"/><circle cx="36" cy="32" r="1.6" fill="#0f172a"/><path d="M30 36 Q32 38 34 36" stroke="#0f172a" stroke-width="1.5" fill="none"/>`,
  // headphones
  `<circle cx="32" cy="32" r="12" fill="white"/><path d="M16 32 a16 16 0 0 1 32 0" stroke="white" stroke-width="3" fill="none"/><rect x="14" y="30" width="6" height="10" rx="2" fill="white"/><rect x="44" y="30" width="6" height="10" rx="2" fill="white"/><circle cx="29" cy="31" r="1.6" fill="#0f172a"/><circle cx="36" cy="31" r="1.6" fill="#0f172a"/>`,
  // glasses
  `<circle cx="32" cy="30" r="12" fill="white"/><circle cx="27" cy="30" r="3.5" fill="none" stroke="#0f172a" stroke-width="1.5"/><circle cx="37" cy="30" r="3.5" fill="none" stroke="#0f172a" stroke-width="1.5"/><path d="M30.5 30 H33.5" stroke="#0f172a" stroke-width="1.5"/>`,
  // hat
  `<path d="M14 26 H50 L46 18 H18 Z" fill="white"/><circle cx="32" cy="34" r="11" fill="white"/><circle cx="29" cy="34" r="1.6" fill="#0f172a"/><circle cx="36" cy="34" r="1.6" fill="#0f172a"/>`,
  // tied hair
  `<circle cx="32" cy="30" r="12" fill="white"/><path d="M22 24 Q14 18 18 12 M42 24 Q50 18 46 12" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="28" cy="30" r="1.6" fill="#0f172a"/><circle cx="36" cy="30" r="1.6" fill="#0f172a"/>`,
  // pixie
  `<path d="M20 32 Q18 18 32 18 Q46 18 44 32 V36 H40 V30 Q40 24 32 24 Q24 24 24 30 V36 H20 Z" fill="white"/><circle cx="28" cy="32" r="1.6" fill="#0f172a"/><circle cx="36" cy="32" r="1.6" fill="#0f172a"/><circle cx="40" cy="36" r="1.4" fill="#fda4af"/><circle cx="24" cy="36" r="1.4" fill="#fda4af"/>`,
];

const manBodies = [
  // beard
  `<circle cx="32" cy="28" r="12" fill="white"/><path d="M22 32 Q22 44 32 44 Q42 44 42 32" fill="white"/><circle cx="28" cy="28" r="1.6" fill="#0f172a"/><circle cx="36" cy="28" r="1.6" fill="#0f172a"/><path d="M28 34 Q32 36 36 34" stroke="#0f172a" stroke-width="1.5" fill="none"/>`,
  // bald
  `<circle cx="32" cy="32" r="12" fill="white"/><circle cx="28" cy="30" r="1.6" fill="#0f172a"/><circle cx="36" cy="30" r="1.6" fill="#0f172a"/><path d="M28 36 Q32 38 36 36" stroke="#0f172a" stroke-width="1.5" fill="none"/>`,
  // short hair
  `<circle cx="32" cy="32" r="12" fill="white"/><path d="M20 26 Q22 18 32 18 Q42 18 44 26" fill="white"/><circle cx="28" cy="32" r="1.6" fill="#0f172a"/><circle cx="36" cy="32" r="1.6" fill="#0f172a"/>`,
  // glasses guy
  `<circle cx="32" cy="32" r="12" fill="white"/><circle cx="27" cy="31" r="3.5" fill="none" stroke="#0f172a" stroke-width="1.5"/><circle cx="37" cy="31" r="3.5" fill="none" stroke="#0f172a" stroke-width="1.5"/><path d="M30.5 31 H33.5" stroke="#0f172a" stroke-width="1.5"/>`,
  // mustache
  `<circle cx="32" cy="32" r="12" fill="white"/><path d="M24 36 Q28 32 32 36 Q36 32 40 36" stroke="#0f172a" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="28" cy="30" r="1.6" fill="#0f172a"/><circle cx="36" cy="30" r="1.6" fill="#0f172a"/>`,
  // hat man
  `<path d="M16 26 H48 L42 16 H22 Z" fill="white"/><circle cx="32" cy="34" r="11" fill="white"/><circle cx="29" cy="34" r="1.6" fill="#0f172a"/><circle cx="35" cy="34" r="1.6" fill="#0f172a"/>`,
  // headset
  `<circle cx="32" cy="32" r="12" fill="white"/><path d="M16 32 a16 16 0 0 1 32 0" stroke="white" stroke-width="3" fill="none"/><rect x="44" y="30" width="6" height="10" rx="2" fill="white"/><rect x="14" y="30" width="6" height="10" rx="2" fill="white"/><path d="M48 40 V46 H40" stroke="white" stroke-width="2" fill="none"/>`,
  // hood
  `<path d="M14 32 a18 18 0 0 1 36 0 V46 H14 Z" fill="white"/><circle cx="32" cy="34" r="9" fill="#0f172a" opacity=".15"/><circle cx="29" cy="33" r="1.6" fill="#0f172a"/><circle cx="35" cy="33" r="1.6" fill="#0f172a"/>`,
  // suit/tie
  `<circle cx="32" cy="26" r="9" fill="white"/><path d="M18 50 Q18 38 32 38 Q46 38 46 50 Z" fill="white"/><path d="M32 38 L29 44 L32 50 L35 44 Z" fill="#0f172a"/>`,
  // sunglasses
  `<circle cx="32" cy="32" r="12" fill="white"/><rect x="22" y="28" width="8" height="5" rx="2" fill="#0f172a"/><rect x="34" y="28" width="8" height="5" rx="2" fill="#0f172a"/><path d="M30 30 H34" stroke="#0f172a" stroke-width="1.5"/>`,
];

function build(prefix: string, cat: AvatarCategory, palettes: [string,string][], bodies: string[]): AvatarPreset[] {
  return bodies.map((body, i) => ({
    id: `${prefix}${i+1}`,
    label: `${prefix.toUpperCase()}${i+1}`,
    category: cat,
    url: wrap(`g_${prefix}_${i}`, body, palettes[i % palettes.length]),
  }));
}

// Default fallbacks: Robot + Eagle Eye
const robot = wrap("g_def_0", `<rect x="18" y="22" width="28" height="24" rx="4" fill="white"/><circle cx="26" cy="33" r="3" fill="#0f172a"/><circle cx="38" cy="33" r="3" fill="#0f172a"/><rect x="26" y="40" width="12" height="2" fill="#0f172a"/><rect x="30" y="14" width="4" height="8" fill="white"/><circle cx="32" cy="13" r="2" fill="white"/>`, ["#38bdf8","#1e3a8a"]);
const eagleEye = wrap("g_def_1", `<ellipse cx="32" cy="34" rx="20" ry="12" fill="white"/><circle cx="32" cy="34" r="8" fill="#0f172a"/><circle cx="32" cy="34" r="4" fill="#facc15"/><circle cx="34" cy="32" r="1.5" fill="white"/>`, ["#facc15","#7c2d12"]);

export const DEFAULT_AVATARS: AvatarPreset[] = [
  { id: "default-robot", label: "Robot", category: "default", url: robot },
  { id: "default-eagle", label: "Eagle Eye", category: "default", url: eagleEye },
];

export const AVATAR_PRESETS: AvatarPreset[] = [
  ...DEFAULT_AVATARS,
  ...build("cy", "cyber", cyber, cyberBodies),
  ...build("wo", "woman", woman, womanBodies),
  ...build("mn", "man",   man,   manBodies),
];

export function avatarFor(seed: string | undefined | null, override?: string | null) {
  if (override) return override;
  if (!seed) return DEFAULT_AVATARS[0].url;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_PRESETS[h % AVATAR_PRESETS.length].url;
}

/** Default avatar for a brand-new model when no identity is set. */
export function defaultModelAvatar(name: string): string {
  // ELARA-flavored names default to Eagle Eye, others to Robot
  return /elara|eagle|qwen/i.test(name) ? DEFAULT_AVATARS[1].url : DEFAULT_AVATARS[0].url;
}
