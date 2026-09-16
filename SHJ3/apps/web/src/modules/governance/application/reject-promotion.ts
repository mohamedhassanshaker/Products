import {
  assertDecidable,
  assertNotSelfApproval,
  mapPromotionTriggerError,
  type PromotionStatus,
} from "../domain/promotion.js";
import { PromotionNotFoundError } from "../domain/promotion.js";
import type { PromotionRequestRepository } from "../ports/promotion-repository.js";

export interface RejectPromotionInput {
  readonly promotionRequestId: string;
  readonly decidedByStaffUserId: string;
  readonly decisionNote: string;
  readonly now: Date;
}

/** B14 tab 1's Reject action — the mirror of `ApprovePromotion`; see its doc comment for
 *  the shared atomicity/separation-of-duties reasoning. */
export class RejectPromotion {
  constructor(private readonly deps: { readonly promotions: PromotionRequestRepository }) {}

  async execute(input: RejectPromotionInput): Promise<void> {
    const row = await this.deps.promotions.findById(input.promotionRequestId);
    if (!row) throw new PromotionNotFoundError();
    assertDecidable(row.status as PromotionStatus);
    assertNotSelfApproval(row.requestedByStaffUserId, input.decidedByStaffUserId);

    try {
      await this.deps.promotions.decide(input.promotionRequestId, {
        decidedByStaffUserId: input.decidedByStaffUserId,
        status: "Rejected",
        decisionNote: input.decisionNote,
        now: input.now,
      });
    } catch (error) {
      const mapped = mapPromotionTriggerError(error);
      if (mapped) throw mapped;
      throw error;
    }
  }
}
