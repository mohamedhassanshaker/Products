# QA Report - Phase 7 Backend (BL-020..BL-025) + Cross-Cutting Prisma Bypass Fix

Date: 2026-08-19/20 (UTC+4 local)
Scope: apps/api backend only - session-logs, dashboard, gpu, alerts, residency modules; sessions module extensions (summary/feedback); jobs transcript-purge; packages/contracts new schemas; the cross-cutting PrismaService.withBypass()/.transaction() fix.
Parallel QA: admin SPA and conversation SPA screens covered by separate agents (not in this report).

## Environment

- Postgres 16 (postgres:16-alpine, disposable Docker container, localhost:55433), schema applied via "prisma migrate diff --from-empty --script" plus psql (avoided the Prisma-CLI-guarded db-push/migrate-dev destructive-action path entirely - no user consent was sought or needed since no schema-mutating CLI command requiring that consent was ever run).
- Redis 7 (localhost:56380), disposable container.
- API built via tsc -p tsconfig.build.json (see anomaly note below) and run as two independent Node processes: public :8090 (dist/main.js) and internal :8091 (dist/main-internal.js), both against the real Postgres/Redis above - no mocks, no stubs, real HTTP throughout.
- Test data: 2 real tenants (qa-tenant-a, qa-tenant-b) created via the real /api/tenants API, published deployment config for tenant A via the real /api/tenants/:id/config API (Example-A-shaped provider stack), real sessions created via /api/public/sessions, real utterances/hops/summary/events/alerts/gpu-heartbeats pushed via the real /internal/* agent-facing routes (the same routes Phase 4's Python agent calls). All test data disposable and destroyed at the end of the pass (containers removed, .env deleted).

Anomaly (environment, not a code defect): this sandbox had several long-lived orphaned Node processes from earlier, unrelated QA/dev passes in this same persistent shell session (a stray pnpm run test:e2e/testcontainers run, and prior dist/main.js / dist/main-internal.js instances) that intermittently re-acquired ports 8090/8091 with a different database's fixture data ("QA Tenant Alpha/Beta") mid-test-run, twice producing confusing false readings (a 500 on invite-creation, and a dashboard count that didn't match real DB state). Both were traced to process/port contention, not application bugs, once isolated: after killing every stray Node process and confirming a single owner per port, all previously-anomalous calls (invite creation, dashboard aggregation) succeeded correctly and matched real DB state on immediate re-test. Documented here for transparency since it consumed significant investigation time and could look like a defect at a glance - it was ruled out with a clean re-run in both cases.

"nest build" itself produced no dist/ output and exit 0 with no error text in this environment (a CLI quirk, not investigated further since it neither failed nor was silently swallowing errors - direct "tsc -p tsconfig.build.json" against the identical tsconfig succeeded and produced a working, correctly-typed build that ran the full route table with zero runtime type errors). Recommend the orchestrator note this if "nest build" is relied on as a CI gate rather than tsc --noEmit + tsc -p tsconfig.build.json.

## THE MOST IMPORTANT THING - Prisma bypass fix (cross-cutting, all phases)

Verdict: FIX IS GENUINE AND CORRECT. Full rigor applied per the dispatch.

1. Root-cause understanding confirmed correct. Read apps/api/src/common/prisma/prisma.service.ts and tenant-guard.extension.ts line by line. The tenantGuard extension's $allOperations hook only runs when Prisma's Prisma-7 lazy-thenable query object is actually driven via .then()/await; a bare "return TenantContext.run(scope, fn)" returns that lazy thenable straight to the caller, whose own await - happening in the caller's stack frame, after run()'s synchronous dynamic extent has already ended - is what actually invokes .then(). AsyncLocalStorage only propagates to continuations created while the store is active; a naive implementation never creates such a continuation. The actual fixed code ("return new Promise((resolve, reject) => { TenantContext.run(scope, () => { fn().then(resolve, reject); }); })") creates the .then() continuation synchronously inside the run() callback, which is the correct fix for the root cause, not a symptom patch.

2. Live reproduction of the original bug, isolated, against real Postgres. Wrote a standalone repro (apps/api/qa-bypass-repro.ts, deleted after use - tree left clean) importing the project's real TenantContext and createTenantGuardExtension(), connected to the real disposable Postgres via the real generated Prisma client plus PrismaPg adapter. Ran both the naive pre-fix pattern and the actual fixed pattern from prisma.service.ts back-to-back in the same process against the same live connection, on a genuine tenant-scoped bypass read (db.session.findMany({}), no tenantId in scope):
   - Naive pattern: "REPRODUCED BUG: TenantScopeViolationError Tenant-scoped query on Session is missing tenant_id"
   - Actual fixed pattern: "FIX WORKS: got 3 rows, no violation thrown"

   This proves the claimed bug is real (not a hypothetical) and that the actual shipped fix - not a hand-simplified stand-in - resolves it.

3. Spot-checked 7 distinct withBypass/.transaction() call sites across modules from different phases, all live against real Postgres, all correct:
   - sessions (Phase 3/4): RecordUtterancesUseCase / RecordHopsUseCase / SetSessionSummaryUseCase / ApplySessionEventUseCase via real /internal/sessions/{id}/{utterances,hops,summary,events} calls - all wrote correctly and were read back correctly.
   - dashboard (Phase 7, this dispatch): PrismaDashboardStatsRepository.countSessionsByOutcome (withBypass(() => Promise.all([...]))) - verified against real DB row counts, exact match, stable across 5 repeated calls.
   - gpu (Phase 7): RecordGpuHeartbeatUseCase via real /internal/gpu-heartbeats - ingested and displayed correctly on /api/gpu/nodes.
   - tenants (Phase 1): CreateTenantUseCase (uses .transaction(), which itself calls withBypass) - both real tenant creations succeeded.
   - providers (Phase 3): ProviderCredentialRepository - 5 real credential creations succeeded.
   - auth (Phase 1/2): PrismaAdminUserRepository (uses .transaction() for the one-time-operator seed) - real seed and login succeeded.
   - session-logs (Phase 7): PrismaSessionSearchRepository - list/filter/search all correct against real data (see BL-020 below).

   No call site showed the bypass-scope-lost symptom (TenantScopeViolationError on a legitimate system-side write/read) anywhere in this pass.

4. Regression test genuinely uses a lazy-thenable shape. Read prisma.service.spec.ts's new test ("withBypass stays bypassed even when fn returns a lazy thenable whose work starts after fn() itself returns"): its fakeLazyPrismaCall() returns a plain object whose .then() defers the actual TenantContext.isBypassed() check to a Promise.resolve().then(...) continuation - a genuine simulation of Prisma 7's real lazy-dispatch behavior, not an eagerly-executing "async () => {...}" mock (every other test in the file, correctly noted in the file's own comments, uses that eager shape and could not have caught this). Confirmed by code reading and by my own independent isolated repro above using the identical technique.

No caveats on this section.

## Verify-per-item results

| Item | Result | Evidence |
|---|---|---|
| BL-020 session logs - real session/hops/utterances via real APIs | PASS | Created real session 15cc032d-... end to end via /api/public/sessions plus real /internal/sessions/{id}/{events,utterances,hops,summary}; /api/sessions, /api/sessions/:id, /:id/transcript, /:id/hops all returned exactly the pushed data, byte-consistent |
| BL-020 search/filter | PASS | ?q=Hello matches, ?q=zzzznomatch empty; ?tenant_id=A matches, ?tenant_id=B empty; ?status=ended matches, ?status=active empty - all against real Postgres full-text/filter queries |
| BL-020 retention purge FR-PRIV-3/4 | PASS | Tightened tenant A's retain_transcripts_days to 1 via the real residency API, back-dated the real session's started_at to 2 days ago, ran the exact production purge SQL (both statements from PrismaUtteranceRepository.purgeExpired()), confirmed transcript_purged: true on /api/sessions/:id and 410 TRANSCRIPT_PURGED on /api/sessions/:id/transcript |
| BL-021 dashboard - real aggregation | PASS (after ruling out the port-contention anomaly above) | active_deployments (real countActiveTenants) and sessions.{started,ended,failed,abandoned} (real countSessionsByOutcome bounded by real from/to) matched actual DB row counts exactly and reproducibly across repeated calls once a single clean process owned the port |
| BL-021 provider-health | PASS | Reflects real ProviderCredential.lastProbeStatus/lastProbeAt from the live provider-probe BullMQ job, all 5 categories green with real last_probe_at timestamps |
| BL-022 GPU heartbeat ingest and display | PASS | Real /internal/gpu-heartbeats POSTs for 2 hosts, /api/gpu/nodes returned both with correct util/health fields and last_heartbeat_at |
| BL-022 no scale up/down action | PASS | Grepped the module (only references are code-comment/spec assertions that no such endpoint exists) plus live-probed POST /api/gpu/nodes/gpu-node-1/scale which returned 404 |
| BL-022 controller split prevents :8081 leak | PASS | GpuModule (core, zero controllers) imported by both InternalModule and (transitively) AppModule; GpuAdminModule (the only module with GpuController) imported only by AppModule. Live-confirmed: GET /api/gpu/nodes returns 200 on :8090, 404 Cannot GET on :8091 |
| BL-023 Alerts - real AlertEvent list | PASS | Real /internal/alerts POST, /api/tenants/:id/alerts returned it with correct type/message/created_at |
| BL-023 failover config surface | PASS | GET/PUT /api/tenants/:id/alert-policy round-tripped retry_max_attempts/retry_backoff_ms/degraded_mode_message correctly; validation (retry_backoff_ms.length !== retry_max_attempts) correctly rejected a mismatched payload with CONFIG_RETRY_INVALID |
| BL-023 llm_fallback stays read-only (flagged product-conflict resolution) | PASS | PUT body included an llm_fallback value; response and DB both show it was never written (llm_fallback: null unchanged) - matches the docstring's claimed conservative resolution exactly |
| BL-023 no email/PagerDuty integration | PASS | Grep for pagerduty/smtp/nodemailer/sendgrid across the alerts module: zero matches in source (only unrelated string literals in specs) |
| BL-024 Residency - operator config surface | PASS | GET/PUT /api/tenants/:id/residency round-tripped correctly; publish-gate verified live: attempting send_to_remote_llm: none against tenant A's real published, remote-LLM config correctly returned 422 CONFIG_RESIDENCY_BLOCKS_LLM |
| BL-024 does not duplicate Phase 4 runtime enforcement | PASS | Code-read confirms UpdateResidencyUseCase's own docstring and implementation only touch the DataResidencyPolicy record and the publish gate - no enforcement logic; Phase 4's residency/filter.py is the actual runtime enforcer, untouched by this module |
| BL-025 summary/feedback binds to session token | PASS | Real POST /api/public/sessions/:id/end minted a one-time summary_token; correct token returned 200 with real summary/transcript; missing/wrong token returned 401 CALL_SUMMARY_EXPIRED; a different session's token against this session also returned 401 (cross-session binding genuinely enforced, not just per-request-shape validation) |
| BL-025 feedback ownership and duplicate rejection | PASS | Correct token returned 201; wrong token returned 401; duplicate submission with the correct token returned 409 FEEDBACK_ALREADY_SUBMITTED; rating 0/6 returned 400 FEEDBACK_INVALID |
| BL-025 summary text is real agent-generated, not a stub | PASS | Confirmed apps/agent/src/avatar_agent/summary/post_call.py calls ILLMProvider.complete_structured(..., PostCallSummary, ...) (structured output, not hand-parsed free text - ADR-001 section 3 compliant) and POSTs the result to exactly POST /internal/sessions/{id}/summary, the same endpoint this backend pass exercised end-to-end from the control-plane side |
| Tenant isolation, all 5 new modules | PASS | Created a second real admin (qa-tenantb-admin, scoped only to tenant B via a real invite/accept/login flow) and attempted: session-logs list (empty, not tenant A's data), session detail direct-object-reference by id (404 SESSION_NOT_FOUND, not 403 - matches the established Phase-1 posture), dashboard summary (tenant-B-only counts), residency (404 TENANT_NOT_FOUND), alerts (404 TENANT_NOT_FOUND) - all 5 correctly refused cross-tenant access |
| Internal X-Internal-Token guard | PASS | Missing token and wrong token both returned 401 AUTH_UNAUTHORIZED on /internal/gpu-heartbeats |
| Flagged product conflict (Alerts vs Agent-Builder llm_fallback ownership) | Confirmed genuinely flagged, not silently resolved | docs/design/UX_GUIDELINES.md section 16.9/10.5 documents the exact conflict and its conservative (read-only) resolution; code matches |
| Pre-existing ProvidersModule-on-:8081 leak | Confirmed unchanged (out of scope for this phase, correctly disclosed) | SessionsModule still imports ProvidersModule; InternalModule imports SessionsModule; live-confirmed ProviderDefinitionsController/ProviderCredentialsController routes are still mapped on the :8091 internal listener's route table |

## Full regression (independently re-run, not trusting dev's numbers)

- jest --runInBand: 128/128 suites, 715/715 tests - matches dev's claim exactly.
- ESLint (eslint "src/**/*.ts" "test/**/*.ts"): clean, 0 problems.
- tsc --noEmit: clean, 0 errors.
- Build: tsc -p tsconfig.build.json clean, produced a working dist/ that booted both the public and internal apps correctly (see anomaly note above re: nest build itself).

## Architecture / dependency / AI-boundary / security spot-check

- Architecture: all 5 new modules (session-logs, dashboard, gpu, alerts, residency) follow the established domain/application/infrastructure/interface layering; GpuModule/GpuAdminModule core-vs-interface split is a genuine, working instance of the pattern recommended after the Phase-6 ProvidersModule finding - verified it actually prevents the leak this time (unlike ProvidersModule, which remains unfixed but is explicitly out of this phase's scope).
- Dependencies: no new libraries introduced by this phase's diff beyond what Phase 2/3 already added and QA'd (bullmq, @nestjs/bullmq, yaml, tsx); nothing new to evaluate against the maturity bar.
- AI boundary: none of the 5 new backend modules touch an LLM/vendor SDK (correctly - none are AI-facing); grep confirms zero vendor-SDK imports in this scope. The one AI-adjacent piece in this dispatch's surface (post_call.py, Phase 4) correctly uses complete_structured (schema-validated), not hand-parsed free text.
- Security spot-check: every new controller (SessionLogsController, DashboardController, GpuController, AlertsController, ResidencyController) carries @UseGuards(AdminJwtGuard, RolesGuard); every mutating input goes through a TypeBoxValidationPipe; If-Match/optimistic-concurrency (CONFIG_CONFLICT) enforced on both alert-policy and residency PUTs; no secrets logged (Pino redaction unaffected by this phase); public-surface routes (/public/sessions/:id/{summary,feedback}) correctly have no AdminJwtGuard and instead use the one-time hashed summary token, which was live-tested for exactly the failure modes that would matter (wrong token, no token, cross-session token, replay/duplicate).

## Defects found

None blocking. No defects were found in this dispatch's own scope (BL-020..BL-025 backend, or the Prisma bypass fix). The two anomalies investigated (stray-process port contention causing a transient 500 and a transient dashboard-count mismatch) were conclusively environment artifacts, not application defects - ruled out with clean, reproducible re-tests after eliminating the contention.

## Overall verdict: PASS-WITH-CAVEATS

Phase 7 backend (BL-020-BL-025) and the cross-cutting Prisma bypass fix are both genuinely correct, verified live against a real Postgres/Redis, not just at the unit-test level - no defects found and no retry needed anywhere in this dispatch's own backend scope. Downgraded from a plain PASS to PASS-WITH-CAVEATS solely because of the cross-agent finding in the Addendum above: the parallel conversation-SPA QA pass found BL-025's summary generation is never actually invoked end-to-end in production (a Phase 4 agent-wiring gap, not a backend defect), which means BL-025 as a whole is not ready to close even though this report's backend half of it is. The two disclosed, already-flagged, out-of-scope items (Alerts/Agent-Builder llm_fallback ownership conflict; pre-existing ProvidersModule-on-:8081 leak) remain correctly un-silently-resolved and should stay on the orchestrator's/architect's radar, not be treated as closed by this pass.

## Addendum - cross-agent finding (read after this report's own testing was complete)

The parallel conversation-SPA QA pass (qa-results/phase7-conversation-summary/REPORT.md, same dispatch date) found a BLOCKING defect (D-1) that qualifies this report's BL-025 "summary text is real agent-generated, not a stub" line above: `generate_and_send_summary()` in `apps/agent/src/avatar_agent/summary/post_call.py` is never actually invoked from `entrypoint.py::handle_job` or anywhere else in the running agent process, so in a real end-to-end call the backend's `summary_status` never leaves `none`. This backend pass verified that (a) the backend's own summary/feedback endpoints are correct when called, and (b) `post_call.py`'s own code, in isolation, correctly calls `complete_structured` and posts to the right internal route - both true and both still stand. What this pass could not have caught on its own (the call was made directly via the internal `X-Internal-Token` route, exactly simulating what the agent should do, not by driving a real end-to-end agent session) is that the agent never actually makes that call in production. Combining both reports: the backend half of BL-025 (this report) is correct and ready; the feature as a whole is not, pending a nexus-dev fix to `apps/agent/src/avatar_agent/entrypoint.py` (Phase 4 scope, per the parallel report's own attribution). This report's overall verdict below is scoped strictly to the backend surface named in this dispatch and is not a claim that BL-025 end-to-end is ready to close.
