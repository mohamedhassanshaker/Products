import {
  assertValidRuleShape,
  evaluateRoutingRules,
  type RoutingRuleInput,
  type TicketSample,
} from "../domain/routing-rule-engine.js";
import { ruleSetHash } from "../domain/routing-rule-hash.js";
import type { HandoverRoutingConfigRepository } from "../ports/handover-routing-config-repository.js";
import type { RoutingRuleRepository, RoutingRuleRow } from "../ports/routing-rule-repository.js";
import type { RoutingRuleTestRepository } from "../ports/routing-rule-test-repository.js";
import type { TeamRepository } from "../ports/team-repository.js";

/** api.md §6.8 `POST /handover/routing-rules/test`. */
const MAX_TEST_RULES = 200;

export type RuleSetSpec =
  | { readonly mode: "provided"; readonly rules: readonly RoutingRuleInput[] }
  | { readonly mode: "persisted" };

export interface TestRoutingRulesInput {
  readonly ticket: TicketSample;
  readonly ruleSet: RuleSetSpec;
  readonly staffUserId: string;
  readonly now: Date;
}

export interface TestRoutingRulesResult {
  readonly matched: boolean;
  readonly firedRule: {
    readonly id: string;
    readonly position: number;
    readonly condition: string;
    readonly routeTo: string;
    readonly routeToLabel: string;
  } | null;
  readonly evaluation: ReturnType<typeof evaluateRoutingRules>["evaluation"];
  readonly ruleSetSource: "provided" | "persisted";
  /** `true` whenever the evaluated set is not byte-for-byte the currently-persisted
   *  order/state — the exact signal api.md §6.8's own worked example calls out
   *  ("`differsFromSaved: true` tells the admin they are looking at an unsaved
   *  hypothesis"). This is the whole point of the hard requirement this use case
   *  proves: the tester reflects the live, edited-but-not-yet-saved rule state, and
   *  tells the caller when that state disagrees with what is actually live. */
  readonly differsFromSaved: boolean;
  readonly defaultQueueLabel: string | null;
}

function toRow(rule: RoutingRuleRow): RoutingRuleInput {
  return {
    id: rule.id,
    attribute: rule.attribute,
    operator: rule.operator,
    value: rule.value,
    targetKind: rule.targetKind,
    targetTeamId: rule.targetTeamId,
    alertSupervisor: rule.alertSupervisor,
    isEnabled: rule.isEnabled,
  };
}

/**
 * **Pure evaluation, real persistence only for the audit trail.** The endpoint "writes
 * nothing, not even the tester input" as far as routing state goes (api.md §6.8 rule
 * 2) — this use case never calls `RoutingRuleRepository.update`/`reorder`/anything that
 * changes a rule. It *does* call `RoutingRuleTestRepository.record()`, which is a
 * separate, additive audit row (`RoutingRuleTests`) the schema itself names as existing
 * "so a pre-live check is evidence rather than a transient reassurance" — recording
 * that a test ran is not the same as the test having a side effect on routing, the same
 * distinction `AuditLogEntries` draws everywhere else in this codebase between "this
 * happened" and "this changed something."
 */
export class TestRoutingRules {
  constructor(
    private readonly deps: {
      readonly rules: RoutingRuleRepository;
      readonly teams: TeamRepository;
      readonly handoverConfig: HandoverRoutingConfigRepository;
      readonly tests: RoutingRuleTestRepository;
    },
  ) {}

  async execute(input: TestRoutingRulesInput): Promise<TestRoutingRulesResult> {
    const persisted = await this.deps.rules.list();
    const persistedInputs = persisted.map(toRow);

    let evaluatedRules: readonly RoutingRuleInput[];
    let differsFromSaved: boolean;

    if (input.ruleSet.mode === "provided") {
      if (input.ruleSet.rules.length > MAX_TEST_RULES) {
        throw new Error(`A rule-tester request may evaluate at most ${MAX_TEST_RULES} rules.`);
      }
      for (const rule of input.ruleSet.rules) assertValidRuleShape(rule);
      evaluatedRules = input.ruleSet.rules;
      differsFromSaved = ruleSetHash(evaluatedRules) !== ruleSetHash(persistedInputs);
    } else {
      evaluatedRules = persistedInputs;
      differsFromSaved = false;
    }

    const evaluation = evaluateRoutingRules(evaluatedRules, input.ticket);

    const [teams, config] = await Promise.all([
      this.deps.teams.list(),
      this.deps.handoverConfig.getSingleton(),
    ]);
    const teamName = (teamId: string | null) =>
      teams.find((team) => team.id === teamId)?.name ?? teamId;

    const defaultQueueLabel = config ? (teamName(config.defaultQueueTeamId) ?? null) : null;

    const firedRule = evaluation.firedRule;
    const resolvedTarget = firedRule
      ? firedRule.targetKind === "Team"
        ? (teamName(firedRule.targetTeamId) ?? "Unknown team")
        : `Requeue${firedRule.alertSupervisor ? " + supervisor alert" : ""}`
      : (defaultQueueLabel ?? "Default queue");

    const firedOrdinal = firedRule
      ? (persisted.find((rule) => rule.id === firedRule.ruleId)?.ordinal ?? null)
      : null;

    await this.deps.tests.record({
      sampleJson: JSON.stringify(input.ticket),
      firedRoutingRuleId: firedRule?.ruleId ?? null,
      firedRuleOrdinal: firedOrdinal,
      resolvedTarget,
      fellToDefaultQueue: !evaluation.matched,
      ruleSetHash: ruleSetHash(evaluatedRules),
      ranByStaffUserId: input.staffUserId,
      now: input.now,
    });

    return {
      matched: evaluation.matched,
      firedRule: firedRule
        ? {
            id: firedRule.ruleId,
            position: firedRule.position,
            condition: firedRule.condition,
            routeTo: firedRule.targetTeamId ?? "requeue",
            routeToLabel: resolvedTarget,
          }
        : null,
      evaluation: evaluation.evaluation,
      ruleSetSource: input.ruleSet.mode,
      differsFromSaved,
      defaultQueueLabel,
    };
  }
}
