# @nextbot/authz

Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.2) — the
centralized permission-intersection evaluator (FR-ORC-02/FR-SEC-08) and the
`/authz/simulate` preview endpoint.

## What this module is

The single implementation of:

> effective scope = caller scope ∩ artifact scope ∩ tenant policy. Composition
> narrows. It never unions, and there is no flag that makes it union.

- `domain/scope-lattice.ts` — the 16-dimension lattice's `⊤` values and
  per-dimension `∧` (meet) functions, transcribed verbatim from LLD §14.2.1's
  table. Pure, no I/O.
- `domain/intersect.ts` — `evaluate()`, the pure algorithm (LLD §14.2.3, steps
  0–6). Pure, no I/O, no database (enforced by dependency-cruiser's
  `no-db-inside-domain` rule). **Never call this directly from outside this
  module** — use `evaluateOrDeny()` instead (E11: fails closed on a thrown
  error). `evaluate` is **not** part of this module's public barrel
  (`src/index.ts`) — the only way to reach it from outside `authz` is a deep
  relative import straight into `domain/intersect.ts`, which is not a valid
  package-entry-point import under this workspace's `exports` map and is
  additionally flagged by the `no-raw-authz-evaluate-outside-authz`
  dependency-cruiser rule (kept as defense-in-depth for that deep-import case).
  This module's own unit tests import `evaluate` via a relative path
  (`./intersect.js`), which is fine since they live inside `authz` itself.
  (QA retry 1, 2026-08-29: this module previously re-exported `evaluate` from
  the public barrel, which made `import { evaluate } from "@nextbot/authz"`
  compile from anywhere in the monorepo — the dependency-cruiser rule only
  matched the literal `domain/intersect` path, so it never saw that barrel
  import as a violation. QA constructed and confirmed the bypass. The fix
  removes `evaluate` from the barrel entirely rather than patching the lint
  rule, so the unsafe path is structurally unreachable, not merely flagged.)
- `application/evaluate-or-deny.ts` — the sanctioned entrypoint. Catches,
  logs, writes a `guardrail.evaluator_error` domain event, and returns
  `Deny(EVALUATOR_ERROR)` if `evaluate()` itself throws.
- `application/tenant-scope-policy-service.ts` — `tenant_scope_policy`, the
  one table this module owns (LLD §14.2.6). Derived fresh on every read from
  `tenant_data_policy`/`tenant_runtime_quota` (not hand-edited).
- `application/simulate-service.ts` — resolves an `/authz/simulate` request's
  artifact references to real `ScopeDescriptor`s, then calls the exact same
  `evaluateOrDeny()` the runtime uses.

## Disclosed scope decisions (Phase 6 / BL-37)

- **`tenant_scope_policy` derives only `allowOutOfRegionInference`** from
  `tenant_data_policy` this phase. `tenant_runtime_quota`'s existing columns
  (`maxConcurrentRuns`, `maxTokensPerMinute`, etc.) don't correspond to any
  `budget` dimension field (those are run/delegation-tree concepts
  `team_version.limits_json` will own once Module E ships) — `budget` stays
  at `⊤` at the tenant-policy level. `pii_policy`'s matrix is keyed by
  `(entityType, context, trustLevel)`, not `context` alone — collapsing it to
  one `maskingFloor` value per context would require an aggregation rule the
  LLD doesn't specify, so `maskingFloor` also stays at `⊤` this phase. PII
  masking itself is still fully enforced independently by `@nextbot/pii`'s
  own masker at every existing call site.
- **Recomputed fresh on every read**, not reconciled hourly by a worker job as
  LLD's literal text describes — strictly stronger (always exactly current)
  and avoids a new write-time coupling into `tenancy`'s own transactions this
  phase doesn't otherwise touch.
- **`/authz/simulate`'s chain-ref resolution today**: `inline` and
  `skillVersion` are real. `agentVersion`/`teamVersion`/`teamMember`/
  `workflowVersion`/`workflowNode` throw `AuthzRefNotYetSupportedError` (422)
  — none of those artifact kinds persist a real `ScopeDescriptor` in this
  build yet (`agent_definition_version` has no `scope_json` column; teams/
  workflows are Phase 14/15).
- **`PermissionIntersectionInputSchema.tenantResidencyRegion`** is an
  additive field not literally in LLD §14.2.2's schema — the LLD's own step
  4g pseudocode compares `requested.targetRegion` against "the tenant
  residency region" but never says how the evaluator learns that value (it
  isn't a lattice dimension). This field fills that gap explicitly rather
  than guessing at an implicit source.

## Mandated call sites (LLD §14.2.5) — status

| Call site | Status |
|---|---|
| `orchestration/application/tool-call-pipeline.ts` | **Wired live** this phase |
| `teams/application/delegation-executor.ts` | Deferred — no delegation executor exists yet (Phase 14/BL-46) |
| `workflows/application/node-executor.ts` | Deferred — no workflows module exists yet (Phase 15) |
| `orchestration/application/skill-activator.ts` | Deferred — no runtime skill-activation call path exists yet |
| `knowledge/application/retrieval-executor.ts` | Deferred — no retrieval executor exists yet (Phase 7+) |

Every deferred call site's future implementation only needs to import
`evaluateOrDeny`/`getTenantScopePolicy` from this module's public API — the
contract is already stable.
