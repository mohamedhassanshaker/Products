import { GuardrailLoosenedError, type ScopeDescriptor } from "@nextbot/contracts";
import { DIMENSIONS, TOP, latticeValuesEqual, type LatticeFields } from "./scope-lattice.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-14, LLD §14.5.6) — the
 * guardrail tightening-only invariant: an agent version (authored via Text,
 * Design, or Studio mode) may only **tighten** tenant-level PII masking/guardrail
 * policy relative to the tenant default, never loosen it.
 *
 * **Reuses the EXACT SAME `meet`/lattice definitions Phase 6's permission-
 * intersection evaluator already established (`domain/scope-lattice.ts`)** — "so
 * there is exactly one notion of 'stricter' in the codebase," per this phase's own
 * brief. The check is `meet(tenantFloor, proposed) deepEquals proposed`: if
 * intersecting the proposal with the tenant floor changes it, the proposal was
 * looser somewhere on that dimension — the differing dimension (and, for the
 * per-context `maskingFloor` dimension, the specific context key) is exactly the
 * field named in the thrown error, never merely a generic "policy rejected".
 *
 * A dimension the proposal never declares is SKIPPED entirely, not substituted
 * with `⊤` on the proposed side — this is the one place this function
 * deliberately does NOT mirror `evaluate()`'s own chain-fold semantics (LLD
 * §14.2.1's "absent ⇒ ⊤" fold-identity convention is correct for computing an
 * EFFECTIVE scope across a chain, where every level really does participate;
 * it is wrong here, where "proposed" is a single artifact that structurally
 * cannot even author most of these 16 dimensions yet — e.g. no artifact shape
 * this codebase has today can declare `allowOutOfRegionInference`. Substituting
 * `⊤` for an undeclarable dimension would compare the TENANT'S real floor
 * against a value the artifact never claimed, producing a false
 * "loosened" rejection on a dimension the author had no way to even discuss.
 * Only a dimension the artifact actually populates (today: `maskingFloor`,
 * `trustLevel`, `channelTypes`, `refuseWhenUngrounded`, `minCitations`, per
 * `agent-platform/application/artifact-validator.ts`'s own mapping) is ever
 * compared against a real tenant floor value — confirmed by a real adversarial
 * integration test proving an undeclared dimension can never trigger a false
 * rejection (`artifact-validator.guardrail-tightening.int.test.ts`).
 *
 * Called from `artifact-validator.ts` so this blocks **saving as Draft**, not
 * merely promotion, identically for every authoring mode — FR-AGT-14's actual
 * enforcement mechanism, not merely hidden in the interface.
 */
export function assertTightensOnly(tenantFloor: ScopeDescriptor, proposed: ScopeDescriptor): void {
  const floorFields = tenantFloor as LatticeFields;
  const proposedFields = proposed as LatticeFields;

  for (const dim of DIMENSIONS) {
    const proposedValue = proposedFields[dim.name];
    // The artifact makes no claim about this dimension at all — nothing to
    // check (see this function's own doc comment for why this is NOT the
    // same as substituting ⊤).
    if (proposedValue === undefined) continue;

    const floorValue = floorFields[dim.name] ?? TOP[dim.name];
    const met = dim.meet(floorValue, proposedValue);
    if (latticeValuesEqual(met, proposedValue)) continue; // no loosening on this dimension.

    if (dim.name === "maskingFloor") {
      // Drill into the per-context record so the error names the exact matrix
      // cell that was loosened (e.g. `maskingFloor.Transcript`), not just the
      // dimension name — LLD §14.5.6's own worked example requires this.
      const floorRecord = floorValue as Record<string, string>;
      const proposedRecord = proposedValue as Record<string, string>;
      const metRecord = met as Record<string, string>;
      for (const context of Object.keys(proposedRecord)) {
        if (!latticeValuesEqual(metRecord[context], proposedRecord[context])) {
          throw new GuardrailLoosenedError(`maskingFloor.${context}`, floorRecord[context] ?? "Show", proposedRecord[context]);
        }
      }
      // Should be unreachable (the outer mismatch guarantees at least one context
      // differs), but fail closed with the dimension-level error rather than
      // silently passing if this invariant is ever violated by a future edit.
      throw new GuardrailLoosenedError("maskingFloor", floorValue, proposedValue);
    }

    throw new GuardrailLoosenedError(dim.name, floorValue, proposedValue);
  }
}
