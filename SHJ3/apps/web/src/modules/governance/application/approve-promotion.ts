import {
  assertDecidable,
  assertNotSelfApproval,
  mapPromotionTriggerError,
  type PromotionStatus,
} from "../domain/promotion.js";
import { PromotionNotFoundError } from "../domain/promotion.js";
import type { PromotionRequestRepository } from "../ports/promotion-repository.js";

export interface ApprovePromotionInput {
  readonly promotionRequestId: string;
  readonly decidedByStaffUserId: string;
  readonly now: Date;
}

/**
 * B14 tab 1's Approve action. `TR_PromotionRequests_decisionRules` does the real work
 * here: separation of duties (error 51192) AND writing `AuditLogEntries` — in the SAME
 * transaction as this exact `UPDATE` (FR-GOV-14/29's atomicity guarantee). This use case's
 * job is (a) perform the update correctly and (b) check separation of duties itself
 * first, for a clean error message — belt-and-braces, never a substitute for the trigger.
 */
export class ApprovePromotion {
  constructor(private readonly deps: { readonly promotions: PromotionRequestRepository }) {}

  async execute(input: ApprovePromotionInput): Promise<void> {
    const row = await this.deps.promotions.findById(input.promotionRequestId);
    if (!row) throw new PromotionNotFoundError();
    assertDecidable(row.status as PromotionStatus);
    assertNotSelfApproval(row.requestedByStaffUserId, input.decidedByStaffUserId);

    try {
      await this.deps.promotions.decide(input.promotionRequestId, {
        decidedByStaffUserId: input.decidedByStaffUserId,
        status: "Approved",
        decisionNote: null,
        now: input.now,
      });
    } catch (error) {
      const mapped = mapPromotionTriggerError(error);
      if (mapped) throw mapped;
      throw error;
    }
  }
}
