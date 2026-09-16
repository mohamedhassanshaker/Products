import type {
  PromotionRequestRepository,
  PromotionRequestRow,
} from "../ports/promotion-repository.js";

/** B14 tab 1's pending-promotions table. */
export class ListPendingPromotions {
  constructor(private readonly deps: { readonly promotions: PromotionRequestRepository }) {}

  async execute(): Promise<readonly PromotionRequestRow[]> {
    return this.deps.promotions.listPending();
  }
}
