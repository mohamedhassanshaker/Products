/**
 * B11 tab 2's action → required-assurance map.
 *
 * `CK_StepUpRules_actionKey` (`prisma/sql/001_constraints.sql`) closes the
 * vocabulary to these four — transcribed from the real constraint, not guessed
 * (`tasks/lessons.md`: "a CHECK constraint's closed vocabulary is not guessable
 * from context").
 */

import type { RequiredAssuranceLevel } from "../../tools/domain/tool-catalog.js";

export const STEP_UP_ACTIONS = [
  "ViewBillBalance",
  "LinkUtilityAccount",
  "InitiatePayment",
  "ChangeRegisteredMobile",
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export function isStepUpAction(value: string): value is StepUpAction {
  return (STEP_UP_ACTIONS as readonly string[]).includes(value);
}

/**
 * `TR_StepUpRules_paymentFloor` (§4.11) made visible in TypeScript: `InitiatePayment`
 * may never be configured below `VerifiedPlusOtp` (FR-PAY-06). Both sides of this
 * floor exist — the trigger is the real, unbypassable enforcement; this constant
 * is what lets `SetStepUpRule` reject the change with a clear reason *before*
 * round-tripping to the database to discover the trigger said no.
 */
export const PAYMENT_ACTION_ASSURANCE_FLOOR: RequiredAssuranceLevel = "VerifiedPlusOtp";

const REQUIRED_ASSURANCE_RANK: Readonly<Record<RequiredAssuranceLevel, number>> = {
  Anonymous: 0,
  Verified: 1,
  VerifiedPlusOtp: 2,
  VerifiedPlusDocument: 3,
};

/** Rank comparison — the floor and a candidate value are both compared as ranks, never as strings. */
export function belowPaymentFloor(candidate: RequiredAssuranceLevel): boolean {
  return (
    REQUIRED_ASSURANCE_RANK[candidate] < REQUIRED_ASSURANCE_RANK[PAYMENT_ACTION_ASSURANCE_FLOOR]
  );
}
