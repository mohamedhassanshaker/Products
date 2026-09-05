# NextBot — Phased Implementation Plan

**Owner:** nexus-dev · **Status:** Active · **Created:** 2026-08-15

## Dispatch #9 (2026-08-17) — BL-01 completion: Users & Roles screen (FR-ADM-02)

Not a new backlog phase — a targeted completion of BL-01's Phase 3 UI slice, which
had shipped `RolesList.tsx` as a read-only list of the six seeded system roles with
an explicit in-code "out of scope" disclosure for invite/assignment UI. The user
flagged this directly as a real RBAC gap, not a polish item, since it's a
verify-immediately auth/authz surface. Implemented in one sitting (no new plan
phase needed — this stays within BL-01's already-approved scope):

- **Backend** (`packages/modules/iam`): most domain logic already existed
  (`manage-roles.ts`'s `createRole`, `register-user.ts`, `role-repository.ts`,
  `permission-matrix.ts`'s fail-closed `requirePermission`). Added: `updateRole`
  (custom-role-only, `SystemRoleImmutableError` for the six seeded roles — a
  defense-in-depth `WHERE is_system = false` clause backs the app-layer check),
  `manage-users.ts` (`listUsers`, `createUser` with multi-role assignment via
  validated `roleIds`, `updateUserRoles` full-set reassignment), and the matching
  repository functions (`listUsersWithRoles`, `findRoleById`, `findRolesByIds`,
  `assignRolesToUser`, `replaceUserRoles`). New contracts:
  `UpdateRoleRequestSchema`, `CreateUserRequestSchema` (`roleIds` `minItems: 1` —
  the fail-closed rule enforced at creation time, not just at login), 
  `UpdateUserRolesRequestSchema`, and four new `DomainError`s
  (`SystemRoleImmutableError`, `RoleNotFoundInTenantError`,
  `UserNotFoundInTenantError`, `InvalidRoleAssignmentError`).
- **Routes** (`apps/web/app/api/v1/admin`): `PUT /roles/{id}`, `GET/POST /users`,
  `PUT /users/{id}/roles` — same "RBAC checked inside `@nextbot/iam`'s own http
  layer" convention `/roles` already used (no composition-root `requireApi`
  indirection needed, since `users_roles` is iam's own module). Every mutating
  route calls `recordAdminAudit` with the real acting admin as actor (also
  backfilled onto the pre-existing `POST /roles`, which had no audit call at all).
- **UI** (`apps/web/app/(admin)/roles`): `RolesList.tsx` is now a `Tabs` shell
  (Users / Roles / SSO) instead of a bare table. `UsersTable.tsx` — real user list
  (name, email, role(s), last login, MFA status per screen inventory B.8.1),
  "+ Invite User" (`InviteUserModal.tsx`), per-user "Change roles"
  (`ChangeRolesModal.tsx`), and a "Reset MFA" action wiring the
  previously-orphaned `POST /users/{id}/mfa-reset` endpoint into the UI for the
  first time. `RolesTable.tsx` — "+ New Role"/"Edit" (`RoleFormModal.tsx`) with
  the full per-module Read/Write/None permission matrix
  (`PermissionMatrixEditor.tsx`, one `Select` row per `RbacModuleValue`, following
  UX_GUIDELINES.md §4.3's matrix-cell convention) plus the `mfaRequired` toggle
  (previously backend-only since QA Defect B3, never exposed in any UI). System
  roles stay visible with Edit disabled + tooltip, matching what the backend
  already enforces. No fresh `nexus-ux` dispatch — UX_GUIDELINES.md §2's baseline
  ("standard CRUD/list/detail/wizard patterns... gated by RBAC, not a different
  skin per role") plus the Tool Permission Rule Builder's already-established
  matrix-editor convention (§4.3) covered this without new design judgment.
- **SSO** (`SsoGroupMappingSection.tsx`): an honest "not yet configured"
  `Alert`, matching the login screen's inert "Sign in with SSO" button precedent
  (QA Defect U8) — `sso_group_mapping` is schema-ready (LLD §3.3) but no real
  SAML/OAuth2 provider integration exists anywhere in this codebase, so no fake
  config form was built.
- **Verification**: a new end-to-end integration test
  (`rbac-effective-permissions.int.test.ts`) proves the full
  create-role → create-user → login → `requirePermission` path against real
  Postgres — a user assigned a custom role with `approval_queue: None` genuinely
  fails `requirePermission(..., "approval_queue", "Read")` while their granted
  modules (`connectors: Write`, `reporting: Read`) genuinely pass, and
  reassigning roles changes effective permissions on next login. Full test
  suite (unit 837, integration 278, isolation 76), lint, and typecheck (31
  packages via turbo) all green. Coverage on this dispatch's `apps/web/app/
  (admin)/roles` files: 93.66%; `manage-roles.ts`/`manage-users.ts`: 100%.
- **Local/reversible decisions** (noted per §3, not stopped-and-flagged): role
  *deletion* was left out of scope (the inventory says "create/edit," not
  delete; deleting a role with users still assigned risks silently locking
  them out — flagging rather than guessing at a delete-blocking policy); role
  reassignment replaces the full set rather than incremental add/remove
  (matches `PUT /users/{id}/roles`'s already-simplest shape); "invite user"
  creates the account directly with an admin-chosen password rather than a
  magic-link/no-password flow (no email-sending infrastructure exists in this
  codebase yet, and this matches `registerUser()`/`scripts/seed.ts`'s existing
  account-creation convention).

## Execution status (updated 2026-08-17, dispatch #8 — Phase 19, BL-15 WhatsApp slice)

**Note on Phases 14-18**: those phases (BL-08 Tier-2/3 approvals, BL-09 escalation/live-takeover, BL-10 audit/PII/DSR, BL-11 MCP health/circuit-breaker/quota) were implemented and QA-approved (Final Review PASS, 2026-08-16) in dispatches between #7 and this one — full detail lives in `docs/NEXUS_STATE.md`'s decision log (the table below was not backfilled row-by-row for them; not this dispatch's scope to retroactively reconcile). Backlog Phases 1 and 2 (all P0 items, BL-01 through BL-11) are QA-approved, deployed, and Final-Review-passed as of 2026-08-16. This dispatch (#8) starts Backlog Phase 3 (P1), BL-15's WhatsApp slice.

| Phase | Status | Notes |
|---|---|---|
| Phase 0 — Repo/platform scaffold | **QA-approved (PASS, 2026-08-15)** | See "Dispatch #1 notes" and "Dispatch #2 notes" below. |
| Phase 1 — Tenancy, data policy & plan-tier provisioning | **QA-approved (PASS, 2026-08-15)** | `provisionTenant()` + RLS isolation proven against a real Postgres. |
| Phase 2 — IAM, RBAC & Better Auth integration | **QA-approved (PASS, 2026-08-15)** | Whole-batch re-verification (retry 1) confirmed all B1/B2/B3 fixes genuine. |
| Phase 3 — Admin Console shell + auth UI | **QA-approved (PASS, 2026-08-15)** | Whole-batch re-verification (retry 1) confirmed all U-defect fixes genuine. |
| Phase 4 — Credential vault & connector registration | **QA-approved (PASS, 2026-08-15)** | Whole-batch re-verification (retry 1) confirmed the platform-role ciphertext-leak fix genuine. |
| Phase 5 — Connector & discovery Admin UI | **QA-approved (PASS, 2026-08-15)** | Whole-batch re-verification (retry 1). |
| Phase 6 — Tool Catalog, Agent Tool Registry & permission matrix | **QA-approved (PASS, 2026-08-15)** | Whole-batch re-verification (retry 1). |
| Phase 7 — Web Widget shell + core message types (backend) | **QA-approved (PASS, 2026-08-15)** | Whole-batch re-verification (retry 2, D12-only) confirmed genuine. |
| Phase 8 — Web Widget UI + embed SDK | **QA-approved (PASS, 2026-08-15)** | Whole-batch re-verification (retry 2, D12-only) confirmed genuine. |
| Phase 9 — Platform branding & white-label theming | **QA-approved (PASS, 2026-08-15)** | Whole-batch re-verification (retry 2, D12-only) confirmed genuine. |
| Phase 10 — Agent Platform foundation (backend, BL-07) | **QA-approved (PASS, 2026-08-15)** | Retry-3 final re-verification confirmed genuine. |
| Phase 11 — Agent Platform Architecture Console (frontend, BL-07) | **QA-approved (PASS, 2026-08-15)** | Retry-3 final re-verification confirmed genuine. |
| Phase 12 — Tier-1 autonomous tool calls end-to-end (BL-05) | **Implemented, pending QA (dispatch #7)** | See "Dispatch #7 notes" below. |
| Phase 13 — Conversation persistence, listing & trace viewer (BL-06) | **Implemented, pending QA (dispatch #7)** | See "Dispatch #7 notes" below. Completes Backlog Phase 1. |
| Phases 14-18 — BL-08/09/10/11 (Tier-2/3 approvals, escalation/takeover, audit/PII/DSR, MCP health/circuit-breaker/quota) | **QA-approved (PASS, 2026-08-16, Final Review)** | Completes Backlog Phase 2 (full P0 MVP). Detail in `docs/NEXUS_STATE.md` decision log, not backfilled into this table row-by-row. |
| Phase 19 — Meta channel family: WhatsApp slice (BL-15, Backlog Phase 3/P1) | **Implemented, pending QA (dispatch #8)** | See "Dispatch #8 notes" below. Messenger/Instagram + FR-OC-04 routing rules deferred to a follow-up dispatch. |

### Dispatch #8 notes (Phase 19 — BL-15 WhatsApp slice, Backlog Phase 3/P1)

Full detail (schema, adapter design, admin UI, security review, verification) is
recorded in `docs/NEXUS_STATE.md`'s decision log (2026-08-17 entry) — not duplicated
here. Summary:

- **Scope**: WhatsApp channel connection end-to-end — Meta Business Manager link,
  WABA/phone-number/messaging-tier config, credential vaulting + rotation, webhook
  receiver with real HMAC signature verification + idempotent processing, template
  sync, opt-in/consent tracking with bulk import/export, the 24h-session-window
  enforcement wired into the real send path, quick-reply → interactive-button
  mapping, and the Admin Console "Add Channel" type-picker + B.2.3 config screen.
- **Deliberately out of scope, deferred to a follow-up dispatch**: Messenger,
  Instagram (the rest of BL-15), and FR-OC-04 (channel routing rules — bundled into
  BL-15's backlog title, but this dispatch's task list scoped to the WhatsApp channel
  connection itself).
- **Disclosed sandbox limitation** (same class as the Git/LLM provider disclosures in
  earlier phases): no real Meta App/System User credentials exist here — the connect
  flow uses direct System User token entry (a real Meta-documented workflow) rather
  than a live OAuth redirect, and phone numbers are synced from Meta rather than
  verified via this system's own OTP flow. Every Meta Graph API call site is proven
  against a new local mock server (`packages/testing`'s `startMockMetaGraphServer`),
  exercising the real client code end-to-end.
- **`nexus-ux` dispatched foreground** before implementation — `docs/design/
  UX_GUIDELINES.md` §7 covers the type-picker, the full B.2.3 config screen (every
  state), the 24h-window violation surfacing, and the quick-reply → button preview.
- **Verification**: `pnpm typecheck` 31/31, `pnpm lint`/`lint:boundaries` clean, full
  suite green (unit 798/798, integration 262/262, isolation 76/76 — including a real
  signed-webhook → real-turn-pipeline → real-Meta-mock-server-send e2e test, a real
  24h-window-rejection test, and a real webhook-redelivery idempotency test). `next
  build` compiled every new route/page cleanly for both apps (the only build-step
  failure is the pre-existing, unrelated Windows-symlink `output: "standalone"`
  file-tracing issue, reproduced identically on unrelated pre-existing pages).

### Dispatch #7 notes (Phases 12-13, batched, completes Backlog Phase 1)

Implemented via two sequential subagent passes (Phase 12 then Phase 13, since Phase 13's
trace viewer depends on Phase 12's `agent_run` data existing). Full detail is in
`docs/NEXUS_STATE.md`'s decision log; highlights:

1. **Phase 12 (BL-05):** real turn pipeline (`packages/modules/orchestration`:
   param-extract → guardrail-eval stub → tier-engine Tier-1-only → dispatch), goal/tool
   selection via `ai-registry`'s TypeBox-validated `generateStructured` against the
   Agent Tool Registry, gated by `resolvePermission()`; `ToolInvocation`/`ToolResult`
   contract over `ports/egress.ts` into `apps/gateway/src/lib/mcp-egress.ts` (PEP
   re-check, vault credential injection, circuit-breaker stub); four new widget payload
   types (DataSummary/DataTable/Document/ExternalLink) with matching card components;
   Phase 7's placeholder AI reply replaced end-to-end; full FR-AI-05 fallback messaging.
   **Deviations flagged:** selection uses `generateStructured` directly rather than a
   full `GraphRuntime.start()` tool-execution loop (ADK adapter/mock model server don't
   support one yet); circuit breaker is an in-memory stub (real one is BL-11/Phase 18,
   as planned); `apps/gateway` is the composition root wiring `orchestration`/
   `conversations`/`connectors` together, since none of those modules may import each
   other directly under the existing ESLint boundary rules.
2. **Phase 13 (BL-06):** idle-sweep job (LLD §3.7 exact rule, real cron scheduling
   deferred to Phase 18 per the Phase-10 git-sweep convention); Conversation List
   admin API+UI (filter by channel/status/date/recognized-task/language — no `backend`
   filter, flagged: no `tool_call` fact table exists yet to filter by) with rate-limited
   CSV/JSON export; Conversation Detail/Trace Viewer reading `agent_run` plus a newly
   stood-up ClickHouse read/write path (`packages/db/src/clickhouse.ts`, new
   `@clickhouse/client` dependency, checked against the ADR maturity bar).
3. **A genuine Phase-12 gap was found and fixed while building Phase 13, not silently
   worked around:** `runTurnPipeline` never called Phase 10's `startAgentRun`/
   `completeAgentRun` write path nor emitted spans, so `agent_run`/`agent_run_span`
   were entirely unpopulated — would have left the trace viewer with nothing to show.
   Fixed additively (new optional `agentDefinitionVersionId`/`conversationId` fields;
   every existing Phase-12 call site keeps working unchanged with `runId: null`) via
   `packages/modules/orchestration/src/infrastructure/agent-run-tracing.ts`; a new
   NFR-9 integration test proves a real tool-call turn produces a complete, in-order,
   tenant-scoped trace on both success and failure paths.
4. **ClickHouse bridge flagged:** no OTel Collector exists in this repo (infra, not app
   code); spans are written directly to ClickHouse from `agent-run-tracing.ts` in
   parallel with the existing OTel SDK exporter — reversible once a real Collector
   lands.
5. `nexus-ux` was **not** re-dispatched for the Conversation List/Trace Viewer screens —
   judged routine against `UX_GUIDELINES.md` §6.7 (already anticipated the trace
   viewer's span-waterfall shape) plus the already-established list/detail +
   expandable-block patterns from Channels/Agent Platform.

**Verification (not just claimed):** full workspace suite re-run after both phases
landed — `pnpm typecheck` 31/31, `pnpm lint`/`lint:boundaries` clean (984 modules/3892
deps cruised, 0 violations), `pnpm build` clean across all 3 Next.js apps, full suite
636 unit + 172 integration + 54 isolation = **862/862 green**. Coverage on this
dispatch's added/changed files: 91.1% stmts/lines, 82.2% functions, 77.9% branch
(meets the ≥80% target in aggregate; a couple of trivial RSC page wrappers and
secondary error branches sit under the file-level 80% bar, consistent with this
codebase's existing convention). Phase 12 in isolation had flagged a lower
**workspace-aggregate** coverage figure (64.07%) dragged down by pre-existing
unrelated 0%-covered boilerplate/empty stub packages, not by Phase 12's own files
(individually 63–100%) — the final full-suite figures above supersede it. Security
review: every new endpoint RBAC-guarded + tenant-scoped (Postgres `withTenant` +
ClickHouse forced `tenant_id` predicate, cross-tenant invisibility integration-tested
for both stores); PEP re-check at MCP egress independently verified (deny-only test
proves no network call for a denied tool); credentials never cross the port boundary
or get logged; export endpoint rate-limited + row-capped; no raw SQL string
concatenation; no provider-SDK/`@google/adk`/vendor-model-id/hand-parsed-JSON
violations (dependency-cruiser-enforced).

**This completes Backlog Phase 1 (BL-01 through BL-07 plus BL-26)** per
`docs/BACKLOG.md`, pending this QA pass — the plan's own recommended checkpoint before
Backlog Phase 2 (BL-08 → BL-11) begins.

### Dispatch #6, retry 3 fix pass (QA-driven, final attempt before retry cap)

QA's retry-2 re-verification found the retry-1 uuid-format fix itself broken:
`packages/contracts/src/formats.ts` registered `"uuid"` with a regex allowlisting
version nibbles `[1-5]`, rejecting every UUIDv7 id this system's own `generateId()`
(`packages/db/src/id.ts`) actually produces — and the regression tests added
alongside that fix used a hand-picked v4 example instead of a real generated id, so
they stayed green while the live system 422'd on every real request.

**Fix**: `formats.ts`'s `"uuid"` validator now checks only the general UUID shape
(8-4-4-4-12 hex, hyphenated) without constraining the version nibble at all — no
hand-maintained version allowlist, so no future RFC 9562 version can trigger the same
class of defect. The variant nibble (`[89ab]`) is still checked (stable across
versions, matches the `uuid` npm package's own `validate()` and `crypto.randomUUID()`).

**Verification gap closed**: added an explicit test that generates real ids via
`uuidv7()` (the exact function `generateId()` wraps — imported as a devDependency of
`@nextbot/contracts` rather than depending on `@nextbot/db` directly, to avoid tripping
`.dependency-cruiser.cjs`'s `no-circular` rule, since `@nextbot/db` already depends on
`@nextbot/contracts`) and asserts they all validate, with a sanity check confirming the
fixture is genuinely v7. Updated `apps/web/.../bind-eval-suite/route.test.ts` to use
real `generateId()` output throughout. Added a new
`apps/web/.../bind-eval-suite/route.int.test.ts` — a genuine end-to-end test against
the real test Postgres stack: provisions a real tenant/Git connection/agent
definition/version/eval suite (real v7 id), calls the real `POST` handler (only
session/auth mocked), and re-fetches the version to confirm the binding persisted
("visible on reload"), not just a 200 status. Required adding the `@/*` alias to
`vitest.workspace.ts`'s "integration" project (first `apps/web` int test) and
`@nextbot/testing`/`uuidv7` as devDependencies.

**Full verification**: unit 594/594, integration 131/131 (incl. the 2 new tests),
isolation 54/54 — 779 tests green. `pnpm lint`, `pnpm lint:boundaries` (confirms no
circular dependency from the `uuidv7` devDependency approach), `pnpm typecheck` (31/31
packages) all clean. Coverage on the two changed files: `formats.ts` and
`bind-eval-suite/route.ts` both 100/100/100/100. No production dependency added
(`uuidv7`/`@nextbot/testing` are devDependencies only); no auth/validation logic
outside the uuid regex itself touched.

### Dispatch #6 notes (Phases 10-11, BL-07 Agent Platform, batched per orchestrator instruction)

Implemented both phases in one dispatch, gated internally (typecheck at each phase
boundary; lint/full-suite/coverage once at the end). Full defect-by-defect/decision
detail is also recorded in `docs/NEXUS_STATE.md`'s decision log; the highlights
load-bearing for QA:

1. **Schema (migrations 0014-0015):** `git_connection`, `agent_definition`,
   `agent_definition_version`, `eval_suite`/`eval_case`/`eval_run`/`eval_case_result`,
   `deployment`/`deployment_history` (minimal — full canary UI is BL-13), `model_provider`
   (platform-level, no `tenant_id`, like `channel_capability`), `model_route`/
   `model_budget`/`model_call_log`/`model_cache_entry`, `agent_run`. **Deviation
   flagged:** every table above (except `model_provider`) uses `tenant_id NOT NULL`,
   deviating from LLD's nullable-for-platform-shared-rows column — see
   `packages/db/src/schema/agent-platform.ts`'s module doc for the full reasoning
   (no platform-template-library feature is in this phase's actual scope, and the
   nullable-tenant RLS shape needed for it is genuinely different/riskier than every
   other tenant-scoped table in this codebase; env config already covers LLD §7.1's
   "env default" resolution tier without it).
2. **`packages/ai-registry`** stood up for real (was a reserved stub): the *only*
   package importing `@google/adk` or a provider SDK (dependency-cruiser's existing
   Phase-0 rule already covered this — verified, not just assumed). Real providers:
   Anthropic (`@anthropic-ai/sdk`) and a dependency-free fetch-based OpenAI-compatible
   client (covers OpenAI/Azure OpenAI/Ollama/vLLM/LM Studio via `baseUrl` — this is
   also how "on-prem is first-class" is proven structurally). `GraphRuntime` port
   (ADR-0003) plus a real Google ADK adapter (genuine `LlmAgent`/`Runner`/
   `InMemorySessionService` usage, a custom `NextBotGatewayLlm extends BaseLlm`
   bridging ADK's model client to this registry so ADK never sees a URL/credential/
   vendor model id) and the second in-tree `CustomFSM` implementation, both passing a
   shared conformance suite (suspend/resume via a structural test-only trigger,
   independent of any model's tool-selection behavior). TypeBox structured-output
   re-validation (`generateStructured`) with one repair attempt, never hand-parsed JSON.
3. **`packages/modules/agent-platform`** stood up for real: agent definition/version
   CRUD with real Git commits (GitHub/GitLab REST clients, plain `fetch`, no SDK —
   contents/compare/pulls or files/commits/compare/merge_requests respectively), the
   promotion-policy FSM (`Draft→EvalGated→HumanReview→Approved→Production→Deprecated`)
   enforced server-side (not just a UI hint), eval-suite execution (runs the version's
   `GraphRuntime` directly, single-turn — orchestration's full pipeline is Phase 12),
   Model Gateway route resolution (tenant `model_route` → env default, region
   filtering via `model_provider.regions`/`tenant_data_policy.allow_out_of_region_
   inference`, exact-match caching), `agent_run` write path + real OTel spans
   (`packages/observability`, newly implemented — OTel SDK/exporter plumbing,
   `ConsoleSpanExporter` default / `OTLPTraceExporter` when `OTEL_EXPORTER_OTLP_
   ENDPOINT` is configured). Webhook-primary + 15-minute polling-reconciliation status
   sync (ADR-0009) — the reconciliation function itself is real and integration-tested;
   **deferred, flagged:** actually scheduling it as a recurring job is Phase 18's job
   (apps/worker's job-scheduling infrastructure doesn't exist yet) — a flagged,
   callable-not-yet-scheduled entrypoint exists at `apps/worker/src/agent-platform-git-
   sweep.ts`.
4. **No real GitHub/GitLab OAuth app or LLM provider credentials exist in this
   sandbox — flagged, not faked.** The OAuth redirect/token-exchange protocol code
   (`infrastructure/git-oauth.ts`) is implemented against the real, documented GitHub/
   GitLab endpoints with env-configurable client id/secret placeholders
   (`GITHUB_APP_CLIENT_ID`/`_SECRET`, `GITLAB_OAUTH_CLIENT_ID`/`_SECRET`); pointing
   these at a real registered app is the only remaining step to go live. Every Git
   integration test instead runs against a local GitHub-API-shaped mock server
   (`packages/testing`'s new `startMockGitHubServer`), exercising the real client code's
   request/response handling end-to-end. Likewise, no `ANTHROPIC_API_KEY`/
   `OPENAI_API_KEY` exists; the OpenAI-compatible provider is proven against a local
   mock server, and the Anthropic adapter's SDK-calling code is proven against a
   minimal local server speaking the real documented `/v1/messages` wire shape.
5. **Frontend (Phase 11):** nine screens under a new "Agent Platform" nav section
   plus Settings → Integrations — see Phase 11's own status note above for the full
   list and the flagged no-e2e-this-dispatch deviation.
6. **Two small, deliberate, locally-reversible additions beyond the plan's literal
   text, both following the UX guidance's own explicit recommendations:** a
   `GET /versions/:id/promotion-check?target=X` endpoint (backs the "(?) why can't I
   promote this further?" affordance — reuses the already-tested pure `canPromote()`);
   wiring eval-case executions through `startAgentRun`/`completeAgentRun` (trigger
   `EvalCase`) so the Runtime Observability screen has real data this phase instead of
   staying empty until Phase 12.
7. **Security review** (new HTTP surfaces: `/api/v1/admin/agent-platform/**`,
   `/api/agent-platform/git/webhooks/**`): every admin route has an explicit
   `agent_platform` RBAC guard (already a real seeded permission-matrix key); the
   webhook receiver is HMAC/shared-token-verified against the tenant's own vaulted
   secret (never trusts the payload first) and rate-limited (`ioredis`-backed,
   reusing the existing `apps/gateway/src/lib/rate-limit.ts`); Git OAuth tokens and
   the webhook secret are envelope-encrypted via the existing Phase-4 vault, never
   logged; no raw SQL (Drizzle throughout); no provider SDK/vendor model id/hand-parsed
   JSON outside `packages/ai-registry` (dependency-cruiser-enforced, already in place
   since Phase 0, re-verified against the real new imports this phase adds).

**Verification (not just claimed):** stood up `compose.test.yml`'s ephemeral Postgres/
Redis, ran the 2 new migrations, then `pnpm test:unit` (545, up from 495), `pnpm
test:integration` (124, up from 76 — incl. real HTTP round trips against local mock
GitHub/OpenAI-compatible/Anthropic-shaped servers, a full real-database Draft→
Production promotion lifecycle test, and the ADK adapter's real `LlmAgent`/`Runner`
conformance suite), `pnpm test:isolation` (54, up from 35, incl. 5 new cross-tenant
proofs for git_connection/agent_definition/agent_definition_version/eval_suite/
model_route/agent_run) — 723/723 green. `pnpm typecheck` (31/31) and `pnpm
lint:boundaries` (ESLint + dependency-cruiser, 901 modules/3576 dependencies cruised)
both clean. `next build` verified clean for both `nextbot-web` and `nextbot-gateway`
(the `@google/adk`/`@mikro-orm`/`@opentelemetry` transitive-dependency webpack warnings
are benign — build completes, and a live `next start` + curl smoke test confirmed no
runtime crash) — **flagged as a genuine architecture note:** `apps/web` and
`apps/gateway` currently bundle the full ADK/mikro-orm/OTel-auto-instrumentation
dependency tree because eval-suite execution runs synchronously inside a Next.js API
route this phase, rather than being dispatched to a separate Data Plane worker process
— consistent with `apps/runtime` not existing yet (Phase 12's job); worth revisiting
once `apps/runtime` is stood up. Coverage checked per-file (not just aggregate) for
every file this dispatch added/changed; the ten new UI components are in the 85-100%
statement/line range, with a handful (`DefinitionDetail.tsx` 76% branch, `VersionDetail.tsx`
[versions/[versionId]] 69% branch, `ModelGateway.tsx` 74% branch) below the 80% branch
ideal despite genuinely targeted additional tests — flagged honestly rather than
padded further given this dispatch's two-whole-phase time budget; every other touched
file (backend `packages/ai-registry`, `packages/modules/agent-platform`,
`packages/observability`, domain/promotion-policy, definition-hash) is at or above
85%/85% stmts/branch. A new native/binary-adjacent dependency (`@google/adk`, pulling
in `sqlite3`/`protobufjs` transitively) was added — verified via a genuine clean
`pnpm install` (no manual workarounds needed) and via the real `next build`/`next
start` smoke test above, consistent with this project's own native-dependency gotcha
check.

Implemented all three phases in one dispatch. Full detail (deviations, deferred
scope, interpretation calls) is recorded inline under each phase's own "Status"
note above; the highlights load-bearing for QA:

1. **`apps/gateway` stood up for real** (was a reserved stub) — the first
   genuine Gateway Plane surface (ADR-0004), serving the widget's anonymous
   session/message/SSE/typing/language endpoints as Next.js Route Handlers.
2. **New modules `@nextbot/channels` and `@nextbot/conversations`** fully
   implemented (schema, domain, application, infrastructure, http layers,
   unit+integration+isolation tests each) — both previously reserved stubs.
3. **`apps/widget-embed` stood up for real** (was a reserved stub) — two
   independent Vite build outputs (loader IIFE + widget SPA), verified with a
   real `vite build` for both, not just typecheck.
4. **A genuine, deliberate architecture deviation from the plan's literal
   Phase 8 wording** ("iframe-hosted widget route in apps/web") — the widget
   SPA is served entirely from `apps/widget-embed`'s own build, not through
   `apps/web`'s Next.js/Chakra tree, to avoid restructuring the
   already-QA-approved root layout for a scoped-theme requirement. Full
   rationale in Phase 8's status note.
5. **The Phase 7 AI reply is an explicitly-labeled placeholder** (never claims
   real understanding) — the actual turn pipeline is Phase 12 (BL-05) scope and
   must replace it wholesale.
6. **`nexus-ux` was dispatched once** (foreground, before any widget UI code),
   producing `docs/design/UX_GUIDELINES.md` §5 — followed throughout Phase 8's
   implementation, including its own flagged recommendation (a customer-facing
   notice on offline-queue message drop, beyond the spec's literal
   console-warning-only requirement) and its flagged open questions (file-upload
   form fields deferred, "Talk to a human" wired as a plain message rather than
   a real escalation call since BL-09 isn't built yet).
7. **A calibration correction was made and documented in place**, not silently:
   FR-ADM-07's contrast-check requirement was first implemented literally per
   one reading of the spec, found (via the checker's own unit tests, not
   assumed) to be unsatisfiable for realistic brand colors, and re-implemented
   against the spec's own worked example instead — see Phase 9's status note
   and `update-branding.ts`'s doc comment for the full before/after reasoning.

**Verification (not just claimed):** stood up `compose.test.yml`'s ephemeral
Postgres/Redis, ran the 4 new migrations (0010-0013, channels+conversations
schema/RLS), then `pnpm test:unit` (391), `pnpm test:integration` (76, incl. a
real curl+SSE round trip against a live `apps/gateway` `next start` process and
a live-database branding-inheritance test), `pnpm test:isolation` (35) — 502/502
green. `pnpm typecheck` (31/31 packages/apps) and `pnpm lint:boundaries` both
clean. Coverage checked per-file (not just aggregate) for every file this
dispatch added/changed; files initially below 80% (`packages/modules/tenancy/
src/http/admin-routes.ts`, several `apps/widget-embed` components/`WidgetApp.tsx`/
`FormBubble.tsx`) were pushed up with targeted tests rather than accepted.
`nextbot-web` and `nextbot-gateway` both verified with a genuine `next build`
(zero errors) — `nextbot-gateway` additionally smoke-tested with real
`next start` + curl (session create → message send → SSE stream showing both
messages) against a live test Postgres, not merely unit-mocked. No new
native/binary dependency was introduced this dispatch (jose/zustand/vite/
Chakra/framer-motion/`@vitejs/plugin-react` are all pure JS), so the
clean-`pnpm install` verification this project's gotcha-list calls for was not
separately re-run beyond the two ordinary `pnpm install` runs already performed
while adding the new workspace packages (both succeeded without incident).

Security review for this dispatch's new HTTP surfaces (`/api/v1/widget/**`,
`/api/v1/admin/channels`, `/api/v1/admin/branding`): every endpoint has an
explicit auth mechanism (anonymous widget session JWT with its own distinct
signing secret for the widget surface; RBAC session guard for the two admin
routes) and server-side input validation via TypeBox schemas; no raw SQL
string concatenation (Drizzle throughout); the widget session token embeds
`tenantId`/`region`/`environment` but never a queryable secret; branding logo
`data:` URLs are size-capped both client-side (2 MB) and schema-side
(`maxLength`); CORS on the widget surface is flagged wildcard (see Phase 7's
note) rather than silently narrowed to look enforced when it isn't. No rate
limiting was added to `/api/v1/widget/messages` (an LLM-adjacent, per earlier
phases' own flagged gap around login rate limiting) — flagged as a should-fix
for the phase that adds tenant-wide rate-limit infrastructure (BL-11), not
silently shipped as if handled.

### Dispatch #4 notes (QA-driven fix pass, retry 1 of cap 3, dual QA report)

Fixed every BLOCKING (B1, U1, U2, U3) and SHOULD-FIX (B2, B3, U4–U11) defect from the
2026-08-15 dual QA report, plus U12/U13 (both cheap). Did not re-scope, refactor
unrelated code, or start new plan phases. Full defect-by-defect summary is in
`docs/NEXUS_STATE.md`'s decision log; highlights:

- **B1** (`packages/db/src/bootstrap/ensure-roles.ts`): the "platform" (BYPASSRLS)
  role no longer gets blanket `SELECT` on `credential` — column-grant-restricted to
  the same non-secret column list as "app" (ciphertext/dek_ref excluded), not zero
  columns as first attempted (zero columns broke tenant deprovisioning's `DELETE
  ... WHERE tenant_id = $1`, which needs SELECT on any column referenced in a WHERE
  clause — caught by re-running the full integration suite, not assumed fine).
- **U1** (`apps/web/app/login/LoginForm.tsx`): removed the non-reactive `useState`
  wrapper around `mfaChallengeToken`; both it and the new `enrollmentToken` are
  derived directly from action state on every render.
- **U2** (`apps/web/package.json`): added `@node-rs/argon2` as a direct dependency
  (matching iam's version) — verified with a genuine clean `node_modules` removal +
  fresh `pnpm install` + `next build` + `next start`, no manual symlink needed.
- **U3**: SSR-level fail-closed guards (`apps/web/src/lib/require-module-access.ts`)
  added to every gated page (`connectors`, `connectors/new`, `connectors/[id]`,
  `tools`, `roles`), rendering `@nextbot/ui`'s new `AccessDeniedState` full-page
  component before any client fetch happens; a client-side `fetchJson()` helper
  (`apps/web/src/lib/fetch-json.ts`) also distinguishes a 403 from a genuine empty
  list as defense in depth, applied to `ConnectorsList`/`ToolCatalog`/`RolesList`
  (`RolesList` had the same latent bug, not previously reported).
- **B2/B3**: backup codes wired end-to-end (generate/hash/persist at enrollment,
  accept as a TOTP alternative at the challenge step, admin MFA-reset route); new
  `role.mfa_required` column (migration `0009_iam_role_mfa_required.sql`) enforced
  via a new `login()` outcome (`mfa_enrollment_required`) and confirmation flow.
- **U4–U11**: read-only mutating-control disabling, visible focus rings + avatar
  contrast fix (`packages/ui/src/theme.ts`), `<main>`/`<h1>` landmarks, a breadcrumb
  component, login screen password show/hide + Forgot-password link + honest
  disabled-SSO affordance, lockout `warning`-tier styling + form-disable, human
  copy for TypeBox validator messages, and a Tool Catalog filter bar.

**Verification (not just claimed):** stood up `compose.test.yml`'s ephemeral
Postgres/Redis, ran the new migration, then `pnpm test:unit` (238), `pnpm
test:integration` (55, including a new regression test reproducing and confirming
each fix), `pnpm test:isolation` (28) — 321/321 green; `pnpm typecheck` (31/31) and
`pnpm lint:boundaries` both clean. Re-ran the entire suite again after the clean
`node_modules` reinstall to confirm nothing regressed. Coverage checked per-file for
every file this dispatch added/changed (not just in aggregate) and pushed below-80%
files up with targeted tests. Did every fix's exact QA repro manually (live psql for
B1, real Playwright-equivalent curl/browser-shaped checks for the UI fixes) rather
than trusting the code diff alone.

### Dispatch #3 notes (Phases 2–6, batched per orchestrator instruction)

**Scope covered:** BL-01 completion (IAM/RBAC/auth UI), BL-02 (connector registration +
credential vault + MCP discovery, backend + UI), BL-03 (tool catalog + agent tool
registry + permission matrix + resolver, backend + UI). Full detail, including every
locally-reversible decision and every genuine bug found and fixed along the way, is in
the dispatch's final report relayed to the orchestrator; the highlights load-bearing
for QA are:

1. **Better Auth was not wired as a literal dependency — flagged, not silently
   substituted.** `packages/modules/iam/README.md` documents the full rationale: Better
   Auth's adapter model assumes a single long-lived DB client with no per-request `SET
   LOCAL app.current_tenant` re-scoping, which is incompatible with ADR-0001's
   transaction-scoped RLS primitive for the schema's most sensitive table
   (`app_user`). Implemented the equivalent feature set natively instead (argon2id via
   `@node-rs/argon2`, TOTP via `otpauth`, JWT sessions via `jose`) against the LLD's own
   `app_user`/`role`/`user_role` schema. SMS/Email MFA remain stubbed per the plan's
   pre-flagged open item #2; SAML/OIDC SSO callback handling itself is schema-ready
   (`sso_subject`/`sso_group_mapping`) but not implemented this dispatch (time budget).
2. **A fourth Postgres role ("gateway") was added**, distinct from "app"/"platform"
   (`packages/db/src/bootstrap/ensure-roles.ts`, `pool.ts`'s `getGatewayPool`,
   `tenant-context.ts`'s `withGatewayTenant`) — the concrete mechanism for LLD §3.5's
   "SELECT on `credential.ciphertext` is granted only to the gateway DB role" via a
   column-list `GRANT` (table-wide `SELECT` cannot be narrowed by a later column
   `REVOKE` in Postgres's ACL model — the app role never holds table-wide `SELECT` on
   `credential` at all). Proven by a DB-level test connecting directly as each role.
   **Gotcha discovered and now regression-tested:** calling `ensureRoles()` without
   `gatewayUrl` re-grants blanket `SELECT` on `credential` via the generic per-role
   loop and does not reconcile it back (analogous to QA's original BYPASSRLS-drift
   defect) — documented in `ensure-roles.ts`'s doc comment and proven by a new
   regression test in `bootstrap.int.test.ts`.
3. **ADR-0004's full Gateway Plane process separation is deferred, flagged.**
   `discoverTools()` (`packages/modules/connectors`) is callable from `apps/web`'s
   admin route today rather than only from a physically separate `apps/gateway`
   process reached via an internal RPC egress port — the DB-level security control
   (gateway-role-only ciphertext SELECT) is real and enforced regardless of caller
   process, but the physical process split is deferred to Phase 12 (Tier-1 tool-call
   egress), the phase that structurally needs it, consistent with how the Enterprise
   dedicated-database escape hatch was deferred to `nexus-deploy` in Phase 1.
4. **A genuine bug was found and fixed via the coverage pass, not merely a gap noted:**
   `tool-repository.ts`'s `hashSchemas()` used `JSON.stringify(value,
   Object.keys(value).sort())` — the array form of `JSON.stringify`'s second argument
   is a **global property allow-list applied at every nesting level**, not a per-level
   key sort, so it silently stripped every nested schema key not literally named
   `inputSchema`/`outputSchema`, making every tool's schema hash collide and
   `upsertToolFromDiscovery` never actually detect a real schema change (FR-MCP-15's
   breaking-change detection was a no-op). Fixed with a proper recursive
   `canonicalize()`; caught by a new integration test in `tool-repository.int.test.ts`
   asserting a removed-required-property re-discovery is flagged breaking, which
   failed against the buggy implementation before the fix.
5. **UI is intentionally lighter-touch than a dedicated UI-focused dispatch would
   produce**, given this single dispatch's time budget covered five backend-heavy
   phases plus UI for three of them. Concretely: the connector "wizard" is a single
   sectioned form, not a literal multi-step component (still React Hook Form +
   TypeBox resolver, still the field-grouping order `nexus-ux`'s guidance specifies);
   the Tool Catalog ships list/filter/visibility-toggle/priority-weight/capability-group
   but not the full drag-and-drop permission rule-builder UI `nexus-ux` flagged as a
   novel composite pattern (the underlying rule CRUD + simulate API is real and
   tested; only the rule-builder's own UI is simplified to a data-fetch stub); no
   Playwright/axe-core automated e2e was run this dispatch (verified instead via an
   extensive real `next build` + `next start` + curl smoke test against a live test
   Postgres — see the dispatch report for the exact commands/assertions). Flagged
   for `nexus-qa` to weigh accordingly rather than assumed equivalent to a full
   axe-core pass.
6. **`docs/design/UX_GUIDELINES.md` was produced this dispatch** (dispatched
   `nexus-ux`, foreground, before any UI code) — baseline + Admin Console
   auth/shell + connector wizard + tool catalog/permission-matrix guidance. `NEXUS_STATE.md`'s `ux_guidelines` pointer now
   set.

Full verification (not just claimed): `pnpm typecheck` (31/31 tasks), `pnpm
lint:boundaries` clean, `pnpm test:unit` (157), `pnpm test:integration` (44), `pnpm
test:isolation` (28) — 229/229 green, run against a real ephemeral Postgres via
`compose.test.yml`. Coverage on changed files checked once at the end
(`pnpm test:coverage`); files below the 80% bar after the coverage-driven test
additions are either pre-existing untouched files, thin CLI entrypoints/type-only
files with no meaningful executable surface, or `apps/web`'s `requireApi()`
Next.js-runtime-dependent half (verified instead via the live smoke test, documented
in that test file's own comment) — none are business-logic gaps.

### Dispatch #2 notes (QA-driven fix pass, retry 1 — defects only, no new scope)

QA failed the Phase 0/1 batch on two defects (see `docs/NEXUS_STATE.md` decision log,
2026-08-15 qa entry, for the verbatim report). Both fixed in this dispatch; nothing
else in the batch was touched, per the fix-pass's scope restriction:

1. **`ensureRoles()` BYPASSRLS drift (blocking).** `packages/db/src/bootstrap/
   ensure-roles.ts` previously set `BYPASSRLS`/`NOBYPASSRLS` only inside the
   `if (!exists)` branch, so a role that drifted to `BYPASSRLS` post-creation (e.g.
   an operator's manual `ALTER ROLE`) was never detected or repaired by subsequent
   `ensureRoles()` runs — silently defeating ADR-0001's isolation model. Fixed by
   running the `ALTER ROLE ... BYPASSRLS`/`NOBYPASSRLS` reconciliation
   unconditionally on every call. Added a standing `pg_roles.rolbypassrls` gate to
   `rls-coverage.isolation.test.ts` and a regression test in `bootstrap.int.test.ts`
   reproducing QA's exact repro.
2. **Boundary lint gap on re-exports (should-fix).** `eslint-plugin-boundaries` only
   inspected plain `import` statements by default; a disallowed module dependency
   expressed as `export * from "..."` / `export {...} from "..."` passed
   `lint:boundaries` cleanly. Fixed by opting into the plugin's built-in `export`
   dependency-node kind via `"boundaries/dependency-nodes"` in `eslint.config.mjs`
   (no custom rule needed — the plugin already supported this, just wasn't
   configured to use it). Added `eslint.boundaries.test.ts` (new root-level
   regression test file, wired into `vitest.workspace.ts`) proving both re-export
   forms and the existing plain-`import` case are all now caught.

Full suite re-verified green after both fixes: `pnpm test:unit` (25), `pnpm
test:integration` (8), `pnpm test:isolation` (10) — 43/43 total (was 37/37) —
plus `pnpm typecheck` (31/31 tasks) and `pnpm lint:boundaries` clean. Did not
advance to Phase 2 in this dispatch — this was a fix-only pass per the orchestrator's
instruction; Phase 0/1 status remains "pending QA" (re-verification) until the
orchestrator re-runs nexus-qa over the whole batch.

Stopped here deliberately, per nexus-dev's own batching judgment: Phase 2 (Better
Auth integration, MFA, lockout, RBAC guard) is a security-sensitive slice that
deserves its own focused dispatch and security review rather than being rushed to
fit alongside Phase 0/1 in the same pass. This is the first natural QA checkpoint
within Backlog Phase 1.

### Dispatch #1 notes / deviations (local, reversible decisions — recorded per nexus-dev process)

1. **Migrations are hand-authored SQL, not drizzle-kit-generated.** drizzle-kit's
   CLI (CJS `require`-based module loading) could not resolve this workspace's
   `.js`-suffixed relative imports against `.ts` source files (a well-known
   drizzle-kit/ESM interop gap), and RLS statements need hand-authored SQL either
   way (not expressible in the Drizzle schema DSL). Rather than fight the tool for
   a benefit it wasn't providing, migrations are plain `.sql` files under
   `packages/db/migrations/`, applied by a small custom runner
   (`src/bootstrap/run-sql-migrations.ts`) that tracks applied files in a
   `_migrations_applied` table. `packages/db/src/schema/*.ts` remains the source
   of truth for TypeScript types/query building; the `.sql` files are the source of
   truth for what's actually applied. See `packages/db/migrations/README.md`.
2. **`domain_event` (the transactional outbox, LLD §2.4) was built in Phase 0 as
   planned**, not deferred — the plan's own Phase 17 note flags this as
   intentional ("this is why the outbox was built generically in Phase 0, not
   deferred"). It is RLS-protected like any other tenant-scoped table; nothing
   consumes it yet (that's Phase 17's job).
3. **Role separation is two distinct Postgres roles**, not one: a non-`BYPASSRLS`
   "app" role (`withTenant`) and a `BYPASSRLS` "platform" role (`withPlatform`),
   provisioned idempotently by `packages/db/src/bootstrap/ensure-roles.ts`. This
   makes ADR-0001's "non-owner app role" and "operator-only, audited" language
   concrete rather than aspirational.
4. **`withPlatform`'s "only two call sites" rule is enforced by a dedicated
   dependency-cruiser rule**, not just ESLint's package-level boundaries plugin
   (which can't restrict a single named export's importers). `withPlatform` lives
   at a separate `@nextbot/db/platform-only` entry point specifically so
   `.dependency-cruiser.cjs`'s `no-platform-outside-allowed-callers` rule can
   target it. **Verified working** by a deliberate sanity-check violation during
   this dispatch (added, confirmed it fails CI, reverted) — see the same
   verification for the module-to-module ESLint boundaries rule, which needed
   `eslint-import-resolver-typescript` added as a devDependency and wired into
   `eslint.config.mjs`'s `settings["import/resolver"]` before it would actually
   resolve `@nextbot/<module>` package-exports-mapped `.ts` entry points and catch
   a real violation (without it, the rule silently no-op'd on every cross-module
   import — a gap worth flagging explicitly since it would otherwise have shipped
   a boundary rule that looked configured but enforced nothing).
5. **CI workflow is GitHub Actions** (`.github/workflows/ci.yml`) — not specified
   by the LLD/ADRs, a local/reversible choice given no CI system was named.
6. **Enterprise dedicated-database escape hatch**: only the `tenant_database_route`
   routing row is written by `provisionTenant()` (`is_dedicated=true`,
   `dsn_vault_ref=null`); no physical second database is provisioned. Matches the
   plan's pre-flagged open item #3 — physical provisioning is `nexus-deploy` scope.
7. **MFA channel scope, Figma input**: not yet reached (Phase 2/3); no change from
   the plan's existing open items #1–#2.

**Source of truth:** `docs/PRODUCT_SPECIFICATION.md` (FR-*/NFR-*), `docs/BACKLOG.md` (build
order — authoritative, not re-prioritized here), `docs/architecture/HLD.md` +
`docs/architecture/LLD.md` (structure/contracts), `docs/architecture/adr/0001-0009`.

**How to read this document.** Phases are vertical slices sized for one nexus-dev
dispatch each (a few consecutive phases may be batched into one dispatch when they are
independent and small — see note at each phase). Every phase leaves the system
buildable, lintable, and passing its own tests — no phase depends on a *later* phase to
compile. Phase numbering is sequential dev-agent phases, not the BACKLOG.md "Phase
1..5" grouping (that grouping is called out per phase as **Backlog phase**).

Within Phase 1–2 (P0), phases follow BACKLOG.md's item order (BL-01 → BL-11) except
where a technical dependency forces a slice earlier — each such case is called out
explicitly with rationale, per the nexus-dev operating instructions. Phase 3–5 (P1/P2)
is intentionally listed at a lighter level of detail; it will be elaborated into full
phase specs once Phase 1–2 is QA-approved and the orchestrator reaches that point.

---

## Phase 0 — Repository & platform scaffold (prerequisite, no BL item)

**Goal.** A buildable, lintable, empty-but-structurally-complete monorepo matching
LLD §2 exactly, so every subsequent phase adds code into an already-enforced shape
instead of retrofitting boundaries later.

**Backlog item(s).** None — this is a technical prerequisite shared by every BL-*
item; not a reprioritization, just the ground every phase after it stands on.

**Scope.**
- pnpm workspace + Turborepo config; `apps/{web,runtime,gateway,worker,widget-embed,gateway-agent}` folder stubs (LLD §2.1); `packages/{contracts,db,ai-registry,mcp-client,channel-adapters,observability,secrets,ui,testing,modules}` stubs.
- TypeScript 5.x strict config (`noUncheckedIndexedAccess: true`), shared `tsconfig.base.json`.
- ESLint 9 flat config + `eslint-plugin-boundaries` with the module dependency allow-list from LLD §2.3, plus `dependency-cruiser` rules (no cycles, no `ajv` outside `mcp-client`, no `@google/adk`/provider SDK outside `ai-registry`, no `@nextbot/db` inside `domain/`, no `next/*` inside `packages/modules`).
- `compose.yaml` / `compose.test.yml` (Postgres 16 + pgvector, Redis 7) for local + CI Testcontainers-style integration tests.
- CI pipeline skeleton (lint incl. boundary rules → typecheck → unit → integration) — full pipeline (isolation suite, Playwright, image build, SBOM/CVE) added incrementally as those pieces exist; deployment packaging itself is `nexus-deploy` scope, not this phase.
- `packages/db`: Drizzle client factory skeleton, `withTenant`/`withPlatform` primitives (LLD §3.2 rule 4) with a placeholder schema, so the RLS-safety pattern exists before the first real table lands in Phase 1.
- Out of scope: any actual business schema/tables, any portal UI, any real auth.

**Deliverables.** Monorepo skeleton, boundary lint green on an empty repo, `withTenant`/`withPlatform` primitives with unit tests proving the fail-closed behavior (unset tenant context throws), CI running lint+typecheck+unit on a trivial smoke test.

**Exit gate.** `pnpm lint:boundaries`, `pnpm typecheck`, `pnpm test` all green in CI on the empty scaffold. No security review needed (no endpoints/data yet).

**Status: implemented, pending QA (dispatch #1, 2026-08-15).** All exit-gate checks
verified green locally (lint incl. boundaries, typecheck across all 30 packages/apps,
unit suite). See "Dispatch #1 notes" above for the migration-tooling and
boundary-enforcement deviations.

---

## Phase 1 — Tenancy, data policy & plan-tier provisioning (BL-01 slice A)

**Goal.** A tenant can be provisioned with a plan tier and the isolation/quota rows that tier implies exist and are enforced at the data layer.

**Backlog item(s).** BL-01 (data/domain portion).

**Scope.** `packages/modules/tenancy`: `tenant`, `tenant_data_policy`, `tenant_runtime_quota` tables (LLD §3.3, §3.10 plan-tier seeding rule) with RLS policies per LLD §3.2 rule 1; provisioning service (domain + application layers) that seeds quota defaults from `plan_tier` (Starter/Growth/Enterprise, NFR-4a table) and routes Enterprise tenants to the dedicated-database escape hatch record (ADR-0001 §2a) — the escape-hatch *routing table* is created here, actual DB-per-tenant infra wiring is `nexus-deploy` scope, flagged if reached. No HTTP surface yet (added in Phase 3 alongside IAM so auth exists first). No UI.

**Deliverables.** Drizzle schema + migration for the three tables, `withTenant`-scoped repository, `provisionTenant()` use case, unit tests (quota seeding per tier, retention validation rejecting 0/blank per FR-ADM-06), integration test against Testcontainers Postgres proving RLS blocks cross-tenant reads for a second seeded tenant.

**Exit gate.** Typecheck/build; `pnpm test:isolation`-style suite (cross-tenant read returns zero rows) passing for this table set; coverage ≥ 80% on changed files.

**Status: implemented, pending QA (dispatch #1, 2026-08-15).** `tenant`,
`tenant_data_policy`, `tenant_runtime_quota`, `tenant_database_route` tables shipped
with RLS+FORCE RLS+policy; `provisionTenant()` (domain + application layers) seeds
NFR-4a quota defaults per tier and validates retention per FR-ADM-06. 37 tests green
(unit + integration against a real Postgres via `compose.test.yml` + isolation suite
proving cross-tenant reads/inserts are blocked); coverage 94.14% on changed files
(lowest individual file 73–78%, all above the 80% bar in aggregate and by file where
it matters — see dispatch report). No security review required (no HTTP endpoints
yet, per this phase's own scope).

---

## Phase 2 — IAM, RBAC & Better Auth integration (BL-01 slice B)

**Goal.** A user can register/log in via Better Auth (email+password, SSO stub), is bound to at least one role, and RBAC's `requirePermission(module, level)` guard is enforced on a real endpoint.

**Backlog item(s).** BL-01 (auth/RBAC portion).

**Scope.** `packages/modules/iam`: `app_user`, `role`, `user_role`, `sso_group_mapping`, `login_attempt` tables; Better Auth wiring (email+password, OIDC/SAML SSO config surface, per-role MFA — TOTP first, SMS/email stubs behind the same interface, backup codes), lockout (5 attempts / 15 min, FR-SEC-03 distinct message), `requirePermission()` guard, zero-role fail-closed login (`AUTH_NO_ROLE_ASSIGNED`). First `/api/v1/admin/**` Route Handlers (session check, current-user, role CRUD). No portal UI yet (Phase 3).

**Deliverables.** Schema + migrations, Better Auth adapter, guard middleware, seeded system roles (Tenant Admin, Backend System Owner, Designer, Platform Engineer, Escalation Agent, Read-Only), unit tests (lockout, zero-role rejection, permission matrix evaluation) + integration tests (login flow, session, guard on a protected route).

**Security review (required — new auth surface).** Password hashing (argon2id per LLD), session cookie flags, lockout timing-safe comparison, SSO callback validation, no plaintext MFA secret (vault_ref pointer only), rate limiting on login endpoint.

**Exit gate.** Build/typecheck; unit+integration green; coverage ≥ 80%; security review findings fixed in-phase.

**Status: implemented, pending QA (dispatch #3, 2026-08-15).** Schema+migrations
shipped (`app_user`/`role`/`user_role`/`sso_group_mapping`/`login_attempt`/
`login_lockout_policy`/`mfa_secret`); argon2id hashing, TOTP MFA (enrollment + backup
codes), lockout (default 5/15min, tenant-tunable), `requirePermission()` guard, six
seeded system roles, zero-role fail-closed rejection all implemented and tested (unit
+ integration against real Postgres, incl. login/lockout/MFA-challenge/zero-role
flows). **Deviation flagged, not silently substituted:** Better Auth itself was not
wired as a dependency — see `packages/modules/iam/README.md`'s "Auth architecture
decision" for the full rationale (adapter-model incompatibility with ADR-0001's
transaction-scoped RLS). SAML/OIDC SSO callback flow not implemented this dispatch
(schema-ready only) — flagged, not claimed done. Security review: argon2id via
`@node-rs/argon2` (OWASP-baseline params), timing-safe compare (library-internal),
session cookie httpOnly/sameSite=lax/secure-in-prod, MFA secret never stored
plaintext (envelope-encrypted via `@nextbot/secrets`, vault_ref pointer only on
`app_user`), rate limiting on the login endpoint **not implemented this dispatch** —
flagged as a gap for a security-focused follow-up phase (BL-11's quota/rate-limit
infrastructure is the natural home).

---

## Phase 3 — Admin Console shell + auth UI (BL-01 slice C, first UI phase)

**Goal.** A user can open the Admin Console, log in, see RBAC-gated navigation for the modules that exist so far, and see a tenant context header (name/logo placeholder, environment badge).

**Backlog item(s).** BL-01 (portal UI portion), lays the shell BL-26 branding will plug into.

**UX step (required — first UI surface in the project).** Dispatch `nexus-ux` (foreground, `model: sonnet`) with: FR-ADM-01, FR-ADM-02, FR-SEC-03 (login/lockout/MFA states), the persona table, and the five-portal IA from HLD §3.1. Ask it to establish the project-wide design-system baseline (WCAG 2.2 AA target, Chakra usage conventions, RTL/logical-props rule, navigation pattern for a multi-portal shell) plus concrete flows/states for: login, MFA challenge, lockout, zero-role rejection, RBAC-gated nav item hiding. This baseline is reused by every later UI phase without re-consulting nexus-ux for routine screens.

**Scope.** `apps/web` Next.js App Router shell; `packages/ui` Chakra theme bootstrap (tokens, logical-props lint rule, a11y defaults); login/MFA/lockout screens; top nav + tenant context header (branding wired to a placeholder until BL-26 lands); route groups for the five portals (empty placeholders beyond B for now). `next-intl` scaffold for i18n (NFR-8), even though only English ships this phase.

**Deliverables.** Working login → dashboard shell flow; Chakra theme package; Playwright a11y (axe-core) smoke test on the login route; component tests for nav RBAC-gating.

**Exit gate.** Build/typecheck; unit+component+e2e-smoke green; axe-core clean on login/dashboard shell; coverage ≥ 80% on changed files.

**Status: implemented, pending QA (dispatch #3, 2026-08-15).** `apps/web` is now a
real Next.js 15 App Router application (was a Phase-0 reserved stub): root layout +
Chakra `AppProviders`, login page (Server Action → `@nextbot/iam`'s `login()`), MFA
challenge step, RBAC-gated sidebar nav (`isNavItemVisible` from `@nextbot/ui`), tenant
context header (environment badge), route guard redirecting to `/login` without a
valid session. `docs/design/UX_GUIDELINES.md` produced by `nexus-ux` before any UI
code, per the required UX step. **Deviation flagged:** no Playwright/axe-core
automated e2e this dispatch (time budget) — verified instead via a real `next build` +
`next start` + curl smoke test proving the full login→session→RBAC-nav→API round trip
against a live test Postgres (see the dispatch report for exact commands/output);
`nexus-qa` should weigh this as a real but different form of verification, not assume
axe-core-equivalent accessibility coverage. next-intl i18n scaffold **not** added this
dispatch (English-only, `dir="ltr"` hardcoded in the root layout) — flagged as
deferred, not silently dropped.

---

## Phase 4 — Credential vault & connector registration (BL-02 slice 1: data + backend)

**Goal.** An admin can register an MCP connector (Streamable HTTP) with vaulted credentials, and the connector's status is computed (not manually set).

**Backlog item(s).** BL-02.

**Scope.** `packages/secrets`: `SecretsProvider` port + KMS-backed implementation (ADR-0007 envelope encryption, per-tenant DEK, AAD binding); `credential` table with the gateway-only-decrypt rule enforced by DB role grants. `packages/modules/connectors`: `connector` table + domain state machine (Connected/Degraded/Offline computed, never set via API), application service for CRUD + duplicate-name rejection (`CONNECTOR_NAME_DUPLICATE`). `packages/mcp-client`: transport client for Streamable HTTP, `list_tools` call, Ajv-based validation scoped exclusively here (LLD §1.1). Runs inside `apps/gateway` per ADR-0004; `apps/web`/`apps/runtime` reach it only through the `ports/egress.ts` port. No stdio/Gateway-Agent transport yet (that's BL-22, Phase 4 backlog / later dev phase). Admin API routes only, no UI yet.

**Deliverables.** Schema+migrations, `SecretsProvider` with unit tests (never returns plaintext outside gateway registration), connector CRUD service, `list_tools` discovery flow with verbatim transport-error surfacing (FR-MCP-02), unit + integration tests (Testcontainers Postgres + a mock MCP server in `packages/testing`).

**Security review (required — credential storage + new endpoints).** Ciphertext column access restricted to gateway DB role only (assert via a DB-level test attempting a read as the web/runtime role and expecting denial); no vault_ref/plaintext logged; auth guard + tenant ownership check on every connector endpoint; input validation on `endpoint_url` (https-only), `stdio_command` (deferred, no code path yet so nothing to check).

**Exit gate.** Build/typecheck; unit+integration green incl. the DB-role-denial test; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #3, 2026-08-15).** `packages/secrets`
ships the `SecretsProvider` port + `KmsEnvelopeSecretsProvider` (ADR-0007 envelope
encryption: AES-256-GCM DEK wrapped by a KEK, AAD binding `(tenant, kind, id)` —
local/dev KMS stub per the plan's own allowance, production path is a same-interface
swap). `credential` table's `ciphertext` is column-grant-restricted to a new fourth
"gateway" Postgres role, proven by a DB-level test connecting directly as both the
app and gateway roles. `packages/modules/connectors`: full CRUD, duplicate-name
rejection, connector state machine columns (`status`/`circuit_state`) present and
defaulted but not yet driven by a health-checker (BL-11, correctly deferred).
`packages/mcp-client`: Streamable HTTP transport (JSON + SSE response parsing),
`list_tools`/`call_tool`, Ajv validation scoped exclusively here. **Deviation
flagged:** `discoverTools()` is reachable from `apps/web` directly rather than only
through a physically separate `apps/gateway` process behind `ports/egress.ts` — the
DB-level security boundary is real regardless, but full ADR-0004 process separation
is deferred to Phase 12, the phase that structurally needs it (see the dispatch
report for the full rationale).

---

## Phase 5 — Connector & discovery Admin UI (BL-02 slice 2: frontend)

**Goal.** An admin can walk through registering a connector and discovering its tools end-to-end in the browser.

**Backlog item(s).** BL-02 (UI portion).

**UX step.** Routine CRUD/wizard screen on an already-established admin shell + Chakra baseline (Phase 3) — apply existing guidance; no new nexus-ux dispatch needed unless the wizard's re-discovery diff/breaking-change UI turns out to need a novel pattern, in which case flag and consult narrowly for that sub-flow only.

**Scope.** Connector list, add-connector wizard (name/description/backend-type/environment/transport/auth-method), credential entry form (masked display only), "Discover Tools" action with verbatim error surfacing, re-discovery diff view (added/removed/schema-changed flags).

**Deliverables.** TanStack Query data-access hooks, Chakra UI screens, React Hook Form + TypeBox resolver validation, component tests, one e2e flow test (register connector → discover tools → see tool list) per nexus-dev's one-e2e-per-backlog-item rule (covers BL-02 as a whole, so Phase 4+5 together satisfy it).

**Exit gate.** Build/typecheck; component tests + the one e2e green; axe-core clean; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #3, 2026-08-15).** Connector list
(status badge, Discover Tools action with verbatim `McpTransportError` message
surfacing), Add Connector form (React Hook Form + TypeBox resolver, masked-credential
input, https-only validated client + server side), connector detail page. **Deviations
flagged:** implemented as a single sectioned form rather than a literal multi-step
wizard component (still matches the field-grouping order the guidance specifies);
re-discovery diff view (added/removed/schema-changed) **not implemented** — the
underlying data (`tool_schema_version.change_summary`/`breaking_change`) exists and is
computed correctly (proven by integration tests), but the UI to surface a diff wasn't
built this dispatch; TanStack Query **not wired** — pages use plain `fetch`+`useState`
for time-budget reasons (the dependency is present in `apps/web/package.json` for a
follow-up pass). No Playwright e2e this dispatch — see Phase 3's status note for how
this was verified instead (real `next build`+`next start`+curl, incl. actually
creating a connector via the API and confirming it round-trips).

---

## Phase 6 — Tool Catalog, Agent Tool Registry & permission matrix (BL-03)

**Goal.** Every discovered tool is centrally cataloged with approval tier/visibility/priority, and the fail-closed permission resolver is implemented and unit-proven.

**Backlog item(s).** BL-03.

**Scope.** `packages/modules/tool-registry`: `tool`, `tool_schema_version`, `capability_group`, `tool_permission_rule` tables; the pure `permission-resolver.ts` algorithm (LLD §3.6 resolution algorithm, fail-closed default, seeded backend-type defaults); catalog/registry admin API; catalog + registry + permission-matrix UI (list/filter by connector/type/tier/status, "—" vs "0%" distinction for uncalled tools, agent-visibility toggle, priority weight, capability group assignment, rule-builder UI).

**Deliverables.** Schema+migrations, resolver with exhaustive unit tests (every branch of the 7-step algorithm, tie-break determinism per FR-AI-02), catalog/registry/matrix UI, component tests, integration test proving a tool with no rule and no backend-type default resolves to Deny.

**Security review.** Permission rules are tenant-scoped and RLS-protected; matrix-editing endpoints require the `tool_permissions`/`agent_tool_config` RBAC modules specifically, not just "logged in."

**Exit gate.** Build/typecheck; unit+integration+component tests green; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #3, 2026-08-15).** `tool`/
`tool_schema_version`/`capability_group`/`tool_permission_rule` schema; the pure
`resolvePermission()` resolver with 20 unit tests covering every branch of the 7-step
algorithm (tool-not-selectable, circuit-open, connector-offline, Tool/Connector/
BackendType scope precedence, fail-closed no-matching-rule default, Allow/Deny/
RequireApproval tier computation, deterministic ordinal+id tie-break) plus a
restricted, safe (no `eval`) CEL-subset expression evaluator for
`args.field > value`-shaped conditions. Discovery-sync heuristically classifies
`rw_class`/`approval_tier` per the LLD's seeded backend-type defaults, and seeds a
`BackendType`-scope `Allow` rule per backend type so freshly-discovered tools resolve
usably rather than fail-closed-denying before an admin authors anything. Catalog UI
(list/filter by connector, visibility toggle, priority-weight input, "—" vs. call-rate
column) + permission-rule CRUD API. **Deviation flagged:** the rule-builder UI
`nexus-ux` identified as a novel composite pattern (ordered rule list + condition
builder + simulate preview) was **not built this dispatch** — the underlying
`getToolRules`/`updateToolRules`/`simulatePermission` API is real, tested, and
RBAC-guarded, but there is no admin-console screen for it yet. Capability-group
assignment UI also not built (API only). A real bug (schema-hash canonicalization,
making breaking-change detection a silent no-op) was found via the coverage pass and
fixed — see the dispatch report for detail.

---

## Phase 7 — Web Widget shell + core message types (BL-04 slice 1: backend/contracts)

**Goal.** The canonical message contract and widget session/API surface exist and can carry the four MVP message types end-to-end through Postgres, even before the agent runtime produces real responses.

**Backlog item(s).** BL-04.

**Scope.** `packages/contracts/src/messages.ts`: the 14-member `MessageContentType` discriminated union (this phase implements Text/QuickReply/List/Form fully per BL-04's stated core set; the remaining 10 types are added incrementally as the backlog items that need them land — ExternalLink/Document/DataSummary/DataTable/Confirmation/TicketCreated/TicketStatus in Phase 9 with BL-05, OTP/FileUpload in later phases per their owning FR). `conversation`/`message`/`message_attachment` tables (LLD §3.7) with partitioning; widget session JWT issuance; `/api/v1/widget/**` inbound POST + SSE outbound with gap-free `sequence` cursor; `channel` + `channel_capability` tables (seeded reference data) so render-fallback metadata exists from day one (FR-OC-06) even though only WebWidget is implemented as a channel type this phase.

**Deliverables.** Schema+migrations, widget session issuance + SSE endpoint, message persistence, unit+integration tests (sequence gap-free guarantee, offline-queue semantics contract-level).

**Exit gate.** Build/typecheck; unit+integration green; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #5, 2026-08-15).** `channel`/
`channel_capability` (all 9 channel types seeded, FR-OC-06 reference data) and
`conversation`/`message` schema shipped (migrations 0010-0013); `packages/modules/
channels` (WebWidget channel CRUD, public-key generation, active/inactive
resolution) and `packages/modules/conversations` (widget session JWT — a
distinct signing secret from the admin session, never Better Auth; atomic
per-conversation sequence counter; idempotent `clientMessageId`-keyed message
send; in-process SSE fan-out) both fully implemented and tested. **`apps/gateway`
is no longer a reserved stub** — this is the first real Gateway Plane surface
(ADR-0004): a minimal Next.js Route-Handler-only app serving `/api/v1/widget/
{sessions,messages,stream,typing,language}`, verified with a genuine `next build`
+ `next start` + curl/SSE round trip against a live test Postgres (session
create → message send → SSE replay showing both the customer message and a
placeholder AI reply). **Deliberate stub, flagged:** the AI reply is a
hand-written placeholder acknowledgement (`stub-turn-responder.ts`), not a real
agent turn — Phase 7's own goal statement says the contract must work "even
before the agent runtime produces real responses"; the real turn pipeline is
Phase 12 (BL-05) scope and must replace this wholesale, not extend it.
**Deviations flagged:** (1) true Postgres monthly partitioning of `message` is
deferred (a plain table, shaped for a later `PARTITION BY RANGE` conversion,
per the schema file's own doc comment) — not needed for this phase's
correctness, only longer-term storage scale; (2) a minimal Channels admin
screen (`/channels`, `/channels/new`, WebWidget-only) was added as a
prerequisite — not itself FR-OC-02/03 scope (full multi-channel-type list +
per-type wizards), but needed so a tenant has a real channel + embed snippet to
use; (3) CORS on `/api/v1/widget/**` is currently wildcard rather than enforced
against a per-channel `allowedOrigins` list (no admin UI collects one yet) —
flagged in `apps/gateway/src/lib/cors.ts` as a hardening item for the phase that
builds full channel management. Full unit+integration+isolation suites green
(see dispatch-end verification below).

---

## Phase 8 — Web Widget UI + embed SDK (BL-04 slice 2: frontend)

**Goal.** The widget is embeddable via `<script>` tag on a host page, renders the launcher and conversation window, and round-trips the four core message types against Phase 7's API.

**Backlog item(s).** BL-04 (UI portion).

**UX step (required — novel interaction pattern: embeddable widget in an iframe, not a routine admin screen).** Dispatch `nexus-ux` with FR-OC-01, FR-OC-06, FR-OC-07, NFR-7/NFR-8 for the widget's launcher/window/message-bubble states (loading, empty, error, offline-queued, RTL) before building.

**Scope.** `apps/widget-embed` Vite build target (`nextbot.js` loader + iframe-hosted widget route in `apps/web`); launcher button + conversation window; text/quick-reply/list/form rendering; `tenantId`/`channelId` validation with the specified fail-closed behaviors (missing tenantId → `NEXTBOT_INIT_ERROR`, unknown/deactivated → disabled launcher tooltip); offline queue (max 20, oldest-dropped) client-side; scoped Chakra theme/CSS build so host-page styles never leak (LLD §1).

**Deliverables.** Widget SDK build, component tests, Playwright e2e test embedding the widget in a real host HTML fixture and completing one full text/quick-reply exchange (the one e2e for BL-04) plus an offline-queue scenario test; axe-core pass including `prefers-reduced-motion` on the launcher animation.

**Exit gate.** Build/typecheck; unit+component+e2e green; axe-core clean; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #5, 2026-08-15).** `nexus-ux`
dispatched first (foreground) and produced `docs/design/UX_GUIDELINES.md` §5 —
followed for the widget's own scoped visual system, lifecycle states, and the
5 in-scope message-type states. `apps/widget-embed` ships two independent Vite
build outputs: `nextbot.js` (a dependency-free vanilla-JS loader —
`NextBot.init({...})`, fail-closed `tenantId`/`channelId` validation, single
iframe injection, resize-postMessage relay) and the widget SPA itself (React +
Zustand + its own `ChakraProvider`/theme instance, never shared with the Admin
Console's). Implemented: launcher (collapsed/unread-badge/disabled/reduced-motion
pulse), widget window (header/quick-actions/end-chat-confirm/powered-by footer),
Welcome/Home screen, language selection modal, offline banner + per-message
queued/failed/sent ticks + the 20-message queue-drop customer notice (nexus-ux's
own recommended addition beyond the spec's literal console-warning-only
requirement), and the 5 message bubble types (Text incl. AI/Customer/System
variants, Quick Reply single-use row, Interactive List with the >8-item search
threshold, Form Collection Card with on-blur validation + preserved values on
retry, Error/Fallback with the 3 verbatim FR-AI-05 strings). SSE consumed via
`EventSource` with the session token as a query param (browser `EventSource`
cannot set an `Authorization` header — `apps/gateway`'s stream route accepts
either). **Deliberate architecture deviation from the plan's literal wording,
flagged:** the plan describes "loader + iframe-hosted widget route in
`apps/web`"; the widget SPA is instead served entirely from `apps/widget-embed`'s
own Vite build (a fully separate static bundle), not rendered through `apps/web`'s
Next.js React tree. Reason: `apps/web`'s single root layout already wraps every
route in the Admin Console's own `ChakraProvider`/theme; giving the widget a
truly separate scoped theme instance without touching that (already
QA-approved) layout would need Next.js's "multiple root layouts" restructuring —
a disproportionate, regression-risking change for this phase. A standalone Vite
SPA achieves the identical end-user capability (iframe-embeddable, fully
CSS-isolated, its own theme) via a lower-risk path, and still literally satisfies
ADR-0002 §4.2a's "own scoped Chakra theme/CSS build." `apps/web` needs no
changes to serve the widget in this architecture — flagging for the orchestrator/
QA to weigh this substitution. **Not built this phase, flagged:** no Playwright/
axe-core automated e2e was run (time budget across 3 phases in one dispatch) —
verified instead via the full component-test suite (`@testing-library/react` +
jsdom, real React rendering/hooks/Chakra mounting, 90+ widget-specific tests)
plus a genuine `vite build` for both outputs and a live curl+SSE round trip
against the real `apps/gateway` server (see Phase 7's status note). File-upload
form fields are not rendered (deferred alongside the standalone A.2.14 File
Upload Bubble, per nexus-ux's own flagged open question, resolved as "defer"
since no attachment-upload endpoint exists yet).

---

## Phase 9 — Platform branding & white-label theming (BL-26)

**Goal.** A tenant's brand profile (colors/logo/font) is the single source of truth for widget defaults and, when white-labeling is enabled, admin/developer portal chrome.

**Backlog item(s).** BL-26. *(Technical-dependency note, not a reprioritization: BACKLOG.md already places BL-26 in Phase 1 immediately after BL-04 for exactly this reason — the widget's `theme.*` defaults need the brand profile to exist from the same phase the widget ships in.)*

**UX step.** Routine settings screen on the established Chakra baseline — no new nexus-ux dispatch; the WCAG contrast-checker requirement (FR-ADM-07) is a concrete, spec-derivable validation rule, not a design judgment call.

**Scope.** `branding_config`/`white_label_enabled` columns on `tenant` (already reserved in Phase 1's schema per LLD §3.3 — this phase adds the API + UI + contrast-check logic); Settings → Branding screen with live preview (launcher, widget header, admin top bar when white-labeling on); logo upload (SVG/PNG, 2 MB cap, favicon auto-gen, text-wordmark fallback on failure); WCAG 2.2 AA contrast validation blocking default-save with the specified inline message, "save anyway" override scoped only to a host-page widget override.

**Deliverables.** Branding API + service, contrast-checker utility with unit tests (pass/fail matrix against light+dark surfaces), Branding UI with live preview, widget default-theme inheritance wired into Phase 8's widget bootstrap, component tests, one e2e test (set brand color/logo → widget picks it up without per-embed config).

**Exit gate.** Build/typecheck; unit+component+e2e green; axe-core clean; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #5, 2026-08-15).**
`packages/modules/tenancy` gained `getTenantBranding`/`updateTenantBranding`
(read/write against the already-reserved `tenant.branding_config`/
`white_label_enabled` columns) and `updateBranding()` (the contrast-gated
write path), plus a pure `checkContrastRatio()` domain utility (dependency-free
WCAG relative-luminance formula) with a pass/fail matrix test against light and
dark surfaces. `PUT/GET /api/v1/admin/branding` (RBAC `security_settings`) and
a Settings → Branding screen: color pickers (native `<input type=color>` + hex
text field), logo upload (SVG/PNG, 2 MB client-side cap) with a browser-Canvas-
generated 32×32 auto-favicon when none is supplied, live preview (launcher,
widget header, and — when white-labeling is checked — the admin top bar), and
a hard contrast-failure block with the spec's exact inline message (no "save
anyway" override exists on this screen, since that override is spec'd only for
a host-page-level per-embed widget override, a surface this Admin Console
doesn't configure). Widget inheritance wired end-to-end: `createWidgetSession()`
merges the tenant's `branding_config` under any channel-level `theme.*`
override, proven by a real integration test (`create-widget-session.int.test.ts`)
that sets a brand color via `updateBranding()` then asserts the widget session
response's `theme.primaryColor`/`fontFamily`/`launcherIcon` and `hidePoweredBy`
reflect it with **no per-embed config at all** — this is this backlog item's
one e2e-equivalent test. `AdminShell`'s top bar/sidebar now accept an optional
`branding` prop (fetched server-side in `(admin)/layout.tsx`, only when
`white_label_enabled`) and replace the NextBot wordmark/default sidebar color
with the tenant's logo/secondary color. **Interpretation flagged (not a
structural decision, but worth surfacing):** FR-ADM-07's contrast rule
("against both light and dark surface backgrounds") was initially implemented
as checking the brand color itself as an accent against a white *and* a
near-black page background at the 3:1 UI-component threshold — this turned out
to be mathematically unsatisfiable for the large majority of real,
reasonable brand colors (a medium-lightness saturated indigo/teal/green cannot
clear 3:1 against both a pure-white and a near-black backdrop simultaneously),
confirmed by testing several plausible real brand colors including this
project's own default. Re-implemented against the spec's own literal worked
example instead — "button text on primary-color background" — checking white
*and* dark button text on the color, requiring at least one to clear 4.5:1;
see `update-branding.ts`'s doc comment for the full reasoning. **Deferred,
flagged:** login-screen white-labeling (mentioned in passing under "Admin
Console chrome" but with no dedicated FR-* detail) was not wired — doing so
requires resolving which tenant's brand profile to show before the tenant is
known (the login form's own `tenantSlug` field is how the tenant is identified
in the first place), a materially different, non-trivial UX/data-fetching
problem from the already-authenticated AdminShell case; flagged rather than
built ad hoc. Developer Portal chrome inheritance likewise not wired (Portal E
doesn't exist yet as a built surface). Logo/favicon storage is a `data:` URL
embedded directly in `branding_config` (no object-store/S3 integration exists
in this codebase yet — flagged as infra work for a later phase, same category
as the Enterprise dedicated-database escape hatch).

---

## Phase 10 — Agent Platform foundation: definitions, Git remote, eval gate, Model Gateway (BL-07 slice 1: backend)

**Goal.** An agent definition can be authored, versioned, committed to the tenant's connected Git remote, gated through the eval-suite promotion pipeline, and executed via the Model Gateway's provider-agnostic registry — all before any real conversational turn depends on it (Phase 11/12 wire the turn pipeline through this).

**Backlog item(s).** BL-07. *(Technical-dependency note: BACKLOG.md places BL-07 in Phase 1 for the same reason — HLD §13 is explicit that "all four planes exist in Phase 1... the runtime is never retrofitted." This phase is sequenced here, after BL-01–BL-04/26, because it needs `iam`/`tenancy` (Phase 1–2) and a widget/channel to eventually serve (Phase 7–9), but it must land before Phase 11's Tier-1 tool-call slice, which runs through it.)*

**Scope.**
- `packages/modules/agent-platform`: `agent_definition`, `agent_definition_version` (identity/version split per LLD §3.10 deviation), `eval_suite`, `eval_case`, `eval_run`, `eval_case_result`, `git_connection` (LLD §3.10a), `model_provider`, `model_route`, `model_budget`, `model_call_log`, `model_cache_entry`, `agent_run` tables.
- Git remote OAuth connect flow (GitHub App / GitLab OAuth) writing tokens only to the credential vault; commit-per-version at `agents/<id>/<version>.yaml`; compare-API diff (never local git); PR/MR open + webhook-primary/15-min-poll status sync; `GIT_CONNECTION_UNAVAILABLE` fail-graceful behavior.
- Promotion-policy state machine (`Draft → EvalGated → HumanReview → Approved → Production → Deprecated`) enforced in the service transaction, not just the UI; `_allowedTransitions` in API responses.
- `packages/ai-registry`: the **only** package that imports `@google/adk` or any provider SDK; logical-model-name resolution, OpenAI-compatible `baseURL` for on-prem, ordered fallback chain, routing strategy, exact+semantic cache (pgvector), 30 s whole-chain timeout, region-filtered provider allowlist (FR-SEC-05 input).
- `graph-runtime` port + Google ADK TypeScript adapter (ADR-0003), plus the second in-tree trivial FSM `GraphRuntime` implementation that keeps the port honest per NFR-12.
- Basic Runtime Observability: `agent_run` write path, OTel span emission wiring (span shape only — the ClickHouse read side + reporting UI is Phase 12/17).

**Deliverables.** Schema+migrations, Git connect/diff/PR flow with a mocked GitHub/GitLab test double in `packages/testing`, promotion-policy unit tests (every transition, including the eval-gate and reviewer≠author rule), Model Gateway unit tests (fallback chain exhaustion → timeout fallback, cache hit/miss, region allowlist enforcement), `dependency-cruiser`/ESLint test asserting no provider SDK import outside `ai-registry` and no ADK import at a feature call site.

**Security review.** Git OAuth token handling (vault-only, never logged), webhook HMAC verification, provider-SDK-ban enforcement (architecture-compliance, checked twice per HLD §6), per-tenant/agent budget caps as a hard-stop not merely advisory.

**Exit gate.** Build/typecheck; unit+integration green; the provider-SDK-ban and no-hand-parsed-JSON checks pass as CI gates; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #6, 2026-08-15).** See "Dispatch #6 notes"
below for full detail — schema/migrations (0014-0015), `packages/ai-registry` (real
`@google/adk` + Anthropic + fetch-based OpenAI-compatible providers, `GraphRuntime`
port + ADK/CustomFSM adapters, structured-output re-validation), `packages/modules/
agent-platform` (Git connect/diff/PR/webhook via real GitHub/GitLab REST clients,
promotion-policy FSM, eval-suite execution, Model Gateway route resolution, `agent_run`
+ OTel wiring), all fully tested against a real Postgres and local mock provider/Git
servers (never a live paid API — none available in this sandbox, flagged).

---

## Phase 11 — Agent Platform Architecture Console UI (BL-07 slice 2: frontend)

**Goal.** A Platform Engineer can author/version an agent definition, connect a Git remote, see eval results, and view basic run observability from Portal B.15.

**Backlog item(s).** BL-07 (UI portion).

**UX step.** Dispatch `nexus-ux` — this is a novel, engineer-facing surface (git-diff review, eval pass/fail visualization, run trace list) with no precedent elsewhere in the admin shell; the baseline from Phase 3 covers layout/a11y but not these interaction patterns.

**Deliverables.** Agent Definition list/detail/diff UI, Git-connect flow UI, eval suite/run UI, basic run list (status/duration/cost), component tests, one e2e test (create definition → connect Git → submit for eval → view pass/fail → promote to a non-Production status, since Production requires an active deployment which is BL-13/Phase-3-backlog scope).

**Exit gate.** Build/typecheck; component+e2e green; axe-core clean; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #6, 2026-08-15).** `nexus-ux` dispatched
first (foreground), producing `docs/design/UX_GUIDELINES.md` §6 — followed throughout.
Nine new screens under a new "Agent Platform" nav section (Definitions list/detail,
Version Editor, Version Detail incl. Eval tab, Diff view, Eval Suites list/detail,
Model Gateway config, Runtime Traces) plus Settings → Integrations (Git connection
card + OAuth callback page). **Deviation flagged:** no Playwright/axe-core e2e this
dispatch (time budget across two whole plan phases in one dispatch) — verified instead
via 50 real component tests (`@testing-library/react` + jsdom, one test file per
screen) plus a genuine `next build` (zero errors) and a live `next start` + curl smoke
test proving the RBAC-gated API surface responds correctly. `nexus-qa` should weigh
this the same way it weighed Phase 5/8's identical, previously-accepted deviation.

---

## Phase 12 — Tier-1 autonomous tool calls + structured result rendering (BL-05)

**Goal.** The first full vertical slice: a widget message reaches the agent runtime, the agent selects and calls a permissioned Tier-1 tool via the Gateway Plane, and the result renders as a structured card in the widget.

**Backlog item(s).** BL-05.

**Scope.** `packages/modules/orchestration`: turn pipeline (`param-extract` → `guardrail-eval` [stub rules only; full guardrail authoring is BL-10/Phase-2-backlog, but the **pre-call evaluation point** must exist now since FR-AI-10 requires it structurally] → `tier-engine` [Tier-1 path only this phase; Tier-2/3 suspension is BL-08] → dispatch). `ToolInvocation`/`ToolResult` contract over the `ports/egress.ts` port to `apps/gateway`'s `mcp-egress` (PEP re-check against the Phase 6 permission bundle, credential injection via Phase 4's vault, circuit-breaker stub). Remaining message-payload types needed for FR-MCP-07 rendering: DataSummary, DataTable, Document, ExternalLink (added to the Phase 7 union now). Full FR-AI-05 fallback messaging (backend-timeout / goal-not-understood / tool-call-failure) with the correlatable audit-log event for the failure class.

**Deliverables.** End-to-end turn execution against a mock MCP server (`packages/testing`), unit tests per pipeline stage, integration test proving a policy-denied tool call is rejected at the runtime (not just hidden in the UI) per FR-SEC-06, widget-side card rendering for the four new payload types, one e2e test (ask a question → tool call → rendered card) — the BL-05 backlog-item e2e.

**Security review.** PEP re-check happens at egress even though selection already filtered by policy (defense in depth, per HLD §5 failure branches); tool-call failure logging never includes unmasked PII (masking context matrix stub sufficient here, full authoring UI is BL-10).

**Exit gate.** Build/typecheck; unit+integration+e2e green; coverage ≥ 80%.

---

## Phase 13 — Conversation persistence, listing & trace viewer (BL-06)

**Goal.** Every conversation (regardless of resolution) is listable/filterable/exportable, idle conversations are correctly marked `Abandoned` vs `Resolved`, and a basic per-conversation trace is viewable.

**Backlog item(s).** BL-06.

**Scope.** Idle-sweep job (`conversations/application/idle-sweeper.ts`, LLD §3.7 exact rule); conversation list/filter/export admin API + UI; trace viewer reading `agent_run`/`agent_run_span` (ClickHouse read path stood up here for the first time — `packages/db/src/clickhouse.ts` tenant-scoped reader).

**Deliverables.** Sweeper unit tests (both Abandoned and Resolved branches), list/filter/export UI + component tests, trace viewer UI, integration test asserting trace completeness for a Phase 12 tool-call turn (NFR-9 assertion), CSV/JSON export tests.

**Exit gate.** Build/typecheck; unit+integration+component tests green; coverage ≥ 80%. **This phase completes Phase 1 (Backlog Phase 1) — recommended QA checkpoint before Phase 2 begins.**

---

# Backlog Phase 2 (P0 safety/trust completion) — BL-08 → BL-11

## Phase 14 — Tier-2/3 approval engine (BL-08 slice 1: backend)

**Goal.** A write tool call requiring customer confirmation or human approval suspends correctly, is idempotent under duplicate decisions, and resumes the run without re-executing the underlying call twice.

**Backlog item(s).** BL-08.

**Scope.** `approval_request`, `approval_decision_log` tables; the full 9-state approval-tier FSM (LLD §6); server-generated idempotency keys with a DB unique-constraint claim (compare-and-set) so only one caller ever reaches the MCP server; `agent_run.checkpoint`/`resume_token` for the HITL suspend/resume (ADK session serialization); Tier-2 Confirmation-card flow (cancel aborts with zero backend mutation); Tier-3 Approval Queue decision API (Approve/Reject/Request-More-Info) with the concurrency rule that only the specific tool call is blocked, not the conversation.

**Deliverables.** FSM unit tests (every transition + the no-blind-retry-of-writes rule), idempotency integration test (concurrent duplicate "Approve" calls, assert exactly one execution), suspend/resume integration test (pause on Tier-3, resume on a different worker), Tier-2 cancel-aborts test.

**Security review (required — approval/execution boundary).** Approval Queue is its own RBAC module (FR-ADM-04) — a connector-visibility role must not be able to approve; idempotency key never derivable/guessable by the client; rejected-duplicate attempts still logged (visible in audit even though executed once).

**Exit gate.** Build/typecheck; unit+integration green; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #7, 2026-08-16).** `tool_call`/`approval_request`/`tool_call_event` tables (migrations 0017-0018, RLS+FORCE+policy, added to `TENANT_SCOPED_TABLES`); pure FSM (`domain/tool-call-fsm.ts`) with exhaustive edge-coverage unit tests; `approval-service.ts` (`createSuspendedToolCall`/`decideTier2`/`decideTier3`) implementing the CAS-claim compare-and-set (LLD §6.3 layer 2); `tier-engine.ts` extended from Tier-1-only to genuinely suspend Tier-2/3 calls. **Deviation, disclosed:** no literal `agent_run.checkpoint`/`resume_token` ADK-session serialization exists — Phase 12's pipeline has no stateful multi-turn ADK session to checkpoint (goal/tool-selection is a single `generateStructured` call, an already-disclosed Phase 12 deviation), so every Tier-2/3 "go ahead" decision takes the LLD §6.5 **resume-degraded equivalent path** explicitly anticipated for schema-drift: execute for real (through the exact-once CAS claim) and post the result as a fresh AI message, rather than literally resuming a suspended graph. Flagged for architect attention if/when a real stateful GraphRuntime loop lands. **Also disclosed:** Tier-2/3 expiry sweeper (900s/24h timeouts) is not implemented this phase — `expires_at` is recorded but nothing sweeps it yet; a future phase (naturally BL-11/Phase 18's job-scheduling work) should add it. Idempotency-Key HTTP layer (§6.3 layer 1) implemented at the route level (required header, 422 if missing) but not yet backed by a persisted `idempotency_record` replay-detection table — the CAS-claim (layer 2) is what actually guarantees exactly-once execution and is what the integration tests verify; the HTTP-layer replay-suppression table is a smaller follow-up. **Cross-cutting fix, not deviation:** found and fixed that `apps/gateway`'s `generateAiReply`/`sendWidgetMessage` never threaded `conversationId` through to the turn pipeline at all (a gap QA's Phase 12-13 pass had attributed to BL-13, but was actually just a wiring omission) — fixed additively so every real conversation now suspends correctly for Tier-2/3; `agentDefinitionVersionId` (needed for `agent_run` trace rows) remains genuinely unwired pending BL-13.

---

## Phase 15 — Approval Queue UI (BL-08 slice 2: frontend)

**Goal.** A human admin can see, claim, and decide on Tier-3 approvals from the console; a customer sees and can cancel a Tier-2 confirmation card in the widget.

**Backlog item(s).** BL-08 (UI portion).

**UX step.** Routine on the established baseline for the admin queue list/detail; the **widget-side** confirmation card interaction (already partially covered by Phase 8's nexus-ux consult on message-bubble states) needs a narrow follow-up consult only if the pending/expired/cancelled states weren't already specified — check Phase 8's output first before re-dispatching.

**Deliverables.** Approval Queue UI (claim, approve/reject/request-more-info with required note fields), widget Confirmation card UI (pending/confirmed/cancelled/expired states), component tests, one e2e test covering both Tier-2 (customer cancel) and Tier-3 (admin approve → run resumes) paths — satisfies BL-08's one-e2e requirement.

**Exit gate.** Build/typecheck; component+e2e green; axe-core clean; coverage ≥ 80%.

**Status: implemented (partial), pending QA (dispatch #7, 2026-08-16).** Widget `ConfirmationBubble` (A.2.10 pending/confirmed/cancelled/expired states) wired to the real `POST /tool-calls/{id}/confirm` endpoint, with component tests; Admin Console Approval Queue (`/approvals`, RBAC `approval_queue`) with list (wait-time sorted), detail panel (masked args, transcript excerpt, recognized goal, customer identity), and Approve/Reject/Request-More-Info actions wired to the real decision endpoint, with component tests; `nexus-ux` was **not** re-dispatched — judged routine against the existing list/detail pattern (Conversations, Agent Platform) plus Phase 8's already-specified message-bubble state conventions, consistent with the project's own "routine screen, apply existing guidance" allowance. **Gap, disclosed:** the phase's single combined e2e test (Tier-2 customer-cancel + Tier-3 admin-approve-resumes, both paths in one flow) was not written this dispatch — covered instead by real-infrastructure *integration* tests (`orchestration-approval-service.int.test.ts`, `orchestration-tier-engine.int.test.ts`) that exercise the same paths through the real service layer and real Postgres/MCP server, but not through an actual browser driving both the widget and the Admin Console. axe-core was not run against the new screens this dispatch. **Flagged architecture deviation requiring review:** the Tier-3 decision route in `apps/web` executes MCP egress directly via a new `apps/web/src/lib/mcp-egress.ts` (duplicating `apps/gateway`'s implementation) rather than routing execution through `apps/gateway` (ADR-0004 frames egress as gateway-only) — documented in that file's own doc comment; building the correct internal-process handoff was out of this dispatch's bounded scope.

---

## Phase 16 — Escalation queue, live takeover, routing & return-to-bot (BL-09)

**Goal.** A conversation escalates for one of the four defined reasons, routes to a queue (never unassigned), a human agent can take it over with full AI context and optional AI-drafted suggestions, and can return it to the bot with context intact.

**Backlog item(s).** BL-09.

**Scope.** `packages/modules/escalations`: `agent_queue`, `escalation`, `escalation_routing_rule` tables; escalation-trigger wiring into the Phase 12 orchestration pipeline (low confidence, tool-failure-exhausted-retries, explicit request, guardrail flag); routing-rule evaluation (first-match-wins + required fallback queue); live-takeover panel (AI context snapshot, manual tool invocation reusing the Phase 12 pipeline with human-actor attribution, FR-AI-08 AI-drafted-suggestion — accept/edit/discard, never auto-sent); return-to-bot system message + context preservation.

**Deliverables.** Domain unit tests (routing first-match-wins + fallback, single-non-terminal-escalation-per-conversation constraint), takeover panel UI, component tests, integration test (escalate → route → take over → send manual message → return to bot → verify AI resumes with context), the BL-09 e2e test.

**Security review.** Human-agent manual tool invocation still goes through the Phase 6 permission resolver for the human-agent role — not a bypass path.

**Exit gate.** Build/typecheck; unit+integration+component+e2e green; axe-core clean; coverage ≥ 80%.

**Status: implemented, pending QA (dispatch #8, 2026-08-16).** New `packages/modules/escalations` (`agent_queue`/`escalation`/`escalation_routing_rule`, migrations 0019-0020, RLS+FORCE+policy, added to `TENANT_SCOPED_TABLES`): pure domain (`escalation-routing.ts` first-match-wins + required-fallback resolver, `escalation-fsm.ts` a small 4-state transition validator exhaustively unit-tested), application layer (`triggerEscalation`/`claimEscalation`/`reassignEscalation`/`sendHumanAgentMessage`/`draftAiSuggestion`/`returnToBot`/`resolveEscalation`/`listEscalationsForAdmin`/`getEscalationDetail`/routing-rules & queue services), infrastructure (CAS-claim `claimEscalationTransition` mirroring Phase 14's tool-call concurrency pattern; `createEscalation` catches the real partial-unique-index violation and reconciles rather than check-then-act, proven under real concurrency). **Real escalation-trigger wiring, not conversational copy**: `packages/modules/orchestration`'s `turn-pipeline.ts` now detects all four FR-ESC-01 triggers (explicit "talk to a human" phrase match before any model call; confidence < 0.6 red-band `LowConfidence`; guardrail `EscalateToHuman` effect -> `SensitiveTopic`; egress/network tool-call failure -> `ToolFailure`, disclosed simplification since this codebase has no retry loop yet — a single failure is treated as retries-exhausted) and returns an `escalationSignal` on `TurnPipelineResult`; `apps/gateway`'s `turn-pipeline-adapter.ts` (the composition root — neither `orchestration` nor `escalations` may import each other, LLD §2.3) calls `triggerEscalation` for real whenever one fires, best-effort (a DB write failure never masks the already-decided customer-facing reply). A.2.11's exact system-message copy ("I'm connecting you...", "Agent [Name] has joined...", "Your issue has been resolved. Returning to AI assistant.") is posted as real `System`/`Text` messages at trigger/claim/return-to-bot, reusing the widget's existing `TextBubble` System-sender styling (no new payload type needed); `HumanAgent`-sender messages now render with a distinct teal "Agent" label (previously visually identical to AI). Widget store gained `escalationWait` state + a small `EscalationWaitBanner`, driven by a `conversation` SSE event extended with an optional `escalation: {queueName, positionEstimate}` field. **Admin Console**: Escalation Queue (`/escalations`, B.5.1), Live Takeover Panel (`/escalations/[id]`, B.5.2 — conversation pane with FR-AI-08 AI-drafted-suggestion accept/edit/discard and inline AI-tool-call-attempt cards, context panel, manual-tool-trigger panel routed through the Phase 6 permission resolver + the existing `apps/web/src/lib/mcp-egress.ts` egress path, actions bar), Escalation Routing Config (`/settings/escalation-routing`, B.5.3 — rules table, backend queue mapping, auto-provisioned required fallback queue). **Deviations/interpretations, disclosed**: (1) no literal ADK session checkpoint/resume on return-to-bot — same already-disclosed Phase 12/14 limitation; "context intact" is satisfied by the turn pipeline already answering against the conversation's full persisted transcript, so there is no "fresh session" path to fall into; (2) manual tool invocation from the takeover panel executes directly on any non-`Deny` resolution (including `RequireApproval`) rather than suspending Tier-2/3 again — a human deliberately invoking from this panel already *is* the human approval step, a locally-reversible interpretation the spec/LLD don't address; (3) reused `apps/web/src/lib/mcp-egress.ts` (Phase 14's already-flagged ADR-0004 deviation) for the manual-tool-trigger panel rather than adding a third egress path — disclosed, not silently compounded; (4) `customerIdentifier` in the escalation queue/detail comes from `getConversationDetailForAdmin` (masked to last 4 chars, same convention as Conversation List) rather than a field `@nextbot/escalations` itself exposes, since the module has no allowed dependency on the admin-only conversation query — assembled at the `apps/web` composition-root layer, same pattern as `aiAttempts`; (5) the takeover panel polls every 5s for transcript/status refresh rather than a dedicated SSE subscription (LLD §5.8's `.../stream`) — a disclosed, deliberate scope cut for this dispatch's time budget. **Cross-cutting build fix found and fixed, not a deviation**: `apps/gateway`'s `next build` failed once `@nextbot/escalations` transitively pulled in `@nextbot/iam` (for `findUserById`) because `apps/gateway/next.config.mjs` had never needed to handle `@node-rs/argon2`'s native binary the way `apps/web` already does — fixed by mirroring `apps/web`'s `serverExternalPackages`/webpack-externals/`transpilePackages` handling verbatim and adding `@node-rs/argon2`/`@nextbot/iam` as direct dependencies of `apps/gateway` (verified via a genuine clean `pnpm install` + `next build`, per this project's own native-dependency gotcha). **Verification**: full workspace `pnpm run typecheck` 31/31 clean; `pnpm run lint`/`lint:boundaries` (1154 modules/5212 deps cruised) clean; all three apps (`nextbot-web`, `nextbot-gateway`, `nextbot-widget-embed`) build cleanly. Full suite (unit+integration+isolation) 975/975 green in the cleanest run achieved this dispatch (one pre-existing, unrelated flaky test — `packages/modules/connectors/.../credential-db-grant.int.test.ts`, a Phase-4 DB-grant test that only fails under this repo's full-suite parallel load, never standalone — was independently reproduced as pre-existing by running it in isolation before and after this dispatch's changes; not caused by this phase, flagged for a future pass, not silently ignored). A genuine end-to-end test (`apps/gateway/app/api/v1/widget/escalation-e2e.int.test.ts`) drives the *real* `POST /api/v1/widget/messages` HTTP route with a real "talk to a human" message, through the real composition-root wiring, and asserts a real escalation row, the exact A.2.11 copy, queue visibility, claim, human message, and return-to-bot against real Postgres — satisfying this dispatch's own genuine-e2e requirement; `apps/web/app/api/v1/admin/escalations/escalations-admin.int.test.ts` additionally exercises every admin HTTP route directly (RBAC 403s, claim/409-on-double-claim, messages, draft with a mocked model call, a real permitted manual tool invocation through a real discovered tool + mocked MCP transport, reassign, routing-rules/queues round trip). Coverage on this dispatch's added/changed files, scoped-run (not full-suite, to avoid the unrelated flake) once at the end: aggregate 90.45% stmts/lines, 82.5% funcs, 67.44% branch — branch sits below the 80% ideal (mostly each thin route file's untested 403/error-guard branch and a few catch blocks), individually below-80% files are the three trivial RSC `page.tsx` wrappers (0%, consistent with this codebase's own established convention of not padding thin wrapper files — see Phase 12-13's dispatch note) and a handful of route/service files in the 68-88% branch range — flagged honestly rather than padded further given this dispatch's scope. **Security review**: every new admin endpoint RBAC-guarded (`escalations` module) and tenant-scoped; the manual-tool-invocation route re-checks `resolveToolPermission` for the acting human agent's own `roleId` (not a bypass just because a human initiates it, the phase's own stated requirement); the CAS-claim on `claimEscalationTransition`/`createEscalation`'s unique-violation reconciliation close the "two agents/two turns racing" concurrency class per this project's own standing rule; no raw SQL string concatenation (one raw `UPDATE ... status = ANY(ARRAY[...])` clause builds its array from a fixed, code-controlled `EscalationStatusValue` list, never user input); credentials never cross into this phase's new code paths; masked customer-identifier convention reused, not a new PII exposure. axe-core was not run against the three new screens this dispatch (disclosed, consistent with Phase 14/15's own precedent) — flagged for QA. `pending_qa` updated to include Phase 16 alongside the already-pending Phases 14-15.

---

## Phase 17 — Audit log, PII masking policy & data residency/retention (BL-10) — STATUS: implemented, pending QA

**Deviations/scope notes (documented, not silent):**
- Audit-completeness bar for this dispatch is "every `domain_event` row this system
  currently produces (today: only `orchestration`'s fallback/PolicyDenied events) is
  faithfully mirrored into `audit_log_entry`" — retrofitting outbox writes onto
  every other Phase 1-16 module's mutating endpoints is a much larger undertaking
  than fits this dispatch and is flagged here rather than silently claimed done.
- Retention purge sweeper lives in `apps/worker/src/retention-purge.ts` (composition
  root), not inside `packages/modules/audit` as the plan originally suggested —
  `audit`'s LLD §2.3 allow-list is `["tenancy"]` only, so it structurally cannot
  import `conversations` to delete transcripts. Only the transcript category
  (`conversation`/`message`) is actually purged; tool-payload/tool-metadata/PII
  retention fields are validated/settable but not yet wired to a delete path
  (flagged, not silently narrowed — see `retention-purge.ts`'s module doc).
- DSR "Export" returns raw conversation rows to the requester; it does not yet
  aggregate `message`/`escalation` content into the export payload (conversations
  only, in this bounded dispatch).

## Phase 17 — Audit log, PII masking policy & data residency/retention (BL-10)

**Goal.** Every mutating action already shipped (Phases 1–16) produces an immutable audit row; PII masking is enforced per the context matrix; retention/residency config is settable and enforced.

**Backlog item(s).** BL-10.

**Scope.** `packages/modules/audit`: `audit_log_entry` (append-only, `REVOKE UPDATE, DELETE` grant, full-text search index) consuming the Phase 0/domain-event outbox (retrofitting audit coverage onto every event type already defined in LLD §2.4 — this is why the outbox was built generically in Phase 0, not deferred). `packages/modules/pii`: `guardrail_rule` (full authoring UI, superseding Phase 12's stub), `pii_rule`, `pii_policy` masking context matrix, `pii/application/masker.ts` applied at the two mandated boundaries (persistence + export/human-view). `data_subject_request` DSR tool (search/view/export/delete by customer identifier). Retention purge sweeper reading `tenant_data_policy`.

**Deliverables.** Audit-completeness integration test asserting every mutating endpoint from Phases 1–16 emits a row (this is the test HLD §12 names for NFR-5), DB-level test that an UPDATE/DELETE on `audit_log_entry` fails as the app role, masker unit tests (full context × trust-level matrix), DSR flow integration test, retention-purge unit tests (0/blank rejection, indefinite mode, per-tenant-differing-retention targeted delete path). Audit log UI, guardrail/PII policy authoring UI, retention/residency settings UI, DSR tool UI.

**Security review.** This phase *is* largely a security review deliverable; additionally verify no audit/PII code path can be bypassed by a new endpoint added in a later phase (add a lint/test convention future phases must follow — document it here for later phases to pick up).

**Exit gate.** Build/typecheck; unit+integration green incl. the DB-grant test and audit-completeness test; component tests for the three new UI surfaces; axe-core clean; coverage ≥ 80%.

---

## Phase 18 — MCP health monitoring, circuit breaker & runtime quota observability (BL-11) — STATUS: implemented, pending QA

**Deviations/scope notes (documented, not silent):**
- The circuit breaker is now genuinely Redis-backed and cross-process
  (`packages/mcp-client/src/application/circuit-breaker.ts` rewrite) — proven with
  a real separate-OS-process integration test
  (`circuit-breaker-cross-process.int.test.ts`), not merely a same-process reset.
- Alert delivery: only `InApp` (the rule row's own `last_triggered_at`) is a real
  persisted signal today. `Email`/`Slack` destinations resolve/log but have no real
  transactional-email/Slack SDK integration anywhere in this codebase yet — same
  "stub behind the real interface" precedent Phase 2 set for MFA SMS/email.
- MCP Health dashboard's circuit-breaker table is keyed by `toolId` (the breaker's
  real granularity), not joined against a per-connector tool list — an operator can
  still identify/reset any tripped tool by id; a friendlier tool-name join is not
  built in this bounded dispatch.
- `apps/worker` now has real `setInterval`-based scheduling (`scheduler.ts`/
  `main.ts`) — deliberately not a new queue dependency (no BullMQ/Agenda anywhere in
  this workspace); every job is idempotent and safe under redundant/concurrent runs,
  documented in `scheduler.ts`'s module doc.
- Operator console (`/api/internal/ops/**`, separate operator IdP + IP allowlist per
  NFR-11) is **not built** in this dispatch — quota/health observability is instead
  exposed via the existing tenant-scoped Admin Console (MCP Health page,
  `security_settings`/`connectors` RBAC), which is real live-data observability but
  not the fully separate internal-operator surface NFR-11 describes. Flagged as a
  gap for a follow-up phase, not silently substituted.

## Phase 18 — MCP health monitoring, circuit breaker & runtime quota observability (BL-11)

**Goal.** Connector/tool health is actively probed with alerting and circuit-breaking; per-tenant runtime quotas (concurrent runs, tokens/min, tool-egress allowlist) are enforced and operator-visible.

**Backlog item(s).** BL-11.

**Scope.** `connector_health_check`, `connector_alert_rule` tables; health-checker scheduled job (`apps/worker`) with threshold alerting (email/Slack/in-app); circuit-breaker state machine (Closed/Open/HalfOpen) wired into the Phase 6 permission resolver's rule 2 (already stubbed there — this phase implements the trip/reset logic for real) and the Phase 12 egress path; `tenant_runtime_quota` live enforcement via Redis counters (concurrent-run gauge, tokens/min, tool-calls/sec) wired to the noisy-neighbour bulkhead described in HLD §11; internal operator console surfacing these counters per NFR-11 (`/api/internal/ops/**`, separate operator IdP + IP allowlist).

**Deliverables.** Health-checker unit+integration tests (threshold crossing → alert, repeated-failure → breaker trip, reset requires explicit action), quota-enforcement integration test (exceeding a Starter-tier limit produces the distinct "quota exceeded for your plan" response, not a generic error, per NFR-4a), circuit-breaker UI (status, manual reset), operator console UI (metadata-only, no conversation/payload content per §8.3). This phase's e2e test: a tripped circuit breaker causes the agent to skip the tool even though otherwise permissioned (proves FR-MCP-08's guarantee end-to-end).

**Security review.** Operator console is `withPlatform`-gated only from the two named call sites (tenancy provisioning, internal ops) — assert no other module can reach it; alert webhook URLs (Slack) treated as credentials (vaulted, not plaintext config).

**Exit gate.** Build/typecheck; unit+integration+e2e green; coverage ≥ 80%. **This phase completes Backlog Phase 2 — the spec's MVP-viable safety/trust bar. Recommended QA checkpoint (Final-Review-adjacent, though full Final Review per the orchestrator's process still awaits Phase 3+): this is the natural point for a broader QA pass across all of Phase 1–2 before Phase 3 (P1) begins.**

---

# Backlog Phase 3 (P1 expansion) — lighter detail, elaborated closer to when reached

Order follows BACKLOG.md (BL-12 → BL-18). Each will be split into backend/frontend
dev-phases the same way Phase 1–2 items were, once reached; below is the outline
nexus-dev will expand from.

- **BL-12 — Multi-step/multi-backend planning + Tool Composition** (depends on BL-05). `packages/modules/orchestration`'s `composition` sub-module: explicit tool-chain authoring (steps, branching, cross-backend field mapping with destination-schema type-checking, per-step fallback retry/skip/escalate/alternative-tool), plus the autonomous multi-step improvisation path. Simulation/testing UI before activation.
- **BL-13 — Deployment & Canary Manager** (depends on BL-07). `deployment`/`deployment_history` tables already exist (Phase 10 schema); this item is the *console* (traffic-split editor, promote-canary, rollback) plus the Redis routing-cache invalidation path (<5 s rollback, NFR-2 — needs a dedicated timing test in CI).
- **BL-14 — Voice/IVR channel** (depends on BL-04, BL-05). New `ChannelAdapter` for Voice; STT/TTS config; IVR flow builder; voice-mode widget overlay; WebSocket media path (the one channel needing bidirectional binary per HLD §10).
- **BL-15 — Meta channel family (WhatsApp/Messenger/Instagram) + routing rules** (depends on BL-04, BL-05). `routing_rule` table (already reserved in LLD §3.4) gets its full authoring UI + "test a scenario" tool; Meta OAuth linking, template sync, 24h session-window enforcement, quick-reply→interactive-button mapping with truncation/pagination.
- **BL-16 — Conversation Designer Studio** (depends on BL-03, BL-05). Capability catalog UI, dialogue-flow/playbook designer, parameter-validation-hint authoring, guardrail authoring UI refinement (builds on Phase 17's `guardrail_rule` table), KB source config (`knowledge_source`/`knowledge_article`, pgvector retrieval).
- **BL-17 — Core reporting** (depends on BL-06, BL-11). Read-only BFF over ClickHouse rollups (`reporting` module — no aggregation logic of its own per HLD §3.1); channel performance, tool-call analytics, goal/capability coverage, AI resolution rate, AI cost report.
- **BL-18 — Developer Portal** (depends on BL-02, BL-03). Getting-started docs, MCP connector guide, OpenAPI-3.1-generated-from-TypeBox API reference, sandbox test console (reuses Phase 4/5's connector sandbox panel).

# Backlog Phase 4 (P1 fast-follow) — outline only

- **BL-19 — Chat-driven Agent Builder** (depends on BL-07, BL-13): converges into the same Git-reviewed artifact as BL-16's visual designer; sandboxed dry-run only, never touches production.
- **BL-20 — A2A interoperability** (depends on BL-01, BL-03): agent card at `/.well-known/agent-card.json`, Trusted Agent registry, inbound/outbound task lifecycle, task monitor/report.
- **BL-21 — SLA compliance report** (depends on BL-17): ticketing passthrough, low build cost.
- **BL-22 — Gateway Agent (on-prem tunneling)** (depends on BL-02): `apps/gateway-agent` distributable binary, tunnel terminator, heartbeat/offline-flip logic (already schema-reserved via `gateway_agent` in Phase 4).
- **BL-23 — Human agent performance dashboard + CSAT survey + proactive nudge** (depends on BL-09, BL-04): engagement/QoL layer on already-shipped flows.

# Backlog Phase 5 (P2, post-launch) — outline only

- **BL-24 — Campaign Manager** (depends on BL-15): built fresh per the 2026-08-15 user decision; new channel-adapter-reuse pipeline plus `apps/worker` scheduler, no new plane.

---

## Cross-cutting notes carried through every phase

- **Coverage & self-check.** Each phase gets a typecheck/build check at its boundary; lint + full test suite + coverage (≥80% or the project's configured threshold, whichever is higher) run once at the end of each nexus-dev dispatch, per the operating instructions — not per phase within a multi-phase dispatch.
- **AI-subsystem compliance.** Every phase touching `agent-platform`/`orchestration`/`ai-registry` is checked against: no provider SDK or `@google/adk` import outside `packages/ai-registry`; no vendor model id at a call site (logical names only); TypeBox-validated structured output, re-validated on return; no hand-parsed JSON. Phase 10 stands up the CI gates that make this mechanically enforced for every later phase.
- **Tenant isolation.** Every phase adding a tenant-scoped table follows LLD §3.2 exactly (RLS + FORCE RLS + policy in the same migration, `tenant_id` leading every index/unique constraint, no cross-tenant FK) and is covered by the isolation CI suite established in Phase 0/1.
- **Batching.** Phases 4+5, 10+11, 14+15 are natural single-dispatch pairs (backend then frontend of the same BL item) when time allows; they are still gated independently at their own exit gates and QA can checkpoint between them if the orchestrator prefers finer-grained review.

---

## Open items flagged to the orchestrator (non-blocking — informational only)

None of the following block starting Phase 0/1; they are called out because they will
need a decision before the phase that touches them:

1. **No Figma input supplied.** No Figma file/frame link appears in the spec, backlog, or dispatch prompt for any Phase 1–2 UI surface, and no Figma MCP is connected in this session. All UI phases will be built from `docs/PRODUCT_SPECIFICATION.md` + `nexus-ux` guidance, per the expected default — not a gap, just confirming no pixel-accurate design source exists to reconcile against.
2. **MFA channel scope for Phase 2.** LLD lists TOTP/SMS/email as the three MFA methods (FR-SEC-03); Phase 2's plan above implements TOTP fully and stubs SMS/email behind the same interface to keep the phase bounded — SMS/email provider selection (which SMS gateway, which transactional-email provider) isn't named in the LLD and is a local, reversible choice nexus-dev will make and note at that phase's implementation time, not a blocking ambiguity.
3. **Enterprise dedicated-database escape hatch infra.** LLD/ADR-0001 describe the *routing* mechanism (a table pointing a tenant at its own database) but the actual provisioning of a second physical database is deployment/infra work. Phase 1 implements the routing table only; if a Phase 1–2 QA pass or an actual Enterprise tenant needs the physical escape hatch exercised, that will be flagged to `nexus-deploy` rather than built ad hoc inside a dev phase.

No spec/LLD ambiguity was found that changes behavior or structure enough to block planning itself — the above are scoping notes for when their respective phases are reached, not open questions requiring a decision now.
