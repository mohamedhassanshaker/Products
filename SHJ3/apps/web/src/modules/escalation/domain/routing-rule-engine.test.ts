import { describe, expect, it } from "vitest";
import {
  assertValidRuleShape,
  evaluateRoutingRules,
  InvalidRoutingRuleShapeError,
  type RoutingRuleInput,
  type TicketSample,
} from "./routing-rule-engine.js";

const billingRule: RoutingRuleInput = {
  id: "r1",
  attribute: "Topic",
  operator: "Eq",
  value: "Billing",
  targetKind: "Team",
  targetTeamId: "team_sewa_billing",
  alertSupervisor: false,
  isEnabled: true,
};

const highPriorityRule: RoutingRuleInput = {
  id: "r2",
  attribute: "Priority",
  operator: "Eq",
  value: "High",
  targetKind: "Team",
  targetTeamId: "team_senior_agents",
  alertSupervisor: false,
  isEnabled: true,
};

const whatsAppRule: RoutingRuleInput = {
  id: "r3",
  attribute: "Channel",
  operator: "Eq",
  value: "WhatsApp",
  targetKind: "Team",
  targetTeamId: "team_whatsapp_agents",
  alertSupervisor: false,
  isEnabled: false,
};

const waitTimeRule: RoutingRuleInput = {
  id: "r4",
  attribute: "WaitTime",
  operator: "Gt",
  value: "5",
  targetKind: "Requeue",
  targetTeamId: null,
  alertSupervisor: true,
  isEnabled: true,
};

const billingHighPriorityTicket: TicketSample = {
  topicKey: "Billing",
  priority: "High",
  channelKey: "Web",
  waitTimeMinutes: 2,
};

describe("evaluateRoutingRules", () => {
  it("routes a Billing + High ticket to the SEWA billing team when Topic is rule 1 (the seeded order)", () => {
    // Mirrors the wireframe [rule]: "a Billing + High-priority ticket routes to the
    // SEWA billing team, not Senior agents" with the seeded rule order.
    const result = evaluateRoutingRules(
      [billingRule, highPriorityRule, whatsAppRule, waitTimeRule],
      billingHighPriorityTicket,
    );
    expect(result.matched).toBe(true);
    expect(result.firedRule?.ruleId).toBe("r1");
    expect(result.firedRule?.targetTeamId).toBe("team_sewa_billing");
    expect(result.evaluation).toEqual([
      { position: 1, ruleId: "r1", enabled: true, matched: true, reason: "topic == billing" },
      {
        position: 2,
        ruleId: "r2",
        enabled: true,
        matched: null,
        reason: "not_evaluated_first_match_won",
      },
      { position: 3, ruleId: "r3", enabled: false, matched: null, reason: "disabled" },
      {
        position: 4,
        ruleId: "r4",
        enabled: true,
        matched: null,
        reason: "not_evaluated_first_match_won",
      },
    ]);
  });

  it("routes the identical ticket to Senior agents once rules 1 and 2 are swapped — order determines the outcome", () => {
    // This is the exact api.md §6.8 worked example, reordered.
    const result = evaluateRoutingRules(
      [highPriorityRule, billingRule, whatsAppRule, waitTimeRule],
      billingHighPriorityTicket,
    );
    expect(result.matched).toBe(true);
    expect(result.firedRule?.ruleId).toBe("r2");
    expect(result.firedRule?.targetTeamId).toBe("team_senior_agents");
    expect(result.evaluation[0]).toMatchObject({ ruleId: "r2", matched: true });
    expect(result.evaluation[1]).toMatchObject({ ruleId: "r1", matched: null });
  });

  it("falls to the default queue when no enabled rule matches", () => {
    const result = evaluateRoutingRules([whatsAppRule], {
      topicKey: "Library",
      priority: "Normal",
      channelKey: "Web",
      waitTimeMinutes: 1,
    });
    expect(result.matched).toBe(false);
    expect(result.firedRule).toBeNull();
  });

  it("evaluates a WaitTime rule with '>' against the sample's own minutes", () => {
    const matches = evaluateRoutingRules([waitTimeRule], {
      topicKey: "General",
      priority: "Normal",
      channelKey: "Web",
      waitTimeMinutes: 6,
    });
    expect(matches.matched).toBe(true);

    const doesNotMatch = evaluateRoutingRules([waitTimeRule], {
      topicKey: "General",
      priority: "Normal",
      channelKey: "Web",
      waitTimeMinutes: 5,
    });
    expect(doesNotMatch.matched).toBe(false);
  });

  it("never evaluates (and never fires) a disabled rule even when it would otherwise match", () => {
    const enabledWhatsApp: RoutingRuleInput = { ...whatsAppRule, isEnabled: true };
    const disabledOnly = evaluateRoutingRules([whatsAppRule], {
      topicKey: "General",
      priority: "Normal",
      channelKey: "WhatsApp",
      waitTimeMinutes: 1,
    });
    expect(disabledOnly.matched).toBe(false);

    const enabledInstead = evaluateRoutingRules([enabledWhatsApp], {
      topicKey: "General",
      priority: "Normal",
      channelKey: "WhatsApp",
      waitTimeMinutes: 1,
    });
    expect(enabledInstead.matched).toBe(true);
  });
});

describe("assertValidRuleShape", () => {
  it("accepts a well-formed Eq/Team rule", () => {
    expect(() =>
      assertValidRuleShape({
        attribute: "Topic",
        operator: "Eq",
        value: "Billing",
        targetKind: "Team",
        targetTeamId: "team_1",
      }),
    ).not.toThrow();
  });

  it("rejects Topic paired with Gt (CK_RoutingRules_operatorMatchesAttribute)", () => {
    expect(() =>
      assertValidRuleShape({
        attribute: "Topic",
        operator: "Gt",
        value: "Billing",
        targetKind: "Team",
        targetTeamId: "team_1",
      }),
    ).toThrow(InvalidRoutingRuleShapeError);
  });

  it("rejects WaitTime paired with Eq", () => {
    expect(() =>
      assertValidRuleShape({
        attribute: "WaitTime",
        operator: "Eq",
        value: "5",
        targetKind: "Requeue",
        targetTeamId: null,
      }),
    ).toThrow(InvalidRoutingRuleShapeError);
  });

  it("rejects a non-numeric WaitTime value (CK_RoutingRules_waitTimeNumeric)", () => {
    expect(() =>
      assertValidRuleShape({
        attribute: "WaitTime",
        operator: "Gt",
        value: "five",
        targetKind: "Requeue",
        targetTeamId: null,
      }),
    ).toThrow(InvalidRoutingRuleShapeError);
  });

  it("rejects a Team target with no targetTeamId (CK_RoutingRules_targetPaired)", () => {
    expect(() =>
      assertValidRuleShape({
        attribute: "Topic",
        operator: "Eq",
        value: "Billing",
        targetKind: "Team",
        targetTeamId: null,
      }),
    ).toThrow(InvalidRoutingRuleShapeError);
  });

  it("rejects a Requeue target that names a targetTeamId", () => {
    expect(() =>
      assertValidRuleShape({
        attribute: "Priority",
        operator: "Eq",
        value: "High",
        targetKind: "Requeue",
        targetTeamId: "team_1",
      }),
    ).toThrow(InvalidRoutingRuleShapeError);
  });
});
