/**
 * Reconciles B11's two independently-typed assurance vocabularies.
 *
 * `Principal.assurance` (`iam/domain/assurance.ts`) is the citizen-session
 * ladder: `L0`–`L3`, a rank a feature module compares. `ToolBindings`/
 * `FlowNodes`/`StepUpRules`.`requiredAssurance` (`tools/domain/tool-catalog.ts`,
 * `CK_ToolBindings_requiredAssurance` et al.) is the *persisted enum* a config
 * screen writes: `Anonymous` | `Verified` | `VerifiedPlusOtp` |
 * `VerifiedPlusDocument`. Both describe the same four-level ladder, but B-5
 * (the agent runtime wave) found they do not agree on a value set anywhere in
 * the codebase — flagged plainly rather than silently guessed at (`tasks/
 * todo.md`'s B-5 review, judgment call 3) — because nothing had needed to
 * compare them across the boundary until the runtime's step-up gate did.
 *
 * ## Which mapping is authoritative, and why the two docs disagree
 *
 * `docs/data-model.md` §4.11 (written before RISK-006 was decided) proposed
 * collapsing `VerifiedPlusOtp` and `VerifiedPlusDocument` onto one shared rank
 * `L2`, leaving `L3` "reserved, unallocated." `docs/requirements.md` §9's
 * RISK-006 row **records a later, explicit product-owner decision** ("adopted:
 * four levels L0–L3, with L3 (document-verified) defined for kiosk journeys")
 * — and the already-shipped, already-tested `iam/domain/assurance.ts` was built
 * to that later decision: its own module doc names `L3` as document-verified,
 * gating nothing yet, existing so the mock adapter's fourth level is exercised
 * before a kiosk journey needs it. Per this codebase's own established
 * discipline (`tasks/lessons.md`: "a doc's worked example can be stale relative
 * to an already-tested sibling"), the already-built, already-tested sibling
 * wins over the earlier doc. `docs/data-model.md` §4.11 is corrected in the same
 * change that adds this file, so the two documents no longer disagree either.
 *
 * ## The mapping, therefore
 *
 * | `RequiredAssuranceLevel` | `AssuranceLevel` |
 * |---|---|
 * | `Anonymous`            | `L0` |
 * | `Verified`             | `L1` |
 * | `VerifiedPlusOtp`      | `L2` |
 * | `VerifiedPlusDocument` | `L3` |
 *
 * A straight bijection — every enum value has its own distinct rank, which is
 * what makes this a true reconciliation rather than a lossy collapse. Nothing
 * in the seeded step-up rules (FR-PAY-06's payment floor is `VerifiedPlusOtp`,
 * i.e. `L2`) or the mock provider's own four-level ladder requires the
 * collapsed reading, so nothing downstream needs to change to adopt it.
 */

import { satisfiesAssurance, type AssuranceLevel } from "../../iam/domain/assurance.js";
import type { RequiredAssuranceLevel } from "../../tools/domain/tool-catalog.js";

/**
 * The bijection, spelled out as data rather than derived from array index —
 * `REQUIRED_ASSURANCE_LEVELS`'s declared order already happens to match
 * `ASSURANCE_LEVELS`'s, but this table is the actual contract, so a future
 * reordering of either enum (unlikely — both are CHECK-constrained /
 * rank-order-sensitive — but not impossible) cannot silently re-map anything.
 */
const REQUIRED_TO_ASSURANCE: Readonly<Record<RequiredAssuranceLevel, AssuranceLevel>> = {
  Anonymous: "L0",
  Verified: "L1",
  VerifiedPlusOtp: "L2",
  VerifiedPlusDocument: "L3",
};

const ASSURANCE_TO_REQUIRED: Readonly<Record<AssuranceLevel, RequiredAssuranceLevel>> = {
  L0: "Anonymous",
  L1: "Verified",
  L2: "VerifiedPlusOtp",
  L3: "VerifiedPlusDocument",
};

/** Every `RequiredAssuranceLevel` maps to a rank; a bijection guarantees this cannot silently fall through. */
export function requiredLevelToAssurance(required: RequiredAssuranceLevel): AssuranceLevel {
  return REQUIRED_TO_ASSURANCE[required];
}

export function assuranceToRequiredLevel(level: AssuranceLevel): RequiredAssuranceLevel {
  return ASSURANCE_TO_REQUIRED[level];
}

/**
 * The step-up gate's one real comparison: does the session's held rank satisfy
 * the persisted `requiredAssurance` enum value a `ToolBinding`/`FlowNode`/
 * `StepUpRule` row carries?
 *
 * `required: null` means "the row carries no override" — treated as
 * `Anonymous` (no gate), matching `FlowNodes.requiredAssurance`'s own nullable
 * column (only `ToolCall` nodes populate it, and even those may leave it unset
 * to inherit the bound tool's own floor — see `evaluateStepUp`).
 */
export function satisfiesRequiredAssurance(
  held: AssuranceLevel,
  required: RequiredAssuranceLevel | null,
): boolean {
  if (required === null) return true;
  return satisfiesAssurance(held, requiredLevelToAssurance(required));
}
