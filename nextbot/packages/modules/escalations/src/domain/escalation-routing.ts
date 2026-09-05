/**
 * FR-ESC-03 — escalation routing rule evaluation: `IF recognized_goal = X AND channel
 * = Y AND reason = Z AND language = L -> route to queue Q`. Pure function, exactly
 * like `resolvePermission`/`evaluateGuardrails`'s deterministic first-match-wins
 * convention elsewhere in this codebase, so it is exhaustively unit-testable without
 * a database.
 */

export type EscalationReasonValue = "LowConfidence" | "ToolFailure" | "CustomerRequest" | "SensitiveTopic";

export interface RoutingRuleConditions {
  /** Every present key must match (AND semantics) for the rule to apply; an absent
   * key is a wildcard (matches anything). */
  recognizedGoal?: string;
  channelTypes?: string[];
  reasons?: EscalationReasonValue[];
  language?: string;
}

export interface RoutingRule {
  id: string;
  ordinal: number;
  conditions: RoutingRuleConditions;
  queueId: string;
  enabled: boolean;
}

export interface RoutingContext {
  recognizedGoal?: string | null;
  channelType?: string | null;
  reason: EscalationReasonValue;
  language?: string | null;
}

export interface RoutingResolution {
  queueId: string;
  matchedRuleId: string | null;
}

/**
 * Evaluates the tenant's ordered rule set (ascending `ordinal`, disabled rules
 * skipped) and returns the first matching rule's queue, or `fallbackQueueId` if none
 * match. **`fallbackQueueId` is a required parameter, never optional** — this is the
 * structural guarantee behind FR-ESC-03's "routing must never leave an escalation
 * unassigned to any queue": there is no code path through this function that can
 * return without a queue id.
 */
export function resolveRoutingQueue(rules: RoutingRule[], ctx: RoutingContext, fallbackQueueId: string): RoutingResolution {
  const ordered = [...rules].filter((r) => r.enabled).sort((a, b) => a.ordinal - b.ordinal);
  for (const rule of ordered) {
    if (matchesConditions(rule.conditions, ctx)) {
      return { queueId: rule.queueId, matchedRuleId: rule.id };
    }
  }
  return { queueId: fallbackQueueId, matchedRuleId: null };
}

function matchesConditions(conditions: RoutingRuleConditions, ctx: RoutingContext): boolean {
  if (conditions.recognizedGoal !== undefined && conditions.recognizedGoal !== ctx.recognizedGoal) return false;
  if (conditions.channelTypes !== undefined && (!ctx.channelType || !conditions.channelTypes.includes(ctx.channelType))) return false;
  if (conditions.reasons !== undefined && !conditions.reasons.includes(ctx.reason)) return false;
  if (conditions.language !== undefined && conditions.language !== ctx.language) return false;
  return true;
}
