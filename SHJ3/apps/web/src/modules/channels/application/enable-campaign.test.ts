import { describe, expect, it } from "vitest";
import { EnableCampaign } from "./enable-campaign.js";
import {
  CampaignTemplateNotApprovedError,
  type CampaignRepository,
} from "../ports/campaign-repository.js";

/**
 * Fake-backed test of the TRANSLATION logic only — proving the real database trigger
 * itself is `tests/integration/channels-campaign-enable-trigger.spec.ts`'s job, against a
 * real SQL Server. This test exists so the mapping from the repository's typed error to the
 * screen-facing result shape is covered without needing live infrastructure for every run.
 */
function fakeCampaigns(behavior: "approve" | "refuse"): CampaignRepository {
  return {
    async list() {
      return [];
    },
    async findById() {
      return null;
    },
    async create() {
      throw new Error("not used");
    },
    async update() {},
    async setEnabled(id, isEnabled) {
      if (behavior === "refuse" && isEnabled) {
        throw new CampaignTemplateNotApprovedError(id, "appointment_confirmation", "Pending");
      }
    },
    async listSends() {
      return [];
    },
    async recordSend() {
      return { inserted: true };
    },
    async incrementSentThisMonth() {},
  };
}

describe("EnableCampaign", () => {
  it("succeeds when the repository (the real trigger, in production) allows it", async () => {
    const useCase = new EnableCampaign({ campaigns: fakeCampaigns("approve") });
    const result = await useCase.execute({ id: "camp_01", now: new Date() });
    expect(result).toEqual({ ok: true });
  });

  it("translates a CampaignTemplateNotApprovedError into a named, screen-facing refusal", async () => {
    const useCase = new EnableCampaign({ campaigns: fakeCampaigns("refuse") });
    const result = await useCase.execute({ id: "camp_01", now: new Date() });
    expect(result).toEqual({
      ok: false,
      reason: "channels.template_not_approved",
      templateName: "appointment_confirmation",
      templateStatus: "Pending",
    });
  });
});
