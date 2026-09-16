import type { RoutingRuleRepository } from "../ports/routing-rule-repository.js";

/** api.md §6.8 `PUT /handover/routing-rules/order` — "Body is the complete ordered id
 *  list; `If-Match` **required** on the collection's `ETag`. A stale order -> `409
 *  routing_rule.order_conflict`... Rejecting the whole list on a mismatch is the point:
 *  `Move up`/`Move down` on a list someone else has reordered would otherwise produce
 *  an order neither admin intended."
 *
 *  `expectedCurrentOrder` is this Server-Action-based app's own stand-in for the
 *  `If-Match` header (`RoutingRuleRepository.reorder()`'s own doc comment) — the caller
 *  (the composition-root Server Action) is what supplies "the order the screen last
 *  rendered," and a mismatch throws the identical `RoutingRuleOrderConflictError`. */
export class ReorderRoutingRules {
  constructor(private readonly deps: { readonly rules: RoutingRuleRepository }) {}

  async execute(
    orderedIds: readonly string[],
    expectedCurrentOrder: readonly string[],
  ): Promise<void> {
    await this.deps.rules.reorder(orderedIds, expectedCurrentOrder);
  }
}
