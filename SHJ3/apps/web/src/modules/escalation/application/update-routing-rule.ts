import { assertValidRuleShape } from "../domain/routing-rule-engine.js";
import type {
  RoutingRuleRepository,
  RoutingRuleRow,
  UpdateRoutingRuleInput,
} from "../ports/routing-rule-repository.js";

export class RoutingRuleNotFoundError extends Error {
  readonly code = "routing_rule.not_found";
  constructor() {
    super("No routing rule with this id.");
    this.name = "RoutingRuleNotFoundError";
  }
}

/** api.md §6.8 `PATCH /handover/routing-rules/{id}` — "Edit condition or target. Same
 *  operator constraint." Never touches `ordinal` — reordering is `ReorderRoutingRules`'s
 *  own, separate action. */
export class UpdateRoutingRule {
  constructor(private readonly deps: { readonly rules: RoutingRuleRepository }) {}

  async execute(id: string, input: UpdateRoutingRuleInput): Promise<RoutingRuleRow> {
    assertValidRuleShape(input);
    const existing = await this.deps.rules.findById(id);
    if (!existing) throw new RoutingRuleNotFoundError();
    return this.deps.rules.update(id, input);
  }
}
