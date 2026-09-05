# Escalation Workforce Mechanics — phased plan (Target Architecture Blueprint Phase 13, BL-45, FR-ESC-05)

Source of truth: the dev-dispatch prompt (quotes FR-ESC-05 verbatim and LLD §14.9.2's
exact schema). Extends `packages/modules/escalations` (FR-ESC-01/02/03, already
shipped) — no new module, no new architecture pattern.

## Phase A — Schema

**Goal**: every new column/table LLD §14.9.2 names exists, migrated, RLS'd.

**Scope**: `packages/db/src/schema/enums.ts` (two new enums), `packages/db/src/schema/
escalations.ts` (escalation columns, `agent_queue.sla_seconds`, `agent_presence`,
`escalation_assignment_log`), `packages/db/migrations/0074_escalation_workforce.sql` +
`0075_escalation_workforce_rls.sql`, `packages/db/src/tenant-scoped-tables.ts` (append
both new tables), `eslint.config.mjs` (`escalations` gains a `tenancy` edge — needed
for `listActiveTenantContexts()` in the SLA sweep, same shape `knowledge`/
`model-gateway` already established for their own cross-tenant sweeps).

**Exit gate**: migration applies cleanly against real Postgres; `rls-coverage.
isolation.test.ts` picks up both new tables automatically via the manifest; a new
adversarial cross-tenant test proves zero cross-tenant read of `agent_presence`/
`escalation_assignment_log`.

## Phase B — Presence + atomic concurrency-ceiling enforcement

**Goal**: `claimEscalation()`/`reassignEscalation()` enforce `max_concurrent` via a
single atomic conditional UPDATE (never read-then-write); `current_load` bookkeeping is
correct under real concurrent load; every claim/release/reassign/auto-assign writes an
append-only `escalation_assignment_log` row.

**Scope**: new `infrastructure/agent-presence-repository.ts`, `infrastructure/
escalation-assignment-log-repository.ts`, `application/agent-presence-service.ts`;
`application/claim-escalation.ts`, `application/return-to-bot.ts` (both `returnToBot`
and `resolveEscalation` decrement load on their terminal transition), `application/
claim-escalation.ts#reassignEscalation` (old-agent decrement / new-agent ceiling-checked
increment, both subject to the same 409). New `AgentAtConcurrencyCeilingError` (409,
`AGENT_AT_CONCURRENCY_CEILING`). Out of scope: presence `state` does not gate claiming
(only `current_load`/`max_concurrent` do) — `state` is informational/self-service this
phase, per FR-ESC-05's own wording ("per-agent concurrency limits" is the enforced
mechanic; "availability/presence status" is a separate, unenforced-at-claim-time field).

**Exit gate**: real Postgres integration test proving a claim past ceiling is rejected
with `AGENT_AT_CONCURRENCY_CEILING`, the escalation stays `Waiting`, and `current_load`
is unchanged (no partial state); a genuine concurrent-claim-attempts test (multiple
simultaneous claims against an agent one slot from their ceiling) proves exactly the
right number succeed; existing `escalation-lifecycle.int.test.ts` regressions still
green (the pre-existing no-agent reassign-to-queue-only case is unaffected).

## Phase C — SLA timers + aging

**Goal**: `sla_due_at` is computed from the routed queue's `sla_seconds` at escalation
creation; a new `escalation.sla-sweep` (60s) worker job flips `sla_breached`; the
Escalation Queue admin screen visually distinguishes a breached/aging item.

**Scope**: `agent-queue-repository.ts` (`slaSeconds` field), `contracts/src/
escalations.ts` (`CreateAgentQueueRequestSchema` gains `slaSeconds`), `application/
trigger-escalation.ts` (compute `slaDueAt`), new `application/sla-sweep-service.ts`
(cross-tenant, mirrors `sweepKnowledgeRetention`'s shape), `apps/worker/src/
escalation-sla-sweep.ts` + `index.ts` registration, `EscalationQueue.tsx` (aging
badge).

**Exit gate**: a real test proves a `Waiting` escalation past its `sla_due_at` flips
`sla_breached` on sweep and an `InProgress` one still counts (only `Resolved`/
`ReturnedToBot` stop being swept); a queue with no `sla_seconds` configured never gets
a `sla_due_at` (stays `NULL`, never swept).

## Phase D — CSAT capture

**Goal**: `resolveEscalation`/`returnToBot` optionally accept `csatScore`/
`csatComment`, stamping `csat_captured_at`; the Takeover Panel prompts for it at
Resolve & Close (and, non-blockingly, at Return to Bot); the data is available to
FR-RP-01 reporting (via `getEscalationDetail`) and threaded into an escalation's own
eval-harvest transcript.

**Scope**: `contracts/src/escalations.ts` (`CsatCaptureRequestSchema`, shared by both
routes below since the body shape is identical), `apps/web
.../[id]/resolve/route.ts` + `.../return-to-bot/route.ts` (accept the body),
`TakeoverPanel.tsx` (CSAT mini-dialog before Resolve/Return, and wiring
`HarvestEvalCaseButton` into the panel's Actions column — small addition, the button
was already built generic-reusable in Phase 12 for exactly this, only the conversation
call site had been wired), `list-escalations.ts#getEscalationDetail` (surface
`csatScore`/`csatComment`/`csatCapturedAt`).

**Exit gate**: a real test proves a Resolve with a score persists `csat_captured_at`
non-null and a Resolve without one leaves it `NULL` (never blocks the transition).

## Phase E — Presence self-service UI

**Goal**: an agent can set their own presence `state`; first reference auto-provisions
`Offline`/3.

**Scope**: `application/agent-presence-service.ts` (already built in Phase B, reused),
new routes `apps/web/app/api/v1/admin/agent-presence/me/route.ts` (GET/PATCH, state
only, server-derives the acting user — never trusts a client-supplied target id for
"me") and `apps/web/app/api/v1/admin/agent-presence/[userId]/route.ts` (PATCH,
`Write`-gated, admin sets another agent's `maxConcurrent`/`state` — ownership-checked
via `findUserById` so a cross-tenant id can never be targeted), a small
`PresenceToggle.tsx` on the Escalation Queue page.

**Exit gate**: a real test proves first reference to a brand-new user auto-provisions
`Offline`/3 (not a 404/500); a cross-tenant target id is rejected.

## Phase F — Zero-presence boundary + full regression

**Goal**: prove the FR-ESC-05 boundary note directly — a queue with every agent
Offline/Away/at-ceiling still routes per FR-ESC-03 and waits visibly (SLA-aging),
never silently drops or throws.

**Exit gate**: standard batched gate (typecheck, `eslint . --max-warnings=0`,
dependency-cruiser clean, full regression, coverage ≥80% on this dispatch's
added/changed files) plus the boundary test above.

---

## Status

All six phases implemented in this single dispatch (they are small enough, and
sufficiently interdependent at the data-model layer, that splitting them across
multiple dispatches would have left intermediate phases non-functional). See
`docs/NEXUS_STATE.md`'s decision log for the verification report. **Not yet
QA-approved** — this dev agent does not self-approve.
