import type { RoutingRuleRepository } from "../ports/routing-rule-repository.js";
import { RoutingRuleNotFoundError } from "./update-routing-rule.js";

/** api.md §6.8 `DELETE /handover/routing-rules/{id}`. Hard-deleted — see
 *  `RoutingRuleRepository.delete()`'s own doc comment on why the ordinal gap is left
 *  rather than compacted. */
export class DeleteRoutingRule {
  constructor(private readonly deps: { readonly rules: RoutingRuleRepository }) {}

  async execute(id: string): Promise<void> {
    const existing = await this.deps.rules.findById(id);
    if (!existing) throw new RoutingRuleNotFoundError();
    await this.deps.rules.delete(id);
  }
}
