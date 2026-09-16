/**
 * The real `StepUpRuleRepository` — `StepUpRules`, per-tenant.
 *
 * `TR_StepUpRules_paymentFloor`'s rejection is translated to
 * `identity.payment_floor_violation` — belt-and-braces alongside
 * `SetStepUpRule`'s own `belowPaymentFloor` pre-check.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isRequiredAssuranceLevel,
  type RequiredAssuranceLevel,
} from "../../../../tools/domain/tool-catalog.js";
import { isStepUpAction, type StepUpAction } from "../../../domain/step-up.js";
import type {
  SetStepUpRuleResult,
  StepUpRuleRepository,
  StepUpRuleRow,
} from "../../../ports/step-up-rule-repository.js";

const OPERATION = "identity step-up-rule repository";
const PAYMENT_FLOOR_FRAGMENT = "TR_StepUpRules_paymentFloor";

function toRow(row: {
  id: string;
  actionKey: string;
  requiredAssurance: string;
  isEnabled: boolean;
  ordinal: number;
}): StepUpRuleRow {
  if (!isStepUpAction(row.actionKey) || !isRequiredAssuranceLevel(row.requiredAssurance)) {
    throw new Error(`StepUpRule ${row.id} has an unrecognized actionKey/requiredAssurance.`);
  }
  return {
    id: row.id,
    actionKey: row.actionKey,
    requiredAssurance: row.requiredAssurance,
    isEnabled: row.isEnabled,
    ordinal: row.ordinal,
  };
}

export class PrismaStepUpRuleRepository implements StepUpRuleRepository {
  async list(): Promise<readonly StepUpRuleRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.stepUpRule.findMany({ orderBy: { ordinal: "asc" } });
    return rows.map(toRow);
  }

  async findByAction(actionKey: StepUpAction): Promise<StepUpRuleRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.stepUpRule.findUnique({ where: { actionKey } });
    return row ? toRow(row) : null;
  }

  async setRequiredAssurance(input: {
    readonly actionKey: StepUpAction;
    readonly requiredAssurance: RequiredAssuranceLevel;
    readonly now: Date;
  }): Promise<SetStepUpRuleResult> {
    const db = getTenantDb(OPERATION);
    try {
      const existing = await db.stepUpRule.findUnique({ where: { actionKey: input.actionKey } });
      const row = existing
        ? await db.stepUpRule.update({
            where: { id: existing.id },
            data: { requiredAssurance: input.requiredAssurance, updatedAt: input.now },
          })
        : await db.stepUpRule.create({
            data: {
              id: newUlid(input.now),
              actionKey: input.actionKey,
              requiredAssurance: input.requiredAssurance,
              isEnabled: true,
              ordinal: 1,
              createdAt: input.now,
              updatedAt: input.now,
            },
          });
      return { ok: true, rule: toRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(PAYMENT_FLOOR_FRAGMENT)) {
        return { ok: false, reason: "identity.payment_floor_violation" };
      }
      throw error;
    }
  }
}
