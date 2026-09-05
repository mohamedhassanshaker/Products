// PUBLIC API for "@nextbot/authz" (Target Architecture Blueprint Phase 6, BL-37,
// ADR-0012, LLD §14.2). Everything else in this module is private.
//
// QA retry 1 fix (2026-08-29): the raw `evaluate()` algorithm is deliberately NOT
// re-exported here. It previously was ("for this module's own unit tests"), but
// that made it reachable from any other package via `import { evaluate } from
// "@nextbot/authz"` — a public barrel import dependency-cruiser's
// `no-raw-authz-evaluate-outside-authz` rule cannot see, because the rule matches
// the literal `domain/intersect` path, and a barrel re-export resolves the graph
// edge to THIS file, not that one. QA constructed and confirmed that exact
// bypass. The fix is encapsulation, not a smarter lint pattern: every caller
// outside this module MUST use `evaluateOrDeny` (E11: fail-closed on a thrown
// error) — this is now enforced structurally (no export exists to import), with
// the dependency-cruiser rule kept only as defense-in-depth against a deep
// import that reaches into `domain/intersect.ts` directly, bypassing this barrel
// entirely. This module's own unit tests (`domain/intersect.test.ts`,
// `domain/scope-hash.test.ts`) import `evaluate` via a relative path
// (`./intersect.js`), not this barrel, so they are unaffected.

export { evaluateOrDeny } from "./application/evaluate-or-deny.js";
export { getTenantScopePolicy, readPersistedTenantScopePolicy } from "./application/tenant-scope-policy-service.js";
export { simulate } from "./application/simulate-service.js";
export { handleSimulate } from "./http/admin-routes.js";

export { DIMENSIONS, TOP, tierRank, latticeValuesEqual, type EffectiveLattice, type Dimension, type DimensionName } from "./domain/scope-lattice.js";
export { canonicalize, hashScopeInput } from "./domain/scope-hash.js";

// Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-14, LLD §14.5.6) — the
// guardrail tightening-only invariant, called from `agent-platform/domain/
// artifact-validator.ts` so it blocks saving as Draft for every authoring mode.
export { assertTightensOnly } from "./domain/guardrail-tightening.js";
