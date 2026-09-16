import {
  CampaignTemplateNotApprovedError,
  type CampaignRepository,
} from "../ports/campaign-repository.js";

export type EnableCampaignResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "channels.template_not_approved";
      readonly templateName: string;
      readonly templateStatus: string;
    };

/**
 * `POST /channels/campaigns/{id}/enable` (B10 tab 4 `On` toggle). This is the wave's own
 * hard requirement: the write is attempted for real and the real
 * `TR_Campaigns_templateMustBeApproved` database trigger is what refuses it — this use case
 * does NOT pre-check the template's approval status itself before calling `setEnabled`. A
 * pre-check would be a second, parallel guard that could drift from the trigger and would
 * defeat the entire point of proving the database is the actual backstop (see
 * `tests/integration/channels-campaign-enable-trigger.spec.ts`). The only work here is
 * translating the repository's typed `CampaignTemplateNotApprovedError` into the same
 * `{ ok: false, reason, meta }` shape every other business-rule refusal in this module uses,
 * naming the unapproved template as api.md requires ("the failure names the unapproved
 * template").
 */
export class EnableCampaign {
  constructor(private readonly deps: { readonly campaigns: CampaignRepository }) {}

  async execute(input: { readonly id: string; readonly now: Date }): Promise<EnableCampaignResult> {
    try {
      await this.deps.campaigns.setEnabled(input.id, true, input.now);
      return { ok: true };
    } catch (error) {
      if (error instanceof CampaignTemplateNotApprovedError) {
        return {
          ok: false,
          reason: "channels.template_not_approved",
          templateName: error.templateName,
          templateStatus: error.templateStatus,
        };
      }
      throw error;
    }
  }
}
