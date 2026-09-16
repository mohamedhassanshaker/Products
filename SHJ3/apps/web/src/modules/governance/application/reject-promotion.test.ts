import { describe, expect, it } from "vitest";
import { PromotionSelfApprovalError } from "../domain/promotion.js";
import { FakePromotionRequestRepository } from "../testing/fakes.js";
import { RejectPromotion } from "./reject-promotion.js";

const now = new Date("2026-09-10T10:00:00.000Z");

describe("RejectPromotion", () => {
  it("rejects a pending promotion with a decision note", async () => {
    const promotions = new FakePromotionRequestRepository();
    promotions.seed({
      id: "promo_1",
      agentVersionId: "version_1",
      agentId: "agent_1",
      agentName: "SEWA Billing Agent",
      versionLabel: "v1.4",
      fromEnvironmentKey: "uat",
      toEnvironmentKey: "production",
      requestedByStaffUserId: "staff_requester",
      requestedAt: now,
      status: "AwaitingApproval",
      gateEvaluationId: null,
      decidedByStaffUserId: null,
      decidedAt: null,
      decisionNote: null,
    });

    await new RejectPromotion({ promotions }).execute({
      promotionRequestId: "promo_1",
      decidedByStaffUserId: "staff_approver",
      decisionNote: "Groundedness regressed on the billing dispute golden set.",
      now,
    });

    const updated = await promotions.findById("promo_1");
    expect(updated?.status).toBe("Rejected");
    expect(updated?.decisionNote).toContain("Groundedness");
  });

  it("rejects self-rejection just like self-approval (FR-GOV-15)", async () => {
    const promotions = new FakePromotionRequestRepository();
    promotions.seed({
      id: "promo_1",
      agentVersionId: "version_1",
      agentId: "agent_1",
      agentName: "SEWA Billing Agent",
      versionLabel: "v1.4",
      fromEnvironmentKey: "uat",
      toEnvironmentKey: "production",
      requestedByStaffUserId: "staff_requester",
      requestedAt: now,
      status: "AwaitingApproval",
      gateEvaluationId: null,
      decidedByStaffUserId: null,
      decidedAt: null,
      decisionNote: null,
    });

    await expect(
      new RejectPromotion({ promotions }).execute({
        promotionRequestId: "promo_1",
        decidedByStaffUserId: "staff_requester",
        decisionNote: "n/a",
        now,
      }),
    ).rejects.toThrow(PromotionSelfApprovalError);
  });
});
