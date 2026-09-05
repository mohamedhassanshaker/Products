# QA Report - Dev-13 (VEC-BOOT)

**Date:** 2026-08-10
**Scope:** Dev-13 (VEC-BOOT) only -- Qdrant collections bootstrap, tenant-partitioning
chokepoint, two-tenant isolation guarantee, embeddings adapters. Dev-14+ out of scope
(not started). Treated as a security-critical control at the MySQL-schema-isolation bar,
per orchestrator instruction -- no mocked-Qdrant test accepted as isolation proof.

## Environment

- Backend: apps/api (NestJS), built/tested in place, not deployed to any shared environment.
- MySQL: existing persistent examland-mysql container (127.0.0.1:3306, disposable
  schemas created/dropped per suite -- no production data touched).
- Qdrant (isolation + boot-mismatch proofs): my own fresh, independent container
  (qa-qdrant-dev13, qdrant/qdrant:latest, host port 6533), created before testing and
  destroyed after -- never reused nexus-dev's persistent examland-qdrant container's data
  for the headline isolation proof.
- Full pre-existing e2e regression suite additionally run against the persistent
  examland-mysql (3306) + my independent Qdrant (6533), --runInBand (matching this
  project's established remedy for MySQL pool contention under parallel e2e workers).

## Independent verification performed

1. Real-Qdrant two-tenant isolation (headline requirement). Wrote and ran my own
   throwaway isolation spec (apps/api/test/qa-dev13-independent-isolation.e2e-spec.ts,
   deleted after use) against my own fresh Qdrant instance, seeding two tenants with
   IDENTICAL logical keys/content across all three collections (examland_chunks,
   examland_doc_fingerprints, examland_question_bank). Confirmed:
   - searchChunks/searchFingerprint/searchQuestions, scrollChunks/scrollQuestions,
     deleteChunks/deleteQuestions, purgeTenant, countsForTenant all only ever
     touch/return the calling tenant's own points, even with identical query vectors and
     identical filter values across tenants.
   - Runtime bypass attempt: called adapter.searchChunks with an undefined TenantScope
     via an `as any` cast (bypassing the type system entirely) -- this throws immediately
     (scope.tenantId dereference on undefined) rather than silently searching
     cross-tenant. No runtime path exists to query without a real scope object.
   - Read qdrant.adapter.ts source directly (not just the port's .d.ts shape): confirmed
     buildFilter() is the only place a Filter is constructed and unconditionally
     prepends {key:'tenantId', match:{value: scope.tenantId}}; the Qdrant client is
     private readonly and never returned; no method anywhere accepts a raw filter or
     bare tenant-id string.
   - assertNoLeak() alarm: since a correctly-filtered live query cannot itself produce a
     cross-tenant result to observe the alarm honestly, I monkey-patched the adapter's
     internal client.query to inject one additional, fabricated result with a foreign
     tenant's payload alongside the real result set (simulating a hypothetical future
     defect in the pre-filter). Confirmed: the injected point is stripped from the
     returned array and a vector.tenant_leak_suspected structured log fires with the
     expected/actual tenant ids and point id -- defense-in-depth behaves exactly as
     documented, and the leak is never returned to the caller even when "detected after
     the fact."
   - Then independently re-ran nexus-dev's own test/vector-tenant-isolation.e2e-spec.ts
     (10 tests, unmodified) against my independent Qdrant instance -- all 10 green.
2. UUIDv5 point-id collision resistance: confirmed directly -- pointId(tenantId,
   logicalKey) for two different tenants with the identical logicalKey produces two
   different, well-formed UUIDs (tenant namespace folded in first via
   uuidv5(tenantId, NS_EXAMLAND), then uuidv5(logicalKey, tenantNamespace)).
3. Boot-time dim/model mismatch guard: ran nexus-dev's own
   test/vector-bootstrap.e2e-spec.ts (4 tests, unmodified) against a dedicated disposable
   MySQL schema + my independent Qdrant instance. All 4 green: first-boot creation +
   meta-row recording, idempotent no-op re-boot, EMBEDDING_DIMS drift failure (message
   names the mismatched size and npm run vector:reindex), EMBEDDINGS_MODEL drift failure
   (message names both old/new model, vector_collection_meta, and the remediation command).
4. ESLint boundary: read .eslintrc.cjs directly -- @qdrant/js-client-rest is
   no-restricted-imports-blocked project-wide except one narrow override scoped to
   exactly apps/api/src/infrastructure/vector/qdrant.adapter.ts. Wrote a throwaway file
   (apps/api/src/infrastructure/qa-throwaway-qdrant-violation.ts) importing the Qdrant
   client from a sibling infrastructure/** location and confirmed eslint genuinely fails
   it (no-restricted-imports error), then deleted the file. The boundary is real, not
   just documented.
5. NullEmbeddingsAdapter production refusal: independently instantiated the adapter
   under NODE_ENV=production -- throws with an explicit message naming HLD Section 7.2;
   instantiated again under NODE_ENV=development -- constructs and works normally.
6. Compile-time TenantScope enforcement: ran the isolation suite's own compile-check
   sub-tests, which strip the @ts-expect-error directive from the fixture and run a real
   tsc --noEmit against the project -- confirmed the stripped copy genuinely fails to
   compile (searchChunks/"Expected N arguments" error), proving the directive is a real,
   load-bearing type constraint, not a vacuous comment.
7. Full e2e regression: ran the complete e2e suite (26 suites / 255 tests, --runInBand,
   real MySQL + my independent Qdrant) to completion -- the run nexus-dev flagged as
   unconfirmed. All 26 suites / 255 tests green, zero failures. No regression from this
   phase's @Optional() DI fix or the VectorBootstrapService
   "missing-meta-table-is-non-fatal" change is visible anywhere in the existing suite.
8. Full unit suite: re-ran independently -- 120 suites / 981 tests, all green
   (nexus-dev reported 979; 2 additional tests observed, not a regression -- no failures
   either way).
9. Static analysis: npm run typecheck (all three workspaces) and npm run lint
   (project-wide, --max-warnings=0) both clean.
10. Security spot-check: confirmed no new HTTP endpoint this phase; no controller
    reaches VectorStorePort yet (nothing to get wrong on the request-input side); no
    secret/credential committed (QDRANT_API_KEY/EMBEDDINGS_API_KEY are env-only); no raw
    SQL in the new VectorCollectionMetaRepository (TypeORM query builder only).

## Traceability matrix

| Requirement (HLD Section 6.1/6.1a/6.2/7.3, Dev-13 exit gate) | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Every VectorStorePort method requires a non-optional TenantScope; no raw-filter method | Source read of vector-store.port.ts; compile-check strip/re-check; runtime `as any` bypass attempt | Pass | Port source; tsc --noEmit negative-control failure; runtime TypeError on undefined scope |
| Single chokepoint: only qdrant.adapter.ts imports the Qdrant client | ESLint boundary read + throwaway-violation file | Pass | .eslintrc.cjs; lint run on throwaway file (caught) |
| buildFilter() unconditionally prepends tenant must clause | Source read; two-tenant identical-key search/scroll | Pass | Adapter source; independent isolation spec |
| Post-filter leak alarm (vector.tenant_leak_suspected) fires and strips leaked data | Monkey-patched-client injection test | Pass | Independent isolation spec, alarm log observed, injected point absent from result |
| UUIDv5 per-tenant-namespaced point ids, collision-free across tenants | Direct pointId() comparison for identical logical key, two tenants | Pass | Independent isolation spec |
| Two-tenant isolation across search/scroll/delete/purge/count, all 3 collections | Identical logical keys + identical query vectors, both my own container and nexus-dev's own suite re-run | Pass | Independent isolation spec (5 tests) + vector-tenant-isolation.e2e-spec.ts (10 tests), both against my independent Qdrant |
| Boot-time dim/model drift guard fails loudly with remediation | First boot, idempotent reboot, dims drift, model drift | Pass | vector-bootstrap.e2e-spec.ts (4 tests) against my independent MySQL schema + Qdrant |
| NullEmbeddingsAdapter refuses under NODE_ENV=production | Direct construction under production/development | Pass | Independent spec run |
| Full e2e regression (no cross-cutting break from the @Optional()/meta-table-tolerance changes) | Full 26-suite e2e run to completion | Pass | 26/26 suites, 255/255 tests green |
| Full unit suite | Full run | Pass | 120/120 suites, 981/981 tests green |
| Lint/typecheck clean | Project-wide run | Pass | Clean output, no errors |

No requirement in scope was left untested.

## Defects

None blocking.

One non-blocking, low-severity observation:

- Stray Qdrant collections accumulate on the persistent dev Qdrant instance across
  repeated isolation e2e runs. test/vector-tenant-isolation.e2e-spec.ts's afterAll only
  calls purgeTenant() (deletes tenant points), never deletes the randomized collections
  it creates in beforeAll (ensureCollection). Observed on the persistent examland-qdrant
  container (port 6333, not my throwaway instance): 8 sets of leftover empty
  examland_e2e_iso_* collections from repeated runs (mine and, presumably, nexus-dev's
  own prior runs). Not a tenant-isolation defect and not a data-disclosure risk
  (collections are empty after purgeTenant), but will accumulate indefinitely on any
  long-lived Qdrant instance used for repeated e2e runs. Severity: low / rough edge --
  recommend afterAll additionally delete the 3 collections it created, not just purge
  their points. Does not block Dev-13.

## Verdict

PASS -- Dev-13 (VEC-BOOT) is QA-green. Tenant isolation genuinely holds against an
independently-provisioned, non-reused real Qdrant instance across every exposed surface,
including an intentionally adversarial runtime bypass attempt and a simulated leak
scenario exercising the defense-in-depth alarm. The full e2e suite nexus-dev left
unconfirmed has now been run to completion with zero regressions. Ready to advance.
