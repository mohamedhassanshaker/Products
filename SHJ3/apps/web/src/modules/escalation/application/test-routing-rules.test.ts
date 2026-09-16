import { describe, expect, it } from "vitest";
import {
  FakeHandoverRoutingConfigRepository,
  FakeRoutingRuleRepository,
  FakeRoutingRuleTestRepository,
  FakeTeamRepository,
} from "../testing/fakes.js";
import { TestRoutingRules } from "./test-routing-rules.js";
import type { RoutingRuleInput } from "../domain/routing-rule-engine.js";

const now = new Date("2026-09-10T12:00:00.000Z");

function makeDeps() {
  const rules = new FakeRoutingRuleRepository();
  const teams = new FakeTeamRepository();
  const handoverConfig = new FakeHandoverRoutingConfigRepository();
  const tests = new FakeRoutingRuleTestRepository();

  teams.seed({ id: "team_sewa_billing", name: "SEWA billing team" });
  teams.seed({ id: "team_senior_agents", name: "Senior agents" });
  handoverConfig.seed({
    defaultQueueTeamId: "team_default",
    maxWaitSecondsBeforeRequeue: 600,
    supervisorAlertTeamId: null,
  });
  teams.seed({ id: "team_default", name: "General queue" });

  // The seeded, persisted order: Topic=Billing first, Priority=High second — the
  // wireframe's own [rule] ("a Billing + High-priority ticket routes to the SEWA
  // billing team, not Senior agents").
  rules.seed({
    id: "r1",
    ordinal: 1,
    attribute: "Topic",
    operator: "Eq",
    value: "Billing",
    targetKind: "Team",
    targetTeamId: "team_sewa_billing",
    alertSupervisor: false,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  });
  rules.seed({
    id: "r2",
    ordinal: 2,
    attribute: "Priority",
    operator: "Eq",
    value: "High",
    targetKind: "Team",
    targetTeamId: "team_senior_agents",
    alertSupervisor: false,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  return { rules, teams, handoverConfig, tests };
}

const billingHighTicket = {
  topicKey: "Billing",
  priority: "High",
  channelKey: "Web",
  waitTimeMinutes: 2,
};

describe("TestRoutingRules — the live, unsaved rule order", () => {
  it("evaluating mode: persisted reflects the seeded order (Topic wins, routes to SEWA billing)", async () => {
    const deps = makeDeps();
    const useCase = new TestRoutingRules(deps);

    const result = await useCase.execute({
      ticket: billingHighTicket,
      ruleSet: { mode: "persisted" },
      staffUserId: "staff_1",
      now,
    });

    expect(result.matched).toBe(true);
    expect(result.firedRule?.id).toBe("r1");
    expect(result.firedRule?.routeToLabel).toBe("SEWA billing team");
    expect(result.differsFromSaved).toBe(false);
  });

  it("proves the hard requirement: a reorder that is edited but NOT saved is what the tester evaluates", async () => {
    const deps = makeDeps();
    const useCase = new TestRoutingRules(deps);

    // The admin swaps rule 2 above rule 1 in the *editor* — nothing is persisted.
    // `RoutingRuleRepository.list()` (the persisted source) still returns the
    // original r1-then-r2 order at this point; only proven by re-reading it below.
    const editedOrder: RoutingRuleInput[] = [
      {
        id: "r2",
        attribute: "Priority",
        operator: "Eq",
        value: "High",
        targetKind: "Team",
        targetTeamId: "team_senior_agents",
        alertSupervisor: false,
        isEnabled: true,
      },
      {
        id: "r1",
        attribute: "Topic",
        operator: "Eq",
        value: "Billing",
        targetKind: "Team",
        targetTeamId: "team_sewa_billing",
        alertSupervisor: false,
        isEnabled: true,
      },
    ];

    const result = await useCase.execute({
      ticket: billingHighTicket,
      ruleSet: { mode: "provided", rules: editedOrder },
      staffUserId: "staff_1",
      now,
    });

    // The unsaved edit is what fires — Senior agents, not SEWA billing.
    expect(result.matched).toBe(true);
    expect(result.firedRule?.id).toBe("r2");
    expect(result.firedRule?.routeToLabel).toBe("Senior agents");
    expect(result.ruleSetSource).toBe("provided");
    expect(result.differsFromSaved).toBe(true);

    // And the persisted order is genuinely untouched — the endpoint "writes nothing,
    // not even the tester input" as far as routing state goes (api.md §6.8 rule 2).
    const stillPersisted = await deps.rules.list();
    expect(stillPersisted.map((rule) => rule.id)).toEqual(["r1", "r2"]);

    // The tester's own run *is* recorded, as evidence — a separate, additive audit
    // row, not a routing-state change.
    expect(deps.tests.recorded).toHaveLength(1);
    expect(deps.tests.recorded[0]?.firedRoutingRuleId).toBe("r2");
  });

  it("falls to the default queue and records fellToDefaultQueue when nothing matches", async () => {
    const deps = makeDeps();
    const useCase = new TestRoutingRules(deps);

    const result = await useCase.execute({
      ticket: { topicKey: "Library", priority: "Normal", channelKey: "Web", waitTimeMinutes: 1 },
      ruleSet: { mode: "persisted" },
      staffUserId: "staff_1",
      now,
    });

    expect(result.matched).toBe(false);
    expect(result.firedRule).toBeNull();
    expect(result.defaultQueueLabel).toBe("General queue");
    expect(deps.tests.recorded[0]?.fellToDefaultQueue).toBe(true);
    expect(deps.tests.recorded[0]?.firedRoutingRuleId).toBeNull();
  });

  it("rejects a rule shape the system would refuse to save (api.md §6.8 rule 5)", async () => {
    const deps = makeDeps();
    const useCase = new TestRoutingRules(deps);

    await expect(
      useCase.execute({
        ticket: billingHighTicket,
        ruleSet: {
          mode: "provided",
          rules: [
            {
              id: "bad",
              attribute: "Topic",
              operator: "Gt", // invalid — Topic must use Eq
              value: "Billing",
              targetKind: "Team",
              targetTeamId: "team_1",
              alertSupervisor: false,
              isEnabled: true,
            },
          ],
        },
        staffUserId: "staff_1",
        now,
      }),
    ).rejects.toThrow();
  });
});
