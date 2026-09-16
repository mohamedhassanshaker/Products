import { evaluateRoutingRules, type RoutingRuleInput } from "../domain/routing-rule-engine.js";
import type { HandoverRoutingConfigRepository } from "../ports/handover-routing-config-repository.js";
import type { RoutingRuleRepository, RoutingRuleRow } from "../ports/routing-rule-repository.js";
import type { EscalationTicketSummary, TicketRepository } from "../ports/ticket-repository.js";

function toRuleInput(rule: RoutingRuleRow): RoutingRuleInput {
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

function waitTimeMinutes(queuedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - queuedAt.getTime()) / 60_000);
}

/**
 * api.md §6.8 `GET /handover/queue` — "Sorted by the routing outcome, not by insertion
 * order."
 *
 * **A judgment call, named plainly.** `EscalationTickets.routedByRoutingRuleId`/
 * `routeTargetTeamId` are persisted columns (`conversation/ports/escalation-repository.ts`'s
 * own doc comment: "created here; read-only everywhere else — B8 owns the queue/
 * assignment side") but nothing populates them at ticket-creation time — B-6's own
 * `RequestHandover` only ever writes `Queued`, unrouted. Rather than editing that
 * already-shipped, already-tested use case to reach into this module (a real, avoidable
 * cross-module coupling in the wrong direction — the ticket-creation surface would then
 * depend on the queue-management surface), this use case *lazily* routes every unrouted
 * `Queued` ticket the first time the queue is loaded, using the exact same
 * `evaluateRoutingRules` function the tester uses (§ the module's own load-bearing
 * guarantee: a tested outcome and a live outcome can never disagree). A ticket that
 * matches no enabled rule falls to `HandoverConfig.defaultQueueTeamId` — "falling to the
 * default queue is a legitimate outcome, not an error" (api.md §6.8 rule 4).
 */
export class ListEscalationQueue {
  constructor(
    private readonly deps: {
      readonly tickets: TicketRepository;
      readonly rules: RoutingRuleRepository;
      readonly handoverConfig: HandoverRoutingConfigRepository;
    },
  ) {}

  async execute(
    now: Date,
  ): Promise<readonly (EscalationTicketSummary & { readonly waitTimeMinutes: number })[]> {
    const unrouted = await this.deps.tickets.listUnrouted();
    if (unrouted.length > 0) {
      const [rules, config] = await Promise.all([
        this.deps.rules.list(),
        this.deps.handoverConfig.getSingleton(),
      ]);
      const ruleInputs = rules.map(toRuleInput);
      for (const ticket of unrouted) {
        const evaluation = evaluateRoutingRules(ruleInputs, {
          topicKey: ticket.topicKey,
          priority: ticket.priority,
          channelKey: ticket.channelKey,
          waitTimeMinutes: waitTimeMinutes(ticket.queuedAt, now),
        });
        const targetTeamId =
          evaluation.firedRule?.targetKind === "Team"
            ? evaluation.firedRule.targetTeamId
            : (config?.defaultQueueTeamId ?? null);
        await this.deps.tickets.assignRouting(ticket.id, {
          routedByRoutingRuleId: evaluation.firedRule?.ruleId ?? null,
          routeTargetTeamId: targetTeamId,
          targetKind: evaluation.firedRule?.targetKind ?? null,
        });
      }
    }

    const open = await this.deps.tickets.listOpen();
    return open.map((ticket) => ({
      ...ticket,
      waitTimeMinutes: waitTimeMinutes(ticket.queuedAt, now),
    }));
  }
}
