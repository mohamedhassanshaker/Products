/**
 * The routing-rule evaluator — B8's "Rules evaluate top to bottom; first active match
 * wins" [rule], and the one function both the *real* router (assigning a newly queued
 * ticket to a team) and the *tester* (api.md §6.8 `POST /handover/routing-rules/test`)
 * call, so a tested outcome and a live outcome can never silently disagree.
 *
 * Pure, no I/O — this is deliberate and load-bearing, not merely tidy: the tester's
 * whole point is to evaluate a rule list the caller supplies (possibly reordered,
 * disabled, or edited, and **not yet saved**) rather than whatever is currently
 * persisted (api.md §6.8: "The endpoint accepts the rule list in the request body
 * rather than reading the persisted one" / "It writes nothing, not even the tester
 * input"). A function with no database handle physically cannot read the persisted
 * order by accident, which is the actual guarantee behind "evaluates the live, unsaved
 * rule order."
 *
 * Rule *precedence is array order*, not a field this function reads — callers pass
 * rules already sorted the way they mean to evaluate them (the persisted path sorts by
 * `RoutingRules.ordinal` ascending before calling; the tester passes exactly the array
 * the admin is looking at, unsaved reorder included).
 */

/** `CK_RoutingRules_attribute`. */
export const RULE_ATTRIBUTES = ["Topic", "Priority", "Channel", "WaitTime"] as const;
export type RuleAttribute = (typeof RULE_ATTRIBUTES)[number];

/** `CK_RoutingRules_operatorMatchesAttribute`: `Gt` only for `WaitTime`, `Eq` otherwise. */
export const RULE_OPERATORS = ["Eq", "Gt"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/** `CK_RoutingRules_targetKind`. */
export const RULE_TARGET_KINDS = ["Team", "Requeue"] as const;
export type RuleTargetKind = (typeof RULE_TARGET_KINDS)[number];

export interface RoutingRuleInput {
  readonly id: string;
  readonly attribute: RuleAttribute;
  readonly operator: RuleOperator;
  /** `WaitTime` rules hold a plain integer string of **minutes** (api.md §6.8's own
   *  tester example: `"waitTimeMinutes": 2`, rule `"value": 5`) — `CK_RoutingRules_
   *  waitTimeNumeric` just requires digits-only, not a specific unit, and minutes is
   *  the unit the wireframe's own composer and the tester's wire contract both use. */
  readonly value: string;
  readonly targetKind: RuleTargetKind;
  readonly targetTeamId: string | null;
  readonly alertSupervisor: boolean;
  readonly isEnabled: boolean;
}

export interface TicketSample {
  /** `Billing` | `Customs` | `Library` | `General` (`CK_EscalationTickets_topicKey`). */
  readonly topicKey: string;
  /** `Normal` | `High`. */
  readonly priority: string;
  /** A `Channels.key` value: `WebWidget` | `WhatsApp` | `MobileApp` | `KioskIvr`. */
  readonly channelKey: string;
  readonly waitTimeMinutes: number;
}

export interface RuleEvaluationEntry {
  readonly position: number;
  readonly ruleId: string;
  readonly enabled: boolean;
  /** `null` when a strictly earlier rule already matched — the walk explains why every
   *  later rule was skipped, not just which one fired. */
  readonly matched: boolean | null;
  readonly reason: string;
}

export interface FiredRule {
  readonly ruleId: string;
  readonly position: number;
  readonly condition: string;
  readonly targetKind: RuleTargetKind;
  readonly targetTeamId: string | null;
  readonly alertSupervisor: boolean;
}

export interface RoutingEvaluationResult {
  readonly matched: boolean;
  readonly firedRule: FiredRule | null;
  readonly evaluation: readonly RuleEvaluationEntry[];
}

const ATTRIBUTE_LABELS: Readonly<Record<RuleAttribute, string>> = {
  Topic: "Topic",
  Priority: "Priority",
  Channel: "Channel",
  WaitTime: "Wait time",
};

function sampleValueFor(attribute: RuleAttribute, ticket: TicketSample): string | number {
  switch (attribute) {
    case "Topic":
      return ticket.topicKey;
    case "Priority":
      return ticket.priority;
    case "Channel":
      return ticket.channelKey;
    case "WaitTime":
      return ticket.waitTimeMinutes;
  }
}

/** A single rule's own match predicate, exported so `RuleListEditor` (already built
 *  by an earlier wave, `components/patterns/rule-list-editor.tsx`, naming "B8's routing
 *  rules + rule tester" in its own doc comment) can drive its bundled tester with the
 *  *exact* semantics `evaluateRoutingRules` uses internally — a UI reusing this
 *  organism and a server action reusing `evaluateRoutingRules` can never silently
 *  disagree about what "matches" means, because both call the same function. */
export function ruleMatchesTicket(rule: RoutingRuleInput, ticket: TicketSample): boolean {
  const sampleValue = sampleValueFor(rule.attribute, ticket);
  if (rule.attribute === "WaitTime") {
    return typeof sampleValue === "number" && sampleValue > Number(rule.value);
  }
  return sampleValue === rule.value;
}

function conditionText(rule: RoutingRuleInput): string {
  const operatorText = rule.attribute === "WaitTime" ? ">" : "=";
  const valueText = rule.attribute === "WaitTime" ? `${rule.value} min` : rule.value;
  return `${ATTRIBUTE_LABELS[rule.attribute]} ${operatorText} ${valueText}`;
}

function matchReason(rule: RoutingRuleInput, matched: boolean): string {
  const key = rule.attribute === "WaitTime" ? "wait_time" : rule.attribute.toLowerCase();
  const operatorText = rule.attribute === "WaitTime" ? ">" : "==";
  const negation = matched ? "" : "not ";
  return `${negation}${key} ${operatorText} ${rule.value.toLowerCase()}`.trim();
}

/**
 * Evaluate a ticket against an ordered rule list — first *enabled* match wins.
 *
 * Disabled rules are walked (so the evaluation trail can say `"disabled"`, matching
 * api.md's own example row) but can never fire — "a disabled rule keeps its position...
 * it is skipped, not removed" (§6.8).
 */
export function evaluateRoutingRules(
  rules: readonly RoutingRuleInput[],
  ticket: TicketSample,
): RoutingEvaluationResult {
  const evaluation: RuleEvaluationEntry[] = [];
  let firedRule: FiredRule | null = null;

  for (const [index, rule] of rules.entries()) {
    const position = index + 1;

    // Disabled reports as "disabled" regardless of whether an earlier rule already
    // fired — api.md §6.8's own worked example shows exactly this: a disabled rule
    // *after* the winning match still reports "disabled", not
    // "not_evaluated_first_match_won". A rule's own enabled/disabled state is a fact
    // about the rule, independent of what walking the list before it happened to find.
    if (!rule.isEnabled) {
      evaluation.push({
        position,
        ruleId: rule.id,
        enabled: false,
        matched: null,
        reason: "disabled",
      });
      continue;
    }

    if (firedRule) {
      evaluation.push({
        position,
        ruleId: rule.id,
        enabled: true,
        matched: null,
        reason: "not_evaluated_first_match_won",
      });
      continue;
    }

    const matched = ruleMatchesTicket(rule, ticket);
    evaluation.push({
      position,
      ruleId: rule.id,
      enabled: true,
      matched,
      reason: matchReason(rule, matched),
    });

    if (matched) {
      firedRule = {
        ruleId: rule.id,
        position,
        condition: conditionText(rule),
        targetKind: rule.targetKind,
        targetTeamId: rule.targetTeamId,
        alertSupervisor: rule.alertSupervisor,
      };
    }
  }

  return { matched: firedRule !== null, firedRule, evaluation };
}

/** `CK_RoutingRules_operatorMatchesAttribute`, `_targetPaired` and `_waitTimeNumeric`,
 *  transcribed as a single validator so the create/update use cases (and the tester's
 *  own input validation, api.md §6.8 rule 5: "the tester cannot be used to evaluate a
 *  rule shape the system would refuse to save") reject the same shapes the database
 *  would, before ever reaching it. */
export class InvalidRoutingRuleShapeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvalidRoutingRuleShapeError";
    this.code = code;
  }
}

export function assertValidRuleShape(input: {
  readonly attribute: RuleAttribute;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly targetKind: RuleTargetKind;
  readonly targetTeamId: string | null;
}): void {
  const wantsGt = input.attribute === "WaitTime";
  if (wantsGt !== (input.operator === "Gt")) {
    throw new InvalidRoutingRuleShapeError(
      "routing_rule.operator_invalid",
      wantsGt
        ? "Wait time rules must use the > operator."
        : `${ATTRIBUTE_LABELS[input.attribute]} rules must use the = operator.`,
    );
  }
  if (wantsGt && !/^\d+$/.test(input.value)) {
    throw new InvalidRoutingRuleShapeError(
      "routing_rule.wait_time_not_numeric",
      "A wait-time rule's value must be a whole number of minutes.",
    );
  }
  const wantsTeam = input.targetKind === "Team";
  if (wantsTeam !== (input.targetTeamId !== null)) {
    throw new InvalidRoutingRuleShapeError(
      "routing_rule.target_invalid",
      wantsTeam
        ? "A Team-targeted rule must name a target team."
        : "A Requeue-targeted rule must not name a target team.",
    );
  }
}
