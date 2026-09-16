/**
 * The real `VerificationAttemptRepository` — `VerificationAttempts`,
 * append-only (`DENY UPDATE, DELETE`, §1.4). No update/delete method exists
 * here, matching the grant.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { isRequiredAssuranceLevel } from "../../../../tools/domain/tool-catalog.js";
import { isStepUpAction, type StepUpAction } from "../../../domain/step-up.js";
import type {
  VerificationAttemptRepository,
  VerificationAttemptResult,
  VerificationAttemptRow,
} from "../../../ports/verification-attempt-repository.js";

const OPERATION = "identity verification-attempt repository";

function toRow(row: {
  id: string;
  conversationId: string | null;
  citizenIdentityId: string | null;
  providerKey: string;
  actionKey: string | null;
  requiredAssurance: string | null;
  result: string;
  failureReason: string | null;
  attemptedAt: Date;
}): VerificationAttemptRow {
  const actionKey = row.actionKey !== null && isStepUpAction(row.actionKey) ? row.actionKey : null;
  const requiredAssurance =
    row.requiredAssurance !== null && isRequiredAssuranceLevel(row.requiredAssurance)
      ? row.requiredAssurance
      : null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    citizenIdentityId: row.citizenIdentityId,
    providerKey: row.providerKey,
    actionKey,
    requiredAssurance,
    result: row.result as VerificationAttemptResult,
    failureReason: row.failureReason,
    attemptedAt: row.attemptedAt,
  };
}

export class PrismaVerificationAttemptRepository implements VerificationAttemptRepository {
  async record(input: {
    readonly conversationId: string | null;
    readonly citizenIdentityId: string | null;
    readonly providerKey: string;
    readonly actionKey: StepUpAction | null;
    readonly requiredAssurance: string | null;
    readonly result: VerificationAttemptResult;
    readonly failureReason: string | null;
    readonly now: Date;
  }): Promise<VerificationAttemptRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.verificationAttempt.create({
      data: {
        id: newUlid(input.now),
        conversationId: input.conversationId,
        citizenIdentityId: input.citizenIdentityId,
        providerKey: input.providerKey,
        actionKey: input.actionKey,
        requiredAssurance: input.requiredAssurance,
        result: input.result,
        failureReason: input.failureReason,
        attemptedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toRow(row);
  }

  async countRecentFailures(conversationId: string, sinceInclusive: Date): Promise<number> {
    const db = getTenantDb(OPERATION);
    return db.verificationAttempt.count({
      where: {
        conversationId,
        result: { not: "Success" },
        attemptedAt: { gte: sinceInclusive },
      },
    });
  }
}
