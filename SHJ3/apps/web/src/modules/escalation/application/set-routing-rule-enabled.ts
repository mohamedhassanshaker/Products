import type { RoutingRuleRepository } from "../ports/routing-rule-repository.js";
import { RoutingRuleNotFoundError } from "./update-routing-rule.js";

/** api.md §6.8 `POST .../enable` (idempotent -> `204` when already enabled) and
 *  `.../disable` ("A disabled rule keeps its position — it is skipped, not removed —
 *  so re-enabling restores the previous behaviour exactly"). One use case for both
 *  directions since the only real difference is the boolean. */
export class SetRoutingRuleEnabled {
  constructor(private readonly deps: { readonly rules: RoutingRuleRepository }) {}

  async execute(id: string, isEnabled: boolean, now: Date): Promise<void> {
    const existing = await this.deps.rules.findById(id);
    if (!existing) throw new RoutingRuleNotFoundError();
    if (existing.isEnabled === isEnabled) return; // idempotent, matching the enable endpoint's own 204-when-already-enabled rule
    await this.deps.rules.setEnabled(id, isEnabled, now);
  }
}
