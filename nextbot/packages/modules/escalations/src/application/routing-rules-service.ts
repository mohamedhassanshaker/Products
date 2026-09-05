import { DomainError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import type { RoutingRule, RoutingRuleConditions } from "../domain/escalation-routing.js";
import { listRoutingRules as listRoutingRulesRepo, replaceRoutingRules as replaceRoutingRulesRepo } from "../infrastructure/routing-rule-repository.js";
import { findAgentQueueById } from "../infrastructure/agent-queue-repository.js";

export class RoutingRuleQueueNotFoundError extends DomainError {
  readonly httpStatus = 422;
  readonly code = "ROUTING_RULE_QUEUE_NOT_FOUND";
  constructor(queueId: string) {
    super(`Routing rule references a queue that doesn't exist: ${queueId}`);
    this.name = "RoutingRuleQueueNotFoundError";
  }
}

export async function listRoutingRules(ctx: TenantContext): Promise<RoutingRule[]> {
  return listRoutingRulesRepo(ctx);
}

/** B.5.3's ordered full replace — validates every referenced `queueId` actually
 * exists for this tenant before writing anything (an unresolvable queue reference in
 * a routing rule would silently defeat FR-ESC-03 the next time it matched). */
export async function replaceRoutingRules(
  ctx: TenantContext,
  rules: Array<{ conditions: RoutingRuleConditions; queueId: string; enabled: boolean }>,
): Promise<RoutingRule[]> {
  for (const rule of rules) {
    const queue = await findAgentQueueById(ctx, rule.queueId);
    if (!queue) throw new RoutingRuleQueueNotFoundError(rule.queueId);
  }
  return replaceRoutingRulesRepo(ctx, rules);
}
