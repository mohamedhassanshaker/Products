# QA Report - Target Architecture Blueprint Phase 3 (BL-34, MCP enrolment wizard) + Phase 5 (BL-35, Skills library)

**Date**: 2026-08-29
**QA pass type**: standard batched (both phases dispatched together; not flagged security-relevant by either phase's own exit-gate wording)
**Scope**: `docs/plans/target-architecture-blueprint-plan.md` Phase 3 + Phase 5 sections, `docs/NEXUS_STATE.md`'s 2026-08-29 dev decision-log entries (Phase 3, Phase 5), plus a light non-interference check against the concurrently-landed Phase 4 SSO retry-1 fix. Per instructions, nothing under `packages/modules/iam/**` was modified or targeted by this pass (Phase 4 is being separately re-QA'd).

## Environment

- Local monorepo checkout, `D:\work\products\nextbot` (no git - working tree as handed off).
- `compose.test.yml` stack (already running at pass start, presumably left up by the concurrent Phase 4 re-QA pass - reused, not restarted, to avoid disrupting it): Postgres (`localhost:55432`), Redis (`localhost:56379`), ClickHouse (`localhost:58123`).
- `.env.test` credentials (throwaway, ephemeral tmpfs-backed containers).
- Migrations verified at `0001`-`0058` (58 applied, 0 pending on a fresh `migrate:test` run against the shared stack).
- No production environment touched at any point.

## Verification performed (independent - not a re-run of dev's own fixtures except where noted)

1. `pnpm turbo run typecheck` (full repo) - clean except the one pre-existing, already-disclosed `@nextbot/model-gateway` test-file error (`route-admin-routes.test.ts`, unrelated to either phase). Confirmed unchanged from prior QA passes.
2. `pnpm run lint:boundaries` (eslint + dependency-cruiser) - clean, exit 0. A later standalone `dependency-cruiser` invocation hit a transient `ENOENT` on a nonexistent `packages/modules/tenancy/src/__qa_defect2_fixture_named__.ts` - traced to a file that does not exist in this tree and is referenced nowhere; consistent with a concurrent process (most likely the parallel Phase 4 re-QA session sharing this filesystem) creating/deleting a temp fixture mid-scan. Re-run seconds later: clean, **0 violations, 2011 modules / 5462 dependencies** - exact match to both phases' own reported counts. Not a Phase 3/5 defect; noted for transparency only.
3. Fresh `migrate:test` run: 0 pending migrations (all 58 previously applied cleanly, no errors) - consistent with the claimed successful `0001`-`0058` fresh-migration run.
4. Real-Postgres integration suites run directly (not just re-executed via dev's own report):
   - `packages/modules/mcp-registry` - **14/14 pass** (`enrolment-wizard.int.test.ts` 4/4, `connector-migration.int.test.ts` 1/1, `reconciler.int.test.ts` 6/6, `drift-review.int.test.ts` 3/3).
   - `packages/modules/skills` - **7/7 pass** (`skill-service.int.test.ts`).
   - `packages/modules/agent-platform` (skill-upgrade-service + related) - **62/62 pass**, including `skill-upgrade-service.int.test.ts` 4/4.
   - Isolation suite (whole repo) - **92/92 pass**, including `rls-coverage.isolation.test.ts` 68/68 (both new mcp-registry tables and both new skills tables present with FORCE ROW LEVEL SECURITY + policy) and `agent-platform-isolation.isolation.test.ts` 5/5.
5. Full workspace `--project unit --project integration`, run twice fresh:
   - Run 1: 1887/1890 passed, 3 failures. All 3 re-run in isolation and passed individually; investigated one specifically (`plan-tier-definitions.int.test.ts` expected 15, got 42 for `Growth`'s `maxMcpConnectors`) and traced it to a **pre-existing, unrelated** race in the tenancy module: `reseed-tenant-quota.int.test.ts` mutates the same shared, non-tenant-scoped `plan_tier_definition` global row (`updatePlanTierDefinition("Growth", { maxMcpConnectors: 42 })`) that `plan-tier-definitions.int.test.ts` asserts against, with no cross-file lock - a real, pre-existing test-hygiene issue in `tenancy`, unrelated to and predating both Phase 3 and Phase 5. The other two (`structural-diff.int.test.ts` `RouteValidationFailedError` under shared route-synthesis, `credential-db-grant.int.test.ts` permission-grant timing) match the exact class of resource-contention flakiness dev's own reports already disclosed for this repo under full-monorepo parallel load.
   - Run 2 (clean re-run, same command): **1890/1890 passed, 0 failures** - confirms run 1's 3 failures were transient contention, not a functional regression from either phase.
6. Adversarial/independent tests I constructed myself (not simply re-running dev's suite):
   - **Raw SQL `UPDATE skill_version SET instructions = ...`** issued directly via `psql` inside a throwaway transaction (own tenant/skill/version rows, rolled back after) - genuinely rejected by the real `skill_version_immutable_trigger` with `SKILL_VERSION_IMMUTABLE`, confirmed bypassing the application layer entirely (no ORM, no repository code involved). A companion sanity check confirmed the exempt columns (`status`, `published_by_user_id`, `published_at`) **are** still updatable by the same trigger - the exemption list is neither too broad nor too narrow.
   - **Per-consumer upgrade-consumers isolation** (explicitly requested in the dispatch, and disclosed by dev as an untested branch - 63.8% branch coverage on `skill-upgrade-service.ts`): wrote a one-off integration test (`packages/modules/agent-platform/src/application/qa-per-consumer-isolation.int.test.ts`, deleted after the run) that creates two real consumers pinned to `skill@1`, corrupts one consumer's `agent_definition_version.definitionYaml` directly via raw SQL into unparsable garbage (bypassing the app layer), then runs `upgradeConsumers`. Result: the corrupted consumer is reported `ValidationFailed` in `skipped`, the healthy sibling consumer still gets a real Draft created independently - confirming the per-consumer `try/catch` isolation genuinely holds, not merely by inspection. Test file removed after use; no DB residue (verified via count queries afterward).
   - Confirmed via code path (`packages/db/src/tenant-context.ts`'s `withTenantOnPool`) that `withTenant` wraps its whole callback in one `BEGIN`/.../`COMMIT` - the transactional-atomicity claim for `createAgentDefinitionVersion`'s skill-pin resolution + `agent_version_skill` insert is real, not asserted.
7. Coverage spot-check (`vitest --coverage` scoped to the two new modules): `@nextbot/skills` application 92.76%/95.12% branch, domain/http 100%, infrastructure 100%/68.88% branch; `mcp-registry` application 93.78%/72.07% branch, domain 100%/95.65%, http 100%, infrastructure 90.95%/79.77%. Consistent with (not identical to, due to differing invocation scope) dev's own reported aggregates - no coverage regression, no fabricated numbers.
8. No test data left behind: fixture tenants (per-test `afterEach`) all clean up automatically; my own raw-SQL adversarial inserts were wrapped in `BEGIN...ROLLBACK`; final DB spot-check for any `qa-temp%`/`qa_%`/`qa-isolation%` residue returned zero rows across all three. `compose.test.yml` containers left running exactly as found (already up before this pass started) rather than torn down, to avoid disrupting the concurrent Phase 4 re-QA session sharing this stack.

## Phase 3 - MCP enrolment wizard (BL-34): claim-by-claim verification

| Claim | Verified | Evidence |
|---|---|---|
| Full 9-step wizard, built on Phase 0's unmodified `mcp-registry` reconciler | PASS | `enrolment-draft-service.ts` implements all 9 steps; `reconciler.ts` reviewed against Phase 0 baseline behavior - unchanged; `enrolment-wizard.int.test.ts`'s dedicated reconciler-compatibility test (see below) |
| Sandbox/production credentials captured separately, never cross-used | PASS | `submitAuth` mints one `credential` row per environment binding; integration test asserts sandbox and production credential ids differ and that plaintext never appears in the draft payload; independently re-run, green |
| Wizard-created rows identical in shape to Phase 0's reconciler expectations - real drift-detection test against the unmodified reconciler | PASS | `enrolment-wizard.int.test.ts`'s "Phase 0's reconciler (unmodified) correctly reconciles a wizard-created mcp_server_version and detects drift" test independently re-run and passing: a wizard-shaped row reconciles NoChange, then a live schema change is genuinely detected as DriftDetected with 1 drift event, changeKind SchemaChanged |
| Unclassified tools default to Tier-3 disabled | PASS | `submitEnrol`'s fallback (ioClass to Write, approvalTier to Tier3, enabled to false when unset) plus a dedicated integration test and the main walk-through test's untouched Resource item (Tier3/disabled/Write) - independently re-run, green |
| Existing-connector migration: admin-triggered, not an unattended job; preserves every pre-existing `connector` row and tool FK unchanged | PASS | Code inspection confirms `migrateExistingConnectorsAcrossAllTenants` (the would-be scheduled-job entry point) exists but is never called from `apps/worker` - only `migrateExistingConnectorsForTenant` is wired, from the admin HTTP route. A real before/after row-equality integration test (`connector-migration.int.test.ts`) independently re-run: 3 connectors across 2 servers migrated, byte-comparison of all 3 connector rows before/after, tool FK unchanged, idempotent re-run inserts nothing |
| `/mcp/capability-groups` redirects to Phase 0's `/tools/capability-groups`, no duplicate UI/table | PASS | Page is a pure redirect, no new component; confirmed no second CREATE TABLE capability_group anywhere in `packages/db/migrations` (only Phase 0's original) |
| RBAC reuses `connectors` module consistently, fail-closed, across all `/mcp/**` | PASS | Every one of the 17 new `apps/web/app/api/v1/admin/mcp/**` routes and every `(admin)/mcp/**` page uses `requireApi("connectors", ...)` / `getModuleAccessLevel("connectors")` - grepped exhaustively, no exceptions found; RbacModule (contracts) confirms no `mcp_registry` entry was added; the shared `requireApi()` guard (unchanged, pre-existing) returns 401/403 before any handler logic runs |
| Dry run genuinely invokes sandbox only, shows raw result before commit | PASS | `submitDryRun` is hardcoded to the Sandbox binding and fails closed (McpDryRunRequiresReadToolError) unless the target is already Read+enabled; the wizard test uses two distinct real mock MCP servers per environment with deliberately different results, and asserts the dry-run result matches only the sandbox marker; step 9 (enrol) is a separate, later action in both the API and the UI (step 8 shows the raw JSON result with a further "Continue" click required before step 9's "Enrol" button exists) |

## Phase 5 - Skills library (BL-35): claim-by-claim verification

| Claim | Verified | Evidence |
|---|---|---|
| `skill`/`skill_version` mirrors `agent_definition_version`'s identity+version pattern; DB-level trigger genuinely rejects a raw SQL UPDATE | PASS | Independently constructed my own raw-SQL adversarial test directly against Postgres (own tenant/skill fixture, bypassing the app layer entirely) - SKILL_VERSION_IMMUTABLE genuinely raised; a companion check confirmed the exempt columns remain updatable |
| Upgrade-consumers: N consumers re-pinned to N new Drafts, zero mutation of originals, real idempotency, real dry-run, per-consumer isolation | PASS | `skill-upgrade-service.int.test.ts` (3 consumers, all re-pinned; byte-identical re-read of all 3 originals; second run reports PendingUpgradeDraftExists for all 3, zero new drafts; dryRun true creates a "dry-run" sentinel and writes nothing; a Deprecated head is skipped with ConsumerDeprecated) independently re-run, green. Per-consumer isolation (dev's own disclosed untested branch) independently constructed and verified with a real corrupted-sibling test (see above) - genuinely isolated, not merely claimed |
| Where-used panel accuracy | PASS | Same integration test asserts exact pinnedSkillVersion/behindBy/pendingUpgradeDraftId values before and after an upgrade run, against real data |
| `@nextbot/yaml-diff` reused verbatim, no second diff mechanism | PASS | `structuralDiffVersions` in `skill-service.ts` calls the same `diffArtifact()` Phase 0 built; SkillVersion's ARRAY_DIFF_CONFIG/security-tags.ts entries are additive config into the existing engine, not a parallel implementation; a real structural-diff integration test (escalateWhen set-mode change) independently re-run, green |
| `scope_knowledge_collection_names text[]` deviation is a safe, non-premature placeholder | PASS | Column is a plain text[] with no FK, no knowledge_collection table exists anywhere in the schema yet - confirmed by grep; nothing about the shipped shape (index, constraint, or code) would need to be torn down when Phase 7 adds a real _ids column, only added to |
| No Text/YAML toggle design decision - reasoning is sound | PASS (judgment) | 8 flat fields (`SkillForm.tsx`), genuinely no nesting a form cannot represent; contrasts sensibly with the Agent Version editor's 9 composed/nested dimensions. Server still canonicalizes to YAML and computes the hash identically regardless of which UI captured the input - a client-rendering choice only, matching the stated rationale |
| `spec.skills` resolved + `agent_version_skill` written in the SAME transaction as the version insert | PASS | Traced withTenant to withTenantOnPool (`packages/db/src/tenant-context.ts`) - a single real BEGIN/COMMIT wraps the whole callback; `insertAgentDefinitionVersion` does both inserts inside that one callback. Not merely asserted - read the actual transaction boundary code |

## Findings (non-blocking)

1. **[Low / doc gap, Phase 5]** `eslint.config.mjs`'s `skills` module-allow-list comment says "see this module's README" for the deferred `skills.eval-ref-sweep` job, but `packages/modules/skills/README.md` does not exist (unlike most other modules, e.g. `agent-platform`, `connectors`, `tool-registry`, which all have one). Not blocking - the deferral itself is otherwise clearly disclosed in the plan doc and decision log - but the dangling reference should be fixed (either write the README or point the comment at the plan doc instead) on the next touch of this module.
2. **[Low / coverage gap, both phases]** Neither phase added `.test.tsx` unit tests for its new console screens (`McpEnrolmentWizard.tsx`, `McpServersList.tsx`, `McpServerDetail.tsx`, `McpDriftReview.tsx`, `SkillForm.tsx`, `SkillsList.tsx`), unlike this codebase's own established convention elsewhere (`ConnectorWizard.test.tsx`, `RolesTable.test.tsx`, `DefinitionsList.test.tsx`, etc.). All underlying business logic and RBAC gating for both phases is independently verified server-side (API routes, application services, real Postgres), so this is a rough edge rather than an unverified-behavior risk, and proportionate to this being a standard (non-security-flagged) batched pass rather than Final Review. Flagging so a future pass adds this coverage.
3. **[Informational, environment]** A `dependency-cruiser` invocation mid-pass transiently failed on a nonexistent file (`packages/modules/tenancy/src/__qa_defect2_fixture_named__.ts`), almost certainly caused by the concurrently-running Phase 4 re-QA session sharing this filesystem/checkout. Re-ran seconds later, clean (0 violations). Not attributable to Phase 3 or Phase 5; no action needed from either phase's dev.
4. **[Informational, pre-existing, not Phase 3/5]** Found and traced a real (if narrow) test-isolation bug in the **tenancy module** (predates both phases): `reseed-tenant-quota.int.test.ts` mutates the shared, non-fixture-scoped `plan_tier_definition` global row for `Growth` without restoring it, which can make `plan-tier-definitions.int.test.ts` flake under parallel execution. Neither Phase 3 nor Phase 5 touched tenancy's plan-tier code. Not gating this pass, but worth a ticket since it will keep intermittently failing full-suite runs for unrelated future phases too.

No blocking defects found in either phase.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Phase 3: 9-step wizard end-to-end | Full walk, 2 real mock servers, 2 environments | PASS | enrolment-wizard.int.test.ts (re-run) |
| Phase 3: sandbox/production credential isolation | Distinct credential rows, no plaintext leakage | PASS | same file |
| Phase 3: wizard/reconciler schema compatibility | NoChange then real DriftDetected against unmodified reconciler | PASS | same file, 2nd test |
| Phase 3: fail-closed unclassified defaults | Unclassified item blocked at dry-run/enrol; Resource item defaults verified | PASS | same file, 3rd test + main walk |
| Phase 3: existing-connector migration correctness | Before/after row equality, FK preservation, idempotency | PASS | connector-migration.int.test.ts (re-run) |
| Phase 3: migration is admin-triggered not scheduled | Code inspection - apps/worker never calls the across-tenants variant | PASS | code review |
| Phase 3: capability-groups redirect, no duplicate | Route inspection + migration grep | PASS | code review |
| Phase 3: RBAC consistency/fail-closed | Exhaustive grep of all new routes/pages | PASS | code review |
| Phase 3: dry-run sandbox-only, pre-commit visibility | Two distinct mock servers, UI step ordering | PASS | enrolment-wizard.int.test.ts + McpEnrolmentWizard.tsx review |
| Phase 5: immutability trigger (real bypass-the-app-layer test) | Raw SQL UPDATE against real Postgres | PASS | QA-authored adversarial psql session |
| Phase 5: upgrade-consumers full algorithm | 3 consumers, idempotency, dry-run, Deprecated-skip | PASS | skill-upgrade-service.int.test.ts (re-run) |
| Phase 5: per-consumer isolation | Corrupted sibling does not block/corrupt a healthy consumer | PASS | QA-authored one-off integration test (removed after use) |
| Phase 5: where-used accuracy | Exact counts/pins before and after upgrade | PASS | same suite |
| Phase 5: yaml-diff reuse | Real structural diff between two skill versions | PASS | skill-service.int.test.ts (re-run) |
| Phase 5: scope_knowledge_collection_names deviation safety | Schema/migration review | PASS | code review |
| Phase 5: no-Text-mode design judgment | Form field-count/nesting comparison | PASS | code review |
| Phase 5: transactional atomicity of skill-pin resolution | Traced withTenant's single BEGIN/COMMIT | PASS | code review |
| Both: typecheck/lint/lint:boundaries clean | Full-repo run | PASS | see Verification 1-2 |
| Both: fresh migration success | migrate:test re-run | PASS | see Verification 3 |
| Both: isolation suite green | Full isolation project re-run | PASS | see Verification 4 |
| Both: full workspace suite green, no regression | Two fresh full runs | PASS | see Verification 5 |
| Both: no interference with concurrent Phase 4 SSO retry-1 | @nextbot/iam unit+integration+isolation all green in the same full runs; no packages/modules/iam/** files touched by this pass | PASS | full-suite logs |

## Verdict

**Phase 3 (BL-34, MCP enrolment wizard): PASS.**
**Phase 5 (BL-35, Skills library): PASS.**

Neither phase has a blocking defect. The four findings above are all non-blocking (one pre-existing/unrelated to either phase, one environmental/transient, two low-severity gaps worth a follow-up ticket but not worth a retry round-trip).

Per `docs/plans/target-architecture-blueprint-plan.md`'s dependency ordering: with Phase 3 and Phase 5 both now QA-approved, and Phase 0/1/2 already QA-approved, the plan's Phase 6 (built on Phase 5's Skills composition/agent_version_skill bridge) can now proceed. Phase 4 (BL-36) remains NOT yet QA-approved - its retry-1 fix is still pending a separate, independent re-QA pass per its own security-relevant flag; this report does not speak to that phase's status. Any phase whose only blocker was "wait for Phase 3/5 QA" per the plan's dependency notes may now be dispatched.
