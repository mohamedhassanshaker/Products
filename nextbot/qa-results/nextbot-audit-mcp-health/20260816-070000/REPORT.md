# QA Report: Plan Phases 17-18 (BL-10 audit/PII/residency/DSR, BL-11 MCP health/circuit-breaker/quota)

Date: 2026-08-16
Scope: Backend/security correctness pass. Requirements in scope: FR-ADM-03, FR-SEC-04, FR-ADM-06, FR-MCP-08, FR-AGT-10, RP-02 (plus NFR-10/NFR-4/NFR-4a as cited by those FRs).
Environment: Existing ephemeral test stack (compose.test.yml): nextbot-test-postgres-test-1 (55432), nextbot-test-redis-test-1 (56379), nextbot-test-clickhouse-test-1 (58123). apps/worker was started as a genuinely separate tsx src/main.ts OS process against this same test DB/Redis for the worker verification. All fixture data created/cleaned up by QA scripts.

## Test suite (run independently by QA)

| Suite | Dev claim | QA independent run | Result |
|---|---|---|---|
| Unit | 746 | 746/746 | Match |
| Integration | 216 | 227/227 | All pass (higher than claimed, not a concern) |
| Isolation | 69 | 69/69 | Match |
| Lint | clean | timed out before finishing (inconclusive) | Not independently confirmed clean |

## Independent verifications performed

### 1. Audit log DB-level immutability (FR-ADM-03, NFR-10) -- PASS
Real pg client connecting as nextbot_app_test, nextbot_platform_test, and nextbot_gateway_test after a normal bootstrap run, attempted UPDATE/DELETE against audit_log_entry. All three roles got a genuine SQLSTATE 42501 permission denied for table audit_log_entry -- a real DB-level denial, not app-layer. INSERT still works (append-only). Claim confirmed genuine.

### 2. PII fail-closed default (FR-SEC-04) -- PASS
masker.ts maskText() resolves via resolvePolicy(...) ?? FullMask -- a plain nullish-coalescing fallback with no other path. buildPolicyLookup backs this with Map.get() (returns undefined for a genuinely missing key). Dev's own masker.test.ts explicitly covers this case. Confirmed real.

### 3. Circuit breaker genuinely Redis-backed, cross-process (FR-MCP-08) -- PASS
Ran the dev trip-breaker-in-child-process.ts fixture as a real separate tsx OS process (5 consecutive real recorded failures), then from a second independently-started process read state:
  status before reset: Open, consecutiveFailures=5
  isBreakerOpen from a genuinely different OS process: true
Then called resetBreaker() (same code the admin Reset button calls) and re-read:
  status after reset: Closed, consecutiveFailures=0
  isBreakerOpen after reset: false
Confirmed both apps/gateway and apps/web mcp-egress.ts import isBreakerOpen/recordBreakerOutcome from the same shared mcp-client module (no duplicate implementation), and the admin mcp-health reset-breaker route exists. Closes the Phase 14/16 BE2 gap for real.
### 4. Quota enforcement under real concurrency (FR-AGT-10, NFR-4/4a) -- PASS
Real fixture tenant with max_concurrent_runs=3, max_tool_calls_per_second=4. Fired 10 genuinely concurrent Promise.allSettled calls to the real claimConcurrentRunSlot/checkToolCallRate functions against real Redis:
  concurrent-run claims (limit=3, 10 concurrent attempts): succeeded=3 failed=7, all QuotaExceededError
  tool-call-rate checks (limit=4/sec, 10 concurrent attempts): ok=4 rejected=6, all QuotaExceededError
QuotaExceededError.httpStatus = 429 confirmed. claimConcurrentRunSlot is called from the turn-pipeline-adapter; checkToolCallRate from both apps/gateway and apps/web egress paths, per dev's claim.
Minor gap: no HTTP-level integration test drives a real route to observe 429 end-to-end -- function-level enforcement is proven correct with real infra, so this is a should-fix test-coverage gap, not a functional defect.
### 5. apps/worker real separate-process job execution -- PASS on mechanics, exposes Defect 1
Started apps/worker via tsx src/main.ts as a genuine separate OS process against the real test Postgres/Redis, with a fixture tenant carrying an old (400-day-stale) Resolved conversation and an idle (2-hour-stale) Active conversation. On first run (tenant left at its schema default status Trial), every job reported tenantsChecked: 0. After manually setting the tenant status to Active, all five jobs fired immediately at startup and processed the tenant for real:
  job conversation.idle-sweep completed: tenantsChecked=1, abandoned=1, resolved=0
  job tenancy.retention-purge completed: tenantsChecked=1, tenantsPurged=1, conversationsDeleted=1
Independently re-queried Postgres directly afterward: the old conversation row was genuinely gone (0 rows), and the idle conversation status was genuinely Abandoned. The scheduler/job-execution mechanism itself is real and correct -- the defect is entirely in which tenants ever reach the jobs (see Defect 1).

## Defects

### Defect 1 -- BLOCKING, cross-phase (Phase 1 provisioning x Phase 18 scheduling)
Every real tenant is silently excluded from every apps/worker scheduled job, forever, because:
- tenant.status defaults to Trial (schema enum tenant_status = Active/Suspended/Trial, default Trial).
- provisionTenant() (packages/modules/tenancy/src/application/provision-tenant.ts) never sets status on insert, so every tenant provisioned through the real onboarding flow is created in Trial and stays there.
- Grepped the entire codebase: no code path anywhere ever transitions a tenant status to Active.
- All five apps/worker jobs (retention-purge, idle-sweep, audit-sync, health-check, git-sweep) share one seam, listActiveTenantContexts() (packages/modules/tenancy/src/application/list-tenant-contexts.ts), which filters WHERE tenant.status = Active.
- Net effect: in the real system as shipped, listActiveTenantContexts() returns zero tenants, always. Retention purge (FR-ADM-06) never runs for any tenant. MCP health-checking (FR-MCP-08) never probes any tenant connectors on the recurring schedule. The audit outbox sync (feeding the Audit Log Viewer, FR-ADM-03) never runs. The idle-conversation sweep (Phase 13) never runs. The Git PR reconciliation sweep (Phase 10) never runs.

Evidence this was known, not merely missed: packages/modules/conversations/src/application/idle-sweeper.int.test.ts contains an explicit comment/workaround stating listActiveTenantContexts filters tenant.status=Active, createFixtureTenant leaves the schema default Trial, so the test flips both fixtures to Active -- i.e. the dev had to hand-patch every test tenant status to make the sweep visibly work, which should have triggered checking whether provisionTenant (the real production path) does the same. It does not.

Repro: create/provision a tenant, leave status untouched (real default), start apps/worker as a separate process -> every job logs tenantsChecked: 0 regardless of real data present. Manually UPDATE tenant SET status=Active -> the exact same tenant is immediately processed correctly.

Impact: FR-ADM-06 auto-purge promise and FR-MCP-08 health-monitoring/alerting promise are both completely inert in production as shipped, not partially degraded -- the single most severe finding in this pass. Attributed to Phase 18 (first dispatch that actually runs these jobs for real against production tenant data), though the root fix likely also touches Phase 1 provisionTenant.

### Defect 2 -- BLOCKING (FR-ADM-06)
Retention purge enforces only 1 of the 4 categories FR-ADM-06 explicitly names, with zero enforcement code for the other 3, and the admin UI does not disclose this. Grepped the codebase for retentionToolPayloadsDays/retentionToolMetadataDays/retentionPiiDays usage outside schema/CRUD/UI plumbing: zero hits. These three fields are pure dead configuration -- an admin can set tool-call payloads to 7 days retention in the Data Policy Settings screen and it will never be enforced by anything, indefinitely. FR-ADM-06 promises auto-purge enforcement for all four categories independently. The dev decision log discloses this as a scope cut, but the admin-facing settings screen gives the tenant admin no indication that 3 of the 4 fields they configure do nothing -- a tenant relying on this for a real compliance obligation would be silently unprotected. Phase 17.

### Defect 3 -- BLOCKING (FR-ADM-06 DSR export completeness)
The DSR Export action does not include the customer actual data -- only conversation-row metadata. dsr-service.ts exportDsrData() calls findConversationsByCustomerIdentifier(), a plain SELECT * FROM conversation WHERE ... -- this returns only the conversation table own columns (status, timestamps, cost, recognized goal), not the message table content at all, and does not touch escalation, tool_call, or audit_log_entry rows referencing the customer. FR-ADM-06 explicitly promises search/view/export/delete by customer identifier across all of a tenant data. A GDPR-style access/portability request exists to hand the data subject an actual copy of their personal data -- a response containing only conversation metadata (no transcript text, the primary PII-bearing content) does not satisfy that purpose; this is not a partial/acceptable phased cut, it is functionally a stub with a real-looking name. Dev decision log discloses this (export does not aggregate message/escalation content) but frames it more mildly than the actual severity warrants given the spec explicit across all of a tenant data language. Phase 17.

### Should-fix (non-blocking)
- S1: No HTTP-level integration test proves a real widget/admin HTTP request returns 429 QUOTA_EXCEEDED under load -- only the underlying function is proven (by QA, independently, with real concurrency). Low risk since mechanism and wiring are both independently confirmed correct.
- S2: Lint (pnpm run lint) did not finish within a 200s window when QA re-ran it independently, unlike unit/integration/isolation which all completed and passed. Not treated as a failure but not independently confirmed clean either -- worth a full re-run before the next release gate.

### Judgment on disclosed items
- Audit-module-boundary deviation (retention-purge sweeper lives in apps/worker, not packages/modules/audit): ACCEPTABLE. Matches an established composition-root pattern already used elsewhere in this codebase (dsr-service.ts, turn-pipeline-adapter.ts) for the same only-an-app-may-import-both-modules reason, clearly documented, not silent.
- Retention purge scoped to transcripts only: NOT an acceptable phased cut -- see Defect 2.
- DSR export omitting message/escalation content: NOT an acceptable phased cut -- see Defect 3.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-ADM-03 (Audit Log immutability) | Real UPDATE/DELETE as app/platform/gateway roles | PASS | Section 1 |
| NFR-10 (Auditability and Immutability) | Same as above | PASS | Section 1 |
| FR-SEC-04 (PII fail-closed) | Unconfigured (entityType,context,trust) triple | PASS | Section 2 |
| FR-ADM-06 (retention, auto-purge, all 4 categories) | Transcript purge (real worker run); tool-payload/metadata/PII purge (grep for enforcement) | FAIL (transcripts only) | Defect 2 |
| FR-ADM-06 (DSR export across all of a tenant data) | Read exportDsrData implementation | FAIL (metadata only) | Defect 3 |
| FR-ADM-06 (worker actually running against real tenants) | Real separate-process worker run against fixture tenant | FAIL (blocked by tenant.status default) | Defect 1 |
| FR-MCP-08 (circuit breaker cross-process, Reset) | Real trip in process A, read in process B, reset in process C | PASS | Section 3 |
| FR-MCP-08 (health-check job actually running against real tenants) | Same worker-process test | FAIL (blocked by Defect 1) | Defect 1 |
| FR-AGT-10 / NFR-4/4a (quota enforcement) | 10 truly-concurrent claims against limit=3 / limit=4 | PASS | Section 4 |
| RP-02 (tool call analytics) | Not exercised (no analytics-surface changes in this batch) | UNTESTED | -- |

## Overall verdict: NOT READY / FAIL

Three blocking defects, one of which (Defect 1) silently disables the entire Phase 18 job-scheduling infrastructure -- and by extension FR-ADM-06 auto-purge and FR-MCP-08 health-monitoring promises -- for every real tenant in the system. The circuit-breaker rewrite and quota-enforcement work are both genuinely correct and well-verified; the PII fail-closed default and audit immutability are both genuinely correct at the DB level. Do not advance to Backlog Phase 3 until Defects 1-3 are fixed and re-verified.
