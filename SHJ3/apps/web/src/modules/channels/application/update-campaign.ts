import type { CampaignTrigger } from "../domain/vocabulary.js";
import type { CampaignRepository } from "../ports/campaign-repository.js";

export interface UpdateCampaignInput {
  readonly id: string;
  readonly trigger: CampaignTrigger;
  readonly triggerOffsetHours: number | null;
  readonly audienceDefinitionJson: string;
  readonly audienceLabel: string;
  readonly respectQuietHours: boolean;
  readonly now: Date;
}

/** `PATCH /channels/campaigns/{id}` (B10 tab 4 `[ASSUMPTION]`). Edits trigger/audience only
 *  — `isEnabled` has its own dedicated `enable`/`disable` actions, matching api.md's own
 *  endpoint split. */
export class UpdateCampaign {
  constructor(private readonly deps: { readonly campaigns: CampaignRepository }) {}

  async execute(input: UpdateCampaignInput): Promise<void> {
    await this.deps.campaigns.update(input);
  }
}
