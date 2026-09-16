import type { CampaignRepository, CampaignSendRow } from "../ports/campaign-repository.js";

/** `GET /channels/campaigns/{id}/sends` (B10 tab 4 `Sent` counts). "This is the evidence
 *  that the send-time checks ran." */
export class ListCampaignSends {
  constructor(private readonly deps: { readonly campaigns: CampaignRepository }) {}

  async execute(campaignId: string): Promise<{ readonly rows: readonly CampaignSendRow[] }> {
    return { rows: await this.deps.campaigns.listSends(campaignId) };
  }
}
