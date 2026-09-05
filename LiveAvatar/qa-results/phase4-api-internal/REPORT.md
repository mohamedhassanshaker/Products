# QA Report — Phase 4 `apps/api` extensions (Python agent runtime support)

**Scope:** `apps/api/src/modules/tools`, `apps/api/src/modules/sessions` (5 new use cases + 3
new Prisma repos), `InternalTokenGuard`, `AgentInternalController`, `packages/contracts`
(`internal/schemas.ts`, `agent-config/formats.ts`). Verify-immediately batch (new
internal auth surface).

**Environment:** No Docker/Postgres/LiveKit reachable in this sandbox (carried-forward,
disclosed limitation since Phase 1 - unchanged). All verification below was done
against the real compiled TypeScript/NestJS DI graph and real HTTP requests
(`@nestjs/testing` + `supertest`, mocking only the Prisma-backed repository/use-case
layer, never the guard/controller/pipe/validation layer under test), plus direct
`Value.Check`/`Value.Errors` calls against the real `@sinclair/typebox` runtime - not
static code reading. Jest/ESLint/`nest build` run directly in this sandbox against the
actual repo.

## Overall verdict: **FAIL**

One functional defect blocks two of the six new agent-facing routes outright (every
structurally-valid request is rejected). Auth boundary itself is sound. Recommend one
narrowly-scoped retry to `nexus-dev` for D-1 before this phase can close.

## Traceability matrix

| # | Requirement / check | Scenario(s) tested | Result | Evidence |
|---|---|---|---|---|
| 1a | `InternalTokenGuard` rejects unauthenticated calls to all 6 agent routes | No `X-Internal-Token` header on GET runtime-config, POST events/utterances/hops/summary/alerts | PASS | Real HTTP via supertest against a live NestJS app instantiating the actual `AgentInternalController` + `@UseGuards(InternalTokenGuard)`; all 6 -> `401 AUTH_UNAUTHORIZED` |
| 1b | Guard rejects garbage token | Same 6 routes, `X-Internal-Token: totally-wrong` | PASS | All 6 -> 401 |
| 1c | Guard rejects same-length-but-wrong token (exercises the non-length-mismatch `timingSafeEqual` branch) | Same 6 routes, wrong token same byte-length as real secret | PASS | All 6 -> 401 |
| 1d | Guard accepts the correct shared secret | Same 6 routes, correct `INTERNAL_TOKEN` value | PASS (auth layer only - see D-1) | 4/6 routes -> 200/204; 2/6 (`events`, `utterances`) -> 400, but from the **validation pipe**, not the guard (see D-1) |
| 1e | LiveKit webhook route is not covered by `InternalTokenGuard` | POST `/internal/livekit/webhooks` with no token, and separately with a wrong `X-Internal-Token` header | PASS | Both return `204` (controller's own "drop silently on bad signature" behavior) - confirms `@UseGuards(InternalTokenGuard)` is applied only to `AgentInternalController`, not `InternalController`, and the guard is not accidentally global (checked `internal-app.module.ts` / `internal.module.ts` for any `APP_GUARD`/module-level `@UseGuards` - none found) |
| 2a | TS-side cross-language contract test runs and passes | Ran `agent-config-cross-language.contract.spec.ts` directly | PASS | `11/11` tests green |
| 2b | TS and Python sides consume the identical fixture corpus | Compared path resolution logic in both files | PASS | TS: `join(__dirname,'..','..','..','..','..','agent','fixtures','agent-config')` from `apps/api/src/modules/deployment-config/domain/` -> `apps/agent/fixtures/agent-config`. Python: `Path(__file__).parents[2] / "fixtures" / "agent-config"` from `apps/agent/tests/contracts/` -> same directory. Both list `valid/*.yaml` and `invalid/*.yaml` from that one directory - no separate/duplicated fixture sets |
| 2c | TS side genuinely fails on a corrupted fixture (not a no-op assertion) | Mutated `valid/example-a.yaml`'s `tenant_id` to `"not-a-uuid"`, reran suite, restored the file, reran again | PASS | Corrupted run: `1 failed, 10 passed` (the mutated fixture's own `it.each` case failed with `Expected: true / Received: false`); restored run: `11/11` passed again. Proves the suite is a real, sensitive check |
| 3 | `uuid` format registration does real validation work | (a) Checked `Value.Check`/`FormatRegistry.Has('uuid')` behavior before vs. after registering the format; (b) confirmed the one real TS-side consumer (`AgentConfigSchema.deployment.tenant_id` inside the contract test, see 2c) | PASS | Before registration: `Value.Check` returns `false` for both a valid and an invalid UUID string (TypeBox's "unknown format => unconditional fail" behavior, confirmed directly against the installed `@sinclair/typebox` version, error message `"Unknown format 'uuid'"`). After registering the exact pattern `formats.ts` uses: valid UUID -> `true`, garbage string -> `false`. This is real accept/reject logic, not a decorative no-op |
| 4a | `RecordHopsUseCase`/`RecordUtterancesUseCase`/`RecordAlertUseCase`/`SetSessionSummaryUseCase` write to the correct tenant-scoped row | Code inspection of all 4 use cases + their Prisma repos | PASS | All 4 look the session up by id first (`SessionRepositoryPort.findById`, no tenant filter - necessary since `/internal` has no request-scoped tenant context), then derive `tenantId` from the found session row itself, never from client input, before calling `prisma.withBypass(...)` writes that carry an explicit `tenantId` column. This matches the established pattern from Phase 3's `sessions`/`providers` repositories (decision-log-documented). `RecordAlertUseCase` is the one exception by design (alerts are tenant-scoped not session-scoped per LLD Sec5.9) and takes `tenant_id` directly from the request body with no existence/ownership check against the session - see D-3 |
| 4b | A misbehaving agent process can't write hops/utterances/alerts to a session it doesn't own | Attempted to verify the actual authorization model | CAVEAT (by design, not a code defect) - see D-2 | The write path can't be tricked into writing under the wrong tenant (tenantId always comes from the DB row, never the client), but nothing in this phase's design distinguishes "agent process serving tenant A's session" from "agent process serving tenant B's session" - any holder of the one shared `X-Internal-Token` can address any session id and its hops/utterances/summary will be accepted, because those routes only check "is this a valid agent bearer token", never "is this bearer entitled to this specific session". This matches LLD Sec5.9's documented model (single shared secret + network-boundary trust, mTLS in production) - flagging as a disclosed design characteristic per the dispatch's explicit ask, not asserting it's a bug the dev introduced |
| 5 | `tools` module CRUD tenant scoping | Read `domain/ports.ts`, `infrastructure/prisma-tool-definition.repository.ts`, `tools.module.ts` | PASS (confirms the disclosed gap is real) | The module is read-only - `ToolDefinitionRepositoryPort` exposes only `listByTenant`/`listEnabledByApiRefs`, both tenant-id-filtered at the Prisma query level (no cross-tenant leak possible in what exists). There is no create/update/delete path anywhere in the module, confirming the dev's own flagged item: no admin CRUD screen or backend mutation route exists, so `agent.tools[]` can be validated against `ToolDefinition` rows but an operator has no way to populate them. This is a real, product-level gap as disclosed - not something for QA or dev to silently resolve |
| 6 | Full regression: apps/api jest | `npx jest --runInBand` in `apps/api` | PASS | `98/98 suites, 569/569 tests` - matches dev's claimed numbers exactly |
| 7 | ESLint (api + contracts) | `pnpm --filter @liveavatar/api lint`, `pnpm --filter @liveavatar/contracts lint` | PASS | Both exit 0, zero problems |
| 8 | `nest build` | `prisma generate && npx nest build` in `apps/api` | PASS | Clean, no errors |
| 9 | `packages/contracts` build | `pnpm --filter @liveavatar/contracts build` (`tsc`) | PASS | Clean |

## Defects

### D-1 (Blocking / Critical) - `date-time` format never registered with TypeBox; two of six new agent-facing routes reject every valid payload

**Files:** `packages/contracts/src/internal/schemas.ts` (`SessionEventRequestSchema.at`,
`UtteranceItemSchema.started_at`/`ended_at`), no corresponding entry in
`packages/contracts/src/agent-config/formats.ts` (or anywhere else in the repo).

**Originating phase:** Phase 4 (this batch) - `internal/schemas.ts` and its `date-time`
usage are new this phase; `formats.ts` only registers `uuid`, not `date-time` or `uri`.

**Expected:** `POST /internal/sessions/{id}/events` and
`POST /internal/sessions/{id}/utterances` accept structurally valid, spec-shaped
payloads (LLD Sec5.9: `{type, error_code?, at}` and `{items:[{seq,role,text,started_at,
ended_at}]}` respectively) from an authenticated agent.

**Actual:** Every request to these two routes is rejected with `400
INTERNAL_PAYLOAD_INVALID`, regardless of whether the payload is valid, because
`T.String({format: 'date-time'})` is checked against TypeBox's `FormatRegistry`, which
has no `'date-time'` entry registered anywhere in this codebase. TypeBox's documented
(and directly reproduced) behavior is that an unrecognized `format` keyword makes
`Value.Check` return `false` unconditionally - this is the exact failure mode the
dev's own comment in `draft-schema.ts` describes and deliberately worked around for
`uuid` on the draft schema ("no `uuid` format checker is registered ... an unregistered
`format` keyword fails `Value.Check` outright rather than being ignored"), but the same
reasoning was not applied to the two new `date-time` usages introduced in this same
phase's `internal/schemas.ts`.

Since `ApplySessionEventUseCase` (driving the whole session-status transition machine,
LLD Sec8.1) is invoked exclusively through `POST /internal/sessions/{id}/events` from the
agent side, and `RecordUtterancesUseCase` (FR-CALL-3/FR-SESS-1, live captions'
persistence path) is invoked exclusively through `POST /internal/sessions/{id}/
utterances`, this means the agent can never successfully report a session-status
event or a transcript utterance to the control plane at all - not an edge case, the
golden path itself is broken for these two routes.

**Repro (reproduced directly in this sandbox, not inferred):**
`Value.Check(SessionEventRequestSchema, { type: 'active', at: '2026-01-01T00:00:00.000Z' })`
returns `false`; `Value.Errors(...)` reports `"Unknown format 'date-time'"` on path `/at`.
Same result for `UtteranceBatchRequestSchema` with
`{items:[{seq:0, role:'user', started_at:'2026-01-01T00:00:00.000Z'}]}` ->
`"Unknown format 'date-time'"` on `/items/0/started_at`.

Also confirmed live over real HTTP: a `supertest` request to
`POST /internal/sessions/s1/events` with the correct `X-Internal-Token` and a
spec-shaped body returns `400`, not `204`.

**Why the dev's own test suite didn't catch this:** `agent-internal.controller.spec.ts`
instantiates `AgentInternalController` directly (`new AgentInternalController(...)`) and
calls its methods directly - this bypasses Nest's HTTP pipeline entirely, so the
`TypeBoxValidationPipe` (and therefore this bug) is never exercised by any existing
unit test. This is a real integration gap, not a logic error a unit test would catch.

**Severity:** Blocks the requirement (FR-CALL-3, FR-SESS-1, LLD Sec8.1's status machine)
- two of six new routes are non-functional for every legitimate caller.

**Fix direction (for dev, not applied here):** register `date-time` (and `uri`, see
D-1b below) in `agent-config/formats.ts` alongside `uuid`, or add equivalent format
functions scoped to `internal/schemas.ts` - then re-verify against these same repro
steps.

### D-1b (Low, same root cause, currently latent) - `uri` format also unregistered

**File:** `packages/contracts/src/internal/schemas.ts`
(`AgentRuntimeConfigDtoSchema.endpoints: T.Record(T.String(), T.String({format:
'uri'}))`).

Same unregistered-format defect as D-1, but currently latent on the TS side: confirmed
no TS code path calls `Value.Check`/`Value.Decode` against `AgentRuntimeConfigDtoSchema`
today (`GetRuntimeConfigUseCase`/`AgentInternalController.runtimeConfig` just return a
plain object; grepped the whole `apps/api/src` tree for any `Value.Check`/response-
validation call against this schema - none found). Not currently blocking, but will
reproduce D-1's exact failure the moment anything (a future TS response-validation
interceptor, or the Python Pydantic mirror if it mirrors `format: 'uri'` literally)
actually validates this schema. Recommend fixing alongside D-1 since it's the identical
root cause and a one-line addition.

### D-2 (Disclosed design characteristic, not a code defect - reported per explicit dispatch instruction)

Agent-facing session-scoped routes (`events`, `utterances`, `hops`, `summary`) are
authorized only by possessing the single shared `X-Internal-Token`; there is no
per-session or per-tenant binding of which agent process may write to which session
id. Any caller holding the shared secret can address any session id it knows/guesses
and have writes accepted (tenant attribution is still correct - see matrix row 4a - but
session ownership is not checked). This matches LLD Sec5.9's documented model (`:8081`
internal-only listener + mTLS in production as the trust boundary, not a per-request
authorization check), so this is not treated as a defect, but is called out explicitly
per the dispatch's item 4 ask. No action requested unless the architect wants to
tighten this in a future phase.

### D-3 (Low) - `RecordAlertUseCase` accepts an arbitrary `tenant_id` with no existence check

**File:** `apps/api/src/modules/sessions/application/record-alert.use-case.ts`.

`POST /internal/alerts` takes `tenant_id` directly from the request body (format-checked
as a UUID shape only) and calls `alerts.create(...)` with no check that the tenant
exists. An agent process (or anything holding the shared secret) can create an
`AlertEvent` row under any UUID-shaped `tenant_id`, including one that doesn't
correspond to a real tenant. Given alerts are meant to surface on a tenant's dashboard
(FR-ALERT-1..3), this is a low-severity data-integrity nit (an orphaned alert row, not
an authorization bypass - there's no cross-tenant read exposure since there's no read
path in this phase at all) rather than a security defect. Flagging for completeness.

## Not a defect - explicitly re-confirmed correct

- `InternalTokenGuard` itself: constant-time comparison genuinely exercises the
  length-mismatch branch (`timingSafeEqual(bufA, bufA)` then still `return false`) -
  confirmed both by reading the implementation and by the `1c` HTTP-level probe above
  using a wrong token of matching byte-length.
- No global `APP_GUARD`/module-level guard exists that could double-apply
  `InternalTokenGuard` to the LiveKit webhook route, and no cross-wiring makes the
  webhook route reachable through `AgentInternalController` or vice versa - confirmed by
  reading `internal.module.ts`, `internal-app.module.ts`, and the direct HTTP probes in
  matrix row `1e`.
- `EnvSchema.INTERNAL_TOKEN` requires `minLength: 16` at bootstrap, and
  `InternalTokenGuard` independently rejects when `INTERNAL_TOKEN` is unset - both
  layers checked, consistent with each other.
- `ToolDefinition` module: confirmed genuinely read-only; no accidental write path or
  tenant-crossing exists because none of the CRUD exists at all (see matrix row 5).

## Carried-forward environment limitation (unchanged, not gating this verdict)

Docker/Postgres/LiveKit remain unreachable in this sandbox. All the checks above that
would ordinarily hit a live Postgres (real `PrismaService`/`prisma.db.*` calls end to
end, e.g. that `RecordHopsUseCase`'s upsert genuinely lands the correct `tenantId`
column in a real database row) were verified at the DI/HTTP-pipeline layer with the
Prisma-backed repository mocked at its port boundary, plus direct code review of the
repository's Prisma call shape - not against a live database. This is the same
disclosed, non-blocking gap carried since Phase 1 and does not change this report's
verdict (D-1 is a pure schema/validation-layer bug, fully reproducible with no database
involved at all).

## Summary

- Auth boundary (`InternalTokenGuard`) on the new `/internal` agent surface: sound,
  independently re-verified over real HTTP with no-token / garbage-token / same-length-
  wrong-token / correct-token cases on all six routes, and confirmed non-overlapping
  with the LiveKit webhook's separate HMAC auth.
- Cross-language contract test: genuine and correctly wired - same fixture corpus,
  proven sensitive to a deliberate corruption.
- `uuid` format fix: real, working validation, not a decorative registration.
- `tools` module: confirmed read-only as disclosed; the "no admin CRUD" gap is real.
- New session use cases: tenant attribution is correct (derived server-side from the
  session row); session-level ownership is not checked, but this matches the LLD's
  documented trust model rather than an inconsistency introduced by this phase.
- Blocking defect (D-1): two of the six new agent-facing routes
  (`events`, `utterances`) reject every valid request due to an unregistered TypeBox
  `date-time` format - this breaks the session-status machine and transcript-persistence
  golden path for any real agent caller and must be fixed before this phase can be
  considered functionally complete.

**Recommendation:** retry `nexus-dev`, narrowly scoped to D-1 (register `date-time`,
and ideally `uri`, in `packages/contracts/src/agent-config/formats.ts`), then re-run
this exact repro (`Value.Check`/`Value.Errors` against `SessionEventRequestSchema` and
`UtteranceBatchRequestSchema` with a spec-shaped payload, plus a live HTTP round-trip
through `AgentInternalController`) before re-closing this phase. Everything else in this
dispatch's scope passed independent re-verification.
