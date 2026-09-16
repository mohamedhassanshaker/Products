import type { RoutingRuleRepository, RoutingRuleRow } from "../ports/routing-rule-repository.js";

/** api.md §6.8 `GET /handover/routing-rules` — "Ordered rule list with enabled state.
 *  Order **is** the semantics." */
export class ListRoutingRules {
  constructor(private readonly deps: { readonly rules: RoutingRuleRepository }) {}

  async execute(): Promise<readonly RoutingRuleRow[]> {
    return this.deps.rules.list();
  }
}
