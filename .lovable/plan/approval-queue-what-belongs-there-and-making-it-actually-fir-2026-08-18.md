# Approval Queue: what belongs there, and making it actually fire

## Current state (verified)

- `src/lib/approval-store.ts` holds the queue: six **seed** records in localStorage, plus `decide()` and `reset()`.
- `src/routes/approvals.tsx` is the only consumer. It reads, filters, and decides.
- **Nothing anywhere in the app creates an approval request.** There is no `create`/`enqueue` API, so the queue can never grow — it only ever shows the demo rows and whatever you approve/reject of them.
- The gating flags that _should_ feed it already exist but are decorative: `requiresApproval` on targets (`target-store`), skills (`skill-store`), adapters/webhooks (`adapter-store`), and the policy engine's `challenge` verdict ("CHALLENGE · require operator approval") in `policy-engine.ts`.
- Approver authority (RBAC `approve` verb, group inheritance, ApproverBanner) is wired and working — that part is real.

So: the review side works, the **producer** side is missing.

## What should land in the Approval Queue

Human-gated, reversible-by-refusal actions — everything Meta-Forge does _not_ cover (Meta-Forge stays platform-mutation only):

1. **Policy CHALLENGE verdicts** — any tool call the firewall marks `challenge` instead of allow/deny.
2. **Gated target execution** — a run against a target with `requiresApproval: true`.
3. **Gated skill / adapter / webhook invocation** — same flag on those registries.
4. **Destructive data ops** — knowledge-base purge, vector index drop, bulk delete.
5. **Credential actions** — vault secret rotation/reveal, new MCP server trust.
6. **Budget / ceiling overrides** — spend limit raise, concurrency raise.
7. **Isolation escapes** — running a bound tool outside its sandbox profile, or egress to a non-allowlisted host.

## Plan

1. **Producer API in `approval-store.ts`**
   - `requestApproval({ title, requester, agent, tool, target, policy, risk, args, ttl, origin })` → creates a `pending` row, dispatches the store event, returns the id.
   - `expireStale()` run on read: any row past its TTL flips to `expired` automatically (today TTL is only a label).
   - Keep seeds, but mark them `origin: "seed"` so real traffic is distinguishable and `reset()` stays honest.

2. **Wire the gates** (each one calls `requestApproval` instead of silently proceeding):
   - `policy-engine.ts` — `challenge` verdict enqueues, and the simulation panel shows "parked → approval queue".
   - Target / skill / adapter run paths — when `requiresApproval` is on, enqueue and block the action.
   - Vault rotate, MCP trust, KB purge, budget override, isolation escape paths.

3. **Close the loop**
   - Approving/rejecting writes to the audit spine with the resolved approver handle (already partly there) and emits an event the origin surface can react to (badge clears, run resumes/aborts).
   - Sidebar `Approvals` entry gets a live pending count.
   - Approvals page grows an `origin` column/filter so you can see _which_ gate produced each row.

4. **Deduping + safety** — identical pending request (same tool+target+args hash) is folded into the existing row instead of spamming the queue.

## Technical notes

- Stays local-first (localStorage + custom event), matching the rest of the studio's stores; no backend needed for this step.
- `requestApproval` lives in the store so every producer shares one code path and one audit shape.
- TTL expiry is computed lazily on read to avoid timers.
- Enforcement respects the existing `ENFORCEMENT ARMED` toggle: disarmed = gates log but do not block.
