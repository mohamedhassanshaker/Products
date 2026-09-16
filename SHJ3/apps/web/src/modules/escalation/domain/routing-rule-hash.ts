/**
 * `RoutingRuleTests.ruleSetHash` — "pins **which rule ordering was tested**... without
 * it a passed test cannot be tied to the configuration it passed against" (schema doc
 * comment). A canonical, order-sensitive JSON serialization hashed with sha256: two
 * lists differing only in order (or in one rule's `isEnabled`/`value`/target) hash
 * differently, which is exactly the property a "which order did this prove?" record
 * needs.
 */

import { createHash } from "node:crypto";
import type { RoutingRuleInput } from "./routing-rule-engine.js";

export function ruleSetHash(rules: readonly RoutingRuleInput[]): string {
  const canonical = rules.map((rule) => ({
    id: rule.id,
    attribute: rule.attribute,
    operator: rule.operator,
    value: rule.value,
    targetKind: rule.targetKind,
    targetTeamId: rule.targetTeamId,
    alertSupervisor: rule.alertSupervisor,
    isEnabled: rule.isEnabled,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
