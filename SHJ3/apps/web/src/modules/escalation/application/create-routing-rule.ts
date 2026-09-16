import { assertValidRuleShape } from "../domain/routing-rule-engine.js";
import type {
  NewRoutingRuleInput,
  RoutingRuleRepository,
  RoutingRuleRow,
} from "../ports/routing-rule-repository.js";

/** api.md §6.8 `POST /handover/routing-rules` — "Appended last, so adding a rule never
 *  silently changes existing routing" (`RoutingRuleRepository.create()`'s own
 *  `nextOrdinal()` guarantee). */
export class CreateRoutingRule {
  constructor(private readonly deps: { readonly rules: RoutingRuleRepository }) {}

  async execute(input: NewRoutingRuleInput): Promise<RoutingRuleRow> {
    assertValidRuleShape(input);
    return this.deps.rules.create(input);
  }
}
