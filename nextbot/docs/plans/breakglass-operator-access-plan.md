# Break-glass Operator Access — implementation plan (BL-52, FR-ADM-09)

Target Architecture Blueprint **Phase 20 — the final phase of the 21-phase plan.**
Parent plan: `docs/plans/target-architecture-blueprint-plan.md` (Phase 20 section).

## Requirement recap (verbatim from the dispatch)

> A NextBot Platform Operator may request time-boxed, explicitly-consented,
> doubly-audited (on both the operator's and the tenant's audit trail) access to a
> specific tenant's data for incident diagnosis — additive to the deliberately
> metadata-only cross-tenant health rollup (NFR-11), never a relaxation of it.
> Validation: an operator access request with no tenant-side consent grant is denied
> at the platform level, fail-closed, regardless of operator role.

## Ground reused (not reinvented)

- `verifyOperatorToken()` / `requirePlatformApi()` / IP allowlist (Platform Manager
  console) gate every new `apps/web/app/api/internal/ops/**` route exactly like the
  existing tenants/plan-tiers/health-rollup routes.
- `withPlatform()` (`packages/db/src/platform-context.ts`) — the operator-side
  `platform_audit_log_entry` writer. `packages/modules/tenancy` and
  `apps/web/app/api/internal/ops/**` remain the only two allowed callers
  (dependency-cruiser `no-platform-outside-allowed-callers`) — all new
  platform-ops-side application code therefore lives in `packages/modules/tenancy`.
- The tenant's own `audit_log_entry` is **never written directly** — it is populated
  exclusively by `@nextbot/audit`'s outbox consumer
  (`sync-audit-from-events.ts`, unmodified by this phase) reading `domain_event` rows
  every tenant-scoped module already appends to in its own `withTenant` transaction
  (LLD §2.4). The tenant-side half of "doubly-audited" is therefore a `domain_event`
  write through the normal RLS-protected `withTenant` path — the exact same mechanism
  `escalations`/`agent-platform` already use for their own audit-feeding events — not a
  new audit-write mechanism.
- `auth_session`/`scim_token`'s `revoked_at` + `expires_at`, checked **synchronously at
  use time** (no background sweep) is the precedent followed here: a break-glass grant
  is genuinely lower-frequency than Tier-3 approvals/workflow suspensions/escalation
  SLAs, so a synchronous "is this grant still within its time-box AND not revoked"
  check on every access attempt is sufficient — no new scheduled sweep job is added.
- The platform-ops read-only diagnosis path reuses the tenant admin console's own
  existing read functions **verbatim** — `getConversationDetailForAdmin`/
  `listConversationsForAdmin` (`@nextbot/conversations`) and `getEscalationDetail`/
  `listEscalationsForAdmin` (`@nextbot/escalations`) — called from the `apps/web`
  composition root with a `TenantContext` built from the grant (never the operator's
  own identity, which has none). This is a deliberate design choice, not just reuse for
  its own sake: calling the byte-identical function the tenant admin's own screens call
  makes "an operator sees no more than an equivalent-privilege tenant viewer would"
  a **structural** guarantee (same code path, same masking behavior) rather than a
  second, independently-maintained masking implementation that could silently drift
  from the tenant-side one.

## Disclosed design decisions

1. **One active grant per tenant at a time.** Creating a new grant while one is already
   active (unexpired, unrevoked) is rejected (`BREAKGLASS_GRANT_ALREADY_ACTIVE`, 409) —
   a tenant admin must explicitly revoke first. This keeps "the active grant" always
   unambiguous, both for the tenant UI and for the platform-ops fail-closed check.
2. **Platform-enforced maximum time-box: 24 hours.** A tenant can choose any expiry up
   to that ceiling; requesting longer is rejected at creation time
   (`BREAKGLASS_GRANT_EXPIRY_TOO_LONG`, 422) rather than silently clamped — clamping
   would let a tenant believe they granted less exposure than a silent server-side
   rewrite actually recorded.
3. **Audit granularity: lifecycle events only, not every individual read.** Both audit
   trails record grant lifecycle facts (`breakglass.grant_created`,
   `breakglass.grant_revoked` on the tenant side written when the tenant acts;
   `breakglass.access_activated` / `breakglass.access_denied` written once per operator
   `POST .../activate` call, on both trails for the activated case, platform-only for
   denied) — not one row per subsequent read call during an active session. This
   matches the plan doc's own "low-frequency operational need" framing: a diagnosis
   session may reasonably touch many conversations, and logging every individual read
   would be audit-log noise disproportionate to the actual risk being tracked (the
   fact/time/reason of *why an operator was in the tenant's data at all*). Every read
   endpoint still independently **re-validates** the grant is still active (unexpired,
   unrevoked) at the moment of the call — a mid-session revocation takes effect
   immediately on the very next read, it just doesn't itself produce a new audit row.
4. **Cross-role, cross-transaction audit writes are not atomically joined.** The
   tenant-side `domain_event` write (`withTenant`, "app" role) and the platform-side
   `platform_audit_log_entry` write (`withPlatform`, "platform" role) are, structurally,
   two different Postgres roles/connections — this codebase has no primitive that spans
   both in one transaction (same limitation `provisionTenant()`'s own audit write
   already lives with, just within one role there). A crash between the two writes
   could in principle leave one trail missing an entry the other has; it can never
   cause an access grant to be treated as valid when it wasn't — the grant-validity
   check itself is the security boundary, and it happens before either write.
5. **No aiAttempts/tool-call join on the break-glass escalation-detail read.** The
   tenant admin's own `escalations/[id]` composition-root route additionally joins
   `@nextbot/orchestration`'s `tool_call` rows (`aiAttempts`) — this phase's break-glass
   escalation-detail endpoint returns `getEscalationDetail()`'s own fields (transcript
   excerpt, CSAT, routing) but not that extra join, to keep the diagnosis surface
   bounded to what the two read-model functions above already provide. Flagged as a
   disclosed narrowing, not a silent gap — the AI-attempts trace is a deeper drill-down
   a future phase could add the same way the tenant-facing route already does.
6. **Denial attempts are audited platform-side only, not tenant-side.** A denied
   `POST .../activate` (no grant / revoked / expired / tenant not found) writes one
   `platform_audit_log_entry` row (`breakglass.access_denied`, with a `reason` field —
   `no_grant`/`revoked`/`expired`) for operator-side accountability. It does not write
   a tenant-side `domain_event`, since nothing happened to the tenant's data and
   surfacing every declined operator attempt in the tenant's own Audit Log would be
   noise the tenant can do nothing about.

## Phases

### Phase 20.1 — Data model
**Scope**: `tenant_breakglass_grant` (tenant-scoped, RLS'd) — `packages/db/src/schema/
tenancy.ts`, migrations `0090_breakglass_operator_access.sql` /
`0091_breakglass_operator_access_rls.sql`, `TENANT_SCOPED_TABLES` manifest,
`deleteFixtureTenant`'s child-first delete list.
**Exit gate**: `rls-coverage.isolation.test.ts` covers the new table generically;
typecheck clean.

### Phase 20.2 — Tenant-side domain/application + contracts
**Scope**: `packages/contracts/src/tenancy.ts` (request schema + max-hours constant),
`packages/contracts/src/errors.ts` (three new `DomainError` subclasses),
`packages/modules/tenancy/src/domain/breakglass-grant-policy.ts` (pure expiry/active
predicates), `packages/modules/tenancy/src/application/breakglass-grant.ts`
(create/revoke/get-active/list, each `withTenant`-scoped, create/revoke each writing
one `domain_event`).
**Exit gate**: unit tests for the pure policy; a real-DB integration test proving
create/get-active/revoke/expiry and the `domain_event` → `audit_log_entry` sync path.

### Phase 20.3 — Platform-ops application (the fail-closed boundary)
**Scope**: `packages/modules/tenancy/src/application/breakglass-access.ts`
(`activateBreakglassAccess`, `requireActiveBreakglassTenantContext`) — the ONLY new
code that constructs a `TenantContext` from a bare `tenantId` on the operator's behalf
and is the fail-closed gate the spec names explicitly.
**Exit gate**: real-DB adversarial tests — valid operator flow denied with no grant /
revoked grant / expired grant; doubly-audited property (both rows, correct
attribution); one active grant per tenant.

### Phase 20.4 — Tenant-side surface (Settings)
**Scope**: `apps/web/app/api/v1/admin/breakglass-grants/**` (GET list, POST create,
POST `[id]/revoke` — top-level under `/admin`, matching the `dsr`/`connectors`
convention rather than the narrower `/settings/*-policy` shape a single-toggle screen
like `identity-resolution-policy` uses, since this resource has real CRUD + history,
not one boolean), `apps/web/app/(admin)/settings/breakglass-access/**` (screen), a card
on the Settings hub. RBAC: `security_settings`.
**Exit gate**: route unit tests (mocked guard) + component test; standard batched gate.

### Phase 20.5 — Platform-ops surface (activate + read-only diagnosis)
**Scope**: `apps/web/app/api/internal/ops/tenants/[id]/breakglass/{status,activate,
conversations,conversations/[id],escalations,escalations/[id]}/route.ts` + a minimal
Tenant Detail sub-screen (`.../tenants/[id]/breakglass/**`) reusing the console's
established Card/AlertDialog conventions.
**Exit gate**: route unit tests (mocked guard, matching the existing
`tenants/[id]/status/route.test.ts` convention) PLUS one real, non-mocked-guard
integration test hitting the real route handler with a genuinely valid operator
token/IP/rate-limit path, proving the fail-closed-with-no-grant property end to end —
this is the spec's own named hard requirement and gets the same rigor as every other
auth-boundary property this project has verified.

### Phase 20.6 — Security review, regression, docs
Self-review against §5 checklist (below), full regression suite, this plan doc and
`docs/NEXUS_STATE.md` updated.

## Security review checklist applied

- Every new tenant-side route: `requireApi("security_settings", "Read"|"Write")`,
  ownership implicit via `withTenant` RLS (a grant id from another tenant can never be
  read/revoked — RLS enforces it, proven by an isolation test).
- Every new platform-ops route: `requirePlatformApi()` (token + IP allowlist +
  rate limit), IDENTICAL to every existing `internal/ops` route; the grant-validity
  check is a SEPARATE, additional gate on top, not a substitute for it.
- Every input validated server-side via TypeBox (`CreateBreakglassGrantRequestSchema`)
  before touching the domain layer; `expiresInHours` is bounds-checked (integer, 1..24)
  both by the schema and, defensively, by the domain policy function.
- No raw SQL string interpolation anywhere in this phase — Drizzle query builder only.
- No secret/credential material touched by this phase at all.
- Read responses never include more than the underlying `getConversationDetailForAdmin`/
  `getEscalationDetail`/`listConversationsForAdmin`/`listEscalationsForAdmin` already
  return to a tenant admin — no new field added on the ops side.
- Rate limiting: the platform-ops surface is already rate-limited by
  `requirePlatformApi()` (`PLATFORM_API_RATE_LIMIT`), unchanged and reused as-is; no
  separate limiter needed for this phase's narrower route set.

## IMPLEMENTATION STATUS — 2026-09-01, IMPLEMENTED, ready for standard batched QA

All six phases above were implemented in one dispatch (small, bounded, final phase —
no reason to split across dispatches). Delivered:

- **Data model**: `tenant_breakglass_grant` (migrations `0090`/`0091`), added to
  `TENANT_SCOPED_TABLES` and `deleteFixtureTenant`'s child-first list. Migrations
  applied cleanly against the test database (`pnpm --filter @nextbot/db run
  migrate:test`).
- **Contracts**: `BREAKGLASS_MAX_GRANT_HOURS` (24), `CreateBreakglassGrantRequestSchema`,
  `ActivateBreakglassAccessRequestSchema` (`packages/contracts/src/tenancy.ts`);
  `BreakglassAccessDeniedError` (403), `BreakglassGrantAlreadyActiveError` (409),
  `BreakglassGrantExpiryTooLongError` (422) (`packages/contracts/src/errors.ts`), each
  with a direct-construction test in `errors-coverage.test.ts`.
- **Tenant-side application** (`packages/modules/tenancy/src/application/
  breakglass-grant.ts` + `domain/breakglass-grant-policy.ts`): create (one-active-
  grant-at-a-time enforcement, 24h cap enforcement)/revoke (idempotent)/get-active/
  get-most-recent/list, each writing the correct `domain_event` on create/revoke.
- **Platform-ops application** (`packages/modules/tenancy/src/application/
  breakglass-access.ts`): `activateBreakglassAccess` (the one auditable lifecycle
  event, doubly-audited on success, platform-audited-only on denial) and
  `requireActiveBreakglassTenantContext` (the per-read, unaudited, always-re-validated
  gate).
- **Tenant-side surface**: `apps/web/app/api/v1/admin/breakglass-grants/**` +
  `apps/web/app/(admin)/settings/breakglass-access/**` + a Settings hub card.
- **Platform-ops surface**: `apps/web/app/api/internal/ops/tenants/[id]/breakglass/
  {status,activate,conversations,conversations/[conversationId],escalations,
  escalations/[escalationId]}/route.ts`, all gated by the unmodified
  `requirePlatformApi()`; plus a minimal Platform Manager console screen
  (`.../tenants/[id]/breakglass/**`, linked from the existing Tenant Detail screen)
  reusing the console's established Card/Badge/AlertDialog conventions — grant status,
  an activate form, and read-only conversation/escalation browsing.
- **Metadata-only rollup**: `health-rollup/route.ts` was not touched by this phase at
  all (confirmed by inspection). Its own existing `route.test.ts` already asserts the
  rollup's exact response shape byte-for-byte (`toEqual` on the full connector-summary
  object) AND already carries a dedicated regression test ("never includes a
  conversation/message-shaped key anywhere in the response") guarding precisely
  against the kind of scope-creep this phase's own "additive, never a relaxation"
  requirement is protecting — re-run unmodified as part of this dispatch's full unit
  suite and confirmed still green, which is this phase's regression proof that the
  rollup's shape is unchanged, rather than a new file duplicating an assertion that
  already exists.

**Verification**:
- `pnpm turbo run typecheck` on the six touched packages (`@nextbot/db`,
  `@nextbot/contracts`, `@nextbot/tenancy`, `@nextbot/conversations`,
  `@nextbot/escalations`, `nextbot-web`): clean.
- Scoped `eslint --max-warnings=0` on every touched file: clean. Full-repo
  `eslint . --max-warnings=0`: clean (exit 0).
- `dependency-cruiser`: 0 violations (2549 modules/8187 dependencies) — confirms
  `activateBreakglassAccess`/`requireActiveBreakglassTenantContext` (the only new
  `withPlatform` call site) stayed inside the allowed-callers boundary.
- Full regression re-run fresh: unit project 327 files/2296 tests all green;
  integration project 172 files/976 tests — 975 green, 1 pre-existing flake
  (`plan-tier-definitions.int.test.ts`'s audit-attribution assertion, caused by
  concurrent test workers writing into the same platform-wide, non-tenant-scoped
  `plan_tier_definition`/`platform_audit_log_entry` rows — reproduced only in the full
  concurrent batch, confirmed green in isolation; the same resource-contention flake
  class this project's history already documents, e.g. Phase 19's
  `connectors/credential-db-grant.int.test.ts`); isolation project 15 files/151 tests
  all green (including the new table's generic RLS coverage).
- Coverage (v8, scoped to this dispatch's added/changed files): tenancy module's three
  new files 100% statements/lines/funcs, 98.27% branches; the one uncovered branch is
  `classifyInactiveBreakglassGrant`'s defensive final-fallback arm. `apps/web`'s new
  route/component files: 91.06% statements/lines aggregate — both comfortably above
  the 80% bar.
- **Fail-closed adversarial proof** (the spec's own named hard requirement):
  `breakglass-access.int.test.ts` (application layer, real DB) and
  `breakglass-ops.int.test.ts` (real HTTP route + real, non-mocked
  `requirePlatformApi()` + real DB) both prove a genuinely valid platform-operator
  token is denied 403 with no grant / a revoked grant / an expired grant, and that an
  invalid token is denied even WITH a valid grant (the two gates are independent).
- **Doubly-audited proof**: `breakglass-access.int.test.ts` proves one real
  `platform_audit_log_entry` row (operator trail) and one real `domain_event` row
  (tenant trail, correctly attributed to the operator's actor label) are written on a
  successful activation, and that a denial writes only the platform-side row.
- **PII-masking-parity proof**: `breakglass-pii-masking-parity.int.test.ts` proves the
  break-glass conversation-detail read returns a byte-identical payload to the tenant
  admin's own read for the same conversation (same underlying function, same masking
  behavior, by construction).

`docs/NEXUS_STATE.md`'s `active_dev_plan`/`pending_qa` and this dispatch's own
decision-log entry carry the pointer back here. `current_phase` remains `development`
— the orchestrator's QA pass, not this agent, decides when Phase 20 (and, with it, the
whole 21-phase Target Architecture Blueprint) is done.
