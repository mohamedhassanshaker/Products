import { describe, expect, it } from "vitest";
import { RoutingRuleOrderConflictError } from "../ports/routing-rule-repository.js";
import { FakeRoutingRuleRepository } from "../testing/fakes.js";
import { ReorderRoutingRules } from "./reorder-routing-rules.js";

const now = new Date("2026-09-10T12:00:00.000Z");

function seedThreeRules(rules: FakeRoutingRuleRepository) {
  for (const [id, ordinal] of [
    ["r1", 1],
    ["r2", 2],
    ["r3", 3],
  ] as const) {
    rules.seed({
      id,
      ordinal,
      attribute: "Topic",
      operator: "Eq",
      value: id,
      targetKind: "Requeue",
      targetTeamId: null,
      alertSupervisor: false,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

describe("ReorderRoutingRules", () => {
  it("applies a Move-up style reorder against the expected current order", async () => {
    const rules = new FakeRoutingRuleRepository();
    seedThreeRules(rules);

    await new ReorderRoutingRules({ rules }).execute(["r2", "r1", "r3"], ["r1", "r2", "r3"]);

    expect((await rules.list()).map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
  });

  it("rejects a stale order with the real current order — someone else reordered first", async () => {
    const rules = new FakeRoutingRuleRepository();
    seedThreeRules(rules);
    // Simulate a concurrent reorder that already happened.
    await rules.reorder(["r3", "r1", "r2"], ["r1", "r2", "r3"]);

    await expect(
      new ReorderRoutingRules({ rules }).execute(["r2", "r1", "r3"], ["r1", "r2", "r3"]),
    ).rejects.toThrow(RoutingRuleOrderConflictError);

    // The rejected reorder must not have applied.
    expect((await rules.list()).map((r) => r.id)).toEqual(["r3", "r1", "r2"]);
  });
});
