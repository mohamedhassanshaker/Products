import type { CampaignRepository } from "../ports/campaign-repository.js";

/** `POST /channels/campaigns/{id}/disable` (B10 tab 4 toggle). Idempotent — disarming an
 *  already-disabled campaign is a no-op success, never an error. */
export class DisableCampaign {
  constructor(private readonly deps: { readonly campaigns: CampaignRepository }) {}

  async execute(input: { readonly id: string; readonly now: Date }): Promise<void> {
    await this.deps.campaigns.setEnabled(input.id, false, input.now);
  }
}
