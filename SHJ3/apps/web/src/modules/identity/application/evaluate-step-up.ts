/**
 * The step-up gate itself — B11 tab 2's `[rule]`, "evaluated **before** the
 * tool call, never after" (api.md §3.5, architecture.md §8).
 *
 * This is the citizen-facing half: `shj3-web`'s payment-intent endpoint
 * (`POST /api/public/v1/conversations/{id}/payments/intents`) calls this
 * before constructing a `PaymentGateway.createIntent` request, exactly as
 * `docs/api.md` §4.2 requires ("Rejected with `403 authz.assurance_insufficient`
 * if assurance is short — checked *before* the intent is created"). The agent
 * runtime's own tool-call gate (`apps/ai`'s `ProcessTurn`/`ExecuteFlowStep`) is
 * a second, independent enforcement point reading the same `StepUpRules` table
 * and the same `assurance-mapping.ts` bijection — one Python-side, one
 * TypeScript-side, because the tool call itself can originate from either the
 * flow engine or the citizen HTTP surface and neither may skip the check by
 * routing around the other.
 */

import type { AssuranceLevel } from "../../iam/domain/assurance.js";
import {
  requiredLevelToAssurance,
  satisfiesRequiredAssurance,
} from "../domain/assurance-mapping.js";
import type { StepUpAction } from "../domain/step-up.js";
import type { StepUpRuleRepository } from "../ports/step-up-rule-repository.js";

export type StepUpEvaluation =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly required: AssuranceLevel;
      /** api.md §5.2's `step_up_required` event payload names this. */
      readonly action: StepUpAction;
    };

export interface EvaluateStepUpDeps {
  readonly rules: StepUpRuleRepository;
}

export class EvaluateStepUp {
  constructor(private readonly deps: EvaluateStepUpDeps) {}

  async execute(input: {
    readonly action: StepUpAction;
    readonly heldAssurance: AssuranceLevel;
  }): Promise<StepUpEvaluation> {
    const rule = await this.deps.rules.findByAction(input.action);

    // A disabled or unconfigured rule gates nothing — B11 tab 2's own toggle
    // (`isEnabled`) is the product's way of saying "this action currently needs
    // no step-up," and an absent row (a fresh tenant that never visited the
    // screen) must fail OPEN here rather than block every payment on a config
    // gap. The database-level floor (`TR_StepUpRules_paymentFloor`) is what
    // actually prevents `InitiatePayment` from ever being configured or seeded
    // below `VerifiedPlusOtp` — this function trusts that floor rather than
    // re-deriving it, so a disabled `InitiatePayment` row is a real, audited
    // admin action, not a silent gap this gate quietly reopens.
    if (rule === null || !rule.isEnabled) return { allowed: true };

    if (satisfiesRequiredAssurance(input.heldAssurance, rule.requiredAssurance)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      required: requiredLevelToAssurance(rule.requiredAssurance),
      action: input.action,
    };
  }
}
