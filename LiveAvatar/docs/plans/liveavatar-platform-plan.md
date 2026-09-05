# LiveAvatar Conversational Avatar Platform — Phased Dev Plan

Authoritative build order mirrors `docs/BACKLOG.md`'s phase map exactly (Phase 1 → 7,
BL-001 → BL-025). P2 items (BL-026–BL-032) are out of scope for this plan and are not
scheduled — see the "Out of scope" section at the end.

Stack, layering, and library set are fixed by `docs/architecture/ADR-001-stack.md` and
`docs/architecture/LLD.md` and are not re-litigated per phase.

---

## Phase 1 — Platform skeleton + tenancy + admin auth (BL-001–BL-004)

Exit condition (BACKLOG.md): "Operator can seed, sign in, create/list/pause tenants."

### 1.a — Tenant domain + persistence (BL-001)
- **Scope:** `apps/api/src/modules/tenants/{application,infrastructure,interface}`,
  `tenants.module.ts`, `index.ts`. Tenant create (transactional: tenant + empty
  DeploymentConfig + default DataResidencyPolicy + default AlertPolicy, `room_namespace
  = slug`), get, list (operator sees all, admin sees assigned only — empty list not
  403), patch (name only, slug immutable), status change (pause/activate, idempotent
  no-op on same status). Row-level `tenant_id` isolation via the existing Prisma
  `tenantGuard` extension; `TenantScopeGuard` + `TenantContextInterceptor` wired on the
  controller. Out of scope: provider registry, deployment config content (Phase 2).
- **Deliverables:** repository (`PrismaTenantRepository`), use cases
  (`CreateTenantUseCase`, `GetTenantUseCase`, `ListTenantsUseCase`,
  `UpdateTenantUseCase`, `ChangeTenantStatusUseCase`), `TenantsController`
  (`POST/GET /tenants`, `GET/PATCH /tenants/:id`, `POST /tenants/:id/status`).
- **Exit gate:** unit tests for every use case (mocked repo), tenant-isolation negative
  test (cross-tenant admin → 404), optimistic-lock conflict test, idempotency-key
  replay test on create.

### 1.b — Admin auth (BL-002) — already implemented in this dispatch's starting state
- Login (8h JWT + 7d rotating refresh), refresh (family revoke on reuse), logout,
  `/auth/me`, `AdminJwtGuard` rejecting non-`admin` typ tokens (FR-AUTH-5). Verified,
  not re-built.

### 1.c — Operator seed + invites (BL-003) — already implemented in this dispatch's starting state
- `POST /auth/seed` (bootstrap-secret gated, one-time), invite create/list/revoke/accept,
  no `POST /auth/register` route. Verified, not re-built.

### 1.d — App bootstrap + wiring
- **Scope:** `apps/api/src/app.module.ts`, `main.ts` (public listener :8080, Pino,
  global `AppExceptionFilter`, `TenantContextInterceptor`, `IdempotencyInterceptor`,
  Helmet-equivalent security headers, CORS for the admin origin, Swagger at `/api/docs`
  dev-only), `main-internal.ts` stub listener (:8081, returns 404 for all routes —
  real `/internal` surface starts in Phase 3).
- **Exit gate:** app boots, `GET /api/health` returns 200, e2e smoke test via Supertest.

### 1.e — Deployments list + deep link (BL-004)
- **Scope:** Angular workspace bootstrap (`apps/web`, two SPA projects
  `admin`/`conversation` + `shared` lib per LLD §3.2), admin shell (toolbar/sidebar),
  `AuthStore` (SignalStore), login screen, invite-accept screen, Screen 3 (deployments
  list: search, status filter, pagination, pause/activate action, deep link to
  `/admin/tenants/{id}/builder` placeholder route since Agent Builder is Phase 2).
  Conversation SPA: unauthenticated placeholder page only (LLD §3.2, UX guidelines §6).
  Built per `docs/design/UX_GUIDELINES.md` §§1–5 (already specifies Phase 1 flows/
  states/accessibility in full) — `nexus-ux` not re-dispatched.
- **Deliverables:** `apps/web` workspace, `projects/shared` (api clients, error-envelope
  mapping, ui primitives), `projects/admin` (`core` — interceptors/guards/AuthStore,
  `features/auth`, `features/deployments`), `projects/conversation` placeholder.
- **Exit gate:** Jest unit tests for stores/services/interceptors, a11y pass
  (`@axe-core/playwright` where Playwright is configured — deferred to when Playwright
  is wired in Phase 3 if not feasible standalone yet; noted as a deviation if so).

---

## Phase 2 — Provider registry + deployment config + Agent Builder (BL-005–BL-009)
Exit condition: Example A and B YAML publish; secrets rejected; probes stored.
- 2.a Provider catalog seed + hosting/self-hosted badges (BL-005)
- 2.b Per-tenant Provider Registry: endpoints + credential refs (BL-006)
- 2.c Provider connection/health probe + BullMQ `provider-probe` job (BL-007)
- 2.d Adapter contracts + static combination validation + YAML schema (packages/contracts
  `agent-config`) (BL-008)
- 2.e Agent Builder screen: dropdowns, draft/publish, live preview (BL-009)

## Phase 3 — LiveKit transport + token issuer + screens 9–10 (BL-010–BL-012)
Exit condition: end user completes preflight, joins a room, mutes, ends (agent may be stub).
- 3.a LiveKit rooms/namespace, token issuer, session lifecycle (BL-010) — also stands up
  the real `/internal` surface (moves main-internal.ts stub to real controllers).
- 3.b Pre-call / permissions screen (BL-011)
- 3.c Live conversation screen: LiveKit JS SDK, avatar surface, mute/end/reconnect (BL-012)

## Phase 4 — STT + remote LLM + TTS loop + captions (BL-013–BL-017)
Exit condition: full listen→think→speak loop with captions and hop rows; failover/residency honored.
- 4.a STT adapters (Deepgram self-hosted + faster-whisper) + hop metrics (BL-013)
- 4.b Remote LLM adapters (OpenAI/Anthropic/Google) + failover/retry + residency strip (BL-014)
- 4.c TTS adapters (Fish Speech default + ElevenLabs) + hop metrics (BL-015)
- 4.d LiveKit Agents runtime (LangGraph/Pydantic AI): tools, memory, RAG hook (BL-016)
- 4.e Live captions from STT partials (BL-017)

## Phase 5 — bitHuman avatar adapter (BL-018)
Exit condition: Example A — avatar video driven by Fish Speech over LiveKit.

## Phase 6 — Alibaba LiveAvatar adapter (BL-019)
Exit condition: Example B — second `IAvatarProvider` completes a live call (config only).

## Phase 7 — Logs, dashboard, GPU, alerts, residency, post-call (BL-020–BL-025)
Exit condition: all 11 screens live; latency visible; post-call summary + feedback.
- 7.a Session logs/transcripts + hop breakdown + retention purge (BL-020)
- 7.b Dashboard: volume, errors, per-provider health (BL-021)
- 7.c GPU/node health monitor, heartbeat ingest, status-only (BL-022)
- 7.d Alerts & failover UI + degraded-mode speech + in-app events (BL-023)
- 7.e Data residency/privacy settings + snapshot-at-session-start enforcement (BL-024)
- 7.f Post-call summary: transcript, optional LLM summary, feedback (BL-025)

## Out of scope (P2, not scheduled)
BL-026 (billing), BL-027 (self-serve signup), BL-028 (GPU autoscaler actions),
BL-029 (white-label theming), BL-030 (email/PagerDuty alerts), BL-031 (recording
capture pipeline), BL-032 (schema/DB-per-tenant isolation).

---

## Phase 1 status

| Item | Status |
|---|---|
| 1.a Tenant CRUD + isolation (BL-001) | **Done — QA-approved** |
| 1.b Admin auth (BL-002) | **Done — QA-approved** |
| 1.c Seed + invites (BL-003) | **Done — QA-approved** |
| 1.d App bootstrap | **Done — QA-approved** |
| 1.e Deployments list + admin shell (BL-004) | **Done — QA-approved** |

Closed 2026-08-19 after 3 QA retry rounds (defects D-0 through D-7, all resolved and
independently re-verified). One non-blocking caveat carried forward: the tenant-isolation
e2e suite (`apps/api/test/tenant-isolation.e2e-spec.ts`) is well-formed but has never
executed against a live Postgres in any sandbox used so far (Docker unreachable) — must
be run green in CI before final production sign-off. See `docs/NEXUS_STATE.md` decision
log for full QA history.

(Phase 1 deviation log omitted here — unchanged, see git history / previous revision of
this file for the full text if needed.)

---

## Phase 2 plan detail

### 2.a — Provider catalog seed + hosting badges (BL-005)
- **Scope:** `apps/api/prisma/seed.ts` (idempotent upsert of the v1 `ProviderDefinition`
  catalog — the 10 rows in spec FR-PROVIDER-1, including `alibaba-liveavatar`),
  `packages/contracts/src/providers/schemas.ts` (`ProviderCategorySchema`,
  `ProviderHostingSchema`, `ProviderDefinitionSchema`), `apps/api/src/modules/providers`
  (domain/application/infrastructure/interface — catalog read + operator disable/enable
  with last-enabled-in-category guard).
- **Deliverables:** `GET /provider-definitions`, `PATCH /provider-definitions/:key`.
- **Exit gate:** unit tests for `ListProviderDefinitionsUseCase` /
  `SetProviderDefinitionEnabledUseCase` (category-empty guard), seed script idempotency
  test (run twice, same 10 rows, no duplicate-key error).

### 2.b — Per-tenant Provider Registry (BL-006)
- **Scope:** same `providers` module, `application/` credential use cases
  (`CreateCredentialUseCase`, `ListCredentialsUseCase`, `UpdateCredentialUseCase`,
  `DeleteCredentialUseCase`), `infrastructure/prisma-provider-credential.repository.ts`.
  Secret-key scan (`api_key`/`token`/`password`/`secret` in `extra`) shared with the
  YAML-side scan in 2.d. Tenant isolation via existing `tenantGuard` (model already in
  the `TENANT_SCOPED` set).
- **Deliverables:** `GET/POST /tenants/:id/provider-credentials`,
  `PATCH/DELETE /tenants/:id/provider-credentials/:credId`.
- **Exit gate:** unit tests for every validation branch (unknown provider, non-https
  endpoint except loopback, secret-in-body, duplicate label, delete blocked by a
  published config); integration test proving `has_secret`/`credential_ref` never
  leaks a raw value.

### 2.c — Provider probe + BullMQ job (BL-007)
- **Scope:** `providers/application/probe-provider.use-case.ts` +
  `providers/infrastructure/http-probe-strategy.ts` (category-generic HTTP HEAD/GET
  with a 5s timeout; TCP fallback is out of scope for v1 — HTTP probe covers all v1
  catalog entries since every credential carries an `endpoint_url`), rate limiting
  (30/tenant/min) via a small in-memory/Redis token count keyed by tenant,
  `apps/api/src/modules/jobs` (BullMQ `provider-probe` repeatable job, 2-minute
  interval, re-probes every credential of every active tenant).
- **Deliverables:** `POST /tenants/:id/provider-credentials/:credId/probe`,
  `JobsModule` wiring `@nestjs/bullmq` against the Redis instance from
  `docker-compose.dev.yml`.
- **Exit gate:** unit tests for probe status mapping (healthy/degraded/unreachable),
  rate-limit test, job-registration test (queue/processor wired, idempotent
  re-registration).

### 2.d — Adapter contracts + combination validation + YAML schema (BL-008)
- **Scope:** `packages/contracts/src/agent-config/schema.ts` (TypeBox schema exactly
  per LLD §6.1), `packages/contracts/src/agent-config/errors.ts` (path→code table per
  LLD §6.2), `apps/api/src/modules/deployment-config` (domain: `AgentConfig` type +
  YAML (de)serialization via `yaml`; application: `ValidateConfigUseCase` (Gate A
  schema, Gate B combinations per LLD §8.2), `SaveConfigUseCase`, `GetConfigUseCase`;
  infrastructure: `PrismaDeploymentConfigRepository`; interface:
  `DeploymentConfigController`). Python ports/mirrors (`apps/agent`) are explicitly
  **out of scope** for this dispatch — Phase 4+ builds the agent runtime; only the
  control-plane (TypeScript) side of the contract is needed to satisfy BL-008's exit
  criteria ("secrets rejected... at save").
- **Deliverables:** `GET /tenants/:id/config`, `POST /tenants/:id/config/validate`,
  `PUT /tenants/:id/config`.
- **Exit gate:** unit tests for every schema code (§5.5.1) and combination code
  (§5.5.2), fixture tests for Example A and Example B (must validate + save
  `published`), secret-in-YAML rejection test, `If-Match` conflict test.

### 2.e — Agent Builder screen (BL-009)
- **Scope:** `apps/web/projects/admin/src/app/features/agent-builder` (dropdowns per
  layer sourced from `/provider-definitions` + tenant's `/provider-credentials`,
  `AgentBuilderStore` SignalStore per LLD §9.1, debounced 400ms validate call, redacted
  YAML preview pane, draft/publish actions), `features/provider-registry` (Screen 4:
  catalog table with hosting badges, per-tenant credential CRUD + probe action),
  `shared/` components (`provider-badge`, `hosting-badge`, `yaml-viewer`). Route
  `/admin/tenants/:id/builder` replaces the Phase-1 placeholder.
- **UX input:** `nexus-ux` dispatched for both screens (Agent Builder is a new,
  non-trivial multi-step form + live-preview interaction; Provider Registry is a new
  CRUD-with-secrets surface) — see "UX dispatch" note below for what it produced.
- **Deliverables:** Angular components/services/stores above, wired into the admin
  shell nav (Providers item, currently "Coming soon" placeholder per UX guidelines,
  enabled).
- **Exit gate:** Jest component/service/store tests, Example A/B click-through-and-
  publish covered by one e2e-level Jest/Playwright-light flow test per BL-009 (per
  the "one e2e per user-facing backlog item" rule) if Playwright is feasible in this
  sandbox — else logged as a deviation matching Phase 1's 1.e deviation.

---

### Phase 2 status

| Item | Status |
|---|---|
| 2.a Provider catalog seed + hosting badges (BL-005) | **Done — QA-approved** |
| 2.b Per-tenant Provider Registry (BL-006) | **Done — QA-approved** |
| 2.c Provider probe + BullMQ job (BL-007) | **Done — QA-approved** |
| 2.d Adapter contracts + combination validation + YAML schema (BL-008) | **Done — QA-approved** |
| 2.e Agent Builder screen (BL-009) | **Done — QA-approved** |

Closed 2026-08-19 after 1 QA retry round (backend tenant-authorization gap on
config-validate, frontend credential_ref wiring, provider-registry responsive tables,
publish-button state — all fixed and independently re-verified). See
`docs/NEXUS_STATE.md` decision log for full QA history.

Exit condition check: Example A (`openai`+`deepgram`+`fish-speech`+`bithuman`+`livekit`) and
Example B (`anthropic`+`faster-whisper`+`elevenlabs`+`alibaba-liveavatar`+`livekit`) both
publish successfully in `ValidateConfigUseCase`/`SaveConfigUseCase` fixture tests; a raw
secret anywhere in a credential body or in the config YAML is rejected at save, never
persisted; every provider probe (on-demand and the `provider-probe` BullMQ sweep) writes
`lastProbeStatus`/`lastProbeAt`/`lastProbeError` rather than being called live per paint.

### Phase 2 QA-driven fix pass (2026-08-19)

Two `nexus-qa` reports (`qa-results/phase2-backend/REPORT.md`,
`qa-results/phase2-admin-spa/REPORT.md`) came back with defects; fixed in this pass,
scoped strictly to what was reported (re-verification, not re-planning):

- **Backend D-1 (authorization gap, fixed):** `POST /tenants/:id/config/validate` had
  no tenant-access check at all — any authenticated admin could read another tenant's
  `has_secret`/`hosting`/`feature_gaps` metadata, and an unknown tenant id silently
  returned a 200-shaped body instead of `404 TENANT_NOT_FOUND`.
  `ValidateConfigUseCase.execute()` now takes an `actor` parameter, loads the tenant via
  `TenantRepositoryPort`, and calls `canAccessTenant()` before doing anything else —
  the same pattern `GetConfigUseCase`/`SaveConfigUseCase` already use. The controller
  now passes `@CurrentUser() actor` through. Added two new spec cases covering the
  unknown-tenant and unassigned-admin paths.
- **Frontend D-1 (blocking, fixed):** none of the seven provider-selection handlers in
  `agent-builder-page.component.ts` ever set `credential_ref`, so published YAML for
  both Example A and B had zero `credential_ref` keys — defeating the Provider
  Registry ↔ Agent Builder wiring entirely. Fixed per UX_GUIDELINES §10.5: a provider
  with exactly one tenant credential now auto-populates `credential_ref` on selection;
  a provider with more than one reveals a secondary "Credential" dropdown (new
  `hasMultipleCredentials()`/`credentialsFor()` helpers + `onXxxCredential()` handlers)
  so the multi-credential case (flagged as an open UX decision in §10.10) is handled
  explicitly rather than silently no-op'd.
- **Frontend D-2 (UX, fixed):** `/admin/providers` and
  `/admin/tenants/:id/provider-credentials` had no phone stacked-card layout at 375px.
  Applied the same media-query pattern already verified for the Phase-1 deployments
  list (`deployments-list-page.component.scss`) to both pages' SCSS, reused verbatim
  (not reinvented) with `data-label` attributes added to every `td` in both templates.
- **Frontend D-3 (low, fixed):** the Publish button now switches to a disabled
  "Published" (check-circle icon) state once `configStatus() === 'published' &&
  !hasUnpublishedChanges()`, instead of staying enabled and labeled "Publish"
  indefinitely after a successful in-sync publish.

Regression after the fix pass: backend `jest --runInBand` 413/413 green (411 + 2 new
D-1 tests), backend eslint clean, `prisma generate && nest build` clean; frontend
`jest --coverage` 231/231 green (title unchanged suite count, +7 new agent-builder-page
tests offsetting other file coverage), frontend eslint clean, `ng build admin` clean
(only the pre-existing unrelated `@liveavatar/contracts` CommonJS warning), `ng build
conversation` clean.

### Backend — new modules

- `packages/contracts/src/providers/schemas.ts` — catalog/credential/probe TypeBox
  schemas + `containsSecretKey()`, the single secret-key-name scanner shared by the
  credential-body guard (FR-PROVIDER-2) and the YAML guard (FR-PROVIDER-7).
- `packages/contracts/src/agent-config/{schema,errors}.ts` — the canonical
  `AgentConfigSchema` (LLD §6.1, verbatim) + JSON-Pointer-path → error-code table.
- `packages/contracts/src/deployment-config/schemas.ts` — validate/save/config wire DTOs.
- `apps/api/src/modules/providers` — catalog (list/enable-disable with
  last-enabled-in-category guard) + per-tenant credentials (CRUD, secret/endpoint
  validation, delete-blocked-by-published-config check) + probe (HTTP HEAD/fallback
  strategy, Redis-backed 30/tenant/min limiter).
- `apps/api/src/modules/deployment-config` — `DraftAgentConfigSchema` (all-optional
  mirror of the canonical schema, needed so an incomplete new-tenant draft can still
  pass Gate A structurally) + the two-gate `ValidateConfigUseCase`
  (schema → combinations, LLD §8.2) + `SaveConfigUseCase` (server-owned
  `tenant_id`/`room_namespace` reassertion, optimistic-lock `If-Match`, canonical
  YAML regeneration on publish) + `GetConfigUseCase`.
- `apps/api/src/modules/jobs` — BullMQ `provider-probe` repeatable job (2-min interval)
  sweeping every active tenant's credentials via the same probe strategy the on-demand
  endpoint uses.
- `apps/api/prisma/seed.ts` — idempotent `ProviderDefinition` catalog upsert (10 rows);
  run via `pnpm --filter @liveavatar/api prisma:seed` (not yet wired into a deploy
  pipeline step — that's `nexus-deploy`'s job when it stands up migrations).
- `apps/api/src/common/redis` — shared ioredis client (rate limiter + BullMQ connection).

### Frontend — new features

- `apps/web/projects/shared` — `ProvidersApiService`, `DeploymentConfigApiService`,
  and three new UI primitives (`HostingBadgeComponent`, `ProviderBadgeComponent`,
  `YamlViewerComponent`).
- `apps/web/projects/admin/src/app/features/provider-registry` — global catalog page
  (`/providers`, nav item now live) + per-tenant credential list/create/edit/probe/delete
  page (`/tenants/:id/provider-credentials`, reachable from a Deployments row action).
- `apps/web/projects/admin/src/app/features/agent-builder` — `AgentBuilderStore`
  (SignalStore: structured draft, 400ms-debounced validate, `If-Match` token, dirty/
  conflict/unpublished-changes state) + the Agent Builder page
  (`/tenants/:id/builder`, replacing the Phase-1 placeholder route/component, which was
  deleted).

### Deviations / assumptions logged for the orchestrator

1. **New dependencies.** `tsx`, `bullmq`, `@nestjs/bullmq`, `yaml` added to `apps/api`;
   `yaml` added to `apps/web`. All except `tsx` are named explicitly in ADR-001's
   library table. `tsx` (dev-only TS seed-script runner) was checked against the ADR's
   maturity bar — maintained, MIT license, in wide production use — and passes.
2. **Unmapped schema-validation fallback code.** `codeForConfigPath`'s table (LLD §6.2)
   isn't exhaustive over every possible field; a TypeBox error on a path with no
   explicit mapping falls back to `CONFIG_YAML_PARSE`, blurring "malformed document"
   and "malformed field" slightly. In practice this only matters for hand-authored
   YAML with a wrong provider enum literal — the Agent Builder UI (§10.1) never sends
   raw YAML at all, so it never exercises this path today.
3. **Python agent-side contract mirror out of scope.** LLD §6.3's Pydantic
   `AgentRuntimeConfig` mirror and the CI fixture-corpus contract test are explicitly
   Phase 4+ work (the agent runtime doesn't exist yet). Only the TypeScript half of the
   cross-language contract exists after this dispatch.
4. **Frontend niceties simplified vs. `nexus-ux`'s guidance**, given phase scope:
   - No `<1280px` two-tab (Configuration/Preview) layout split for Agent Builder — the
     preview pane stacks below the form instead. Functionally complete, less polished.
   - No unsaved-changes route-leave guard on the Agent Builder page.
   - No two-level "multiple credentials per provider" dropdown (§10.5/§10.10 in
     UX_GUIDELINES, which nexus-ux itself flagged as an invented, unconfirmed pattern).
     The Agent Builder dropdown currently assumes one usable credential per provider
     per tenant, consistent with what `PROVIDER_CREDENTIAL_EXISTS` actually enforces
     today (duplicate *display label*, not duplicate provider) — if the product intent
     is genuinely one credential per provider per tenant, the cleaner fix is enforcing
     that at the Provider Registry layer instead of building the two-level dropdown,
     exactly as nexus-ux's open-decision note suggested.
5. **Three UX-authored (non-spec) error sentences** (`PROVIDER_CREDENTIAL_EXISTS`,
   delete-blocked `CONFIG_CREDENTIAL_MISSING`, `PROVIDER_PROBE_RATE_LIMITED`) are wired
   through as UX_GUIDELINES §9.15 specifies; the backend still returns the spec's own
   `messageForCode()` text for these codes (contracts `ERROR_MESSAGES`), and the
   frontend's own copy is only used where UX_GUIDELINES explicitly calls for authored
   copy (delete-blocked dialog, probe rate-limit snackbar) — flagged for product sign-off
   per the UX doc's own note, not silently treated as final.
6. **Tenant-isolation e2e suite (Phase 1 carry-forward, unchanged).** Still
   environment-blocked, not code-blocked — Docker/testcontainers remains unreachable in
   this sandbox. Not re-verified in this dispatch since no code here touches that suite.

---

## Phase 3 plan detail

### 3.a — LiveKit rooms/token issuer/session lifecycle + real `/internal` surface (BL-010)
- **Scope:** new `apps/api/src/modules/transport` (domain/infrastructure only —
  `LIVEKIT_CLIENT` port + `LiveKitClientAdapter`, the only file allowed to import
  `livekit-server-sdk`; room-naming/TTL helpers), new `apps/api/src/modules/sessions`
  (domain: `Session`/status machine per LLD §8.1; application:
  `IssueConversationTokenUseCase`, `GetPreflightUseCase`, `EndSessionUseCase`,
  `ApplySessionEventUseCase`, `SweepAbandonedSessionsUseCase`; infrastructure:
  `PrismaSessionRepository`, `PrismaResidencySnapshotReader` — a shared-table read of
  `DataResidencyPolicy`, same pattern as Phase 2's `PrismaPublishedConfigLookup`, since
  no `residency` module exists until Phase 7), new interface-only `public` and
  `internal` modules, `internal-app.module.ts` + rewritten `main-internal.ts` (real
  Nest application replacing the Phase-1 404 stub), session-sweeper BullMQ job added to
  `jobs`. Additive Prisma schema change: `Session.tabKey` (FR-AUTH-4 idempotency; no
  migration existed anywhere to alter, so this is not a destructive change).
- **Deliverables:** `GET /public/deployments/:slug/preflight`, `POST /public/sessions`,
  `POST /public/sessions/:id/end`, `POST /internal/livekit/webhooks` (LiveKit
  `participant_joined`/`room_finished` → the shared `ApplySessionEventUseCase`).
- **Exit gate:** unit tests for every use case/repository/adapter branch, ESLint zone
  proof that `livekit-server-sdk` is unreachable outside `transport/infrastructure`.

### 3.b — Pre-call / permissions screen (BL-011)
- **Scope:** `apps/web/projects/conversation/src/app/core` (`CallSessionStore`,
  `browser-capability.ts` feature-detect), `features/precall/pages/precall-page`
  (`/c/:slug`). `nexus-ux` dispatched first (§11 of UX_GUIDELINES) since this is a new,
  unauthenticated, touch-first UI surface with no prior guidance.
- **Deliverables:** the Screen 9 flow end to end — browser-unsupported dead end,
  backgrounded preflight, display-name/camera-toggle form, mic-permission-on-tap, all
  five spec error sentences, success hand-off to Screen 10 via router state.
- **Exit gate:** component/store unit tests covering every state in UX_GUIDELINES §11.3.

### 3.c — Live conversation screen (BL-012)
- **Scope:** `core/livekit-room.service.ts` (the only file in `apps/web` allowed to
  import `livekit-client`), `features/call/pages/call-page` (`/c/:slug/call`) +
  `features/call/pages/call-ended-page` (`/c/:slug/ended`, the authored Screen-11
  stand-in per UX_GUIDELINES §12.2/§12.9 — Screen 11 itself is BL-025, Phase 7).
- **Deliverables:** LiveKit JS SDK room connect/mic-publish/mute/end-call/reconnect
  handling, the FR-AVATAR-5 "still connecting" banner (worded as ongoing progress, not
  failure, since no agent process exists before Phase 4), `CALL_RECONNECT_FAILED` after
  30s → fresh Screen 9 session.
- **Exit gate:** component/service unit tests covering connect, mute, end-call,
  15s-no-avatar banner, and the 30s-reconnect-failure redirect (all via `fakeAsync`).

### Phase 3 status

| Item | Status |
|---|---|
| 3.a LiveKit transport + token issuer + session lifecycle + real `/internal` (BL-010) | **Done — QA-approved** |
| 3.b Pre-call / permissions screen (BL-011) | **Done — QA-approved** |
| 3.c Live conversation screen (BL-012) | **Done — QA-approved** |

Closed 2026-08-19 after 1 QA retry round (critical webhook-verification bypass and
base-href routing bug both fixed and independently re-verified against the real SDK/dev
server, plus several medium/low defects). See `docs/NEXUS_STATE.md` decision log for
full QA history.

**QA-driven fix pass (2026-08-19), backend (`qa-results/phase3-backend/REPORT.md`) and
frontend (`qa-results/phase3-conversation-spa/20260819T101500Z/REPORT.md`):**

- Backend D-1 (CRITICAL): `LiveKitClientAdapter.verifyWebhook` never awaited
  `WebhookReceiver.receive()` (async in `livekit-server-sdk@2.17.0`), so no webhook —
  forged or valid — was ever actually verified/processed, and a forged one could crash
  the internal `:8081` process via an unhandled rejection. Fixed: method + port +
  `InternalController.webhook()` call site now `async`/`await`; the unit test's mock
  shape (previously `mockReturnValue`, hiding the bug) now mirrors the SDK's real async
  signature (`mockResolvedValue`/`mockRejectedValue`); added a global
  `unhandledRejection` safety net in `main-internal.ts` as defense in depth.
- Backend D-2 (Medium): `SweepAbandonedSessionsUseCase` only implemented LLD §8.8's
  `pending`→`abandoned` half. Added the `active` past `max_duration`→`ended` half
  (`SessionRepositoryPort.listActiveJoined()` + a `wasAlreadyEnded` race guard so a
  concurrent transition never double-deletes a room).
- Backend D-3 (Medium): the internal (`:8081`) app had zero Pino/redaction wiring.
  Extracted the redaction denylist to `common/logging/pino-redact-paths.ts` and wired
  the same `LoggerModule.forRoot(...)` + `app.useLogger(...)` into
  `internal-app.module.ts`/`main-internal.ts` that the public app already had.
- Backend D-4 (Low): `EndSessionUseCase` verifies the token's identity claim (and,
  after loading the session, its room) before ever branching on session existence, so a
  non-existent session id and a bad/mismatched token both collapse to the same
  `AUTH_UNAUTHORIZED` — the prior 404-vs-401 enumeration signal is gone.
- Backend D-5 (Low): `/public/sessions/:id/end`'s body-validation failure now returns
  a new dedicated `AUTH_TOKEN_REQUIRED` code instead of overloading `AUTH_UNAUTHORIZED`.
- Frontend D-1 (Blocking): all five `router.navigate(['/c', ...])` call sites
  (`precall-page`, `call-page` ×3, `call-ended-page`) duplicated the `/c` segment
  `<base href="/c/">` already supplies, throwing `NG04002` on every real navigation.
  Fixed to base-relative arrays; verified live against a real `ng serve conversation`
  dev server (servePath `/c/`) with a one-off Playwright script (golden-path join,
  direct-reload guard redirect, and end-call → ended all reached with zero page
  errors) — the exact repro shape QA used, since Jest/`ng build` cannot catch this bug
  class.
- Frontend D-2 (Moderate): audited every `import/no-restricted-paths` zone in
  `eslint.config.mjs` for the same missing-recursive-suffix bug class flagged twice
  before in this project. Found and fixed three instances, not just the one QA
  reported: the `conversation/core` livekit-client exemption, the sibling
  `conversation/src/app` flat-file gap (`app.routes.ts`/`app.config.ts`/
  `app.component.ts` were unrestricted), and `apps/api/.../transport/!(infrastructure)`
  (`transport.module.ts`/`index.ts` were unrestricted). Root cause for the flat-file
  case specifically: `is-glob` mis-detects a bare extglob as a non-glob string once
  `path.resolve` joins it with a preceding OS path-separator backslash on Windows, so
  the rule silently falls back to plain path-containment; fixed with a trailing bare
  `*` that gives `is-glob` an unescaped glob character to detect. Every fix re-proven
  with a live negative-control probe (deliberate violation added, confirmed it fires,
  reverted, confirmed the real tree stays at 0 violations).
- Frontend D-3 (Moderate): added the mic-level meter (`LiveKitRoomService.micLevel()`)
  to Screen 10's template, adjacent to the mute button, with `prefers-reduced-motion`
  handling.
- Frontend D-4 (Low/Moderate): the camera toggle now only renders when Screen 9's
  `cameraEnabled` opt-in was carried through router state; Screen 9's camera checkbox
  hit target enlarged from 24×24 to 48×48 px.
- Frontend D-5 (Low): added the missing `.la-call__spinner` CSS (was invisible), a
  distinct camera-off icon, and `prefers-reduced-motion` handling for both the spinner
  and the mic-level meter.

Exit condition check: an end user can open `/c/:slug`, pass preflight, grant mic
permission, mint a session-bound LiveKit token via `POST /public/sessions`, join the
room (LiveKit JS SDK connects, publishes mic), mute/unmute, and end the call (fast-path
`POST /public/sessions/:id/end`, verified idempotent) — all exercised by unit/component
tests. No agent process exists yet (Phase 4+), so the "no avatar track" banner is the
expected steady state, matching the backlog's own "agent may be stub" exit condition.

### Backend — new modules (Phase 3)

- `apps/api/src/modules/transport` — `LIVEKIT_CLIENT` port (`checkReachable`,
  `createRoom`, `deleteRoom`, `mintToken`, `verifyToken`, `createAgentDispatch`,
  `verifyWebhook`) + `LiveKitClientAdapter` (wraps `RoomServiceClient`,
  `AgentDispatchClient`, `TokenVerifier`, `WebhookReceiver`, `AccessToken` from
  `livekit-server-sdk`). No `application`/`interface` layer — a pure capability module,
  the same shape `RedisModule`/`PrismaService` already use.
- `apps/api/src/modules/sessions` — owns the `Session` row lifecycle end to end
  (LLD §8.1's single writer of `Session.status` via `ApplySessionEventUseCase`'s
  explicit transition table; illegal transitions are no-ops, not errors). Depends
  one-directionally on `tenants`, `deployment-config`, and `transport` — no module
  cycle. `IssueConversationTokenUseCase` implements LLD §8.3 steps 1–7 (tenant/config
  gates → tab-key idempotency → room create → Session insert → user+agent token mint →
  explicit, best-effort agent dispatch).
- `apps/api/src/modules/public` — interface-only; `PublicController` composes
  `sessions` use cases, no `AdminJwtGuard` anywhere (end users have no accounts).
- `apps/api/src/modules/internal` — interface-only; `InternalController` exposes only
  `POST /internal/livekit/webhooks` this phase (agent-facing routes — runtime-config,
  event/utterance/hop ingest, alerts, GPU heartbeats — are Phase 4/7 additions to the
  same module, not stubbed here). Authenticated by LiveKit's own webhook signature
  (`WebhookReceiver`), not `X-Internal-Token` (that header is reserved for the
  agent-facing routes Phase 4+ adds).
- `apps/api/src/internal-app.module.ts` + rewritten `main-internal.ts` — a second,
  independent Nest application (not a second HTTP adapter on the same app — Nest has no
  first-class "one app, two ports" API) bootstrapping only `InternalModule`, listening
  on `:8081`. `express.raw()` is registered ahead of Nest's body parsing, scoped to the
  webhook path only, so `req.body` is the exact byte sequence LiveKit signed.
  `NFR-3`'s "internal URLs not exposed on the public origin" is now structurally true —
  they are never registered on the public app's router at all.
- `apps/api/src/modules/jobs` — added `session-sweeper` (1-min repeatable BullMQ job,
  `SweepAbandonedSessionsUseCase`: unjoined `pending` sessions older than 15 minutes →
  `abandoned` + best-effort room delete, FR-AUTH-4).
- Prisma: additive `Session.tabKey` column + index (see 3.a). `livekit-server-sdk`
  added to `apps/api` (named in ADR-001/LLD §1.1's library table).

### Frontend — new features (Phase 3)

- `apps/web/projects/conversation/src/app/core` — `CallSessionStore` (SignalStore:
  slug, display name, camera choice, browser-support flag, preflight/join
  status+error, issued session), `browser-capability.ts`, `LiveKitRoomService` (the
  only file allowed to import `livekit-client`; wraps room connect, mic/camera
  publish, mute, mic-level polling, disconnect, and the connection-state/
  hasAvatarVideo signals Screen 10 reads).
- `apps/web/projects/conversation/src/app/features/precall` — Screen 9
  (`/c/:slug`): browser-unsupported dead end, backgrounded preflight, display-name/
  camera form, mic-permission-on-tap, retry-in-place for `TRANSPORT_UNAVAILABLE` only.
- `apps/web/projects/conversation/src/app/features/call` — Screen 10
  (`/c/:slug/call`): connecting/waiting-for-avatar/connected/muted/reconnecting/
  reconnect-failed states, mute/end-call/camera control bar, `aria-live` status region;
  plus the authored Screen-11 stand-in (`/c/:slug/ended`).
- `apps/web/projects/shared` — `PublicApiService` (preflight/create-session/
  end-session typed HTTP client).
- `livekit-client` added to `apps/web` (named in ADR-001/LLD §1.2's library table).

### Deviations / assumptions logged for the orchestrator

1. **`nexus-ux` dispatched** for Screens 9/10 (new §§11–12 in `docs/design/UX_GUIDELINES.md`)
   before any UI was built — see its report for the full flow/state/accessibility spec
   and every invented (non-spec) decision it flagged (route shape `/c/:slug` →
   `/c/:slug/call`, the Screen-11 stand-in, the FR-AVATAR-5 banner copy, the camera
   toggle's existence at all, no confirm-dialog on end-call). Followed as given; not
   re-litigated here.
2. **Additive Prisma schema change.** `Session.tabKey` (+ index) was added for
   FR-AUTH-4's tab-key idempotency rule, which the LLD's own §4.1 Prisma schema didn't
   carry a column for. No migration has ever been applied against a real database in
   this project (`apps/api/prisma/migrations/` doesn't exist yet — Docker/Postgres has
   been unreachable in every sandbox since Phase 1), so this is additive, not a
   destructive/altering change to anything already deployed.
3. **`livekit-server-sdk`/`livekit-client` ESLint isolation zones added**, mirroring
   the existing Prisma-client and vendor-AI-SDK zones: the server SDK is importable
   only from `transport/infrastructure`; the client SDK only from
   `conversation/src/app/core/livekit-room.service.ts`. Verified with deliberate
   probe-file violations (added, linted, reverted).
4. **Agent dispatch is genuinely best-effort.** `IssueConversationTokenUseCase` mints
   an agent join token and calls `createAgentDispatch` (LLD §8.3 step 7), but no
   `avatar-agent` worker exists before Phase 4 — a dispatch failure is logged and
   swallowed, never fails token issuance to the browser. This matches the Phase 3
   backlog's own exit condition ("agent may be stub").
5. **`/internal` surface is intentionally narrow, not a stub.** Only the LiveKit
   webhook route exists this phase; the agent-facing routes (`runtime-config`,
   `events`, `utterances`, `hops`, `summary`, `alerts`, `gpu-heartbeats`) are added by
   Phase 4/7 to the same `internal` module once those bounded contexts exist. This
   was a deliberate scope decision, not an oversight — building those routes now would
   have nothing real to call them (no agent, no STT/LLM/TTS, no GPU heartbeats yet).
6. **`InternalTokenGuard`/`X-Internal-Token` deferred to Phase 4.** LLD §5.1 documents
   `X-Internal-Token` as the general `/internal` auth header, but this phase's only
   `/internal` route (the LiveKit webhook) authenticates via LiveKit's own HMAC webhook
   signature instead — a guard for a header no route checks yet would be speculative.
   Flagged so Phase 4's agent-facing routes add it deliberately, not reinvent it.
7. **No dedicated per-tenant rate limiter on `POST /public/sessions`** beyond the
   existing global `ThrottlerGuard` (300 req/60s, keyed by IP). NFR-7's own answer to
   overload is LiveKit's `503 TRANSPORT_CAPACITY` at room-creation time, not a
   control-plane-side limiter — but unlike Phase 2's provider-probe endpoint (which got
   a dedicated Redis-backed 30/tenant/min limiter), the spec doesn't call for one here
   explicitly. Flagged as a candidate hardening item, not silently assumed sufficient.
8. **LiveKit dev-mode service added to `docker-compose.dev.yml`** (`livekit/livekit-server
   --dev`, fixed `devkey`/`devsecretdevsecretdevsecret` matching `.env.example`) so a
   Docker-capable environment can exercise the real transport module — this is local
   dev tooling only, not a production deployment topology (that remains `nexus-deploy`'s
   job). Not exercised in this sandbox (Docker unreachable, same carried-forward gap as
   every prior phase).
9. **`LiveKitClientAdapter`'s exact `livekit-server-sdk` v2 call shapes are
   best-effort, unverified against a live LiveKit server.** Room creation, token
   minting/verification, webhook receipt, and agent dispatch are implemented against
   the SDK's documented v2 API surface and unit-tested against a mocked module, but
   have never run against a real LiveKit instance in this sandbox (same Docker
   blocker as items 6/8). Flagged for a Docker-capable environment (or `nexus-qa`, if
   it has one) to smoke-test before production sign-off.
10. **Conversation SPA styling is plain CSS, not Angular Material.** UX_GUIDELINES §11
    explicitly calls this "a new, distinct default design language" from the admin
    SPA's Material shell; given the phase scope, semantic HTML + hand-written SCSS was
    used instead of pulling in the Material theme/module set admin already carries —
    lighter bundle, no admin-chrome bleed. Noted as a deliberate simplification, not an
    oversight.
11. **`Session.summaryTokenHash`/`summaryTokenExpiresAt` are populated by
    `EndSessionUseCase`** even though Screen 11/BL-025 (the only consumer) is Phase 7
    work — done to keep `POST /public/sessions/{id}/end`'s wire contract
    (LLD §5.1) stable now rather than needing a breaking change later. The raw summary
    token is only ever returned once, on the transition that actually reaches `ended`;
    a duplicate end-call still returns `{status:"ended"}` per FR-TRANSPORT-4's
    idempotency rule, just without a token (the hash is one-way, nothing to re-hand out).

### Verification (Phase 3)

Backend: `jest --runInBand` 85/85 suites, 500/500 tests, coverage 98.16%/94.01%
line/branch (≥80/80 threshold) — 413 pre-existing + 87 new this phase. ESLint clean
across `apps/api`; `prisma generate && nest build` clean. Deliberate ESLint zone
probes (cross-module import, `livekit-server-sdk` outside `transport/infrastructure`)
fired correctly, then fully reverted.

Frontend: `jest --coverage` 43/43 suites, 278/278 tests, coverage 94.22%/82.95%
line/branch (≥80/80 threshold) — 231 pre-existing + 47 new this phase. ESLint clean
across `apps/web`; `ng build admin` and `ng build conversation` both clean (only the
pre-existing, unrelated `@liveavatar/contracts` CommonJS warning).

Whole-repo `pnpm -r build` and `pnpm -r lint` both clean.

Security review (LLD §5's checklist, scoped to what this phase touched): every new
tenant-facing read (`preflight`, `createSession`) resolves the tenant server-side by
slug/id, never trusts a client-supplied tenant id without an existence check;
`EndSessionUseCase` verifies the presented LiveKit token's signature *and* that its
identity/room match the target session before acting, so a session id alone cannot end
someone else's call; the LiveKit webhook is signature-verified before any DB write and
silently drops on failure (no information disclosure to an unauthenticated caller); all
public request bodies are TypeBox-validated at the edge; no raw secret (LiveKit API
key/secret) is logged (added to the Pino redaction denylist) or ever sent to the
browser; `Session` repository writes always carry an explicit `tenantId` rather than
relying on `TenantContextInterceptor`'s ALS value (which is meaningless on `/public/*`/
`/internal/*` routes with no real `:tenantId` path param) — id-only lookups
(`findById`/`findByRoomName`) use the existing `prisma.withBypass` escape hatch, the
same pattern already established for cross-tenant idempotency/tenant-create side
effects. No raw SQL, no vendor AI SDK import anywhere in this phase's code. Two gaps
disclosed above rather than silently accepted: no dedicated rate limiter on session
issuance (item 7), and the adapter's SDK-shape correctness is unverified against a
live LiveKit server (item 9).

---

## Phase 4 plan detail

### Phase 4 status

| Item | Status |
|---|---|
| 4.a STT adapters (Deepgram + faster-whisper) + hop metrics (BL-013) | **Done — QA-approved** |
| 4.b Remote LLM adapters + failover/retry + residency strip (BL-014) | **Done — QA-approved** |
| 4.c TTS adapters (Fish Speech + ElevenLabs) + hop metrics (BL-015) | **Done — QA-approved** |
| 4.d LiveKit Agents runtime (LangGraph/Pydantic AI): tools, memory, RAG hook (BL-016) | **Done — QA-approved** |
| 4.e Live captions from STT partials (BL-017) | **Done — QA-approved** |

Closed 2026-08-19 after 1 QA retry round (critical: unregistered format bug blocking
all /internal writes, STT loop never wired end-to-end, tool invocation never wired,
import-linter loophole — all fixed and independently re-verified with fresh test
harnesses across 3 parallel QA passes). See `docs/NEXUS_STATE.md` decision log for full
QA history.

Three parallel `nexus-qa` passes (`qa-results/phase4-api-internal`,
`qa-results/phase4-agent-python`, `qa-results/phase4-conversation-captions`)
returned FAIL. `nexus-dev` applied a narrowly-scoped fix pass addressing every
reported defect (see "QA fix pass" subsection below); a fresh QA pass is
required before this phase can close. Several open items are still flagged in
the deviations list below (particularly items 6, 7, 9) for the
orchestrator/architect to weigh in on independent of QA.

### QA fix pass (2026-08-19)

- **`packages/contracts` D-1/D-1b** — `date-time`/`uri` TypeBox formats were
  used in `internal/schemas.ts` but never registered in `agent-config/
  formats.ts` (only `uuid` was), so `Value.Check` unconditionally rejected
  every `at`/`started_at`/`ended_at` value — every real request to
  `POST /internal/sessions/{id}/events` and `.../utterances` was 400'd
  regardless of validity. Fixed by registering both formats; added
  `agent-internal.controller.http.spec.ts`, a real `@nestjs/testing` +
  `supertest` HTTP-pipeline test (guard + `TypeBoxValidationPipe` genuinely
  exercised, not the direct-construction unit spec that missed this).
- **`apps/agent` D-1 (Blocking)** — the STT half of the conversation loop was
  never wired: `entrypoint.handle_job` never subscribed to a room audio
  track or called `pipeline.on_final_utterance`, and `HopRecorder` was dead
  code. Fixed: `entrypoint.py` now subscribes via `Room.on("track_subscribed",
  ...)`, pumps `rtc.AudioStream` frames into the resolved `ISTTProvider`, and
  `ConversationPipeline.run_stt_loop` forwards finals into
  `on_final_utterance`, publishes every partial/final onto the room's
  transcription channel via `LiveKitTransportAdapter.publish_transcription`
  (new — this is also the fix for the parallel captions D-1), and records/
  flushes the `hop="stt"` metric through a real `HopRecorder` instance.
- **`apps/agent` D-2 (Blocking)** — FR-AGENT-2 tool invocation was unwired
  end-to-end: `build_pipeline` hardcoded `tools=[]`/`tool_specs=[]`, and
  `pipeline.py` never detected or invoked a tool call. Fixed across the
  stack: `packages/contracts/src/internal/schemas.ts` gained a new, purely
  additive `tool_definitions[]` DTO field (resolved server-side by
  `GetRuntimeConfigUseCase` via the existing read-only `ToolsModule`,
  mirrored in Python's `AgentRuntimeConfig.tool_definitions`) since
  `agent.tools[]` alone (`{name, api_ref, enabled}`) was never enough to
  actually call a tool; `LlmChunk` gained a `tool_calls` field genuinely
  populated by all three LLM adapters (OpenAI streamed-delta accumulation,
  Anthropic `get_final_message()` tool_use blocks, Gemini `function_calls`);
  `pipeline.py` now detects tool calls, invokes `ToolExecutor`, feeds results
  back as `role="tool"` messages, and gives the model one bounded follow-up
  turn (`_MAX_TOOL_ROUNDS = 1`, so a looping model can't keep a turn
  in-flight forever).
- **`apps/agent` D-3 (Moderate)** — the `vendor-sdk-isolation` import-linter
  contract's `allow_indirect_imports=True` left a proven loophole: a
  non-adapter module (`telemetry`/`residency`/`summary`/`contracts`/`ports`)
  could import an `adapters/**` submodule directly without breaking any
  contract. Fixed by broadening `orchestration-uses-ports`'s `source_modules`
  to include all five of those modules (renamed in spirit to "only
  entrypoint/registry compose adapters directly"); live-probed with a
  deliberate `telemetry` → `adapters.llm.openai` import, confirmed caught,
  reverted, confirmed the real codebase stays clean (231 dependencies, 3/3
  kept).
- **`apps/agent` D-4 (Low)** — `residency/filter.py.build_payload` raised
  unconditionally for `mode="none"` with no exception handling in
  `pipeline.py`, which would have silently swallowed the turn under
  `run_consumer_loop`'s blanket `except Exception` if ever reached. Left the
  raise itself unconditional (adding an unused `hosting` flag with no real
  plumbing would be invented scope), but added a `ResidencyBlockedError`
  handler in `_process_utterance` that now degrades the session visibly
  instead of vanishing.
- **`apps/web` (conversation) D-2** — `captionsAvailable` was initialized
  `true` and never set `false` anywhere, so FR-CALL-3's "Captions
  unavailable." fallback was dead code. Fixed: defaults `false` on
  `connect()`/`Reconnecting`/`disconnect()`, flips `true` only once a
  `TranscriptionReceived` event actually arrives — now genuinely reflects
  "has a live transcription stream been proven to exist this call."
- **`apps/web` (conversation) D-3** — the caption container rendered an
  empty dark box the instant a call connected, before any text arrived.
  Fixed: the container now also requires non-empty `captionText()` or
  `!captionsAvailable()` before rendering, so it's never an unexplained
  empty shell.
- **Regression:** Python `pytest` 160/160 (was 141), `ruff check` clean,
  `import-linter` 3/3 kept, coverage 92.26%; backend `jest --runInBand`
  576/576 (was 569), ESLint clean, `nest build`/`tsc` clean; frontend
  `jest --coverage` 292/292 (was 288), ESLint clean, `ng build admin`/
  `ng build conversation` clean.

### 4.a-d — STT/LLM/TTS adapters + LiveKit Agents runtime (BL-013/014/015/016)
- **Scope:** genuinely new Python deployable, `apps/agent` (LLD §3.3 layout in
  full): `ports/` (Protocol-only: `ILLMProvider`, `ISTTProvider`, `ITTSProvider`,
  `IAvatarProvider`, `ITransportProvider`, `SecretStorePort`, plus a shared
  `ProviderRuntime`/`Timeouts` value type), `registry/` (the only package
  importing `adapters/`; logical-key resolution, env/secret pre-resolution),
  `adapters/llm/{openai,anthropic,google,_openai_compatible}.py`,
  `adapters/stt/{deepgram,faster_whisper}.py`, `adapters/tts/{fish_speech,
  elevenlabs}.py`, `adapters/transport/livekit.py`, `orchestration/` (`pipeline.py`
  the STT→LLM→TTS loop; `failover.py` FR-LLM-2 ladder; `degraded.py` FR-ALERT-3
  throttle; `memory.py` FR-AGENT-3; `rag.py` FR-AGENT-4; `tools.py` FR-AGENT-2/5;
  `graph_langgraph.py`/`graph_pydantic_ai.py` the `agent.runtime`-selected
  orchestrators), `residency/filter.py` (FR-LLM-3/FR-PRIV-2), `telemetry/`
  (`control_plane.py` internal-API client with bounded-buffer retry, `hops.py`,
  `logging.py`), `secrets/directory_store.py`, `summary/post_call.py`,
  `contracts/` (Pydantic mirror of the canonical schema + internal-API request
  models), `settings.py`/`entrypoint.py`/`worker.py`/`__main__.py`.
- **Control-plane additions:** `apps/api/src/modules/tools` (new, read-only
  `ToolDefinition` repository — closes the Phase-2 `knownToolRefs` TODO for
  real, since `ValidateConfigUseCase`'s `CONFIG_TOOL_UNKNOWN` check now queries
  the actual table instead of an always-empty stub); `sessions` module extended
  with `GetRuntimeConfigUseCase`, `RecordUtterancesUseCase`, `RecordHopsUseCase`,
  `SetSessionSummaryUseCase`, `RecordAlertUseCase` plus three new Prisma
  repositories (`TranscriptUtterance`/`LatencyHop`/`AlertEvent` write paths —
  read side deferred to whichever Phase 7 module needs it); `common/auth/
  internal-token.guard.ts` (`InternalTokenGuard`, closing Phase 3's deferred
  `X-Internal-Token` item); `modules/internal` gets a second controller,
  `AgentInternalController`, exposing the six agent-facing `/internal` routes
  LLD §5.9 names (`runtime-config`, `events`, `utterances`, `hops`, `summary`,
  `alerts`); `packages/contracts/src/internal/schemas.ts` (wire DTOs for all
  six); `INTERNAL_TOKEN` added to the env schema/`.env.example`.
- **Deliverables:** the full listen→think→speak loop with real (not stub)
  vendor adapters behind the registry, FR-LLM-2 failover + FR-ALERT-3 degraded
  speech, FR-PRIV-2 residency enforcement at the payload-building layer, hop
  instrumentation for stt/llm/tts (avatar hop deferred — no avatar adapter
  exists until Phase 5/6), the agent-facing `/internal` surface, and the
  cross-language contract test (`apps/agent/tests/contracts/
  test_agent_config_contract.py` + `apps/api/.../agent-config-cross-language.
  contract.spec.ts`, both driven by the same `apps/agent/fixtures/agent-config/
  {valid,invalid}/*.yaml` corpus).
- **Exit gate:** Python `pytest --cov` ≥80% (actual: 90%), `ruff check` clean,
  `import-linter` all 3 contracts kept (layering, vendor-SDK isolation,
  orchestration-uses-ports-not-adapters); TypeScript `jest --coverage` ≥80% on
  changed files, ESLint clean (including the new `tools` module's LLD §3.4
  zone), `nest build`/`tsc` clean; the shared fixture corpus produces identical
  accept/reject verdicts on both language sides.

### 4.e — Live captions (BL-017)
- **Scope:** `apps/web/projects/conversation/src/app/core/livekit-room.service.ts`
  (subscribes to the LiveKit JS SDK's `RoomEvent.TranscriptionReceived` — the
  standard client-side decode of the `lk.transcription` data-channel topic
  `livekit-agents`/`rtc.LocalParticipant.publish_transcription` publishes to;
  new `captionText`/`captionsAvailable` signals), `features/call/pages/
  call-page` (caption overlay + toggle button in the control-bar slot
  UX_GUIDELINES §12.1 step 4 already reserved for this).
- **UX input:** not re-dispatched to `nexus-ux` — UX_GUIDELINES §12.1 already
  reserved the control-bar slot and named captions as "the first candidate for
  an optional side/overlay panel" (Phase 3's own forward-looking note), and a
  bottom-anchored subtitle overlay above the control bar is an extremely
  well-established, low-ambiguity pattern. Judgment calls made directly,
  recorded here rather than in UX_GUIDELINES: default **on** (FR-CALL-3
  verbatim), semi-opaque black background for WCAG 2.2 AA contrast against
  arbitrary video content, `aria-live="polite"` region, "Captions unavailable."
  shown verbatim when the source is known to be down.
- **Exit gate:** component/service unit tests for the toggle, the overlay's
  connected-only visibility, and the unavailable-state message; Jest coverage
  on changed files ≥80% (actual: `call-page.component.ts` 96%/89%,
  `livekit-room.service.ts` 100%/90%).

### Backend — new/changed modules (Phase 4)

- `apps/agent` (new deployable) — see 4.a-d above for the full layout; two
  `import-linter` contracts (`vendor-sdk-isolation`, `orchestration-uses-ports`)
  plus a `layers` contract enforce ADR-001 §3's boundary mechanically, each
  proven by the suite actually passing/failing on the real dependency graph
  (not a hand-inspected claim).
- `apps/api/src/modules/tools` — read-only `ToolDefinitionRecord`/
  `ToolDefinitionRepositoryPort`/`PrismaToolDefinitionRepository`; wired into
  `deployment-config`'s `ValidateConfigUseCase` (constructor now takes a
  fourth `ToolDefinitionRepositoryPort` argument — every existing call site in
  `validate-config.use-case.spec.ts`/`save-config.use-case.spec.ts` updated).
- `apps/api/src/modules/sessions` — `GetRuntimeConfigUseCase` (assembles the
  full `AgentRuntimeConfigDto` from the session's residency **snapshot**, the
  tenant's structured published config, and resolved `endpoint_url`s —
  never a live residency-policy re-read, FR-PRIV-2), `RecordUtterancesUseCase`/
  `RecordHopsUseCase` (batch upsert on the DB's own unique indexes so an agent
  retry after a dropped response never duplicates a row), `SetSessionSummaryUseCase`
  (the agent is the only writer of `Session.summaryText`/`summaryStatus`, HLD
  §7.3), `RecordAlertUseCase`; three new Prisma repositories
  (`PrismaUtteranceRepository`/`PrismaHopRepository`/`PrismaAlertRepository`).
- `apps/api/src/common/auth/internal-token.guard.ts` — `InternalTokenGuard`,
  constant-time `X-Internal-Token` comparison (`crypto.timingSafeEqual`,
  length-mismatch branch handled without leaking timing), applied at the
  `AgentInternalController` class level; `InternalController`'s LiveKit
  webhook route is unaffected (still signature-verified, no shared token).
- `packages/contracts/src/internal/schemas.ts` — TypeBox wire DTOs for all six
  agent-facing `/internal` routes; `packages/contracts/src/agent-config/
  formats.ts` — registers the `uuid` string format TypeBox's `format: 'uuid'`
  keyword needs (previously unregistered anywhere in the TS codebase; the
  existing `DraftAgentConfigSchema` had deliberately routed around this by
  never applying `format` to `tenant_id` at all — see deviation 3 below).

### Frontend — changed files (Phase 4)

- `apps/web/projects/conversation/src/app/core/livekit-room.service.ts` +
  `features/call/pages/call-page` — live captions (BL-017), see 4.e above.

### Deviations / assumptions logged for the orchestrator

1. **Python project structure.** `apps/agent` follows LLD §3.3 verbatim
   (`ports`/`registry`/`adapters`/`orchestration`/`residency`/`telemetry`/
   `secrets`/`summary`/`contracts` + `settings.py`/`entrypoint.py`/`worker.py`/
   `__main__.py`). Tooling: `uv`-style `pyproject.toml` (hatchling build
   backend, since no `uv` binary was available in this sandbox — installed via
   plain `pip`/venv instead, `uv` remains the documented/preferred path per
   ADR-001 §8.3 and this is purely a sandbox-tooling substitution, not a
   library-choice deviation), `ruff` (line-length raised to 130 from the
   scaffolded 110 — a house-style call, not an architectural one), `mypy`,
   `pytest`/`pytest-asyncio`/`pytest-cov`, `import-linter`. All packages in
   ADR-001's library table (`livekit-agents`, `openai`, `anthropic`,
   `google-genai`, `deepgram-sdk`, `faster-whisper`, `elevenlabs`, `langgraph`,
   `pydantic-ai`, `httpx`, `structlog`) were actually installed and exercised
   against their real (current, network-fetched) APIs in this sandbox — not
   hand-approximated from memory — which caught and fixed two genuine API-shape
   bugs during development: Deepgram 7.x's self-hosted endpoint is set via a
   `DeepgramClientEnvironment` object, not a plain `base_url` kwarg; and
   `entrypoint.build_pipeline` originally read `cfg.tenant_id` (doesn't exist —
   the field is `cfg.deployment.tenant_id`), caught by a real unit test, not a
   mock that would have hidden it.
2. **`.importlinter`'s `vendor-sdk-isolation` contract uses
   `allow_indirect_imports = true`.** LLD §3.5's illustrative config didn't
   specify this, and a strict transitive check makes the contract
   unsatisfiable by construction: `entrypoint.py` (intentionally, per its own
   LLD-documented job — "parse metadata → fetch config → build pipeline → run")
   must call `registry.resolve_*`, and `registry` legitimately imports
   `adapters` (a direct, permitted edge) which imports vendor SDKs directly —
   so `entrypoint` transitively reaches every vendor SDK no matter what. The
   contract as configured still catches the actually-important violation
   (`orchestration`/`telemetry`/`residency`/`summary`/`contracts`/`ports`
   **directly** importing a vendor SDK) and is proven live: with everything as
   shipped, all three contracts (`layers`, `vendor-sdk-isolation`,
   `orchestration-uses-ports`) pass; moving `ProviderRuntime`/`Timeouts` from
   `registry` into `ports/runtime.py` (required so `adapters/**` could
   construct one without importing `registry`, itself a `layers`-contract
   violation caught live during development) was the other structural fix
   needed to get a clean run.
3. **`packages/contracts/src/agent-config/formats.ts` (new file) registers
   TypeBox's `uuid` format.** Discovered while building the cross-language
   contract test: `Value.Check(AgentConfigSchema, ...)` on
   `deployment.tenant_id` (which carries `format: 'uuid'`) unconditionally
   failed for *any* value, because no `uuid` format was ever registered with
   TypeBox anywhere in the Phase 1-3 codebase — `DraftAgentConfigSchema`
   (Nest's Gate-A schema) had silently routed around this by never applying
   `format` to its own `tenant_id` field at all, with a comment explaining why,
   but the canonical `AgentConfigSchema` itself (the one thing the Python
   Pydantic mirror must actually agree with) was never exercised against a
   real value before this phase, so the gap was latent, not previously caught.
   Registering the format is a pure addition (an unregistered format was an
   unconditional failure, so nothing that previously passed can now fail) and
   is exactly what the Python side already enforces via `pydantic.UUID`, so
   this closes a real cross-language asymmetry rather than opening a new one.
4. **Two Gate-A cross-field rules exist only in the *validator*, not the
   *schema*, on the TypeScript side** (`backoff_ms.length === max_attempts`,
   `rag.index_ref` required when `rag.enabled`) — `schema.ts`'s own docstring
   already documented this. The Pydantic mirror enforces both as
   `@model_validator`s directly on the model. The cross-language contract test
   accounts for this documented asymmetry explicitly (the TS test runs
   `Value.Check` plus the same two extra checks `ValidateConfigUseCase.
   runSchemaGate` applies in production) rather than either weakening the
   Pydantic model or silently dropping the two fixtures that exercise this
   from the shared corpus.
5. **Avatar adapters are genuinely out of scope this phase (Phase 5/6,
   BL-018/019).** `ports/avatar.py` and `registry.resolve_avatar` exist per
   LLD §3.3's structure, but `resolve_avatar` always raises `FactoryLoadError`
   — `pipeline.py` never calls it at all this phase (no avatar hop is
   recorded; audio-only is simply the correct, expected behavior until an
   avatar adapter exists, consistent with FR-AVATAR-5's "audio continues"
   path and Phase 3's precedent of "the no-avatar banner is the expected
   steady state").
6. **RAG retrieval has no concrete index adapter.** `orchestration/rag.py`'s
   `RagIndexPort` Protocol and `RagRetriever`'s non-fatal
   "`RAG_INDEX_UNAVAILABLE`, continue without context" behavior (FR-AGENT-4)
   are fully implemented and tested; `entrypoint.build_pipeline` wires
   `RagRetriever(index=None)` since no concrete per-tenant vector/text index
   technology is named anywhere in the spec/LLD — building one would be
   inventing a requirement, not implementing one.
7. **`ToolDefinition` CRUD has no admin UI anywhere in the backlog.**
   `docs/BACKLOG.md` never assigns a screen for creating `ToolDefinition` rows
   (FR-AGENT-2's `agent.tools[].api_ref` references them, and FR-CONFIG's
   `CONFIG_TOOL_UNKNOWN` validates against them, but nothing populates the
   table). This phase makes the *read* path real (closing the Phase-2
   "always-empty known-set" TODO) and gives the agent a real `ToolExecutor`
   (10s timeout, 32 KiB untrusted-response cap, `TOOL_TIMEOUT`/
   `TOOL_HTTP_ERROR`/`TOOL_RESPONSE_TRUNCATED`), but `GetRuntimeConfigUseCase`
   does not resolve full tool HTTP definitions (method/url/credential_ref)
   into the wire response — LLD §5.9/§6.3 only documents `agent.tools[]` as
   the plain YAML shape (name/api_ref/enabled) flowing through
   `AgentRuntimeConfig`, not a resolved-tool-definitions array. Flagged for
   the orchestrator/architect: either a future phase adds an admin CRUD
   screen for `ToolDefinition` (at which point resolving full definitions
   into the runtime-config response, or a dedicated `/internal` route, would
   be the natural next step), or the tools feature is explicitly deferred
   until that screen exists — right now `agent.tools[]` can only ever be
   validated against, never actually populated by an operator.
8. **STT is required, LLM/TTS use env-default fallback only for the
   `openai-compatible` on-prem escape hatch.** Matches FR-STT-1's "v1: STT is
   required" — `build_pipeline` propagates `FactoryLoadError` for an
   unresolvable STT leg (fatal, `entrypoint.handle_job` marks the session
   `failed` with `STT_UNAVAILABLE`), but tolerates an unresolvable **fallback**
   LLM leg (logs a warning, proceeds with primary-only — FR-LLM-2's fallback
   is optional by design).
9. **The LiveKit room-join/track-subscribe glue in `entrypoint.handle_job` and
   `adapters/transport/livekit.py` is implemented against the installed
   `livekit-agents`/`livekit` 1.x documented API surface (`JobContext`,
   `WorkerOptions`, `rtc.Room`/`rtc.AudioSource`/`rtc.LocalAudioTrack`) but has
   never run against a live LiveKit server or a real GPU adapter in this
   sandbox** — the same class of gap Phase 3 disclosed for
   `livekit-server-sdk`. The STT→LLM→TTS orchestration logic itself
   (`pipeline.py`, `failover.py`, `residency/filter.py`, the registry, every
   adapter's vendor-call shape) **is** exercised against the real, installed,
   network-fetched vendor SDKs in unit tests — only the LiveKit worker
   bootstrap/room-glue layer is unverified. Flagged for a Docker/LiveKit-
   capable environment (or `nexus-qa`, if it has one) to smoke-test before
   production sign-off, same as items 6/8/9 in the Phase 3 deviation log.
10. **faster-whisper "streaming" is a disclosed approximation.**
   `WhisperModel.transcribe` is a batch call; `adapters/stt/faster_whisper.py`
   re-transcribes an accumulating buffer every ~1.5s of new audio for partials
   and does one final pass at the endpoint. This is standard practice for
   wrapping a non-streaming local model but is worth the architect/QA's
   attention if p95 latency budgets (NFR-1's STT first-partial < 400ms) turn
   out to be unreachable with this approach at the tenant's chosen model size
   — Deepgram (the other STT option) is natively streaming and unaffected.
11. **`graph_pydantic_ai.py` uses `pydantic_graph.GraphBuilder` directly,
   not Pydantic AI's `Agent`/`Model` classes.** Pydantic AI's own vendor
   `Model` wrappers (`OpenAIModel`, `AnthropicModel`, ...) import the vendor
   SDKs directly, which would pull a vendor import into `orchestration/` and
   break ADR-001 §3's boundary if used. `pydantic_graph` (the typed graph
   engine Pydantic AI itself is built on) gives a real, distinct,
   Pydantic-ecosystem control-flow structure for the `agent.runtime ==
   "pydantic-ai"` path while every model call still goes exclusively through
   `ILLMProvider` — flagged for the architect to confirm this interpretation
   of "use Pydantic AI" is acceptable, since it is a real but non-obvious
   architectural call this dispatch made rather than one LLD spelled out.
12. **No dedicated rate limiter on the agent-facing `/internal` routes** beyond
   `InternalTokenGuard`'s constant-time shared-secret check. These routes are
   never registered on the public origin (NFR-3) and are reachable only from
   inside the cluster network in a real deployment — consistent with Phase
   3's own precedent of flagging (not silently assuming sufficient) the same
   gap on `POST /public/sessions`.

### Verification (Phase 4)

**Python (`apps/agent`):** `pytest -q --cov=avatar_agent` — 141 passed, 90%
overall line coverage (every module the phase's own logic touches is at
100% or high-90s; the only sub-80% files are the LiveKit worker
bootstrap/glue disclosed in item 6 above — `worker.py`/`__main__.py`/
`adapters/transport/livekit.py`/`ports/avatar.py`/`ports/transport.py` — none
of which can be meaningfully unit-tested without a live LiveKit server).
`ruff check` clean. `import-linter` — all 3 contracts (`layers`,
`vendor-sdk-isolation`, `orchestration-uses-ports`) kept, each proven by a
real dependency-graph analysis of the actual code (not a design-doc claim);
two real layering violations were caught and fixed during development (see
deviation 2). `mypy` — 17 remaining errors, all either (a) vendor SDKs'
strict `Literal[...]` model-id unions rejecting the plain `str` this
project's logical-role architecture deliberately passes (operator-configured
data, not a compile-time-known literal — the correct trade-off given
FR-LLM-1's "swappable per deployment via config, not code changes"), or (b)
minor generic-typing friction in `graph_pydantic_ai.py`/`registry.py`'s
factory dicts. None reflect an actual runtime bug (all covered by passing,
real-API-exercised tests); flagged as a disclosed, non-blocking gap rather
than silently ignored.

**TypeScript (`apps/api` + `packages/contracts`):** `jest --runInBand` 98/98
suites, 569/569 tests (511 pre-existing + 58 new this phase), no coverage
threshold failure (every changed file individually re-verified ≥80%
line/branch, e.g. `get-runtime-config.use-case.ts` 100%/96.66% after adding
targeted branch-coverage tests). ESLint clean across `apps/api`/
`packages/contracts` (new `tools` LLD §3.4 zone added to `eslint.config.mjs`'s
generated `apiModules` list). `prisma generate && nest build` clean.
`tsc -p tsconfig.json` clean on `packages/contracts`.

**TypeScript (`apps/web`):** `jest --coverage` 43/43 suites, 288/288 tests
(233 pre-existing + 55 new — captions unit tests in both
`livekit-room.service.spec.ts` and `call-page.component.spec.ts`). ESLint
clean. `ng build admin`/`ng build conversation` both clean (only the
pre-existing, unrelated `@liveavatar/contracts` CommonJS warning).

**Cross-language contract test:** genuinely exists and passes on both sides.
`apps/agent/tests/contracts/test_agent_config_contract.py` (11 tests) and
`apps/api/src/modules/deployment-config/domain/
agent-config-cross-language.contract.spec.ts` (11 tests) both run the exact
same fixture corpus (`apps/agent/fixtures/agent-config/{valid,invalid}/
*.yaml` — Example A, Example B, a RAG-enabled config, and 7 invalid documents
covering unknown-key/missing-model/bad-language/retry-mismatch/unsupported-
transport/missing-rag-index/unsupported-version) through `AgentConfig`
(Pydantic) and `AgentConfigSchema` (TypeBox) respectively, asserting
identical accept/reject verdicts fixture-by-fixture. This is the load-bearing
mitigation ADR-001 §1/§7 names for the two-language split, and it is real —
not a stub, not "planned for later."

Security review (scoped to what this phase touched): every new agent-facing
`/internal` route requires `X-Internal-Token` (constant-time compared,
`InternalTokenGuard`), except the pre-existing LiveKit webhook route (still
signature-verified, unchanged); every route resolves the session server-side
by id and 404s on an unknown one rather than trusting agent-supplied
tenant/session data blindly; `GetRuntimeConfigUseCase` never returns a raw
secret, only `endpoint_url` + `credential_ref` (the agent resolves the actual
secret from its own `SECRETS_DIR` mount, path-traversal-checked in
`DirectorySecretStore`, tested); the residency snapshot returned is always
the session-start one, never a live re-read (FR-PRIV-2 holds on the agent
side too now, not just the control plane); tool responses are treated as
untrusted text (32 KiB cap, never `eval`'d); structlog's redaction processor
denies `api_key`/`credential_ref`/`token`/`authorization`/`text`/`transcript`
at any log level (FR-PRIV-4); no vendor AI SDK import anywhere outside
`apps/agent/src/avatar_agent/adapters/**` (grep-checked and `import-linter`-
enforced); no hand-parsed JSON from a free-text LLM completion anywhere
(`complete_structured` + Pydantic re-validation only). One gap disclosed
rather than silently accepted: no dedicated rate limiter on the agent-facing
`/internal` routes beyond the shared-secret check (item 9 above), consistent
with the same class of gap Phase 3 flagged for `POST /public/sessions`.

---

## Phase 5 plan detail

### Phase 5 status

| Item | Status |
|---|---|
| bitHuman avatar adapter + LiveKit video/audio publish + hop metrics + crash degrade (BL-018) | **Done — QA-approved** |

Closed 2026-08-19 after 1 QA retry round (a self-cancellation bug that made mid-session
avatar-crash recovery dead code, fixed and independently re-verified for both self- and
external-cancel paths). One non-blocking follow-up tracked, not gating: no reentrancy
guard on concurrent recovery attempts. See `docs/NEXUS_STATE.md` decision log for full
QA history.

### Phase 5 QA-driven fix pass (2026-08-19)

QA (`qa-results/phase5-agent-bithuman/REPORT.md`) reported one blocking defect
(D-1) and one low-severity documentation-accuracy defect (D-2). Both addressed
in this pass; scope limited to the reported defects only, no re-planning or
scope expansion.

**D-1 (Blocking) — fixed.** `_attempt_avatar_recovery`'s call to
`_cancel_avatar_pump()` was cancelling the currently-executing pump task from
within its own exception handler whenever `_pump_avatar_frames`'s `frame_iter`
crashed while genuinely running as a background task (`asyncio.ensure_future`
— the real production shape). The pending self-inflicted `CancelledError`
surfaced at the retry-delay `asyncio.sleep(2.0)` and killed the task before it
ever retried, degraded, or unpublished the video track. Fixed in
`apps/agent/src/avatar_agent/orchestration/pipeline.py::_cancel_avatar_pump`:
it now compares the pump task against `asyncio.current_task()` and only calls
`.cancel()` when a *different* task is doing the cancelling (a separate
in-flight `push_audio_frame`/`flush` failure, `aclose` teardown, or a
still-running pump from a previous session); when the pump task is cancelling
itself, it just clears the reference — the task is already unwinding via its
own `except AvatarError` clause, so no cancellation is needed to let recovery
proceed. This is a single shared method (not per-caller special-casing), so
every recovery path (start-time failure, live push-audio failure, and the
pump's own mid-stream crash) goes through the same, now-correct, logic.

New regression test added — `apps/agent/tests/orchestration/test_pipeline.py::
test_mid_stream_avatar_crash_as_a_real_background_task_completes_recovery_and_audio_keeps_flowing`
— drives the pump as a genuine `asyncio.ensure_future` background task (not
called directly, and not degraded before the task is created, unlike both
prior tests QA diagnosed as structurally blind to this bug), crashes it mid-
stream, and asserts the full retry-once-after-a-delay → retry-fails →
degrade-and-unpublish sequence completes for real (video unpublished,
`degraded` event, `provider_unreachable` alert, `hop="avatar"` error row, pump
task ends non-cancelled), plus that a subsequent `_speak()` call still pushes
TTS audio onto the room's audio track after the avatar died. The retry delay
constant (`_AVATAR_RETRY_DELAY_S`) is monkeypatched to 0.05s for test speed
only — production value (2.0s, FR-AVATAR-5) is unchanged.

**D-2 (Low, documentation accuracy) — corrected.** The prior decision-log
entry above (Verification section) claims "`mypy` scoped to exactly the 7
files this phase touched ... reports zero errors." That claim is **false as
written**: re-running `mypy` scoped to those 7 files shows 4 pre-existing
errors in `pipeline.py` (lines ~260, ~278, ~336×2 — `orchestrator: object`
lacking a `run_turn` attribute, and an unimported `LlmChunk` name), both
dating to Phase 4's tool-calling work, not to this phase's avatar changes.
`pipeline.py` is unambiguously one of the 7 touched files, so the "clean"
claim should have excluded it. This decision-log entry is left in place above
(for the historical record) but is now corrected here: **`pipeline.py` has 4
known, pre-existing mypy errors predating Phase 5**, unrelated to the avatar
feature; they are out of scope for this fix pass (Phase 4 typing debt, not
something a Phase 5 QA-driven fix pass should silently absorb) and are not
newly introduced or worsened by this pass.

**Full regression after the fix (2026-08-19):** `pytest -q --cov=avatar_agent`
— 210/210 passed, coverage 94.04% (unchanged from the pre-fix run; the new
test exercises previously-uncovered `pipeline.py` lines 562/569-region
self-cancellation-avoidance logic). `ruff check .` — clean. `mypy` scoped to
the same 7 files — 4 pre-existing errors in `pipeline.py` (see D-2 above,
unchanged count, none newly introduced). `import-linter` (`lint-imports`) —
3/3 contracts kept, 84 files, 246 dependencies, unchanged.

### 5.a — bitHuman avatar adapter (BL-018)
- **Scope:** `apps/agent/src/avatar_agent/ports/avatar.py` (settles the real
  `IAvatarProvider` shape Phase 4 left provisional — `start_session()` (no
  args, avatar identity comes from the resolved `ProviderRuntime` at
  construction, matching every other adapter), `push_audio_frame(pcm)`,
  `flush()`, `frames() -> AsyncIterator[VideoFrame]`, `close()`,
  `first_frame_ms`; new `VideoFrame` dataclass, RGB24), `ports/transport.py`
  (new `push_audio_frame`/`publish_video_track`/`push_video_frame`/
  `unpublish_video_track` on `ITransportProvider`), `adapters/avatar/
  bithuman.py` (new — the only file importing the `bithuman` SDK),
  `adapters/transport/livekit.py` (implements the new transport methods —
  `rtc.AudioSource.capture_frame`/`rtc.VideoSource`/`rtc.LocalVideoTrack`/
  `unpublish_track`), `registry/registry.py` (`resolve_avatar` now has a
  real `bithuman` factory; `alibaba-liveavatar` still raises
  `FactoryLoadError`, unchanged, until Phase 6/BL-019),
  `orchestration/pipeline.py` (`_speak` now actually publishes TTS audio
  onto the room and drives the avatar with it — Phase 4's own docstring had
  left this as a named gap; new `start_avatar_session`/
  `_attempt_avatar_recovery`/`_publish_avatar_video`/`_pump_avatar_frames`/
  `aclose`), `entrypoint.py` (resolves+starts the avatar, treating
  `AVATAR_NOT_FOUND` as fatal to job start exactly like `STT_UNAVAILABLE`;
  calls `pipeline.aclose()` on teardown). No control-plane (TypeScript)
  changes were needed — the `bithuman` catalog row (Phase 2), the
  `hop="avatar"`/`first_frame_ms` wire shape, the `degraded` session-event
  type, and the `provider_unreachable` alert type all already existed.
- **Out of scope (explicitly deferred to Phase 6, BL-019):** the Alibaba
  LiveAvatar adapter itself; `resolve_avatar` still raises
  `FactoryLoadError` for that provider key, non-fatal (audio continues),
  unchanged from Phase 4.
- **Deliverables:** a real, registry-resolvable `bithuman` `IAvatarProvider`
  that drives lip-synced video from the session's TTS audio and publishes
  it onto the LiveKit room as a second track, with `hop="avatar"` metrics
  (`first_frame_ms`, FR-AVATAR-4) recorded through the existing
  `HopRecorder`/`ControlPlaneClient` path, and the FR-AVATAR-5 crash/degrade
  state machine (retry once after 2s, then unpublish video + mark the
  session `degraded` while audio keeps flowing).
- **Exit gate:** unit tests for every adapter branch (missing credential,
  missing/malformed `avatar_id`, unknown-model `AVATAR_NOT_FOUND`, any-other
  SDK error `AVATAR_UNAVAILABLE`, mid-stream crash, close idempotency), the
  transport adapter's new publish/push/unpublish methods (idempotency,
  no-op-before-publish), and the pipeline's avatar lifecycle (start success/
  retry-then-recover/retry-then-degrade, mid-stream crash recovery, TTS
  frames reaching both the room and the avatar, `aclose` teardown) — all
  passing; `pytest --cov` ≥80% on changed files (actual: `bithuman.py`
  100%, `livekit.py` 100%, `pipeline.py` 95%, `entrypoint.py` 90%,
  `avatar.py`/`transport.py` (ports) 100%); `ruff check` clean; `mypy`
  clean on every file this dispatch touched (`mypy` scoped to just those 7
  files: 0 errors); `import-linter` all 3 contracts kept (`bithuman` added to
  `vendor-sdk-isolation`'s forbidden-module list — it was already there
  from Phase 4's stub, unchanged).

### Verification (Phase 5)

Python (`apps/agent`): `pytest -q --cov` 209/209 passed (199 pre-existing +
10 net new test functions after also strengthening existing fixtures —
`tests/adapters/avatar/test_bithuman.py` (17 tests, new file),
`tests/adapters/transport/test_livekit.py` (+8), `tests/orchestration/
test_pipeline.py` (+18), `tests/registry/test_registry.py` (updated),
`tests/test_entrypoint.py` (+3)), coverage 94.04% line (≥80% threshold).
`ruff check` clean. `import-linter` 3/3 contracts kept (84 files, 246
dependencies). `mypy` on the whole project reports 22 errors (Phase 4
disclosed 17 of the same nature — vendor SDKs' `Literal[...]` model-id
unions vs. this project's deliberately-`str` logical-role config, plus
`graph_pydantic_ai.py`'s generic-typing friction; the raw count grew since
Phase 4, apparently from installed-package/type-stub updates in files this
dispatch never touched — `openai.py`/`anthropic.py`/`google.py`/
`graph_pydantic_ai.py`), none of them in any file this dispatch added or
changed — `mypy` scoped to exactly the 7 files this phase touched
(`ports/avatar.py`, `ports/transport.py`, `adapters/avatar/bithuman.py`,
`adapters/transport/livekit.py`, `registry/registry.py`, `entrypoint.py`,
`orchestration/pipeline.py`) reports zero errors.

Security review (scoped to what this phase touched): `avatar_id` is
tenant-operator-controlled (Agent Builder, Phase 2), not raw end-user
input, but it still flows into a filesystem path
(`bithuman.py::_resolve_model_path`) — hardened with an
allow-list pattern (`^[A-Za-z0-9_-]+$`) rejecting path traversal
(`../`, absolute paths) before it ever reaches a filesystem call, rather
than trusting the control plane's own `min_length=1, max_length=128` bound
alone. No new HTTP endpoint was added this phase (avatar wiring is entirely
inside the existing agent job/room lifecycle). The `bithuman` API secret is
resolved exactly like every other provider credential (`DirectorySecretStore`,
never logged — already in the Pino/structlog redaction denylist via the
existing `api_key`/`credential_ref` rules, since bitHuman's credential is
just another `ProviderCredential` row). No vendor SDK import outside
`adapters/avatar/bithuman.py` (grep-checked, `import-linter`-enforced). No
new dependency added beyond `bithuman` itself, checked against the ADR's
maturity bar: actively maintained (`1.10.7`, current release train),
commercially-usable license terms consistent with a paid vendor SDK (same
category as `elevenlabs`/`deepgram-sdk`, already accepted), real production
adoption (bitHuman is ADR-001's named production-default avatar vendor).

### Deviations / assumptions logged for the orchestrator

1. **`IAvatarProvider`'s method shape is this dispatch's own settling of a
   Phase-4-provisional contract, not an LLD mandate.** LLD §7.1/§7.3 only
   sketch `start_session(voice_track_id) -> None` at a high level and
   explicitly note (via Phase 4's own docstring in `ports/avatar.py`) that
   the real adapters would settle the exact shape. This dispatch changed
   that signature to `start_session()` (no args — avatar identity is
   already resolved into the adapter via `ProviderRuntime.extra["avatar_id"]`
   at construction, mirroring how `voice_id`/`language` reach TTS/STT) and
   added `push_audio_frame`/`flush`/`frames`/`close` as the actual
   audio-in/video-out contract. This was a local, reversible decision (no
   real code depended on the old provisional shape — `resolve_avatar` had
   never been called with a real factory before this phase) made so
   BL-019's Alibaba LiveAvatar adapter (Phase 6) has a settled, working
   contract to implement against rather than re-deriving the same shape
   independently.
2. **Avatar video never touches LiveKit from the adapter itself.** The
   `bithuman` SDK is audio-in/video-frame-out only (confirmed against the
   real installed package — no LiveKit plugin/integration exists in it);
   `ITransportProvider` (already the only file allowed to import the
   LiveKit SDK, per the Phase 3/4 isolation zone) owns turning `VideoFrame`s
   into a published LiveKit video track. This keeps the vendor-SDK-isolation
   contract intact even though two vendor SDKs (`livekit`, `bithuman`) are
   both involved in getting one utterance's video onto the wire.
3. **bitHuman's asset-addressing scheme (how `avatar_id` maps to a real
   `.imx` model file) is this dispatch's own reversible assumption, not
   verified against a reference deployment.** Neither the LLD nor the
   Phase-2 catalog seed specify this. The operator-configured
   `ProviderCredential.endpoint_url` (already required — `requiresCredential:
   true` on the `bithuman` catalog row) is treated as the base directory
   the tenant's avatar model files live in (a bare filesystem path or a
   `file://` URL, both accepted), joined with `{avatar_id}.imx`. If the real
   production deployment addresses avatar assets differently (e.g. a remote
   object-store key bitHuman's own SDK fetches internally, or a different
   file extension), only `bithuman.py::_resolve_model_path` needs to change
   — nothing else in the codebase depends on this mapping.
4. **FR-AVATAR-1's "Session failed (no video)" is scoped to a *real* bitHuman
   `AVATAR_NOT_FOUND` (from actually asking the vendor at `start_session`
   time), not to any construction-time avatar misconfiguration.** A missing
   credential or a malformed `avatar_id` (caught by the adapter's own
   constructor, before ever asking bitHuman anything) is treated the same
   as "no avatar adapter for this provider at all" (`FactoryLoadError`) —
   non-fatal, audio continues — since the session never even attempted to
   start rendering. Only a genuine vendor-reported "no such avatar" once a
   session tries to render is fatal, matching the spec's own framing (an
   *unknown* id, discoverable only by asking bitHuman, vs. FR-AVATAR-5's
   separate "worker dies mid-session" retry/degrade path for every other
   failure).
5. **`bithuman==1.10.7`'s real, installed API was used throughout, not
   guessed from documentation.** `AsyncBithuman.create(model_path=...,
   api_secret=...)`, `push_audio(data, sample_rate, last_chunk)`, `flush()`,
   `run() -> AsyncIterator[VideoFrame]` (`.rgb_image`, `.has_image`), and
   `stop()` were all confirmed via `inspect.signature`/`dir()` against the
   package actually installed in this sandbox (`pip install bithuman`
   succeeded — pure-Python/ONNX-runtime wheel, no GPU driver needed just to
   import it). Disclosed limitation, same class of gap already accepted for
   every other vendor SDK in this project (Deepgram, `livekit-server-sdk`,
   etc.): this has never run against a real `.imx` model file, a real
   bitHuman license/token, or a live LiveKit server in this sandbox (no GPU,
   no model asset, no network egress to `api.bithuman.ai`, no Docker/LiveKit
   instance reachable here) — flagged for a GPU-capable, network-enabled
   environment to smoke-test end to end before production sign-off.
6. **No new Prisma/control-plane changes.** Everything BL-018 needed on the
   wire (the `bithuman` catalog row, `hop="avatar"`/`first_frame_ms` in
   `HopItem`, the `degraded` session-event type, the `provider_unreachable`
   alert type) already existed from Phase 2/3/4 — this phase is purely
   additive inside `apps/agent`.
7. **FR-AVATAR-5's exact client-facing copy ("Avatar video interrupted.
   Audio continues.") is not a distinct string the frontend renders.**
   Screen 10's existing "no avatar video track" banner (Phase 3,
   `LiveKitRoomService.hasAvatarVideo`/`call-page.component.ts`) is reused
   as-is for both "still connecting" and "video was interrupted" — the
   agent-side `unpublish_video_track()` call makes `hasAvatarVideo` flip
   back to `false` client-side (a real `TrackUnsubscribed` event, not a
   simulated one), which is what re-triggers that existing banner. No
   frontend changes were made or needed this phase, per the dispatch
   prompt's own framing of this as expected, not a gap.

---

## Phase 6 plan detail

### Phase 6 status

| Item | Status |
|---|---|
| Alibaba LiveAvatar avatar adapter (Example B, BL-019) | **Done — QA-approved** |

Closed 2026-08-19, PASS-WITH-CAVEATS. Code/contract-compliance/isolation/feature-gap
copy all verified correct, including end-to-end through a real seeded Postgres row to
the rendered UI (Docker was reachable in this QA pass, a first for this project). One
accepted caveat carried forward: the adapter's wire protocol is unverified against a
real vendor contract (no reachable Alibaba LiveAvatar docs/SDK) — isolated to one file,
user confirmed proceeding rather than blocking. See `docs/NEXUS_STATE.md` decision log
for the separate, more significant finding from this same QA pass: a critical
app-cannot-boot defect (F-1), being fixed as an urgent cross-cutting item next.

### 6.a — Alibaba LiveAvatar avatar adapter (BL-019)
- **Scope:** `apps/agent/src/avatar_agent/adapters/avatar/alibaba_liveavatar.py`
  (new — the only file importing `websockets`, this adapter's own vendor
  client transport), `registry/registry.py` (`resolve_avatar`'s
  `_avatar_factories()` now has a real `alibaba-liveavatar` entry alongside
  `bithuman`), `entrypoint.py`/`orchestration/pipeline.py` (stale
  "until Phase 6" comments updated for accuracy — no functional change, both
  already handled *any* resolved `IAvatarProvider` generically since Phase
  5), `apps/agent/pyproject.toml` (`websockets` added as an explicit direct
  dependency), `apps/agent/.importlinter` (`websockets` added to
  `vendor-sdk-isolation`'s forbidden-module list, the same isolation bitHuman
  gets). Control-plane: `apps/api/prisma/seed.ts` (`alibaba-liveavatar`
  row's `featureGaps` corrected to the exact FR-AVATAR-2 sentence — see
  deviation 3 below). Frontend: `apps/web/projects/admin/.../agent-builder-page`
  (new `featureGapsFor()` + a rendered feature-gap note under the Avatar
  provider dropdown — see deviation 4 below).
- **Out of scope:** any change to `IAvatarProvider`'s shape (Phase 5 already
  settled it and this phase proves it generalizes, unchanged); any change to
  `pipeline.py`'s avatar lifecycle logic (`start_avatar_session`/
  `_attempt_avatar_recovery`/`_pump_avatar_frames`/`_cancel_avatar_pump`) —
  it already treats every `IAvatarProvider` uniformly, so a second
  implementer needed zero lifecycle changes, only comment accuracy fixes.
- **Deliverables:** a real, registry-resolvable `alibaba-liveavatar`
  `IAvatarProvider` implementing `start_session`/`push_audio_frame`/`flush`/
  `frames`/`close`/`first_frame_ms` identically in shape to `bithuman.py`,
  the FR-AVATAR-2 documented-gap copy corrected to the spec's exact sentence
  and now actually rendered in the Agent Builder UI (previously defined in
  the catalog/DTO/schema but never rendered anywhere in the frontend at
  all — a pre-existing Phase 2 gap this phase closes as part of its own
  "documented feature gap in the Agent Builder UI" requirement).
- **Exit gate:** unit tests for every adapter branch (missing credential,
  missing/malformed `avatar_id`, missing endpoint, endpoint-scheme
  translation, unknown-avatar `AVATAR_NOT_FOUND`, any-other vendor error
  `AVATAR_UNAVAILABLE`, connection-failure/OS-error wrapping, malformed
  control-message handling, mid-stream frame yielding, mid-stream error/
  dropped-connection wrapping, flush-swallows-a-dead-connection, close
  idempotency) at 100% line coverage on the new file; a registry test
  proving `resolve_avatar` returns a real `alibaba-liveavatar` adapter (the
  old "still raises `FactoryLoadError`" placeholder test replaced); a
  frontend component test proving the FR-AVATAR-2 sentence renders in the
  DOM once `alibaba-liveavatar` is selected as the avatar provider, and a
  backend test pinning the seed row's `featureGaps` string to the spec's
  exact wording; `ruff check`/ESLint clean; `import-linter` all 3 contracts
  kept with `websockets` isolated to the one adapter file (grep- and
  live-probe-verified); `nest build`/`ng build admin`/`ng build conversation`
  clean.

### Verification (Phase 6)

Python (`apps/agent`): `pytest -q --cov=avatar_agent` 237/237 passed (210
pre-existing + 25 new in `tests/adapters/avatar/test_alibaba_liveavatar.py`,
+2 updated in `tests/registry/test_registry.py`), coverage 94.38% line
(≥80% threshold; `alibaba_liveavatar.py` itself 100%). `ruff check .`
clean. `mypy` scoped to every file this phase touched
(`adapters/avatar/alibaba_liveavatar.py`, `registry/registry.py`,
`entrypoint.py`, `orchestration/pipeline.py`) — zero new errors; the 4
pre-existing `pipeline.py` errors carried forward from Phase 4/5 (D-2,
unchanged line numbers) are untouched by this phase's comment-only edits
there. `import-linter` (`lint-imports`) — 3/3 contracts kept, 86 files, 255
dependencies (up from 84/246 — the new adapter file + its `websockets`
import). Live negative-control probe: added a deliberate
`import websockets` to `telemetry/hops.py`, confirmed `lint-imports`
correctly reports it as `BROKEN` under `vendor-sdk-isolation`, reverted,
confirmed the real tree is back to 3/3 kept.

Backend (`apps/api`): `jest --runInBand` 577/577 (unchanged count — one
`seed.ts` string constant changed, one new pinning test added, net effect
neutral since another suite's assertion also moved), ESLint clean,
`prisma generate && nest build` clean.

Frontend (`apps/web`): `jest --coverage` 296/296 (was 292, +4 new:
`featureGapsFor` null/no-gap/gap-present cases plus one DOM-rendering test),
ESLint clean, `ng build admin`/`ng build conversation` both clean (only the
pre-existing, unrelated `@liveavatar/contracts` CommonJS warning).

Whole-repo `pnpm -r build` and `pnpm -r lint` both clean.

Security review (scoped to what this phase touched): no new HTTP endpoint
added. The adapter's WebSocket connection sends the vendor credential as a
bearer token in a connection header, never in a URL query string (avoids it
leaking into proxy/access logs) and never logs the raw secret (resolved via
the same `DirectorySecretStore` path every other provider credential uses,
already covered by the existing structlog redaction denylist). `avatar_id`
is passed to the vendor as an opaque JSON string field — unlike bitHuman it
is never used to build a local filesystem path in this adapter, so the
path-traversal class of concern that mattered for `bithuman.py` does not
apply here (no new sanitization needed, verified by inspection: the only use
of `avatar_id` in this file is inside a JSON control message and, on the
`AVATAR_NOT_FOUND` branch, an error string). No vendor SDK import (in this
dispatch's sense — the `websockets` client standing in for a proprietary
LiveAvatar SDK) outside `adapters/avatar/alibaba_liveavatar.py` (grep +
`import-linter` enforced, live-probed). New dependency `websockets` checked
against the ADR's maturity bar: actively maintained (v15.x, current release
train), BSD-3-Clause license, extremely wide production adoption (already a
transitive dependency of `livekit-agents` in this same project) — passes
without reservation.

### Deviations / assumptions logged for the orchestrator

1. **No real, publicly verifiable Alibaba LiveAvatar SDK or API reference
   could be found from this sandbox — unlike bitHuman, where the actual
   installed package was introspected directly.** Repeated web searches for
   "Alibaba LiveAvatar" documentation, a PyPI package, or a DashScope/Model
   Studio API reference returned no usable, concrete result (search-tool
   fetches came back as generic error pages / unrelated content, not real
   vendor documentation). No `alibaba`/`liveavatar`/`dashscope` package is
   installed in `apps/agent`'s environment, and none was added — a fake
   `pip install` of an unverifiable package name would have been worse than
   disclosing the gap. **This is a materially different situation from every
   other vendor adapter in this project** (bitHuman, Deepgram, ElevenLabs,
   OpenAI, Anthropic, Google, faster-whisper, Fish Speech, LiveKit — all
   built against a real, installed, introspected SDK), so it is flagged
   loudly here rather than silently presented with the same confidence.
2. **The adapter's wire protocol is therefore this dispatch's own invented,
   reversible, locally-scoped assumption, not a verified vendor contract.**
   Built consistent with what ADR-001/LLD *do* commit to — LiveAvatar is
   classified "remote / customer-hosted per vendor contract" with a
   "TTS audio + rendered video round-trip" (LLD §1.2 table) — as a single
   WebSocket connection per avatar session (`{endpoint_url}/v1/render/
   stream`, bearer-token auth), JSON text control messages
   (`session.start`/`session.ready`/`session.flush`/`session.end`/
   `frame.meta`/`error`) interleaved with raw binary frames (PCM audio in,
   RGB24 pixel bytes out, immediately following their `frame.meta`). If a
   Docker/network-capable environment or product/architect input surfaces
   the real vendor contract and it differs, **only this one file
   (`alibaba_liveavatar.py`) needs to change** — `registry.py`,
   `entrypoint.py`, and `pipeline.py` depend only on the `IAvatarProvider`
   port, not on this adapter's internals, exactly as the port's own Phase-5
   docstring intended. Flagged for the architect/orchestrator to confirm or
   correct against a real vendor contract before production sign-off — this
   is a materially larger unverified-assumption surface than bitHuman's
   `_resolve_model_path` scheme (Phase 5 deviation 3), which was a single
   function's file-addressing convention, not an entire wire protocol.
3. **`apps/api/prisma/seed.ts`'s `alibaba-liveavatar` catalog row's
   `featureGaps` field was corrected, not left as Phase 2 shipped it.** The
   Phase 2 value ("Remote or customer-hosted per vendor contract.") was a
   hosting-classification note, not FR-AVATAR-2's actual required copy —
   and FR-AVATAR-2 is explicit that the Agent Builder preview must list a
   specific sentence: `"LiveAvatar: idle motion and custom upload may differ
   from bitHuman. Lip-sync and LiveKit publish are required."` Corrected to
   that exact string verbatim; a new backend test pins it so it cannot drift
   silently again. The lost hosting-classification wording is not a
   regression — `hosting: 'remote'` on the same row already drives the
   existing `HostingBadgeComponent` badge, so that information is still
   surfaced, just via its own dedicated UI element rather than duplicated
   inside `feature_gaps`.
4. **The Agent Builder UI never rendered `feature_gaps` at all before this
   phase**, despite the field existing in the catalog schema/DTO/seed since
   Phase 2 — grepped the entire `agent-builder-page` template and found zero
   references. This phase adds the actual rendering: a `featureGapsFor()`
   method on the component plus a conditional note (with an info icon,
   `data-testid="avatar-feature-gap"`) directly under the Avatar provider
   dropdown, and a `matTooltip` on each avatar-category `<mat-option>`
   showing the same text on hover for earlier discoverability. This was a
   pre-existing Phase 2 gap, not something Phase 2 deliberately deferred (no
   deviation note in Phase 2's own section mentions it) — closed here since
   BL-019's own exit condition explicitly calls for "documented feature-gap
   copy in the Agent Builder UI." `nexus-ux` was not re-dispatched: this is
   a small, low-ambiguity addition (a helper-text row) to an already-guided
   screen, following the exact same helper/caution text visual language
   (`.la-builder-helper`) the page already uses elsewhere, not a new flow or
   interaction pattern.
5. **No changes needed to `pipeline.py`'s avatar lifecycle, `ports/avatar.py`,
   or `ports/transport.py`.** Phase 5 already designed the avatar wiring to
   be adapter-agnostic (every method just calls through
   `self._avatar.<method>()` regardless of which concrete `IAvatarProvider`
   was resolved) — this phase's clean drop-in of a second, structurally
   different vendor (local model file + native SDK vs. remote WebSocket
   session) with zero lifecycle-code changes is itself the concrete proof
   FR-AVATAR-2 asks for ("prove the abstraction").

## Cross-cutting fix — F-1, app-boot DI defect (post-Phase-6, not a phase of its own)

Not tied to a single backlog phase — routed directly from
`qa-results/phase6-alibaba-liveavatar/REPORT.md`'s non-blocking finding F-1.
Docker was reachable for the first time this session, so this pass fixed the
defect and used the window to genuinely boot/exercise the app end to end
instead of only fixing narrowly.

**F-1 fix.** `apps/api/src/app.module.ts` provided `PrismaService` directly in
its own `providers` array with no `@Global()`/exporting module. Per NestJS's
module-scoping rules that only makes it visible inside `AppModule` itself —
every other feature module that injects `PrismaService` (tenants, auth,
admin-users, providers, deployment-config, sessions) never imported anything
exporting it, so `NestFactory.create(AppModule)` threw
`UnknownDependenciesException` at real boot (reproduced live, confirming QA's
finding exactly). Fixed by adding `apps/api/src/common/prisma/prisma.module.ts`
— a `@Global()` `PrismaModule` providing/exporting the single `PrismaService`
instance — imported once in `AppModule`. Removed the now-redundant local
`PrismaService` re-declarations in `app.module.ts` and
`apps/api/src/modules/tools/tools.module.ts` (re-declaring it locally
alongside the global module would have created a second, independently-pooled
Prisma client instead of sharing one connection pool).

**Second instance of the same defect class, found live-booting
`main-internal.ts` (:8081).** `InternalAppModule` also declared `PrismaService`
locally with the same problem, fixed the same way (import `PrismaModule`).
Additionally, booting the internal app for the first time surfaced that
`RedisModule` (`common/redis/redis.module.ts`, already `@Global()`) was never
imported into `InternalAppModule`'s own graph — `InternalModule` pulls in
`SessionsModule` → `ProvidersModule`, whose `RedisProbeRateLimiter` injects
`REDIS_CLIENT`, which is only visible within whichever independent Nest
application actually imports `RedisModule`. `AppModule` had it; the internal
app's own, separate DI container did not. Fixed by importing `RedisModule`
directly into `InternalAppModule` too. Both fixes are documented in
`internal-app.module.ts`'s own doc comment for the next person who adds a
third global-but-app-scoped module.

**Live verification (not just typecheck/compile).** Brought up a disposable
Postgres 16 + Redis 7 + LiveKit (dev mode) via a standalone compose file
(same shape as `docker-compose.dev.yml`, non-default host ports 15432/16379/
17880 to avoid this sandbox's pre-existing port occupants — same workaround
QA used). Ran `prisma generate`, `prisma db push` (no migration history exists
yet — `prisma/migrations/` is empty, consistent with QA's prior notes),
`prisma/seed.ts` (seeded all 10 catalog rows including `alibaba-liveavatar`'s
FR-AVATAR-2 feature-gap sentence), built `apps/api` with `tsc -p
tsconfig.build.json`, and ran `node dist/main.js` for real:
`NestFactory.create(AppModule)` succeeded (`PrismaModule dependencies
initialized` logged first, no `UnknownDependenciesException`), and
`GET /api/health` returned `200 {"status":"ok"}` against the live server. Ran
`node dist/main-internal.js` the same way — booted clean after the
`RedisModule` fix, confirmed via its own startup log.

**Functional smoke test against the live database (not just boot).**
Exercised real endpoints end to end: `POST /api/auth/seed` (created a real
first operator row), `POST /api/auth/login` (real JWT issued), `GET
/api/provider-definitions` (returned the real seeded 10-row catalog, byte-
identical `alibaba-liveavatar` feature-gap text), `POST /api/tenants` and
`GET /api/tenants` (real tenant created and listed against live Postgres).
`GET /api/provider-definitions` without a token correctly returned `401
AUTH_UNAUTHORIZED` — auth guard verified live, not just unit-tested.

**Phase 1's carried-forward e2e gap — now closed for real.**
`apps/api/test/tenant-isolation.e2e-spec.ts` (FR-TENANT-5 row-level tenant
isolation, written Phase 1, never executed against a live Postgres in any
sandbox before this session per every prior QA report) was run for the first
time via `@testcontainers/postgresql`, uncovering three real, pre-existing
defects in the *test harness itself* (not app code), each fixed:
  - `execFileSync('npx', ...)` with no `shell` option threw `ENOENT` on
    Windows (`npx` resolves to `npx.cmd` via `PATHEXT`, which `execFileSync`
    does not consult without `shell: true`). Fixed with
    `shell: process.platform === 'win32'`.
  - `--skip-generate` was passed to `prisma db push`, a flag the Prisma 7 CLI
    no longer accepts (`db push` now rejects it outright). Removed.
  - `--accept-data-loss` was passed to `db push`. Against this brand-new,
    empty testcontainers database it is not needed (no existing data to
    lose), and passing it tripped Prisma 7's own AI-agent safety guard
    (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`), which correctly refuses
    to run without a literal human consent message — something this agent
    cannot fabricate and did not attempt to bypass. Removed the flag rather
    than supplying fake consent; the push still succeeds without it for this
    suite's actual use case.
  After those three fixes, the suite genuinely passed (1/1) against a real,
  disposable Postgres container, driving `AppModule`'s real module tree via
  `Test.createTestingModule({ imports: [AppModule] })` (not a hand-assembled
  testing module with `PrismaService` supplied directly) — i.e. this is
  exactly the kind of run that would have caught F-1 far earlier had it ever
  executed. This is no longer an environment gap; it is a real, green,
  independently-reproducible pass. (Also observed: the suite process does not
  exit cleanly afterward — "Jest did not exit one second after the test run
  has completed" — an unclosed handle, likely BullMQ/Redis or the LiveKit
  client adapter not being torn down in `afterAll`. Non-blocking for
  correctness since the test itself passes, but worth a follow-up so CI can
  drop the assumption that this suite always needs a hard kill/`--forceExit`.)

**New finding, not fixed in this pass (flagged, not silently patched).**
Booting `InternalAppModule` for real surfaced that `ProvidersModule`'s admin-
facing HTTP controllers (`ProviderDefinitionsController`,
`ProviderCredentialsController`, both guarded by `AdminJwtGuard`) get mounted
on the internal `:8081` listener too — NestJS mounts every controller of an
imported module in the *same application*, regardless of how deeply nested
the import is, and `InternalModule` → `SessionsModule` → `ProvidersModule`
pulls its controllers along whether or not that was intended. Confirmed live:
`GET http://localhost:8081/provider-definitions` (no `/api` prefix, since
`InternalAppModule` never calls `setGlobalPrefix`) returns `500
INTERNAL_ERROR` rather than routing cleanly, because `AdminJwtGuard`'s
Passport `'admin-jwt'` strategy is registered by `AuthModule`, which
`InternalAppModule` deliberately does not import — so the guard itself throws
at request time. Not a data leak (the guard still runs and still fails
closed, just with a 500 instead of a clean 401/404), and not a regression
this pass introduced, but it does contradict `internal-app.module.ts`'s own
documented intent ("only what `/internal` routes need"). The correct fix is
architectural — splitting `ProvidersModule` into a lean, controller-free
module (for `SessionsModule`'s actual dependency, a provider lookup port) and
a separate HTTP-facing module imported only by `AppModule` — which is a new
module-seam decision, not a local/reversible one, so it was flagged here for
the orchestrator/nexus-architect rather than decided unilaterally in an
urgent fix dispatch scoped to F-1.

**Regression check.** Backend unit/integration suite: 577/577 passed, 99
suites, `jest --runInBand` (unchanged from QA's last count). Frontend:
296/296 passed, 43 suites. Python (`apps/agent`): 237/237 passed, 94.39%
coverage (untouched by this pass — included per dispatch instructions to
report full green/red state). No test files needed new assertions beyond the
three e2e-harness fixes above; the DI-graph fix required no application-code
behavior changes, only module wiring.

**Environment note.** All Docker resources created for this pass (the
standalone compose stack, the testcontainers Postgres + its `ryuk` sidecar)
were torn down at the end. `apps/api/.env` was updated to point at this
session's disposable container ports for the live-boot verification above;
it is gitignored (`.gitignore`: `.env`) and was never a tracked file — no
repo file was left in a modified state as a result of this verification pass.

---

## Phase 7 plan detail (BL-020–BL-025) — final development phase

### Phase 7 status

| Item | Status |
|---|---|
| 7.a Session logs/transcripts + hop breakdown + retention purge (BL-020) | **QA fix pass applied — pending re-QA** (D-6/D-7 fixed) |
| 7.b Dashboard: volume, errors, per-provider health (BL-021) | **QA fix pass applied — pending re-QA** (D-1/D-3 fixed) |
| 7.c GPU/node health monitor, heartbeat ingest, status-only (BL-022) | **QA fix pass applied — pending re-QA** (D-2 fixed) |
| 7.d Alerts & failover UI + degraded-mode speech (already Phase 4/5) + in-app events (BL-023) | **QA fix pass applied — pending re-QA** (D-4/D-5 fixed) |
| 7.e Data residency/privacy settings + publish-gate (BL-024) | **Built — pending QA** (no defects reported) |
| 7.f Post-call summary: transcript, optional LLM summary, feedback (BL-025) | **QA fix pass applied — pending re-QA** (D-1/D-2/D-3 fixed; D-4 flagged, unresolved, needs product/architecture decision — see Phase 7 QA fix pass section below) |

Exit condition check: all 11 screens are now live in the admin/conversation SPAs (no
"coming soon" placeholders remain anywhere in `apps/web`); per-hop latency is visible on
the Session Logs detail screen (STT/LLM/TTS/avatar/e2e, missing hops correctly omitted
rather than zero-filled); the post-call summary screen shows transcript + optional
LLM-generated summary + a working feedback form, replacing the Phase 3 "Ended" stand-in.

### 7.a — Session logs / transcripts + hop breakdown + retention purge (BL-020)
- **Scope:** new `apps/api/src/modules/session-logs` (domain/application/infrastructure/
  interface — the *read* side of `Session`/`TranscriptUtterance`/`LatencyHop`, deliberately
  separate from `sessions`, which keeps owning the write/lifecycle side per its own
  telemetry-ports docstring's forward note from Phase 4). `PurgeExpiredTranscriptsUseCase`
  is exported for the `jobs` module's new `transcript-purge` daily repeatable job.
  `sessions`' `UtteranceRepositoryPort`/`HopRepositoryPort`/`AlertRepositoryPort` gained
  read methods (`listBySession`, `searchSessionIds`, `purgeExpired`, `countLlmFailoverStats`,
  `list`) alongside their existing Phase-4 write methods.
- **Deliverables:** `GET /sessions`, `GET /sessions/:id`, `GET /sessions/:id/transcript`,
  `GET /sessions/:id/hops`; Angular `features/session-logs` (list + detail pages, Screen 5).
- **Exit gate:** unit tests for every use case/repository branch; live-verified against a
  real Postgres (see "Live end-to-end verification" below) — a real session with real
  utterances/hops written through the actual `/internal` agent-facing routes, then read
  back correctly through every one of these endpoints, including the full-text `q` search.

### 7.b — Dashboard: volume, errors, per-provider health (BL-021)
- **Scope:** new `apps/api/src/modules/dashboard` (read-only; a dedicated
  `DashboardStatsRepositoryPort` for session-volume aggregation — deliberately not a reuse
  of `session-logs`'s paginated search, a different shape for a different consumer — plus
  reuse of `providers`' existing catalog/credential read ports for the health grid).
- **Deliverables:** `GET /dashboard/summary` (range + optional tenant_id, zero-tenant-safe),
  `GET /dashboard/provider-health` (5-category grid, worst-wins aggregation across
  credentials, stale-probe->gray at >5 min per FR-DASH-2); Angular `features/dashboard`
  (Screen 1), plus a new shared `tenant-select` typeahead primitive (UX_GUIDELINES §13.8)
  reused verbatim on Sessions/GPU.
- **Exit gate:** unit tests for the worst-wins state aggregation (green/amber/red/gray),
  the zero-session "—" error-rate case (never `0%`/`NaN%`), and independent-panel-failure
  behavior (a provider-health fetch failure doesn't blank the summary widgets); live-verified
  against real session/tenant data.

### 7.c — GPU / node health monitor, heartbeat ingest, status-only (BL-022)
- **Scope:** new `apps/api/src/modules/gpu`, split into a controller-free core `GpuModule`
  (imported by `InternalModule` for the agent-facing ingest route — safe from the
  `ProvidersModule`-class leak precisely because it carries zero controllers of its own)
  and a thin `GpuAdminModule` (the admin `GET /gpu/nodes` controller, imported only by
  `AppModule`) — mirroring the fix `nexus-dev`'s F-1 pass recommended for `ProvidersModule`
  in the Phase-6 decision log, applied proactively here rather than repeating that mistake.
- **Deliverables:** `POST /internal/gpu-heartbeats` (added to the existing, correctly-scoped
  `AgentInternalController`), `GET /gpu/nodes` (role/tenant_id filters, per-host latest
  heartbeat via Prisma `distinct`); Angular `features/gpu` (Screen 6, card grid, strictly
  read-only — no scale action rendered anywhere, per FR-GPU-2).
  `ListGpuNodesUseCase` overrides `healthy` to `false` for any heartbeat older than 60s
  (FR-GPU-3), regardless of what the stale payload itself claimed.
- **Exit gate:** unit tests for the staleness override and the true-empty vs.
  filtered-to-empty state distinction; live-verified — a real heartbeat POSTed through the
  internal listener and read back correctly via the admin endpoint.
- **Deliberately not built (P2 non-goal, BL-028):** no scale-up/down action, anywhere, on
  any surface.

### 7.d — Alerts & failover config + in-app events (BL-023)
- **Scope:** new `apps/api/src/modules/alerts` (`AlertPolicy` read/update, reusing
  `sessions`' existing `AlertRepositoryPort`/`HopRepositoryPort` for the event list and
  failover-stats aggregation rather than re-implementing that persistence). Angular
  `features/alerts`: a picker/index page (`/admin/alerts`) plus the real, tenant-scoped
  screen (`/admin/tenants/:id/alerts`, two tabs — "Fallback & retry" and "Alerts").
- **Scope decision, flagged loudly (see Deviations §3 below):** fallback-LLM *identity*
  stays Agent-Builder-owned (Phase 2's own §10.5 decision) — this screen's `PUT
  /tenants/:id/alert-policy` accepts an `llm_fallback` field on the wire (matching LLD
  §5.6 exactly) but never persists it to `DeploymentConfig`; the UI never renders it as
  editable, only as a read-only projection with a link to Agent Builder.
- **Deliverables:** `GET/PUT /tenants/:id/alert-policy`, `GET /tenants/:id/alerts`,
  `GET /tenants/:id/failover-stats`.
- **Exit gate:** unit tests for retry-policy validation (`CONFIG_RETRY_INVALID`,
  `CONFIG_FALLBACK_IDENTICAL`), the empty-alerts-is-good-news state, and the
  growing/shrinking `retry_backoff_ms[]` array behavior; live-verified — a real
  `AlertEvent` recorded through `POST /internal/alerts` and read back via the admin list,
  and a real retry-policy update round-tripped through Postgres.
- **Not re-implemented here (already exists):** FR-ALERT-2's runtime failover behavior and
  FR-ALERT-3's degraded-mode speech were built in Phase 4/5's agent orchestration
  (`failover.py`, `degraded.py`) — this phase adds only the operator config surface + the
  event list display, per the backlog's own framing.

### 7.e — Data residency / privacy settings + publish gate (BL-024)
- **Scope:** new `apps/api/src/modules/residency` (`DataResidencyPolicy` read/update +
  the `CONFIG_RESIDENCY_BLOCKS_LLM` publish-gate check, which reads the tenant's
  *published* config's LLM provider and looks up its catalog `hosting` classification via
  `ProvidersModule`'s existing read port — no runtime enforcement logic duplicated here;
  the agent's own `residency/filter.py`, built in Phase 4, remains the sole enforcement
  point). Angular `features/residency`: picker/index (`/admin/residency`) + real screen
  (`/admin/tenants/:id/residency`), same split as Alerts.
- **Deliverables:** `GET/PUT /tenants/:id/residency` (with the `RECORDINGS_NOT_IMPLEMENTED`
  warning, shown proactively client-side the instant the toggle turns on, not only after
  a successful save, per UX_GUIDELINES §17.2/§17.9).
- **Exit gate:** unit tests for the retention-range validation, the residency/remote-LLM
  publish-gate block (and its two "no config yet" / "self-hosted LLM" pass-through cases),
  and the conflict/If-Match path; live-verified — a real residency update (mode +
  retention days + recordings toggle) round-tripped through Postgres, including the
  `warnings` array.
- **Also required as a follow-up, done in this pass (not new scope):** un-blocked the
  Agent Builder page's previously-disabled "Residency: … (coming soon)" line
  (UX_GUIDELINES §17.4's own flagged required edit) — it is now a real link to
  `/admin/tenants/:id/residency`.

### 7.f — Post-call summary (BL-025)
- **Scope:** replaces the Phase 3 "ended" placeholder entirely (`call-ended-page` deleted,
  no remaining references). New conversation-SPA route
  `/c/:slug/summary/:sessionId/:summaryToken` — the session id is carried in the route
  alongside the one-time `summary_token` because the backend's
  `GET /public/sessions/{id}/summary` contract requires the id as a path parameter;
  `summary_token` remains the sole authorization credential regardless of what's visible
  in the URL (UX_GUIDELINES §18.1/§18.2 step 2's own explicit contingency for this case —
  not a deviation from FR-CALL-5, which is enforced entirely server-side). New sessions-
  module use cases `GetSessionSummaryUseCase`/`SubmitFeedbackUseCase` + a new
  `PrismaFeedbackRepository`; `EndSessionUseCase` (already minting `summary_token` since
  Phase 3, in anticipation of this phase) is unchanged.
- **Deliverables:** `GET /public/sessions/:id/summary`, `POST /public/sessions/:id/feedback`;
  the conversation SPA's `features/summary` page (loading / expired-or-not-found terminal
  state, shared verbatim per FR-CALL-5's non-disclosure requirement / purged-transcript
  terminal state / summary-present / summary-absent-silently / transcript-present /
  transcript-genuinely-empty / feedback default-submitting-success-duplicate-expired
  states, per UX_GUIDELINES §18.3 in full).
- **Deviation, disclosed:** `410 TRANSCRIPT_PURGED` is a whole-endpoint failure per LLD
  §5.8's own error table (not a per-field flag inside a `200`, which is what
  UX_GUIDELINES §18.3 assumed) — treated as its own distinct terminal state rather than
  building a partial-content fetch strategy for a combination that is practically
  unreachable anyway (a 30-minute summary-token TTL can never outlive a 1–730-day
  retention window).
- **Exit gate:** component tests for every state above; live-verified end to end — a real
  session ended, its real `summary_token` hash/expiry set, then a real
  `GET .../summary` (success, wrong-token-401, and post-purge-410 cases) and a real
  `POST .../feedback` (success-201, then duplicate-409) all round-tripped through
  Postgres.

### Backend — new/changed modules (Phase 7)

- `apps/api/src/modules/session-logs` (new) — `SESSION_SEARCH_REPOSITORY` +
  `ListSessionsUseCase`/`GetSessionUseCase`/`GetTranscriptUseCase`/`GetHopsUseCase`/
  `PurgeExpiredTranscriptsUseCase`, `SessionLogsController`.
- `apps/api/src/modules/dashboard` (new) — `DASHBOARD_STATS_REPOSITORY` +
  `GetDashboardSummaryUseCase`/`GetProviderHealthUseCase`, `DashboardController`.
- `apps/api/src/modules/gpu` (new) — `GPU_NODE_REPOSITORY` +
  `RecordGpuHeartbeatUseCase`/`ListGpuNodesUseCase`; split into controller-free `GpuModule`
  (core) + `GpuAdminModule` (admin controller only).
- `apps/api/src/modules/alerts` (new) — `ALERT_POLICY_REPOSITORY` +
  `GetAlertPolicyUseCase`/`UpdateAlertPolicyUseCase`/`ListAlertsUseCase`/
  `GetFailoverStatsUseCase`, `AlertsController`.
- `apps/api/src/modules/residency` (new) — `RESIDENCY_POLICY_REPOSITORY` +
  `GetResidencyUseCase`/`UpdateResidencyUseCase`, `ResidencyController`.
- `apps/api/src/modules/sessions` (extended) — `GetSessionSummaryUseCase`,
  `SubmitFeedbackUseCase`, `PrismaFeedbackRepository`; `SessionRecord` gained
  `summaryText`/`summaryStatus`/`transcriptPurged`/`recordingPresent`;
  `UtteranceRepositoryPort`/`HopRepositoryPort`/`AlertRepositoryPort` gained read methods.
- `apps/api/src/modules/internal` — `AgentInternalController` gained
  `POST /internal/gpu-heartbeats`.
- `apps/api/src/modules/public` — `PublicController` gained
  `GET .../summary`/`POST .../feedback`.
- `apps/api/src/modules/jobs` — new `transcript-purge` repeatable job (daily, LLD §8.8
  FR-PRIV-3), `TranscriptPurgeProcessor`.
- `packages/contracts` — new `sessions/`, `dashboard/`, `gpu/`, `alerts/`, `residency/`
  schema files; `internal/schemas.ts` gained `GpuHeartbeatRequestSchema`;
  `public/schemas.ts` gained `PublicSessionSummarySchema`/`PublicFeedbackRequestSchema`.
  **No new error codes were needed anywhere** — every code Phase 7's endpoints return
  (`SESS_RANGE_INVALID`, `SESS_QUERY_TOO_LONG`, `SESSION_NOT_FOUND`, `TRANSCRIPT_PURGED`,
  `GPU_HEARTBEAT_INVALID`, `CONFIG_RETRY_INVALID`, `CONFIG_FALLBACK_IDENTICAL`,
  `CONFIG_RETENTION_INVALID`, `CONFIG_RESIDENCY_BLOCKS_LLM`, `CALL_SUMMARY_EXPIRED`,
  `FEEDBACK_ALREADY_SUBMITTED`, `FEEDBACK_INVALID`, `RANGE_INVALID`) was already scaffolded
  in `packages/contracts/src/error-codes.ts` since Phase 1–4, confirming the LLD was
  written with Phase 7 already in view.
- `apps/api/src/common/prisma/prisma.service.ts` — **critical cross-cutting fix**, see its
  own section below.

### Frontend — new features (Phase 7)

- `apps/web/projects/shared` — five new API services (`DashboardApiService`,
  `SessionLogsApiService`, `GpuApiService`, `AlertsApiService`, `ResidencyApiService`),
  `PublicApiService` extended with `summary()`/`submitFeedback()`, and a new shared
  `TenantSelectComponent` (typeahead over `GET /tenants?q=`, UX_GUIDELINES §13.8).
- `apps/web/projects/admin/src/app/features/dashboard` — Screen 1.
- `apps/web/projects/admin/src/app/features/session-logs` — Screen 5 (list + detail).
- `apps/web/projects/admin/src/app/features/gpu` — Screen 6.
- `apps/web/projects/admin/src/app/features/alerts` — Screen 7 (picker + real screen).
- `apps/web/projects/admin/src/app/features/residency` — Screen 8 (picker + real screen).
- `apps/web/projects/admin/src/app/core/layout/shell.component.ts` — every remaining nav
  item flipped from disabled/"coming soon" to live; `apps/admin/.../shared/coming-soon`
  deleted entirely (no longer referenced by any route).
- `apps/web/projects/admin/src/app/features/deployments` — two new row actions ("Alerts &
  failover", "Data residency") deep-linking to the new tenant-scoped screens, per
  UX_GUIDELINES §5.1/§5.3's own note that this phase adds them.
- `apps/web/projects/admin/src/app/features/agent-builder` — the previously-disabled
  Residency link is now live (UX_GUIDELINES §17.4's required follow-up).
- `apps/web/projects/conversation/src/app/features/summary` — Screen 11, replacing the
  deleted `features/call/pages/call-ended-page`. `call-page.component.ts`'s `onEndCall`
  now awaits the real `endSession` response and navigates to the summary screen with the
  minted `summary_token` (previously fire-and-forget, since nothing depended on the
  response before this phase).

### Critical cross-cutting fix found via live verification: `PrismaService.withBypass`/`.transaction()` silently broken against a real database

**This is the most significant finding of this dispatch** — bigger in blast radius than
a normal phase-scoped bug, discovered only because this dispatch did what the project's
own history says to do (live-verify against real Postgres rather than trust mocks alone).

**What was broken.** `common/prisma/prisma.service.ts`'s `withBypass(fn)` was implemented
as `return TenantContext.run(scope, fn)` — i.e., it ran `fn` inside an
`AsyncLocalStorage.run()` callback and returned whatever `fn()` returned. Every unit test
for this method (going back to Phase 1) passed `fn` as a genuine `async () => {...}`
function, which starts executing (and reading `TenantContext`) synchronously the instant
it's invoked — a shape that structurally cannot expose the bug, since the ALS store is
still on the call stack at that exact point no matter how `withBypass` is written.

Prisma 7's extended client (`$extends()`) instead returns a **lazy thenable** from every
model method: calling `this.prisma.db.session.findUnique(...)` does nothing at all until
something later calls `.then()`/`await`s it — and the tenantGuard extension's
`$allOperations` check only runs at that later point, not when the call is made. In
every real repository (`PrismaSessionRepository.findById`, `PrismaAlertRepository.create`,
`PrismaDashboardStatsRepository.countSessionsByOutcome`, the seed script's tenant-create
transaction, etc.) the shape is always `return this.prisma.withBypass(() =>
this.prisma.db.<model>.<op>(...))`, followed by the caller's own `await`. That `await` —
and therefore the `.then()` call that actually drives the query and trips the extension's
check — happens in the **caller's** stack frame, which is reached only *after*
`TenantContext.run()`'s callback has already returned and its dynamic extent has ended.
By the time the query engine's `$allOperations` middleware actually runs,
`TenantContext.isBypassed()` is `false` again, and the guard throws
`TenantScopeViolationError` on every single tenant-scoped model access that was supposed
to be bypassed — across every module in the codebase, not just this phase's own.

**How it was found.** Driving this phase's own new BL-020 exit gate live (recording real
utterances/hops through the real `/internal` agent-facing routes against a disposable
Postgres) failed immediately with `500 TenantScopeViolationError: Tenant-scoped query on
Session is missing tenant_id` on `POST /internal/sessions/{id}/utterances` — a route that
has existed since Phase 4 and has passed every unit test in every QA round since, because
no prior sandbox had a live database available when this exact code path was exercised
(Phase 6's F-1 live-boot verification tested `/api/auth`, `/api/tenants`,
`/api/provider-definitions` — none of which touch a `TENANT_SCOPED` model through
`withBypass`). Reproduced and confirmed the root cause in isolation with a minimal
standalone script (a fake tenantGuard-shaped extension + a fake lazy thenable that defers
its own `.then()` to a later microtask, mimicking Prisma's real behavior) before touching
any application code, to be certain of the mechanism rather than guessing.

**The fix.** `withBypass` now chains `.then(resolve, reject)` onto `fn()`'s result
*inside* `TenantContext.run()`'s callback, so the resulting promise continuation is
created while the ALS store is synchronously active — Node's `AsyncLocalStorage` then
correctly threads that store through every subsequent continuation of the chain
(including the real socket I/O the `@prisma/adapter-pg` driver performs), regardless of
how many real async hops occur before the query actually resolves:

```ts
withBypass<T>(fn: () => Promise<T>): Promise<T> {
  const current = TenantContext.get();
  const scope = { tenantId: current?.tenantId ?? null, bypass: true };
  return new Promise<T>((resolve, reject) => {
    TenantContext.run(scope, () => {
      fn().then(resolve, reject);
    });
  });
}
```

`transaction()` needed no separate fix — it already delegates to `withBypass` internally.

**Verification of the fix.** Re-ran the standalone isolation script with the fixed shape:
confirmed `TenantContext.isBypassed()` now reads `true` at the exact point the tenantGuard
extension checks it, and a real `db.session.findFirst({})` call against live Postgres
succeeds. Rebuilt the whole API (a stale `.tsbuildinfo` from an earlier `tsc --noEmit`
check was also found and cleared in the process — unrelated packaging hygiene issue, not
an application bug), reran every previously-failing live call
(`POST /internal/sessions/{id}/utterances`, `.../hops`) — both now return `204` and the
data is correctly readable back through `GET /api/sessions/{id}/transcript` and
`.../hops`. Added a new permanent regression test to `prisma.service.spec.ts` that
reproduces the exact lazy-thenable shape (not another eager-async-function test, which
would pass even on the broken implementation) — this test fails against the pre-fix
implementation and passes against the fixed one. Full backend suite re-run after the fix:
128 suites / 715 tests passed (was 714 before the regression test was added), coverage
unchanged at ≥93%/83%. `tsc`/`nest build`/`eslint` all clean.

**Severity assessment.** This bug affects every `withBypass`/`transaction()` call site in
the entire control plane, going back to Phase 1 — tenant creation's transactional side
effects, the idempotency store, provider probes, session lifecycle writes, and every read
this phase added. It has been silently broken since Prisma 7's adapter-based client was
adopted, invisible because (a) unit tests universally mocked `PrismaService` with plain
jest functions that don't reproduce the lazy-thenable timing, and (b) no prior sandbox
had live Postgres reachable at the moment any of these code paths actually ran end to
end. Flagged as the header finding of this dispatch, not buried in Phase 7's own scope,
because its blast radius is the whole application, not one phase.

### Live end-to-end verification (this dispatch, real Postgres + Redis via Docker)

Docker was reachable this session. Rather than rely on unit tests alone for Phase 7's
`nexus-dev`-required end-to-end trace, stood up disposable Postgres 16 + Redis 7
containers (on non-default host ports, since this machine already runs unrelated
projects' own Postgres/Redis containers on the standard 5432/6379 — nothing else on the
system was touched), ran `prisma db push` + the seed script for real, built the API with
real `tsc`, and booted both `main.js`/`main-internal.js` for real. Exercised, against the
live database, in order: operator seed + login; tenant creation (which also verified the
default `DataResidencyPolicy`/`AlertPolicy` rows Phase 1's transactional create still
produces correctly); `GET /dashboard/summary`/`.../provider-health` on an empty tenant;
`GET /gpu/nodes` (empty); `GET /sessions` (empty) — all correctly zero-state, not errors.
Inserted one real `Session` row directly (standing in for `IssueConversationTokenUseCase`,
since a full LiveKit round trip was out of scope for this phase's own verification) and
then drove the **real, wired agent-facing pipeline** through it: `POST
/internal/sessions/{id}/utterances` and `.../hops` (this is where the
`TenantScopeViolationError` bug above was found and fixed), then confirmed `GET
/api/sessions`, `.../{id}`, `.../{id}/transcript`, `.../{id}/hops`, and
`/dashboard/summary`'s session counters all correctly reflect the real written data,
including a real full-text `q=Hello` search hit via the on-the-fly `to_tsvector` query.
Exercised `POST /internal/gpu-heartbeats` -> `GET /api/gpu/nodes`; `POST
/internal/alerts` -> `GET /api/tenants/:id/alerts`; `PUT .../residency` (including the
`RECORDINGS_NOT_IMPLEMENTED` warning) and `PUT .../alert-policy`, both round-tripped with
real `If-Match` values read back from a prior `GET`. Set a real `summary_token`
hash/expiry on the session (standing in for `EndSessionUseCase`'s own mint, already
covered by its own Phase-3 unit tests) and exercised the full BL-025 flow: `GET
.../summary` (success — real transcript + summary text rendered), a wrong-token attempt
(correct `401 CALL_SUMMARY_EXPIRED`), `POST .../feedback` (`201`), a duplicate submit
(correct `409 FEEDBACK_ALREADY_SUBMITTED`), and confirmed `feedback_submitted: true` on a
subsequent `GET .../summary`. Finally, drove `PurgeExpiredTranscriptsUseCase`'s real
compiled code directly (aged the session's `started_at` past the tenant's
`retain_transcripts_days`) and confirmed the raw-SQL two-step purge genuinely nulls
transcript text and flips `transcript_purged`, and that both `GET .../transcript` and
`GET .../summary` correctly 410 afterward. Also ran the pre-existing
`test/tenant-isolation.e2e-spec.ts` (testcontainers-based) to confirm this dispatch's
`PrismaService` fix doesn't regress that suite — see its own result noted in the decision
log. All containers and server processes created for this verification were torn down
afterward; `apps/api/.env` (gitignored, never tracked) was left pointing at this session's
now-torn-down disposable ports, same disclosed-and-harmless precedent as the Phase 6 F-1
pass.

### Deviations / assumptions logged for the orchestrator

1. **Full-text search (`q`) uses an on-the-fly `to_tsvector`/`plainto_tsquery` match**,
   not LLD §4.2's persisted generated `tsvector` column + GIN index — this project has
   never committed a versioned migration (every schema change so far has gone through
   `prisma db push` in ad-hoc sessions), so adding a raw-SQL migration step with no
   migration pipeline to carry it would be inventing infra this dispatch doesn't own.
   Functionally equivalent, computed per query instead of from a precomputed index — a
   disclosed performance trade-off only, verified correct against real Postgres. Flagged
   for `nexus-deploy`/the architect once a real migration pipeline exists.
2. **`ListSessionsUseCase`'s "admin with no `tenant_id`" behavior** defaults to scoping
   the search to the admin's own assigned tenants (rather than erroring) — a local,
   reversible interpretation of FR-SESS-1's "required for admin" input rule, consistent
   with every other list endpoint's "empty scope, not a hard failure" posture
   (`ListTenantsUseCase`'s own precedent). An admin naming a `tenant_id` they aren't
   assigned to gets an empty result, not `403`, for the same reason. UX_GUIDELINES §14.9
   independently flagged the *client-side* version of this same question (whether to
   even fire the request before a tenant is chosen) — the frontend's own "Choose a
   deployment" prompt state (§14.3) means this backend fallback is defense-in-depth, not
   the primary UX.
3. **Alerts screen's `llm_fallback` scope conflict, resolved per UX_GUIDELINES §16.9's own
   flag, not silently picked.** `UpdateAlertPolicyUseCase` accepts an `llm_fallback` field
   on the wire (matching LLD §5.6's documented contract) but never persists it — fallback
   *identity* stays Agent-Builder-owned (Phase 2 §10.5's decision), this screen owns only
   retry timing + the degraded message. **This is flagged as a genuine, unresolved
   product conflict**, not a small wording nit: if product instead wants this screen to
   edit fallback identity directly (matching this backlog item's own brief, which did
   describe "a config form for fallback LLM"), the two-level provider→credential dropdown
   pattern from Agent Builder (§10.5) would need to be lifted into this screen, and
   Agent Builder's own docs updated so the two screens don't silently disagree about who
   owns the field.
4. **Whether `PUT /tenants/{id}/alert-policy` is a true full-replace or tolerates a
   partial body is unconfirmed** (UX_GUIDELINES §16.9's own flag) — this dispatch's
   `UpdateAlertPolicyUseCase` only ever writes `retry_max_attempts`/`retry_backoff_ms`/
   `degraded_mode_message` to the `AlertPolicy` row itself (never touches
   `DeploymentConfig`), so this ambiguity doesn't currently bite in practice, but the
   wire contract's own `llm_fallback` field remains unconfirmed as to its intended
   semantics if a future pass does wire it up.
5. **`GET /dashboard/provider-health` has no `tenant_id` filter**, per LLD §5.7's own
   endpoint signature (unlike `/dashboard/summary`, which does) — the frontend's
   `tenant-select` control therefore only ever re-fetches the three summary widgets, never
   the health grid, exactly as UX_GUIDELINES §13.9 itself flagged and resolved (no silent
   mismatch — confirmed backend-side that this is the actual, deliberate LLD contract,
   not an oversight this dispatch introduced).
6. **No Python (`apps/agent`) changes in this dispatch.** FR-GPU-3's heartbeat sender is
   infrastructure that runs on each self-hosted GPU box, not part of the LiveKit
   conversation-agent process `apps/agent` implements — building a heartbeat-sending
   daemon has no home in the existing Python package's scope (it isn't a per-session
   worker) and wasn't asked for by BL-022 itself ("heartbeat ingest endpoint... status
   display ONLY"). The ingest endpoint + admin display are both real and live-verified;
   the sender is deployment-time infrastructure, `nexus-deploy`'s domain if/when it's
   needed.
7. **Post-call summary's transcript-purged state is a whole-endpoint `410`**, not a
   per-field flag inside a `200` response as UX_GUIDELINES §18.3 assumed when it was
   written without the LLD's exact contract in front of it — see 7.f above. Treated as
   its own distinct terminal state, practically unreachable given the token TTL vs.
   retention-window difference in scale.
8. **Two Deployments-list row actions ("Alerts & failover", "Data residency") were added**
   to the existing menu per UX_GUIDELINES §5.1/§5.3's own note that Phase 7 does so —
   confirmed this is additive to Screen 3, not a redesign of it.
9. **The pre-existing `ProvidersModule`-controller-leak-onto-`:8081` finding from the
   Phase-6 F-1 decision log is unchanged and was NOT fixed in this dispatch** (confirmed
   still present during live verification: `TenantsController`/`DeploymentConfigController`/
   `ProviderDefinitionsController`/`ProviderCredentialsController` are still reachable on
   the internal listener via `InternalModule` → `SessionsModule` → {`TenantsModule`,
   `ProvidersModule`, `DeploymentConfigModule`}). Out of scope for Phase 7 (a pre-existing,
   already-flagged architectural item, not something this dispatch's own work touches or
   worsens) — confirmed this dispatch's own new modules (`session-logs`, `dashboard`,
   `alerts`, `residency`, and the admin half of `gpu`) do **not** add to this leak, since
   none of them are imported by `SessionsModule`/`TransportModule`/the core `GpuModule`.
   Recommend the orchestrator route this pre-existing item to a dedicated architecture
   fix pass (the `ProvidersModule` core/interface split already recommended in the Phase-6
   decision log) independent of Phase 7's own QA.
10. **Simplifications vs. `nexus-ux`'s full guidance, given the phase's sheer size** (6
    screens across two SPAs in one dispatch) — noted here rather than silently shipped as
    if fully matching every documented detail:
    - Sessions list: date-range (`from`/`to`) filter inputs were not built (only `q`,
      `status`, `tenant_id`, pagination) — the backend fully supports `from`/`to` and has
      unit-test coverage for `SESS_RANGE_INVALID`, but the UI control itself (a
      `mat-datepicker` pair per UX_GUIDELINES §14.1) was left for a follow-up pass given
      time.
    - Alerts screen: implemented as a simple two-button tab switcher (not a `mat-tab-group`)
      and plain HTML form controls (not `mat-select`/`mat-slide-toggle`) for the retry
      fields — functionally complete and accessible (labelled, keyboard-operable) but not
      pixel-matched to the Material design language the rest of the admin SPA uses.
      Residency screen has the same simplification (plain radio/checkbox inputs, not
      `mat-radio-group`/`mat-slide-toggle`).
    - No route-leave dirty-check / unsaved-changes guard was added to the Alerts/Residency
      forms (Agent Builder's own precedent from Phase 2 already didn't have one either, per
      that phase's own disclosed deviation).
    - GPU health screen uses a manually-built CSS grid rather than any new shared "card
      grid" primitive (UX_GUIDELINES §15.8 itself said not to promote one, since no other
      screen needs a bare card grid — this matches that guidance, not a deviation from it).
11. **Recommendation for the orchestrator: this phase would have benefited from being
    split into 2–3 parallel `nexus-dev` dispatches** (e.g., session-logs+dashboard+jobs as
    one; GPU+alerts+residency as a second; the conversation-SPA summary screen as a
    third), given it was, item-count-wise, the largest single dispatch in the project so
    far (6 backlog items, 2 SPAs, a new backend bounded-context per item, plus the
    cross-cutting `PrismaService` fix). It was completed as one dispatch per this
    session's instructions, but a future project of comparable phase size might complete
    faster and with tighter per-item focus split across dispatches that don't share a
    single context window.

### Verification (Phase 7)

**Backend (`apps/api` + `packages/contracts`):** `jest --runInBand` 128/128 suites,
715/715 tests (was 714 pre-existing +1 new regression test this phase; net new tests
this phase are considerably more than +1 — the suite count already included every new
module's own tests from this dispatch, with 714 being the count *after* all Phase 7
modules were added and *before* the `PrismaService` regression test was appended).
Coverage ≥93%/83%/95%/93% overall (line/branch/function/statement), comfortably above
the 80% floor; every new file individually at or above 80% line coverage. ESLint clean
(`eslint "src/**/*.ts" "test/**/*.ts"`). `tsc --noEmit`/`nest build` both clean.
`packages/contracts`: `tsc`/ESLint clean.

**Frontend (`apps/web`):** `jest --runInBand --coverage` 61/61 suites, 403/403 tests.
Coverage 95.52%/84.08%/95.26%/95.51% overall; every new Phase 7 file individually at or
above 75% branch / 90%+ line coverage (a few trivial one-line delegate methods sit at
50–75% branch, e.g. the picker pages' null-tenant branch). ESLint clean
(`eslint "projects/**/*.ts"`). `ng build admin` and `ng build conversation` both clean
(only the pre-existing, unrelated `@liveavatar/contracts` CommonJS warning, unchanged
since Phase 1).

**Whole-repo:** `pnpm -r build` and `pnpm -r lint` both clean across
`packages/contracts`, `apps/api`, `apps/web` (no `apps/agent` changes this phase, so its
own Python suite was not touched or re-run).

**Live Postgres/Redis verification:** see the dedicated section above — every new
endpoint this phase added was exercised against a real, disposable database and returned
correct data, including the cross-cutting `PrismaService.withBypass` fix this
verification pass required and produced.

Security review (scoped to what this phase touched): every new admin endpoint sits behind
`AdminJwtGuard`+`RolesGuard`, resolving the tenant server-side and using
`canAccessTenant()`/the existing cross-tenant-404 convention — no new `403`-vs-`404`
information leak introduced (verified: cross-tenant session ids collapse to the same
`SESSION_NOT_FOUND` as a genuinely unknown id, both in session-logs and the post-call
summary flow). The new `POST /internal/gpu-heartbeats` route sits behind the existing
`InternalTokenGuard` (constant-time compare), on the existing, correctly-scoped
`AgentInternalController` — no new controller/module was added to the internal listener
that could repeat the `ProvidersModule`-class leak (the new `GpuModule` core has zero
controllers by design). The public `GET .../summary`/`POST .../feedback` routes are
gated solely by the one-time, hashed, TTL'd `summary_token` — never the raw session id —
and a wrong/expired/reused-after-duplicate-submit token is never distinguishable from a
well-formed-but-nonexistent one (FR-CALL-5's non-disclosure requirement, verified live).
No raw SQL string-concatenation anywhere (the one new raw-SQL surface, full-text search
and the retention purge, both use parameterized `$queryRaw`/`$executeRaw` tagged
templates — verified the search term is never concatenated into the query string). No
vendor AI SDK import anywhere in this phase's TypeScript code (this phase touches no AI
boundary at all — it is purely control-plane read/write surfaces around data other
phases already produce).

### Phase 7 QA fix pass (post-QA, three parallel reports: backend PASS-WITH-CAVEATS,
admin SPA PASS-WITH-CAVEATS, conversation summary FAIL)

**Status: fixes applied, re-verification pending a fresh `nexus-qa` pass** (this
dispatch does not mark the phase done — that is the orchestrator's QA-driven call).

**D-1 (conversation-summary, BLOCKING, third recurrence of the "built but never wired"
class after Phase 4's STT/tool-calling misses):** `summary/post_call.py`'s
`generate_and_send_summary` was fully unit-tested in isolation but never invoked from
the real per-call agent job handler, so every genuinely-ended production session was
permanently stuck at `summary_status="none"`. Fixed by adding
`ConversationPipeline.generate_summary()` (`apps/agent/src/avatar_agent/orchestration/
pipeline.py`) — builds a `ResidencyPayload` directly from the session's own memory
window (respecting the session's residency snapshot, defensively skipping a
`residency_mode == "none"` session the same way `_process_utterance` already does) and
calls `generate_and_send_summary` with the pipeline's own resolved primary LLM — and
wiring it into `entrypoint.handle_job`'s `finally` teardown block
(`apps/agent/src/avatar_agent/entrypoint.py`), alongside the existing `"ended"` event
send. Per the dispatch brief, added a genuine integration-style regression
(`test_handle_job_genuinely_reaches_and_posts_the_post_call_summary_on_teardown` in
`apps/agent/tests/test_entrypoint.py`) that drives the real `handle_job` end-of-call
path with a real `ConversationPipeline` instance (only the LLM/network-boundary
adapters faked) and asserts a summary is genuinely posted via
`ControlPlaneClient.send_summary` — not merely that `generate_and_send_summary` works
called directly, which is exactly how this bug class stayed hidden three times running.
Also added direct unit tests for `generate_summary` itself in
`apps/agent/tests/orchestration/test_pipeline.py` (ready/unavailable/residency-blocked
paths).

**D-2 (conversation-summary, BLOCKING):** `SummaryPageComponent.feedbackSubmitted`
was never initialized from the `GET .../summary` response's own `feedback_submitted`
field, so reopening/reloading a summary link after feedback was already submitted
incorrectly re-showed the full rating form. Fixed in `fetchSummary()`'s success handler
(`apps/web/projects/conversation/src/app/features/summary/pages/summary-page/
summary-page.component.ts`) to call `this.feedbackSubmitted.set(summary.feedback_submitted)`.

**D-3 (conversation-summary, low, batched in):** the star-rating control used
`role="radiogroup"` on the container but `aria-pressed` toggle-button semantics on the
stars themselves — not a recognized ARIA pattern. Fixed to `role="radio"`/`aria-checked`
per-star with roving `tabindex` and arrow-key navigation (`onStarsKeydown`).

**D-4 (conversation-summary, flagged, NOT fixed — left as-is per explicit
instruction):** UX_GUIDELINES §18.3's "a purged transcript does not block feedback"
sentence cannot be reconciled with the LLD's own `GET .../summary` contract, which
returns a whole-response `410 TRANSCRIPT_PURGED` with no body once purged — there is
structurally no `feedback_submitted`/summary data left to render "normally" once that
error fires. The current implementation (both `GetSessionSummaryUseCase` and
`SummaryPageComponent`) follows the LLD's literal contract (full-card terminal state, no
form) and is not being changed by this pass. **This is a genuine, unresolved
spec/LLD-vs-UX-guideline inconsistency for the orchestrator/architect to reconcile** —
either the LLD needs an amended response shape (e.g. a per-field `410` flag inside a
`200` body) or the UX guideline's sentence needs correcting. Not silently picked either
way.

**D-6 (admin SPA, highest severity, RECURRING BUG CLASS — 5th occurrence after Phase 1
x3/Phase 2 x1):** the Sessions list never got the phone stacked-card layout
UX_GUIDELINES §14.7 requires (721px table clipped inside a 375px viewport, no page
scroll). Fixed by applying the exact `data-label` + `max-width: 767px` media-query
pattern already proven in `deployments-list-page.component.scss`
(`apps/web/projects/admin/src/app/features/session-logs/pages/sessions-list-page/
sessions-list-page.component.html`/`.scss`). **Proactive sweep** (per the dispatch's
explicit instruction, given how often this bug class recurs): checked every other
Phase 7 table/list — Dashboard, GPU, Alerts have none (cards/lists only, GPU already
phone-correct per QA); found and fixed the same gap on the session-detail latency
table (`session-detail-page.component.html`/`.scss`), which UX_GUIDELINES §14.7 itself
says should degrade to a stacked row-per-cycle at phone width and had no responsive
treatment at all.

**D-4 (admin SPA/Alerts, blocking-equivalent — claimed built, actually absent):** the
Alerts screen's read-only "Fallback LLM" display + "Edit in Agent Builder" link
(UX_GUIDELINES §16.2 step 4) was entirely absent despite a prior decision-log entry
claiming it existed. Built in `alerts-page.component.html`/`.ts` — a read-only
`fallbackLlmDisplay` computed showing `provider / model` or "No fallback configured",
plus a `routerLink` to `/tenants/:id/builder`. (Note: this is a plain gap-fix, distinct
from the pre-existing, still-open §16.9 product question of whether this screen should
ever *edit* fallback identity — that flagged conflict is untouched by this fix.)

**D-1/D-2/D-5/D-7 (admin SPA, low, batched in as instructed):**
- Dashboard provider-health category labels rendered as `Stt`/`Llm`/`Tts`
  (CSS `text-transform: capitalize` over the raw enum key) — fixed with a
  `categoryLabel()` mapping to `LiveKit`/`STT`/`LLM`/`TTS`/`Avatar`
  (`dashboard-page.component.ts`/`.html`/`.scss`).
- GPU node role labels rendered as raw `stt`/`tts`/`avatar` — fixed with a
  `roleLabel()` mapping to `STT`/`TTS`/`Avatar`, mirroring the existing `roleIcon()`
  pattern (`gpu-page.component.ts`/`.html`).
- Alerts event rows showed the raw snake_case `type` with no icon — fixed with an
  event-type → icon/label map (`llm_failover`→`sync_problem`/"LLM failover", etc.,
  `alerts-page.component.ts`/`.html`).
- Sessions list "Provider stack" column showed only `provider_stack.llm` — fixed with
  a `providerStackSummary()` that renders all five populated categories
  (transport/stt/llm/tts/avatar) as a compact, em-dash-on-empty list
  (`sessions-list-page.component.ts`/`.html`).

**D-3 (admin SPA/Dashboard, moderate, batched in):** the phone-width range control
stayed a 3-button `mat-button-toggle-group` instead of converting to a `mat-select` per
UX_GUIDELINES §13.6. Fixed with a `BreakpointObserver`-driven `isPhone` signal
(`dashboard-page.component.ts`) that conditionally renders a `mat-select` below 599px,
same convention already used for the shell's own desktop/mobile sidenav switch
(`core/layout/shell.component.ts`).

**Regression after fixes — all green, no regressions:**
- Python (`apps/agent`): `pytest --cov=avatar_agent` 241/241 (was 237 pre-fix; +4 new
  tests — 1 real end-to-end teardown-path regression plus 3 `generate_summary` unit
  tests), 94.41% coverage (`post_call.py`/`pipeline.py`/`entrypoint.py` all 90%+); `ruff
  check .` clean; `lint-imports` (`.importlinter`) clean — 3/3 contracts kept, confirming
  the new `summary.post_call` import from `orchestration/pipeline.py` (deliberately a
  local import, to keep the dependency one-directional) doesn't violate the agent's
  layering rule.
- Backend (`apps/api`): untouched this pass (no backend defects were reported) —
  `jest --runInBand` 128/128 suites, 715/715 tests (unchanged), ESLint clean, `tsc
  --noEmit`/`nest build` clean.
- Frontend (`apps/web`): `jest --coverage` 61/61 suites, 424/424 tests (was 403 pre-fix;
  +21 new tests across summary-page/sessions-list-page/session-detail-page/gpu-page/
  dashboard-page/alerts-page specs). Every file this pass touched sits at or above the
  80% line/branch floor (several were brought from a pre-existing sub-80% branch figure
  up to 100% as part of covering the new code; `session-detail-page.component.ts` and
  `sessions-list-page.component.ts`'s remaining sub-80% branch lines are pre-existing,
  outside this pass's own added/changed logic, and were left as pre-existing gaps
  rather than expanded scope). ESLint clean. `ng build admin`/`ng build conversation`
  both clean (only the pre-existing, unrelated `@liveavatar/contracts` CommonJS
  warning).

### Phase 7 QA retry round 2 — D-5 (agent summary teardown safety), final fix

QA retry #1 re-verified D-1 as genuinely fixed on the golden path, but its own fresh
probing found **D-5**: the "never raises" safety property the D-1 fix relies on was
*assumed*, not *enforced*. `generate_and_send_summary` caught only `LlmError`, while the
real `openai` adapter's `complete_structured` classified only `RateLimitError`/
`APITimeoutError`/`APIConnectionError`/`APIStatusError` — so an `AuthenticationError`
(credential revoked mid-call), a `NotFoundError` (model deprecated mid-call), an empty
`choices` response, or a `pydantic.ValidationError` from its own re-validation step
escaped as a non-`LlmError`, propagated out of `entrypoint.handle_job`'s teardown
`finally` itself, skipped the terminal `"ended"` session event, and raised out of the
job entrypoint. Fixed in **three independent layers** (deliberately independent: the
root cause of D-5 was exactly one layer being trusted to be exhaustive forever):

1. **Adapter classification (root cause).** `OpenAiLlmAdapter` gained a `_classify`
   method mirroring `anthropic.py`/`google.py`'s existing one, with a catch-all
   fallback branch, and `complete_structured` now runs **both** the request and its
   response post-processing (empty-`choices` guard, `parsed is None`, the
   `schema.model_validate` re-validation) inside the classified block. `complete_stream`
   was refactored onto the same `_classify` (identical behavior/codes as before) and its
   stream body is now classified too, matching `anthropic.py`'s precedent. Swept the
   gap-class across all three adapters as instructed: `anthropic.py` and `google.py`
   already guarded their *requests* but had the analogous hole in their structured-output
   *post-processing* (a raw `pydantic.ValidationError` could leak) — both fixed the same
   way. `_openai_compatible.py` inherits the fix.
2. **Summary boundary.** `summary/post_call.py`'s `generate_and_send_summary` now also
   catches bare `Exception` (logged with a traceback as a defect signal, distinct from
   the expected `LlmError` path), and its degrade write was extracted into
   `_send_unavailable`, which swallows a failure of that write itself — this path runs
   from inside an `except` during teardown, so the internal API being down must not be
   what escapes instead.
3. **Teardown guard.** `entrypoint.handle_job`'s `finally` now runs both
   `pipeline.aclose()` and `pipeline.generate_summary()` through a new
   `_guarded_teardown_step` helper, so no best-effort cleanup can cost a session its
   terminal `"ended"` event. `asyncio.CancelledError` is deliberately *not* caught (a
   cancelled job must still unwind).

Verification — each layer tested on its own merits so a regression in one cannot hide
behind another: 6 new adapter tests (`tests/adapters/llm/test_openai.py` covers QA's
exact `AuthenticationError` reproducer plus `NotFoundError`, empty `choices`,
re-validation failure, an unanticipated `RuntimeError` hitting the fallback branch, and
a mid-stream failure; `test_anthropic.py`/`test_google.py` each cover their
re-validation hole), 2 new `post_call` tests (a never-anticipated exception type — NOT
an SDK error, so it stays valid independently of layer 1 — and a failing degrade write),
and 2 new `entrypoint` tests driving the real `handle_job` with `generate_summary`/
`aclose` raising an unclassified exception and asserting the `"ended"` event is still
sent and nothing escapes.

**Regression after this fix — all green:** `pytest` 253/253 (was 241; +12), coverage
95.14% total (was 94.41%), every touched file well above the 80% floor
(`post_call.py` 100%, `openai.py` 96%, `google.py` 95%, `entrypoint.py` 91%,
`pipeline.py` 95%, `anthropic.py` 91%); `ruff check .` clean; `lint-imports` 3/3
contracts kept (86 files, 256 dependencies). `mypy` on the touched files reports only
the pre-existing vendor-SDK-stub arg-type noise (literal model-name unions, SDK
`messages`/`contents` param types) and `pipeline.py`'s pre-existing `orchestrator:
object` attribute errors — no new errors introduced by this fix. Backend/frontend
untouched this pass.

## Final Review fix pass (2026-08-20) — deployment + CI + security defects from two parallel QA passes

Not a new backlog phase — this is `nexus-dev` fixing every defect Final Review's two
parallel QA reports found (`qa-results/final-review/backend-agent-deployment/REPORT.md`;
the frontend/golden-path report was handled by a parallel dispatch). Ordered by the
report's own severity.

**D-1 (blocking, deployment — fixed and live-verified end to end)**: `deploy/livekit/livekit.yaml`'s
`webhook.api_key: __LIVEKIT_API_KEY__` was mounted straight into LiveKit with no
substitution step in either the compose or k8s path, so LiveKit crash-looped
("api_key is required to use webhooks") and `agent` (gated on
`livekit: {condition: service_healthy}`) never started — the documented process had
never actually worked end to end. Fixed for real, not documented around:
- **Compose**: `docker-compose.yml`'s `livekit` service now overrides
  `entrypoint`/`command` to `sed`-substitute `$LIVEKIT_API_KEY` (read from the
  container's own runtime env, `$$`-escaped so compose doesn't interpolate it itself)
  into a writable rendered config, then `exec /livekit-server --config ...` (the
  binary isn't on `$PATH` in the upstream image — found live, fixed).
- **Kubernetes**: `k8s/livekit.yaml`'s Deployment gained a real `initContainer` that
  renders the ConfigMap's template into a shared `emptyDir`, substituting the real key
  from `liveavatar-web-secrets`'s `LIVEKIT_API_KEY` field before the main container
  starts — a plain `kubectl apply -f k8s/livekit.yaml` is now correct on its own, no
  separate `envsubst`/Helm/Kustomize step to remember.
- **Live-verified**: built both images fresh (`docker compose build`), ran
  `docker compose run --rm migrate` (applied the existing migration + reseeded 10
  provider definitions, confirmed idempotent), then a full clean `docker compose up -d`
  brought up all 5 services (`postgres`, `redis`, `livekit`, `web`, `agent`) healthy
  with **0 restarts** on every container. Agent genuinely registered with the real
  LiveKit (`registered worker, agent_name=avatar-agent, url=ws://livekit:7880`).
  `GET /api/health` returned a real 200; `/admin/`, `/admin/tenants/abc` (SPA deep
  link), and the internal `:8081` guard (401 with no token) all verified live.
  Two host-side deviations, both disclosed and neither a defect in the compose file
  itself: an unrelated leftover `docker-compose.dev.yml` LiveKit container from an
  earlier session held port 7880 (stopped); an unrelated other project's container
  held host port 8080 (worked around with a local, uncommitted compose override
  remapping `web`'s public port to 18080 — container-internal ports untouched).
- **Found and fixed while verifying (not in the original report, but blocked a genuine
  clean run)**: `.env.example`'s `DATABASE_URL` (`liveavatar:liveavatar@localhost`) and
  `POSTGRES_PASSWORD` (`change-me-postgres-password`) were independently-set
  placeholders that don't match each other — `migrate` failed Prisma P1000
  ("Authentication failed") until corrected. `.env.example` now documents that these
  two must be kept in sync for the containerized (root `.env`) path, and
  `DEPLOYMENT.md` §2 spells out the exact values to edit (`LIVEKIT_URL`,
  `LIVEKIT_API_KEY`/`SECRET`, `DATABASE_URL`↔`POSTGRES_PASSWORD`, every other
  `change-me-*`) instead of a bare "fill in real values".

**D-2 (blocking for CI — fixed)**: the `agent` CI job failed `ruff format --check`
(12 files) and `mypy src` (22 errors). `ruff format .` reformatted the 12 files (now
`ruff format --check .` passes). For `mypy`, two errors were genuine bugs in our own
code and were root-cause fixed, not suppressed:
- `orchestration/pipeline.py`'s `ConversationPipeline` typed `orchestrator`,
  `llm_primary`, `llm_fallback`, `retry_policy`, and `_consume_llm_stream`'s `stream`
  param as bare `object`/used a dead `# type: LlmChunk` comment — added a new
  `ports/orchestration.py` `IOrchestrator` Protocol (mirroring `ports/llm.py`'s
  pattern) and typed everything properly (`ILLMProvider`, `RetryPolicy`,
  `AsyncIterable[LlmChunk]`). `FailoverResult` moved from `orchestration/failover.py`
  to `ports/llm.py` so the new port could reference it without a `ports`→`orchestration`
  reverse-layer import (which `.importlinter`'s `layers` contract forbids) —
  `orchestration/failover.py` now imports it from `ports.llm` and re-exports it, so
  every existing `from avatar_agent.orchestration.failover import FailoverResult` call
  site keeps working unchanged.
- `telemetry/logging.py`'s `_redact_processor` signature (`_logger: object`,
  `event_dict: dict[str, object]`) didn't structurally match structlog's own
  `Processor` protocol — retyped to `Any`/`MutableMapping[str, Any]`/
  `Mapping[str, Any]` to match exactly.
- The remaining 17 errors (openai/anthropic/google adapters' `model`/`messages`/
  `contents` arg-type mismatches against those SDKs' own `Literal[...]`-typed stubs,
  plus `pydantic_graph.GraphBuilder`'s generic-arity/overload mismatch) are genuine
  vendor-SDK/type-stub noise, not runtime defects — narrow, documented
  `[[tool.mypy.overrides]]` blocks in `apps/agent/pyproject.toml` disable only the
  specific error codes on only those specific modules, each with a comment explaining
  why (this project's registry pattern means a vendor's closed `Literal` model-id type
  can never be satisfied by a config-driven `str`, by design). `mypy src`: 0 errors,
  58 files. `ruff check .`: clean. `pytest --cov`: 253/253, 95.17% coverage.
  `lint-imports`: 3/3 contracts kept.

**D-3 (moderate, security — fixed)**: `PATCH /tenants/:id` and
`POST /tenants/:id/status` returned 403 `TENANT_FORBIDDEN` for an existing other
tenant but 404 for a non-existent id — a tenant-existence enumeration oracle
violating FR-TENANT-5/HLD's explicit "404, never 403" rule. Both use cases
(`update-tenant.use-case.ts`, `change-tenant-status.use-case.ts`) now combine the
"doesn't exist" and "exists but not yours" checks into a single `404 TENANT_NOT_FOUND`
branch, matching every other tenant-scoped use case in the codebase (e.g.
`get-tenant.use-case.ts`). Fixed the test that tolerated the defect:
`apps/api/test/tenant-isolation.e2e-spec.ts`'s cross-tenant PATCH assertion now
requires exactly `404`/`TENANT_NOT_FOUND` (was `expect([403, 404]).toContain(...)`);
both use cases' unit specs updated to assert 404 too. `TenantScopeGuard`'s doc comment
corrected (previously documented the now-removed 403 split as intentional).

**D-4 (moderate — root-cause fixed, not re-patched)**: the stale-`.tsbuildinfo`
silent-no-op-build bug recurred because the prior "fix" only deleted the file and
gitignored it, never addressing why a `.tsbuildinfo` outside `outDir` can survive a
`deleteOutDir: true` wipe of `dist/`. Root cause: `tsconfig.json`'s `incremental: true`
has no explicit `tsBuildInfoFile`, so TypeScript's default location sits *outside*
`outDir`; `nest-cli.json`'s `deleteOutDir: true` wipes `dist/` on every build but never
touches that file, so a stale cache from a prior build survives, `tsc`'s non-composite
incremental check only compares source hashes (never verifies declared outputs still
exist), and `nest build` exits 0 emitting nothing. Fixed by pinning
`tsBuildInfoFile: "./dist/.tsbuildinfo"` in `apps/api/tsconfig.build.json` — now the
cache lives *inside* `outDir` and is deleted together with `dist/` on every build, so
a wiped `dist/` can never coexist with a cache claiming it's up to date. Verified live:
reproduced the exact bug once (stale root-level `.tsbuildinfo` + `nest build` emitting
nothing), applied the fix, then proved a genuine source change (a temporary marker
comment in `health.controller.ts`) was reflected in the rebuilt `dist/` output, and
that reverting the source and rebuilding again removed it from `dist/` too — not just
an exit-code check.

**Documentation-integrity defect (fixed)**: `ci-cd.yml` and `DEPLOYMENT.md` §4 claimed
a TypeScript agent-config contract test at
`packages/contracts/src/agent-config/schema.contract.spec.ts` ran in the `contracts`
CI job — that file never existed. The real file,
`apps/api/src/modules/deployment-config/domain/agent-config-cross-language.contract.spec.ts`,
already runs today (it matches `apps/api`'s own Jest `testRegex`, so it's part of the
`api` job's `test:cov` step) — only the doc/CI-comment's claim of *where* was wrong.
Both corrected to reference the real path and the real job.

**D-6 / D-7 (blocking for k8s / k8s upgrades — fixed, manifest-review only, no cluster
reachable in this environment either)**: `k8s/networkpolicy.yaml`'s `web-ingress` now
also admits `app: livekit` on `:8081`, and a new `livekit-egress` policy lets LiveKit
pods reach `web-internal:8081` (previously blocked in both directions, silently
dropping `room_finished`/`participant_joined` session-lifecycle webhooks).
`k8s/migrate-job.yaml`'s pod template now carries `app: migrate` (previously no labels
at all, so `default-deny-all` left it DNS-only-egress and unable to reach Postgres on
any deploy after the first); `postgres-ingress` now also admits that label, and a new
`migrate-egress` policy grants Postgres reachability. All `k8s/*.yaml` manifests
structurally re-parsed clean (9 `NetworkPolicy` docs now, up from 7); no cluster was
reachable to run a real `kubectl apply --dry-run=server`, same limitation the original
deploy/QA passes hit.

**D-5 (rough edge — fixed)**: LiveKit's RTC UDP range moved from `50000-50100` to
`20000-20100` in `docker-compose.yml`, `deploy/livekit/livekit.yaml`, and
`k8s/livekit.yaml` (kept in sync per their own existing comments) — the old range sat
inside Windows' default ephemeral port range (49152-65535), making `docker compose up`
fail non-deterministically depending on unrelated host port allocation.

**Full regression after all fixes — all green**: Python `pytest` 253/253 (95.17%
coverage), `ruff check .` clean, `ruff format --check .` clean, `mypy src` 0 errors
(58 files), `lint-imports` 3/3 kept. Backend `jest --runInBand --coverage` 128/128
suites, 715/715 tests; ESLint clean; `tsc --noEmit` clean; `nest build` clean (dist
emitted correctly, `.tsbuildinfo` root-caused per D-4). Frontend `jest --coverage`
61/61 suites, 424/424 tests; ESLint clean; `ng build admin`/`ng build conversation`
both clean (same pre-existing CommonJS warning as every prior pass). `packages/contracts`
build + lint clean. `apps/api` `test:e2e` (tenant-isolation, incl. the corrected D-3
assertion) run against a real testcontainers Postgres — see the dispatch report for
its final pass/fail status (was still running as this doc was written; check
`qa-results`/the orchestrator's own re-verification for the final word). Full clean
`docker compose up -d` of all 5 services verified live per the constraints above —
this is the first time in the project's history the documented process has worked
end to end with zero undocumented manual intervention.

### Final Review fix pass, frontend addendum (2026-08-20) — two High defects from the parallel frontend-golden-path QA report

The coordinator relayed two additional High-severity defects from
`qa-results/final-review/frontend-golden-path/REPORT.md` mid-dispatch, after the
deployment/CI/security fixes above were already complete. Both fixed and verified live
in a real Chromium browser (Playwright, one-off script per this project's established
pattern for un-scaffolded browser verification — not added as a dependency), not just
by reading the template/SCSS source.

**D-1 (High) — 6th recurrence of the phone-layout bug class, this time in the SHARED
component**: `apps/web/projects/shared/src/lib/ui/page-header/page-header.component.scss`'s
`&__actions` rule had no `flex-wrap`, so any screen putting 2+ controls in that slot
overflows a narrow viewport instead of reflowing. Sessions (tenant select + search +
status filter — three controls) was the only screen that tripped it, but since this is
the shared `la-page-header` component every future screen reusing this slot was one
extra control away from the same bug. Fixed in the shared component, not a
Sessions-only override: `flex-wrap: wrap` plus `row-gap: 12px` and `min-width: 0` on
each direct child (so a wide `mat-form-field` can shrink before forcing an overflow),
plus a `@media (max-width: 599px)` block that stacks the whole header vertically and
lets each action take the full row width so wrapped controls read as a deliberate
layout, not crammed fragments.

Verified live against a real seeded backend (disposable Postgres/Redis, the real
NestJS `web` process, `ng serve admin` behind a temporary local proxy) with a real
operator login, driving all 7 screens that use `la-page-header`
(dashboard/deployments-list/provider-catalog/sessions-list/alerts-picker/
residency-picker/gpu) at 375px, 414px, 768px, and 1280px and measuring
`document.body.scrollWidth` vs `clientWidth` plus the header-actions element's own
`clientWidth`/`scrollWidth` directly (not just eyeballing a screenshot):
**zero overflow at any width on any of the 7 screens** — Sessions' header-actions
specifically went from the QA-measured 680px-wide-in-a-375px-viewport failure to a
clean 343px (== the viewport-constrained container width) with no horizontal pan
required. No regression on any other screen at any width, including desktop.

**D-2 (High, WCAG 2.2 level A 4.1.2, axe critical)** — all 10 Provider Registry catalog
toggles had no accessible name.
`provider-catalog-page.component.html` used `[attr.aria-label]` on the `<mat-slide-toggle>`
host, which sets a raw DOM attribute Angular Material's own host bindings then
overwrite on render (the component's `ariaLabel` input, bound via
`aria-label: ["aria-label", "ariaLabel"]` in its metadata, is what actually controls
the label Material forwards to the inner `button[role="switch"]` — confirmed by
reading the installed `@angular/material@20.2.14` package's own compiled component
metadata, not guessed). Fixed by switching to `[aria-label]` (Angular property binding
to that same input, via its `aria-label` alias) so the label genuinely reaches the
rendered control.

Verified by reading the actual rendered DOM's accessibility-relevant attributes for
all 10 toggles against a real seeded provider catalog (LiveKit, Deepgram,
faster-whisper, Anthropic, Google, OpenAI, ElevenLabs, Fish Speech, Alibaba
LiveAvatar, bitHuman) — every one of the 10 `button[role="switch"]` elements now has
a real, provider-specific `aria-label` (`"Enable LiveKit"`, `"Enable Deepgram"`, ...),
confirmed both via direct DOM inspection (`document.querySelectorAll('mat-slide-toggle
button[role="switch"]')`) and independently via Playwright's own locator API
(`page.locator('mat-slide-toggle').first().locator('button[role="switch"]')`) — not
just the template source. Zero browser console errors during the whole pass.

**Regression after both fixes**: frontend `jest --coverage` 61/61 suites, 424/424
tests (unchanged — both fixes are template/SCSS-only, no `.ts` logic touched);
ESLint clean; `ng build admin` clean (same pre-existing CommonJS warning as every
prior pass). All QA-created tenant data, the disposable Postgres/Redis containers, the
temporary local proxy config, and both local dev-server processes (`ng serve`,
`nest start`) were torn down after verification.
