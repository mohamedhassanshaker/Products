/**
 * Set a B11 tab 2 step-up rule's required assurance. `PUT /verification/
 * step-up-rules/{action}` (api.md §6.10), `users.manage`.
 *
 * `belowPaymentFloor` is this use case's own pre-check — the database's
 * `TR_StepUpRules_paymentFloor` is the real, unbypassable enforcement, but
 * failing here first means a rejected change never reaches the audit log as
 * "attempted," which would otherwise record a change that never actually took
 * effect.
 */

import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import { belowPaymentFloor, type StepUpAction } from "../domain/step-up.js";
import type {
  SetStepUpRuleResult,
  StepUpRuleRepository,
} from "../ports/step-up-rule-repository.js";
import type { RequiredAssuranceLevel } from "../../tools/domain/tool-catalog.js";

export type SetStepUpRuleUseCaseResult =
  SetStepUpRuleResult | { readonly ok: false; readonly reason: "identity.payment_floor_violation" };

export interface SetStepUpRuleDeps {
  readonly rules: StepUpRuleRepository;
  readonly audit: AuditSink;
}

export class SetStepUpRule {
  constructor(private readonly deps: SetStepUpRuleDeps) {}

  async execute(input: {
    readonly actionKey: StepUpAction;
    readonly requiredAssurance: RequiredAssuranceLevel;
    readonly actor: Principal;
    readonly now: Date;
  }): Promise<SetStepUpRuleUseCaseResult> {
    if (input.actionKey === "InitiatePayment" && belowPaymentFloor(input.requiredAssurance)) {
      return { ok: false, reason: "identity.payment_floor_violation" };
    }

    const before = await this.deps.rules.findByAction(input.actionKey);
    const result = await this.deps.rules.setRequiredAssurance({
      actionKey: input.actionKey,
      requiredAssurance: input.requiredAssurance,
      now: input.now,
    });

    if (result.ok) {
      await this.deps.audit.record({
        actor: { kind: "Principal", principal: input.actor },
        action: "identity.step_up_rule_changed",
        target: { kind: "StepUpRule", id: result.rule.id, labelSnapshot: input.actionKey },
        summary: `Changed step-up rule: ${input.actionKey} ${before?.requiredAssurance ?? "(unset)"} -> ${input.requiredAssurance}`,
        before: before ? { requiredAssurance: before.requiredAssurance } : undefined,
        after: { requiredAssurance: input.requiredAssurance },
      });
    }

    return result;
  }
}
