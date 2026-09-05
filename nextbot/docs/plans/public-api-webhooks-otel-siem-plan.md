# Public API + Outbound Webhooks + OTel/SIEM Export — implementation plan (Phase 18, BL-49)

Source of truth: `docs/PRODUCT_SPECIFICATION.md` FR-API-01/02, FR-ADM-10 (quoted verbatim
in the dispatch brief). `docs/plans/target-architecture-blueprint-plan.md`'s Phase 18
entry is deliberately thin (no dedicated LLD §14.x/§15.x section exists for this phase —
it is genuinely under-specified, matching its P2/last-scheduled status). This document
records the real design decisions made to close that gap, so they are reviewable rather
than silent.

This phase is investigation-heavy: before writing anything, the codebase was audited for
every existing `domain_event` producer, the real OTel/ClickHouse infrastructure, the
scoped-API-key auth path Phase 4 built and explicitly deferred wiring here, and the
Settings hub's own card convention. Findings below are load-bearing for the design.

## Investigation findings (recorded before implementation)

1. **`getAuthContext()`/`verifyApiKey()` (Phase 4, BL-36) already resolve a bearer
   `nbk_...` key to the exact same `SessionClaims` shape a session cookie does, with
   the key's own scope already intersected against the account's role-derived matrix**
   (`packages/modules/iam/src/domain/permission-scope.ts#intersectMatrices`). Every
   downstream `requirePermission(session.permissions, module, level)` call works
   unchanged. `apps/web/src/lib/api-guard.ts#requireApi`'s own doc comment explicitly
   names this phase as where a bearer-key-accepting guard variant belongs.
2. **`domain_event.processed`/`processedAt` are `@nextbot/audit`'s own private cursor**
   (`sync-audit-from-events.ts`) — confirmed by reading the actual consumer, not
   assumed. A second consumer (the webhook dispatcher) must never read or write these
   columns; it needs its own independent tracking table.
3. **Real `domain_event` producers audited by grepping every `domainEvent).values(` call
   site** (six real production call sites, not counting tests):
   `orchestration` (turn-pipeline.ts's fallback/policy-denial/guardrail events,
   approval-service.ts's approval-pending/failed/confirmation events), `agent-platform`
   (deployment-repository.ts's rollback/canary/traffic-split events,
   continuous-eval-events.ts's regression event), `authz` (evaluator-error event).
   **Two of FR-API-02's five named categories have NO existing producer at all**,
   confirmed by grepping the `escalations` and `mcp-registry` modules for any
   `domain_event`/outbox write — none exists in either. These are real, disclosed gaps
   this phase closes (see "Producer gaps closed" below), not something to silently
   route around.
4. **A third category ("deployment changed") is only partially covered**: rollback,
   canary-promote and traffic-split-change all emit today, but the single most common
   deployment change — a version's first promotion to Production
   (`createInitialProductionDeployment`) — emits nothing. Closed the same way.
5. **ClickHouse is real and already running** (`packages/db/src/clickhouse.ts`,
   `insertAgentRunSpans`/`queryAgentRunSpans`, with its own int tests) — the existing
   OTel SDK bootstrap (`packages/observability/src/tracing.ts`) is a single
   process-wide exporter with no tenant concept at all, which is a fundamentally
   different thing from FR-ADM-10's *tenant-scoped, opt-in* export. This phase adds a
   genuinely new, additive, per-tenant forwarding path rather than repurposing the
   process-wide one.
6. **`getSessionTenantContext()`'s hardcoded `environment: "Sandbox"`**: investigated
   whether this matters for the five resource types this phase exposes.
   `packages/modules/skills/src/application/skill-reference-resolver.ts` genuinely
   reads `ctx.environment` to resolve a skill's connector reference against that
   environment's enrolled connectors — so a tenant whose relevant connector is only
   enrolled in Staging/Production (not Sandbox) already cannot successfully save such a
   skill **today, from the console, over the session-cookie path** — this is a
   pre-existing gap, not something the public API introduces or worsens. Deciding
   "which environment should a bearer-key caller operate in" is a real, unstated design
   question (an API key carries no environment field anywhere in FR-SEC-10's schema) —
   changing it now would be an undisclosed behavior change to every existing
   session-cookie route, not a local/reversible choice. **Flagged to the orchestrator
   below rather than silently decided**; the public API reuses
   `getSessionTenantContext` completely unchanged, so it is exactly as correct/incorrect
   as the console already is — no regression, no silent fix of unrelated scope.
7. **BL-18 (Developer Portal, API reference convention) was never actually built** —
   confirmed by inspection: no `apps/web/app/**/developer*` or `**/portal*` route
   exists anywhere, despite `RbacModule` already reserving a `"developer_portal"` value
   for it. There is no existing API-reference convention to match. This phase
   documents the new public API as a standalone OpenAPI 3.0 document
   (`packages/contracts/openapi/public-api-v1.yaml`) plus a README, and explicitly does
   **not** attempt to build BL-18's Developer Portal UI (sandbox console, connector
   guide) — that is BL-18's own unbuilt scope, not this phase's.
8. **The real HMAC helper already exists and is exported publicly**:
   `computeHmacSha256Hex`/`constantTimeEquals`
   (`packages/modules/agent-platform/src/application/git-connection-service.ts`, quoted
   in the dispatch brief, re-confirmed exported from `@nextbot/agent-platform`'s
   `index.ts`). Webhook payload signing reuses this verbatim.
9. **Every admin route this phase needs to expose already delegates to a
   framework-agnostic exported handler function** (`handleListSkills`,
   `handleCreateSkill`, `handleListWorkflows`, `handleGetTeam`, `handleListCollections`,
   etc., in each module's `http/admin-routes.ts`). The public API layer is therefore
   genuinely just a new thin route/auth adapter calling the *same* functions — no new
   business logic, per the brief's own instruction.
10. **`apps/worker`'s scheduler (`ScheduledJob`/`startScheduler`) is real, already
    running several jobs on a plain `setInterval` basis** — adding the webhook
    dispatcher and the SIEM-export sweep is a matter of one new job file plus one new
    `index.ts` registration each, matching every existing job's own shape.

## Scope decisions (disclosed, since the LLD is silent here)

- **New route prefix**: `/api/v1/external/**` — distinct from `/api/v1/admin/**`
  (session-cookie-first, now also bearer-key) and the tiny, genuinely unauthenticated
  `/api/v1/public/**` (widget branding/SSO-status only). A caller presenting a bearer
  key hits `/external`; a human console session keeps using `/admin` unchanged (no
  existing route's behavior changes).
- **Resource surface** (FR-API-01's named list, CRUD/list/read only — no
  eval/blueprint/studio/shadow-evaluation/graph-explorer surfaces, which are
  console-authoring-experience features FR-API-01 does not name):
  - Agent platform: definitions (list/create/get), versions (list/create/get,
    submit-review, promote) — promotion is included deliberately: FR-API-01 says
    versions are "manageable programmatically," and the promotion-gate/immutability
    rules must be proven to apply identically over this path, which requires a route
    that actually exercises them.
  - Skills: skills (list/create/get), versions (list/create/get, publish, deprecate).
  - Workflows: workflows (list/create/get/update), versions (list/create/get,
    transition).
  - Teams: teams (list/create/get/update), versions (list/create/get, transition).
  - Knowledge: collections (list/create/get/update), sources (list/create/get/delete).
  - **Narrowed out (disclosed)**: diff endpoints, sandbox-run, validate-only endpoints,
    where-used/upgrade-consumers, graph explorer, retrieval playground, coverage/
    freshness reports. These are console-authoring-convenience or analytics surfaces,
    not core "manage the resource" operations, and every one of them remains reachable
    exactly as before through the console's own `/admin` routes. A future phase can
    extend the external surface if a real integrator need shows up.
- **RBAC module/level per resource**: identical to what the corresponding `/admin`
  route already checks (`agent_platform` for agent-platform/skills/workflows/teams,
  `knowledge`/`knowledge_config` for knowledge) — this is the literal mechanism that
  satisfies "the same permission-module gating as the console," so it is not a new
  decision, just a verified reuse.
- **Webhook subscription event vocabulary**: a subscription's `event_types` column
  stores FR-API-02's own five names verbatim (`EscalationCreated`, `ApprovalPending`,
  `GuardrailTripped`, `DeploymentChanged`, `DriftDetected`) — the tenant-facing
  contract never leaks internal `domain_event.type` strings, which can and do change
  across phases. A pure mapping table
  (`packages/modules/webhooks/src/domain/event-category.ts`) expands each category to
  the real underlying `domain_event.type` value(s) found in investigation finding 3/4
  above. New event-producing phases only ever need to add their type string to this
  one map.
- **OTel export scope**: real trace-span forwarding (reusing the OTel JS SDK's own
  `OTLPTraceExporter`, given a real ended `Span` object, per-tenant-endpoint) is
  genuinely real, not mocked. Metric export is disclosed as a narrower, real
  implementation: a periodic (5 min) aggregate push (`agent_run` count/success/fail,
  avg duration, cost, over the interval) via `@opentelemetry/sdk-metrics`'s
  `MeterProvider` + `@opentelemetry/exporter-metrics-otlp-http`'s
  `OTLPMetricExporter`, rather than a per-event metric — OTel metrics are
  interval-aggregated by nature (unlike traces), so this is not a corner cut, it is the
  correct shape for "metric export." Both new `@opentelemetry/*` packages pass the
  ADR's maturity bar (official OTel JS SDK packages, Apache-2.0, actively maintained,
  already-adopted sibling packages in this exact dependency family).
- **SIEM export scope**: audit-log streaming, batched, via a per-tenant cursor
  (`siem_export_config.last_exported_at`/`last_exported_audit_log_id`) that is **its
  own column on its own new table**, never touching `domain_event.processed`/
  `processedAt` (investigation finding 2) or any other consumer's cursor.
- **Settings gating**: webhook subscriptions and OTel/SIEM export config are gated
  under the existing `security_settings` RBAC module, Write level to mutate — the same
  module branding/PII/data-policy/SSO already use for "tenant-wide security/ops
  configuration," since no dedicated module exists for either and inventing one is a
  bigger surface-area decision than this phase needs to make silently.

## Flag to the orchestrator (non-blocking, does not gate this phase)

`getSessionTenantContext()`'s hardcoded `environment: "Sandbox"` is a real, pre-existing
gap (investigation finding 6) that affects the console today, independent of this phase.
Fixing it requires deciding where a session's or an API key's "acting environment" comes
from — genuinely unstated anywhere in FR-SEC-10/LLD §5.1 — and touches every existing
`/admin` route, not just the five resource types this phase adds. Left unchanged
deliberately; flagged here rather than silently fixed or silently ignored.

## Phases

### Phase 18a — Domain event producer gaps + webhook subsystem

**Goal**: every one of FR-API-02's five event categories has a real producer, and a
tenant can subscribe, receive signed at-least-once deliveries with retry/backoff, and
inspect a delivery log.

**Scope**:
- `packages/modules/escalations/src/infrastructure/escalation-repository.ts#createEscalation`
  — append `domain_event` type `escalations.escalation_created` in the same transaction
  as the row insert (the outbox's own stated contract).
- `packages/modules/agent-platform/src/infrastructure/deployment-repository.ts#createInitialProductionDeployment`
  — append `domain_event` type `agent-platform.deployment_created`, same transaction.
- `packages/modules/mcp-registry/src/infrastructure/mcp-server-repository.ts#insertDriftEventsAndMarkReconciled`
  — append `domain_event` type `mcp-registry.drift_detected` (one row, not one per
  classified change — a webhook subscriber wants "this server drifted," not N rows per
  reconcile tick) inside the same transaction, only when `events.length > 0`.
- New `packages/modules/webhooks` module: schema (`webhook_subscription`,
  `webhook_delivery`), domain (event-category map, backoff schedule — pure, unit
  tested), application (subscribe/list/update/delete; dispatch — scans `domain_event`
  rows by mapped type set, per active subscription, `NOT EXISTS` against
  `webhook_delivery` keyed by `(subscription_id, domain_event_id)`, signs with
  `computeHmacSha256Hex`, POSTs, records the attempt).
- `apps/worker`'s new `webhooks.dispatch` job (10s cadence, mirroring
  `knowledge.ingestion-pump`'s shape) + registration in `index.ts`.
- Settings UI: `/settings/webhooks` (subscription CRUD + delivery log table) + hub card.
- Migrations: new tables + RLS; `TENANT_SCOPED_TABLES` + fixture-teardown updates.

**Exit gate**: real integration test proving signature verification passes against an
independently-computed HMAC and fails against a tampered payload; a real retry test
proving a failing endpoint is retried with backoff, not dropped after one attempt; a
real test proving the webhook dispatcher's own progress is independent of
`syncAuditFromEventsForTenant`'s `processed` flag (each can run/mark independently
without affecting the other's view of the same `domain_event` rows).

### Phase 18b — Public API surface

**Goal**: the five FR-API-01 resource families are manageable over a bearer-key-
authenticated `/api/v1/external/**` surface, gated by the exact same RBAC check the
console uses.

**Scope**: `requirePublicApi()` in `apps/web/src/lib/api-guard.ts` (bearer-key variant
of `requireApi`, reusing `getAuthContext()`); new route files under
`apps/web/app/api/v1/external/**` per the resource list above, each delegating to the
already-exported handler function its `/admin` sibling calls; OpenAPI document +
README.

**Exit gate**: real integration test proving a scoped key with insufficient module
permission gets the identical 403 an under-privileged console session gets, for at
least one route per resource family; a real test proving a version's promotion-gate/
immutability behavior is identical whether reached via `/admin` or `/external` (same
underlying call, so this is a structural proof, not a duplicated business-logic test).

### Phase 18c — OpenTelemetry + SIEM export

**Goal**: a tenant can opt in, in Settings, to real trace/metric export to their own
OTel collector endpoint and real audit-log streaming to their own SIEM endpoint, both
additive to the existing in-console experience.

**Scope**: `otel_export_config`/`siem_export_config` tables (migration); tenant-scoped
OTLP trace exporter (extends `packages/observability`) wired into
`agent-run-tracing.ts`'s existing span-emission call sites; periodic metric-aggregate
push (new `apps/worker` job, 5 min cadence); SIEM batch-export worker job (own cursor,
per investigation finding 2/the disclosed scope above); Settings UI
(`/settings/telemetry-export`) + hub card.

**Exit gate**: real test proving a real ended span is handed to a real
`OTLPTraceExporter` instance pointed at a mock collector endpoint and arrives intact;
real test proving the SIEM cursor advances independently of `domain_event.processed`;
both configs default to disabled (opt-in) and existing in-console Trace/Audit Log
screens are unchanged when disabled.

## Standard requirements (all three sub-phases, before reporting done)

Typecheck, `eslint . --max-warnings=0`, dependency-cruiser clean (new `webhooks` module
added to `MODULE_ALLOW_LIST` as a leaf, `[]` deps — it only touches `@nextbot/db`
directly and makes outbound HTTP calls, no cross-module business-logic edge needed).
Full regression suite. Coverage ≥ 80% on files this dispatch touches. Security
self-review per the dev-agent brief §5 (every new route RBAC-gated; webhook target URLs
and OTel/SIEM endpoints are tenant-supplied strings — validated as well-formed
https URLs, never used to construct a raw query/command; delivery/export HTTP calls
are outbound-only egress, not user-controlled dynamic execution; no secret/HMAC key
ever logged; signing secrets stored as-is like other bearer-comparable secrets in this
codebase's existing credential columns, never reversibly "encrypted for display").

Status of each sub-phase and any deviation is recorded below as implementation
proceeds, and in `docs/NEXUS_STATE.md`'s decision log. This dev dispatch does not
self-approve QA.
