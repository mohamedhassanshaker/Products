import { describe, expect, it } from "vitest";
import { PromotionAlreadyResolvedError, PromotionSelfApprovalError } from "../domain/promotion.js";
import { FakePromotionRequestRepository } from "../testing/fakes.js";
import { ApprovePromotion } from "./approve-promotion.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function seedPending(promotions: FakePromotionRequestRepository, id: string, requestedBy: string) {
  promotions.seed({
    id,
    agentVersionId: "version_1",
    agentId: "agent_1",
    agentName: "SEWA Billing Agent",
    versionLabel: "v1.4",
    fromEnvironmentKey: "uat",
    toEnvironmentKey: "production",
    requestedByStaffUserId: requestedBy,
    requestedAt: now,
    status: "AwaitingApproval",
    gateEvaluationId: null,
    decidedByStaffUserId: null,
    decidedAt: null,
    decisionNote: null,
  });
}

describe("ApprovePromotion", () => {
  it("approves a pending promotion decided by a different staff user", async () => {
    const promotions = new FakePromotionRequestRepository();
    seedPending(promotions, "promo_1", "staff_requester");

    await new ApprovePromotion({ promotions }).execute({
      promotionRequestId: "promo_1",
      decidedByStaffUserId: "staff_approver",
      now,
    });

    const updated = await promotions.findById("promo_1");
    expect(updated?.status).toBe("Approved");
    expect(updated?.decidedByStaffUserId).toBe("staff_approver");
  });

  it("rejects self-approval (FR-GOV-15) — application-layer mirror of trigger error 51192", async () => {
    const promotions = new FakePromotionRequestRepository();
    seedPending(promotions, "promo_1", "staff_requester");

    await expect(
      new ApprovePromotion({ promotions }).execute({
        promotionRequestId: "promo_1",
        decidedByStaffUserId: "staff_requester",
        now,
      }),
    ).rejects.toThrow(PromotionSelfApprovalError);
  });

  it("rejects deciding an already-resolved promotion a second time", async () => {
    const promotions = new FakePromotionRequestRepository();
    seedPending(promotions, "promo_1", "staff_requester");
    await new ApprovePromotion({ promotions }).execute({
      promotionRequestId: "promo_1",
      decidedByStaffUserId: "staff_approver",
      now,
    });

    await expect(
      new ApprovePromotion({ promotions }).execute({
        promotionRequestId: "promo_1",
        decidedByStaffUserId: "staff_someone_else",
        now,
      }),
    ).rejects.toThrow(PromotionAlreadyResolvedError);
  });
});
