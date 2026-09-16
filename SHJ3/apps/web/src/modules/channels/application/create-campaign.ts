import type { CampaignTrigger } from "../domain/vocabulary.js";
import type { CampaignRepository, CampaignRow } from "../ports/campaign-repository.js";

export interface CreateCampaignInput {
  readonly name: string;
  readonly messageTemplateId: string;
  readonly trigger: CampaignTrigger;
  readonly triggerOffsetHours: number | null;
  readonly audienceDefinitionJson: string;
  readonly audienceLabel: string;
  readonly respectQuietHours: boolean;
  readonly now: Date;
}

/** `POST /channels/campaigns` (B10 tab 4 `[ASSUMPTION]`). Always created `isEnabled: false`
 *  — a new campaign is armed explicitly via `EnableCampaign`, never live on creation. */
export class CreateCampaign {
  constructor(private readonly deps: { readonly campaigns: CampaignRepository }) {}

  async execute(input: CreateCampaignInput): Promise<{ readonly campaign: CampaignRow }> {
    const campaign = await this.deps.campaigns.create(input);
    return { campaign };
  }
}
