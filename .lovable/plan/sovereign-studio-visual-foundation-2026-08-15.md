# Sovereign Studio — Visual Foundation

Establish the custom visual language first, so every page you specify next drops into a consistent system instead of generic components.

## What gets built

**1. Design tokens (deep dark, jewel accents)**

- Base surfaces: `#0a0a0b` canvas, `#111113` panel, `#17171a` raised, hairline borders at low-opacity white.
- Jewel accents: Sapphire, Emerald, Amethyst — each with a paired glow token for bloom effects.
- Radius scale locked at 8–12px. Elevation via layered glow + hairline, not heavy drop shadows.
- Dark-first: the app renders dark by default, no light-mode toggle unless you ask.

**2. Typography**

- Headings: sophisticated geometric sans with tight tracking.
- Data, code, metrics, IDs, logs: JetBrains Mono.
- A defined type scale (display / title / section / body / mono-sm) used everywhere.

**3. Custom primitive components** (not stock shadcn defaults)

- `GlassPanel` — blurred translucent surface with hairline edge and inner light.
- `JewelButton` — primary / ghost / danger variants with accent bloom on hover.
- `StatusDot` and `Badge` — mono labels, accent-coded states.
- `MonoField` / `MonoTable` — crystal-clear data surfaces.
- `Sheen` divider and section header treatment.
- Motion: shared spring transitions, fade-and-rise on mount, restrained hover states.

**4. App shell**

- Slim left rail navigation (icon + mono label), top command strip with a keyboard-shortcut affordance, main content region.
- Feels like an OS/IDE chrome, not an admin dashboard: no card-grid dashboard, no marketing nav bar.

**5. Landing screen at `/`**

- Replaces the template placeholder so the preview is real from the start.
- A restrained hero establishing the product identity plus a live-feeling orchestration surface preview using the primitives above — this doubles as the reference screen for the visual language.

## Technical notes

- Tokens defined in `src/styles.css` (`@theme inline` + `:root`), all values in oklch. No hardcoded color utilities in components.
- Fonts loaded via `<link>` in `src/routes/__root.tsx` head, referenced through `--font-*` tokens.
- Primitives live in `src/components/sovereign/`.
- Motion via `motion` (Framer Motion) for fluid transitions.
- Route metadata (title, description, og/twitter) set per route.
- No backend yet — screens use local mock data until you specify pages that need persistence.

## Next

Once this is approved and built, send the specific pages; each one composes these primitives.
