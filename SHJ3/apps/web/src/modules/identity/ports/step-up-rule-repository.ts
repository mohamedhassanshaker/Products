/**
 * `StepUpRules` — B11 tab 2's action → required-assurance map.
 */

import type { RequiredAssuranceLevel } from "../../tools/domain/tool-catalog.js";
import type { StepUpAction } from "../domain/step-up.js";

export interface StepUpRuleRow {
  readonly id: string;
  readonly actionKey: StepUpAction;
  readonly requiredAssurance: RequiredAssuranceLevel;
  readonly isEnabled: boolean;
  readonly ordinal: number;
}

export type SetStepUpRuleResult =
  | { readonly ok: true; readonly rule: StepUpRuleRow }
  | { readonly ok: false; readonly reason: "identity.payment_floor_violation" };

export interface StepUpRuleRepository {
  list(): Promise<readonly StepUpRuleRow[]>;
  findByAction(actionKey: StepUpAction): Promise<StepUpRuleRow | null>;

  /**
   * `TR_StepUpRules_paymentFloor` is the real, unbypassable enforcement — this
   * can still return `identity.payment_floor_violation` (the trigger's
   * rejection, translated) even though `SetStepUpRule` (application layer)
   * already checked `belowPaymentFloor` first, because the two checks read the
   * same fact from two different places and only the database's is load-bearing.
   */
  setRequiredAssurance(input: {
    readonly actionKey: StepUpAction;
    readonly requiredAssurance: RequiredAssuranceLevel;
    readonly now: Date;
  }): Promise<SetStepUpRuleResult>;
}
