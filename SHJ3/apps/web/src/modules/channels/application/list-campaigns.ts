import type { CampaignRepository, CampaignRow } from "../ports/campaign-repository.js";

/** `GET /channels/campaigns` (B10 tab 4). `state` is derived, never stored — see
 *  `deriveCampaignDisplayState` and the repository's own join. */
export class ListCampaigns {
  constructor(private readonly deps: { readonly campaigns: CampaignRepository }) {}

  async execute(): Promise<{ readonly rows: readonly CampaignRow[] }> {
    return { rows: await this.deps.campaigns.list() };
  }
}
