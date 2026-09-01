# ELARA Sovereign Studio — UI Technical Documentation

Version: 2.0 · Date: 2026-08-19 · Scope: front-end implementation (no production backend wired)

Stack: **TanStack Start v1** (React 19, file-based routing, SSR on Cloudflare Workers) · **Vite 7** · **Tailwind CSS v4** (CSS-first `@theme` / `@utility`, no `tailwind.config.js`) · **motion** (Framer Motion v11 API, imported from `motion/react`) · **lucide-react** icons · **TanStack Query** (provider mounted; used only where noted) · **sonner** toasts.

Directory contract:

```
src/
  routes/        50 route files (file-based routing) + __root.tsx
  components/
    sovereign/   52 custom components — the entire visual language
    ui/          shadcn primitives, used sparingly (sonner only, at root)
  lib/           80 client stores, gates, engines, 2 server-function modules
  mocks/         all placeholder data, single entry point mockData.ts
  styles.css     the whole design system (tokens, utilities, base layer)
```

---

## 1. Component Architecture

### 1.1 Shell / chrome

| Component            | File                                          | Responsibility                                                                                                                                                                        |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Shell`              | `src/components/sovereign/shell.tsx`          | Root frame for every non-login route: collapsible 272px sidebar (grouped nav + chat list), rounded inner canvas, top bar (title, contextual tab strips, attention bell, canvas toggle) |
| `RuntimeCanvas` / `RuntimeMonitor` | `src/components/sovereign/runtime-canvas.tsx` | Right-hand slide-in "Sovereign Canvas" overlay: live telemetry rows + active fleet, widget layout persisted at `sovereign.runtime.widgets`                                             |
| `CommandPalette`     | `src/components/sovereign/command-palette.tsx`| ⌘K palette: routes, chats, and sub-surfaces indexed from `src/lib/palette-surfaces.ts` (`/knowledge?view=spaces` etc.)                                                                 |
| `AttentionBell`      | `src/components/sovereign/attention-bell.tsx` | Human-in-the-loop alert bell — pending approvals + MetaForge plans                                                                                                                    |
| `ChatList`           | `src/components/sovereign/chat-list.tsx`      | Sidebar thread list: pin, rename, colour tag, delete, export                                                                                                                          |
| `ChatMenuPanel`      | `src/components/sovereign/chat-menu-panel.tsx`| Per-thread context menu (PDF / MD export, purge, branch)                                                                                                                              |
| `Surface`, `Row`, `Meter` | `src/components/sovereign/surface.tsx`   | Standard page scaffold for all non-chat routes (animated header, mono meta, bloom, content slot), hairline data row, 3px animated meter                                               |
| `WorkspacePage`      | `src/components/sovereign/workspace-page.tsx` | Generic renderer driven by a `WorkspaceSpec` (`src/mocks/workspaces.ts`)                                                                                                              |
| `ConfirmHost`        | `src/components/sovereign/confirm-dialog.tsx` | Imperative confirm dialog host, mounted once in `__root.tsx`                                                                                                                          |
| `DebugConsole`       | `src/components/sovereign/debug-console.tsx`  | Live console fed by `src/lib/debug-bus.ts`                                                                                                                                            |

Contextual tab strips rendered by `Shell` per route: `ModelGroupTabs`, `SquadTabs`, `SkillSquadTabs`, `CapabilitySquadTabs`, `WorkflowTabs`, `OrchestrationTabs`, `RoleTabs`, `TelemetryCardTabs`, `CveWatchlistTabs`, `ForgeKindTabs`, `GraphTabs`.

### 1.2 Primitives — `src/components/sovereign/primitives.tsx`

`GlassPanel`, `Sheen` (1px gradient divider), `SectionLabel`, `StatusDot` (optional ping), `Tag` (mono jewel chip), `JewelButton` (`primary | outline | ghost | danger`, sizes `sm | md`), `MonoRow`.
Exported motion constants: `spring` = `{ type:"spring", stiffness:260, damping:30, mass:0.7 }`, `rise` = `{ y:12→0, opacity, 0.3s, cubic-bezier(0.22,1,0.36,1) }`.
Shared union: `Jewel = sapphire | emerald | amethyst | topaz | ruby | platinum`.

### 1.3 Conversation surface

| Component                             | File                                | Notes                                                                                                          |
| ------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SovereignChat` (route component)     | `src/routes/index.tsx`              | Zen chat: greeting empty state, message stream, pinned context, inline branching, Zen mode, auto-titles         |
| `Composer`                            | `components/sovereign/composer.tsx` | Floating `obsidian-slab` composer: attachments, effort selector, `@` agents, `#` MCP, `>` snippets, emoji, Zen  |
| `RichMessage` / `CodeHighlight`       | `rich-message.tsx`, `code-highlight.tsx` | Markdown + syntax-highlighted rendering of agent turns                                                     |
| `ThinkingBlock`                       | `thinking-block.tsx`                | Collapsible reasoning trace                                                                                    |
| `RetrievalCard`                       | `retrieval-card.tsx`                | RAG evidence: space, chunks, scores (built by `src/lib/rag-preview.ts`)                                        |
| `CompactionCard` / `CompactingCard`   | `compaction-card.tsx`               | Context compaction artifact (server fn `compactContextWithModel`)                                              |
| `ProposalCard`                        | `proposal-card.tsx`                 | Inline MetaForge plan: confidence chip, meter, model/cost footer, refine/forge actions                         |
| `MetaForgeApprovalCard`               | `metaforge-approval-card.tsx`       | Anthracite glass, 1px sapphire border, emerald-glow APPROVE / ghost REJECT, optional mono `facts[]`            |
| `MessageActions` / `TelemetryStrip`   | `message-actions.tsx`               | Copy, branch, retry + per-turn latency/token telemetry                                                         |
| `FilePreview`, `ImageViewer`, `FilesInChat` | respective files              | Attachment hover preview, lightbox, per-thread file canvas                                                     |

### 1.4 Governance / configuration components

`OperatorCard`, `OperatorPicker`, `Identity`/`EntityAvatar`, `ApproverBanner`, `AuditPanel`, `SiemPanel`, `SignatureBadge`, `VaultKeyField` (masked secret field used by Providers / Models / MCP), `KnowledgeSpaces`, `OwnershipControls` (`SharePopover`), `ProviderSelect`, `AiProvidersPanel`, `WebhookAdapters`, `RunControls`, `ActionButtons`, `ReportKit`, `Gallery` (`CardShell`, `StatCard`, `Toggle`, `ConfigCard`, `ActionCard`), `WorkflowCanvas` (magnetic node graph), `RuntimeCanvas`.

### 1.5 Auth

`LoginPage` — `src/routes/login.tsx`. Standalone (does **not** render `Shell`): brand lockup, obsidian-slab form, brute-force guard, sapphire CTA. Verifies against `src/lib/credential-store.ts` (salted non-crypto digest in `localStorage`, preview only) with a "handle plane" resolving username / email prefix / first name.

### 1.6 Route inventory (`src/routes/`, 50 files)

- `__root.tsx` — html shell, head metadata, Google Fonts `<link>`, `QueryClientProvider`, `Toaster`, `ConfirmHost`, 404 + error boundaries.
- `index.tsx` `/` chat · `login.tsx` `/login`.
- **Core:** `agents`, `memory`, `rag-documents`, `planner`.
- **Automation:** `orchestration`, `flows`.
- **Forge:** `skills`, `tools`, `capabilities`, `factory`, `meta-forge`, `mcp`, `adapters`, `converter`.
- **Runtime:** `engine`, `models`, `fleet`, `runtime`, `targets`, `system`, `services`, `vision`, `vision-audio`, `telemetry-sources`, `siem`.
- **Governance:** `knowledge`, `rbac`, `policy`, `approvals`, `security`, `users`, `authentication`, `certificates`, `middleware`, `settings`, `backup`, `registry`, `account`, `mail`, `theme`.
- **Reporting:** `reporting.overview|usage|cost|users|rag|exports` → `/reporting/*`.
- `w.$section.$card.tsx` — dynamic module detail (`/w/$section/$card`).

---

## 2. Design System & Styling

Everything lives in `src/styles.css`. Source of truth is **oklch**; hex below are sRGB equivalents for design tooling. Components must use token classes (`bg-canvas`, `text-sapphire`, `border-border`) — never literal hex.

### 2.1 Sovereign palette

| Token                | oklch                    | ≈ hex                   | Usage                                     |
| -------------------- | ------------------------ | ----------------------- | ----------------------------------------- |
| `--canvas`           | `oklch(0.235 0.003 260)` | `#1d1e1f`               | Page / chat canvas (anthracite)           |
| `--canvas-deep`      | `oklch(0.205 0.003 260)` | `#161719`               | Sidebar / rails, login background         |
| `--canvas-low`       | `oklch(0.235 0.003 260)` | `#1d1e1f`               | Wells inside the stage                    |
| `--panel`            | `oklch(0.268 0.003 260)` | `#252627`               | Glass panels, cards, composer body        |
| `--raised`           | `oklch(0.305 0.003 260)` | `#2e2f31`               | Hover, inputs, chips                      |
| `--hairline`         | `oklch(1 0 0 / 6%)`      | `rgba(255,255,255,.06)` | 1px separators                            |
| `--border`           | `oklch(1 0 0 / 8%)`      | `rgba(255,255,255,.08)` | Global border colour (applied to `*`)     |
| `--input`            | `oklch(1 0 0 / 10%)`     | `rgba(255,255,255,.10)` | Field borders                             |
| `--foreground`       | `oklch(0.928 0.012 258)` | `#e2e8ef`               | Platinum body text                        |
| heading colour       | `oklch(0.985 0.004 258)` | `#f8fafd`               | `h1–h4`                                   |
| `--muted`            | `oklch(0.32 0.003 260)`  | `#323334`               | Muted surface                             |
| `--muted-foreground` | `oklch(0.745 0.008 258)` | `#a9adb1`               | Secondary text, `mono-label`              |
| `--platinum`         | `oklch(0.78 0.003 260)`  | `#b6b7b9`               | `platinum-data` mono values               |
| `--sapphire`         | `oklch(0.62 0.155 260)`  | `#4b84e2`               | Primary accent, active nav, CTA           |
| `--sapphire-deep`    | `oklch(0.5 0.14 260)`    | `#2f60b2`               | Deep sapphire variant                     |
| `--emerald`          | `oklch(0.774 0.136 156)` | `#62cf90`               | Approve / healthy                         |
| `--amethyst`         | `oklch(0.68 0.155 305)`  | `#af7de4`               | Secondary jewel / automation              |
| `--topaz`            | `oklch(0.8 0.13 85)`     | `#e4b750`               | Cost / warning                            |
| `--ruby`             | `oklch(0.64 0.19 22)`    | `#e94f55`               | Destructive / error                       |

`--color-chart-1..5` alias sapphire → ruby. `--radius: 0.625rem` (10px) → `sm 6 / md 8 / lg 10 / xl 14 / 2xl 18`.
No light theme: `html { color-scheme: dark }` is fixed. Theme presets (e.g. **Onyx Graphite** `#171717`) are applied at runtime by `src/lib/theme-store.ts` (`applyTheme`, key `sovereign.theme`), which rewrites the `:root` custom properties.
**Inverse Onyx** variant: `.studio-invert .studio-rail` re-declares `--hairline/--border/--panel/--raised/--canvas` so rails can ride lighter than the canvas while keeping depth reading.

### 2.2 Glassmorphism

| Utility                  | Background                                | Filter                      | Border                                    | Shadow                                                                                     |
| ------------------------ | ----------------------------------------- | --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `glass`                  | `color-mix(oklab, panel 86%, transparent)`| `blur(18px) saturate(140%)` | `1px solid var(--hairline)` (6% white)    | `0 1px 0 0 rgba(255,255,255,.04) inset, 0 2px 6px -3px rgba(0,0,0,.40)`                    |
| `obsidian-slab`          | `color-mix(oklab, panel 94%, transparent)`| `blur(20px) saturate(140%)` | `1px solid oklch(1 0 0 / 7%)`             | `0 1px 0 0 rgba(255,255,255,.04) inset, 0 18px 44px -30px rgba(0,0,0,.70)`; 160ms border-colour transition |
| `jewel-edge`             | —                                         | —                           | `1px color-mix(sapphire 30%)`             | `--glow-sapphire`                                                                          |
| MetaForge card (inline)  | `color-mix(raised 62%)`                   | `backdrop-blur-xl` (24px)   | `1px color-mix(sapphire 34%)`             | `0 0 38px -24px sapphire, 0 18px 40px -30px rgba(0,0,0,.9)`                                |
| Gallery `CardShell`      | `color-mix(raised 45%)`                   | `backdrop-blur-xl`          | `1px color-mix(sapphire 22%)`, hover 38%  | hover `0 0 38px -24px sapphire`                                                            |

Glow tokens: `--glow-sapphire` = `0 0 0 1px color-mix(sapphire 42%), 0 0 18px -6px color-mix(sapphire 45%)`; `--glow-emerald` / `--glow-amethyst` = `0 0 20px -8px color-mix(<jewel> 50%)`; `--shadow-panel` as above.
Other utilities: `platinum-data`, `mono-label`, `hairline-t`, `grid-veil` (56px grid + radial mask), `bloom-sapphire`, `canvas-depth`, `etched`, `no-scrollbar`, `corner-bloom` (currently neutralised), `.tuning-range` (custom jewel slider thumb), `.edge-flow` (animated graph edges).

### 2.3 Typography

Loaded via `<link>` in `__root.tsx` (Google Fonts) — never `@import` in CSS (Lightning CSS resolves from the filesystem):

- **Space Grotesk** 400/500/600/700 → `--font-sans`, `--font-display` (headings, `ELARA` wordmark)
- **Inter** 400/500/600 → `--font-body` (`<body>` default)
- **JetBrains Mono** 400/500/600 → `--font-mono` (all data, IDs, metrics, labels; `tabular-nums`, `letter-spacing: -0.01em`)

Base: `h1–h4` display font, weight 600, tracking `-0.03em`, colour `#f8fafd`, `text-wrap: balance`; body antialiased; selection = sapphire 35%.

| Element                 | Size                      | Tracking                         | Weight    |
| ----------------------- | ------------------------- | -------------------------------- | --------- |
| Chat greeting (`h1`)    | 38px / lh 1.1             | `-0.035em`                       | 600       |
| Surface page title      | 28px                      | tight                            | 500       |
| Chat message body       | 17px / lh 1.72–1.78       | `-0.01em` user, `-0.005em` agent | 500 / 400 |
| Composer textarea       | 16.5px / lh 1.65          | `-0.01em`                        | 500       |
| Sidebar nav item        | 15.5px                    | normal                           | 500       |
| Sidebar chat entry      | 14.5px                    | normal                           | 500       |
| Sidebar group header    | 12.5px uppercase          | `0.12em`                         | 600       |
| Card title / body       | 15.5–16.5px / 13.5–14.5px | `-0.01em` / normal               | 500 / 400 |
| `mono-label`            | 11px uppercase            | `0.14em`                         | 400       |
| Actor label (you/elara) | 10.5px uppercase mono     | `0.24em`                         | 600       |
| Brand `ELARA`           | 13px sidebar / 30px login | `0.16em` / `0.14em`              | 600       |
| Status / meta mono      | 10.5–12px                 | `0.1em`–`0.24em`                 | 400       |

Layout constants: conversation column `max-w-[760px]`, prose `max-w-[62ch]`, message stack `space-y-14`, sidebar `272px`, top bar `48px`, inner canvas inset `my-2 mr-2`, radius `14–16px` on composer/cards.

---

## 3. Navigation & Routing Logic

- **Router:** TanStack Router file-based. `src/router.tsx` builds the router with a `QueryClient` context, `scrollRestoration: true`, `defaultPreloadStaleTime: 0`. `src/routeTree.gen.ts` is generated — never edit.
- **Page navigation is real routing**, not view state. Sidebar items and tabs are `<Link to=…>`; dynamic routes use `params={{ section, card }}` (never string interpolation).
- **Active view detection:** `Shell` reads `useRouterState({ select: s => s.location.pathname })`; `active = allItems.find(t => t.to === pathname)` drives the top-bar title, the `bg-raised/70` active row, the 1.5px sapphire left indicator, and the sapphire icon tint. `crumb` prop overrides the title.
- **Sub-views inside a route are search params, not routes.** Panels such as Access Spaces, RBAC compliance, Planner planes read `?view=` / `?plane=`. `src/lib/palette-surfaces.ts` is the canonical index of these surfaces and is what the command palette searches; add an entry there whenever a new tab is introduced.
- **Sovereign Canvas overlay is not a route.** `Shell` owns `const [canvas, setCanvas] = useState(false)`; the top-right `PanelRight` button opens it, backdrop/`X` closes it. Rendered inside `<AnimatePresence>` so the exit animation runs; fixed at `right-3 top-3 bottom-3` (`z-50`, backdrop `z-40`) so it floats above any route. The chat **files canvas** (`filesOpen`) uses the same pattern.
- **RBAC-driven nav:** `useAccess()` (`src/lib/rbac-store.ts`) filters `groups` when enforcement is armed; a blocked pathname renders a denial surface instead of the route body and emits a `deny` event (`src/lib/deny-events.ts`). Knowledge routes additionally consult `useSpaceAccess()`.
- **Auth redirects are ad hoc:** `/login` redirects to `/` when `sessionStorage["sovereign.operator"]` exists; sign-out clears it. There is **no server-side route guard** — every workspace route is reachable directly today.
- **Head metadata:** every route declares its own `head()` (title, description, og:*, twitter:card); the root supplies charset, viewport, fonts and the stylesheet link.

---

## 4. State Management

There is no Redux/Zustand. The app uses a consistent, hand-rolled **store module pattern** in `src/lib/*-store.ts`:

```ts
const KEY = "sovereign.<domain>";
function read(): T[]  { /* localStorage JSON parse, SSR-guarded, seed fallback from @/mocks */ }
function write(next)  { localStorage.setItem(KEY, JSON.stringify(next)); notify(); }
export function useX() { const [state, setState] = useState(read); useEffect(subscribe…); return { …state, actions }; }
```

Properties every store shares: SSR-safe (`typeof window === "undefined"` guards, hydration via `useEffect`), a module-level listener set so all mounted consumers re-render together, seed data imported from `@/mocks/*`, and (where relevant) owner stamping through `src/lib/ownership.ts`.

Representative hooks (80 modules total): `useChats`, `useAgents`/`useSquads`, `useSkills`, `useCapabilities`, `useModels`/`useModelGroups`, `useProviders`, `useMcp`, `useWorkflows`, `useChains`, `usePlanners`, `useKnowledge`, `useSpaces`/`useSpaceAccess`, `useRagFolders`, `useMemoryStore`, `useApprovals`/`usePendingApprovals`/`useQueueSwitch`, `useForgePlans`, `useAccess`/`useRoles`, `useIdentity`, `useAuthProviders`, `useNotifyPrefs`/`useOutbox`, `useAuditLog`, `useCveFeed`/`useWatchlists`, `useSiem`, `useTargets`, `useAdapters`, `useMiddleware`, `useRuntimes`, `useTelemetryBoards`/`useLiveTelemetry`/`useTelemetrySources`, `useTuning`, `usePrompts`, `useSnippets`, `useVisionModels`, `useVoiceProfiles`, `useSchedules`, `useUserPrefs`, `useUserTemplates`, `useRegistry`, `useOwned`/`useOwnerCtx`, `useRunController`, `useDebugBus`.

Key state locations:

| State                         | Owner                                   | Storage                                                    |
| ----------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| Auth session (operator name)  | `login.tsx` → `Shell`                   | `sessionStorage["sovereign.operator"]`                     |
| Local credentials             | `src/lib/credential-store.ts`           | `localStorage["sovereign:credentials"]` (salted digest)    |
| Brute-force guard             | `login.tsx`                             | `localStorage["sovereign.auth.guard"]` — 5 attempts, lock `30 × 2^over` s capped 15 min |
| Operator profile / avatar     | `operator-card.tsx`                     | `localStorage["sovereign.profile"]`                        |
| Sidebar open + group expansion| `Shell` (module-level `persistedSidebar`, `persistedGroups`) | `sessionStorage["sovereign.sidebar.closed"]`, groups collapsed by default |
| Runtime canvas / files canvas | `Shell` local `useState`                | in-memory (widget layout: `sovereign.runtime.widgets`)     |
| Active chat + threads         | `src/lib/chat-store.ts`                 | `localStorage` — survives navigation and login             |
| Active agent / model / effort | `agent-store`, `model-store`, composer  | `sovereign.agents`, `sovereign.models.default`, per-thread |
| RBAC roles + enforcement + preview | `src/lib/rbac-store.ts`            | `localStorage`; preview mode exits via `exitPreview()`     |
| Ownership / visibility        | `src/lib/ownership.ts`                  | stamped onto every owned record (`private/group/org/system`)|
| Theme preset                  | `src/lib/theme-store.ts`                | `localStorage["sovereign.theme"]`, applied in `__root.tsx` `useEffect` |

Full storage-key list is discoverable with `rg -o '"sovereign[.:][a-z0-9._:-]+"' src` (≈80 keys, prefix `sovereign.` or `sovereign:`).

Cross-cutting event buses (not stores): `rbac-events.ts`, `deny-events.ts`, `planner-events.ts`, `debug-bus.ts` — tiny pub/sub emitters consumed by banners, the audit journal, and the live console.

Determinism rule: never render locale/timezone-dependent dates directly. Use `fmtDate` / `fmtDateTime` / `fmtTime` (en-GB, UTC) and `seedNow()` from `src/lib/utils.ts`, otherwise SSR and hydration diverge.

---

## 5. API Integration Points

### 5.1 Existing server boundary

Only two real server functions exist (TanStack `createServerFn`):

| Function                  | File                                | Purpose                                              |
| ------------------------- | ----------------------------------- | ---------------------------------------------------- |
| `syncCveSources`          | `src/lib/cve-feed.functions.ts` (+ `cve-feed.server.ts`) | Fetches CVE feeds server-side       |
| `compactContextWithModel` | `src/lib/context-compact.functions.ts`| Context compaction call for long threads            |

Both follow the required shape: the `.functions.ts` module contains only imports/types/exported server functions; runtime helpers live in the `.server.ts` sibling.

### 5.2 Mock surface — one-to-one swap targets

All placeholder data is isolated in `src/mocks/` and re-exported from `src/mocks/index.ts` / `mockData.ts`. Stores import seeds from there; **no component holds inline data**. Replacing a mock export with an `api-v2` fetch requires no component changes.

| Mock module          | Seeds                                                | Suggested endpoint                        |
| -------------------- | ---------------------------------------------------- | ----------------------------------------- |
| `chat.ts`            | greeting, suggestions, agent reply, proposals, threads| `POST /chat/completions` (stream), `GET /threads` |
| `agents.ts`          | `seedAgents`, squads, knowledge brands               | `GET/POST /agents`                        |
| `skills.ts`, `capabilities.ts` | skills, squads, capability registry        | `GET/POST /skills`, `/capabilities`       |
| `mcp.ts`             | MCP servers/clients                                  | `GET/POST /mcp/servers`                   |
| `knowledge.ts`, `knowledge-seed.ts` | corpora, spaces, sync logs            | `GET /knowledge/spaces`, `/documents`     |
| `memory.ts`          | working/episodic/semantic/policy memory              | `GET /memory/*`                           |
| `identity.ts`, `directory.ts` | accounts, groups, directory users/groups    | `GET /identity/*`, LDAP/Entra bridge      |
| `telemetry.ts`, `fleet.ts`, `runtimes.ts` | telemetry, fleet, python runtimes| `GET /runtime/telemetry` (SSE), `/fleet`  |
| `orchestrations.ts`, `workflows.ts` | chains, workflow graphs               | `GET/POST /orchestration`, `/workflows`   |
| `services.ts`, `system.ts`, `settings.ts`, `snippets.ts`, `composer.ts`, `workspaces.ts` | service tower, journal, settings panels, snippets, composer presets, workspace specs | per-module endpoints |

### 5.3 Simulated flows that need real backends

1. **Chat runtime** — `send()` in `routes/index.tsx` synthesises the reply, telemetry, retrieval and proposals. Wire to the LLM gateway (streaming) and keep `RetrievalCard` / `ThinkingBlock` / `TelemetryStrip` as the render contract.
2. **Auth** — `credential-store.ts` digest check must become `POST /auth/login`; the brute-force counter must move server-side (the `localStorage` guard is UX only). Federated providers (`src/lib/auth-provider-store.ts`: LDAP / on-prem MS AD, Microsoft Entra ID, SAML, OIDC, OAuth2, RADIUS) currently only persist configuration and "validate config" locally — real deployments need a directory bridge and redirect flows.
3. **Directory import** — `src/mocks/directory.ts` simulates group/user trees consumed by `routes/users.tsx` (`DirectoryPrincipalBinder`, approver group mapping). Swap for LDAP/Graph queries.
4. **Approvals & MetaForge** — `approval-store.ts`, `metaforge-store.ts`, `approver-gate.ts`: approve/reject/delegate must hit `POST /approvals/:id/{approve,reject}`.
5. **Notifications / email** — `notify-store.ts` writes an in-browser outbox; `mail-store.ts` holds SMTP config. Needs a real mail transport.
6. **RAG pipeline** — `rag-preview.ts`, `rag-agent.ts`, `rag-keywords.ts`, `space-router.ts`, `rag-analytics-store.ts` implement retrieval scoring client-side against seed corpora. Replace with vector-store queries; keep `resolveScope`/`narrowScopeToSpace` semantics for space isolation.
7. **Planner / run controller** — `planner-store.ts`, `run-controller.ts`, `policy-engine.ts` simulate execution and log to the audit journal.
8. **Security planes** — `security-store.ts`, `signing.ts`, `siem-store.ts`, `cve-store.ts` (feed sync partially real), certificate management.
9. **Reporting & exports** — `report-store.ts`, `report-pdf.ts`, `report-users.ts`, `schedule-store.ts` compute from local data; PDF/MD export is client-generated.
10. **Persistence** — every store writes to `localStorage`. For multi-device operation each `read()/write()` pair becomes a query/mutation.

**Recommended wiring pattern:** `createServerFn` in `src/lib/<domain>.functions.ts` → `queryOptions` → `ensureQueryData` in route loaders (only under authenticated subtrees) + `useSuspenseQuery` in components. Keep `@/mocks` as fixtures for tests and Storybook.

---

## 6. Custom Animations

Library: `motion/react`. Two easings recur: the **Sovereign cubic** `[0.22, 1, 0.36, 1]` for entrances (also set globally as `--default-transition-timing-function` and on `*` in the base layer) and `easeInOut` at 100–250 ms for interactive micro-states.

### 6.1 Sidebar "wave" dots (group headers) — `shell.tsx`

Parent `motion.button` with `initial/animate="rest"`, `whileHover="hover"`; three 3px dots as `motion.span` children:

```ts
variants = {
  rest:  { y: 0, scale: 1, opacity: 0.6 },
  hover: { y: [0, -3.5, 0], scale: [1, 1.15, 1], opacity: [0.6, 1, 0.75], color: "var(--sapphire)" },
};
transition = { duration: 0.9, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.1, delay: d * 0.11 };
```

The `d * 0.11 s` stagger produces the travelling wave; it loops while hovered and snaps back on exit.

### 6.2 Nav micro-interactions

- `iconHover` / `iconActive` = `{ scale: 1.05, duration: 0.16, easeInOut }` — no rotation, no bounce (design constraint).
- Active indicator: `motion.span`, `scaleY 0 → 1` + opacity, 250 ms, `origin-center`, 1.5px × 16px sapphire bar at `left-[7px]`.
- Group collapse: `AnimatePresence initial={false}` + `height 0 ↔ auto` with opacity, 250 ms, `overflow-hidden`; chevron `rotate: expanded ? 0 : -90`.
- Sidebar collapse: `motion.aside` `width 272 ↔ 0`, spring `380/38`; inner content keeps a fixed `w-[272px]` so text never reflows.
- Tab strips: 100 ms opacity/position snaps (deliberately faster than card entrances).
- Composer popovers (emoji, `+`): fixed-height containers, `opacity + y` only at 120 ms — **no `scale`** (scale caused the two-step "grow" artefact).

### 6.3 Sovereign transitions (entrances)

| Surface                 | Definition                                                            |
| ----------------------- | --------------------------------------------------------------------- |
| `rise` primitive        | `y 12 → 0`, opacity, 0.3 s, Sovereign cubic                           |
| `Surface` header / body | `y 10 / 12 → 0`, 0.5 s / 0.55 s (0.08 s delay)                        |
| Chat empty state        | `y 10 → 0`, 0.7 s; suggestion chips `delay: 0.25 + i*0.08`, 0.5 s     |
| Chat messages           | `y 8 → 0`, 0.45 s                                                     |
| `ProposalCard`          | `y 10 → 0`, 0.5 s, `delay: 0.06 * index`                              |
| `CardShell`             | `y 10 → 0`, 0.45 s, `delay: index * 0.05`                             |
| `MetaForgeApprovalCard` | in `y 14 → 0` + `blur(6px) → 0`, 0.45 s; exit `y -8` + `blur(6px)`    |
| Login card              | `y 14 → 0` + `blur(8px) → 0`, 0.6 s                                   |

### 6.4 Overlays

Runtime Canvas / Files Canvas — backdrop `bg-canvas/60 backdrop-blur-[2px]` opacity fade; panel `x: 40 → 0` + opacity, spring `320/34`, exit mirrored through `AnimatePresence`.

### 6.5 Other motion

- `JewelButton`: `whileHover={{ y: -1 }}`, `whileTap={{ y: 0, scale: 0.985 }}`, shared `spring` (260/30/0.7).
- `Toggle` knob: `x: 2 ↔ 19`, spring `420/32`; colours 300 ms.
- `Meter`: `width 0 → value%`, 0.8 s Sovereign cubic. `StatusDot`: Tailwind `animate-ping` @60%.
- Workflow/graph edges: CSS `@keyframes edge-dash-flow` → `.edge-flow` (`stroke-dashoffset -36`, 1.4 s linear infinite).
- Card hairline sweep: CSS-only `opacity 0 → 0.8` over 500 ms on `group-hover`.
- Glow hovers are CSS `transition-shadow`, never animated in JS.
- Compositing: `.glass`, `.obsidian-slab`, `[data-motion-layer]` get `backface-visibility: hidden; transform: translateZ(0)`.
- `prefers-reduced-motion: reduce` disables all animation/transition durations globally.

---

## 7. Conventions & Known Gaps

**Conventions**

1. Colours only through tokens; no `text-white`, `bg-black`, or hex in components.
2. All demo data through `@/mocks`; stores may import mocks, mocks never import stores.
3. Dates only through `fmtDate/fmtDateTime/fmtTime`; seed timestamps through `seedNow()`.
4. Every icon-only control carries an English `title` tooltip.
5. New sub-tabs must be registered in `src/lib/palette-surfaces.ts`.
6. Route string in `createFileRoute("…")` must match the filename mapping; `routeTree.gen.ts` is generated.

**Gaps for the engineering phase**

1. No server-side auth guard; the session is a `sessionStorage` string with no token or expiry.
2. No data-fetching layer — TanStack Query is mounted but nearly unused; all reads are synchronous `localStorage`.
3. Chat, planner runs, approvals, notifications and RAG scoring are simulated in the browser.
4. `localStorage` is single-device and unencrypted; secrets in `VaultKeyField` are masked, not protected.
5. Sidebar is `hidden md:block` — no mobile drawer.
6. Mixed Turkish/English copy remains in a few settings strings — needs an i18n pass.
