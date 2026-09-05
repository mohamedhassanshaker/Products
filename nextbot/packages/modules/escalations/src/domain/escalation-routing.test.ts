import { describe, expect, it } from "vitest";
import { resolveRoutingQueue, type RoutingRule } from "./escalation-routing.js";

const FALLBACK = "fallback-queue";

describe("resolveRoutingQueue (LLD §3.9, FR-ESC-03)", () => {
  it("falls back to the required default queue when no rules exist", () => {
    const result = resolveRoutingQueue([], { reason: "LowConfidence" }, FALLBACK);
    expect(result).toEqual({ queueId: FALLBACK, matchedRuleId: null });
  });

  it("falls back when rules exist but none match", () => {
    const rules: RoutingRule[] = [
      { id: "r1", ordinal: 1, conditions: { recognizedGoal: "billing" }, queueId: "billing-queue", enabled: true },
    ];
    const result = resolveRoutingQueue(rules, { recognizedGoal: "shipping", reason: "LowConfidence" }, FALLBACK);
    expect(result).toEqual({ queueId: FALLBACK, matchedRuleId: null });
  });

  it("matches a rule whose every condition key is satisfied", () => {
    const rules: RoutingRule[] = [
      {
        id: "r1",
        ordinal: 1,
        conditions: { recognizedGoal: "billing", channelTypes: ["WebWidget"], reasons: ["LowConfidence"] },
        queueId: "billing-queue",
        enabled: true,
      },
    ];
    const result = resolveRoutingQueue(
      rules,
      { recognizedGoal: "billing", channelType: "WebWidget", reason: "LowConfidence" },
      FALLBACK,
    );
    expect(result).toEqual({ queueId: "billing-queue", matchedRuleId: "r1" });
  });

  it("first-match-wins in ascending ordinal order, not array order", () => {
    const rules: RoutingRule[] = [
      { id: "second", ordinal: 2, conditions: {}, queueId: "queue-2", enabled: true },
      { id: "first", ordinal: 1, conditions: {}, queueId: "queue-1", enabled: true },
    ];
    const result = resolveRoutingQueue(rules, { reason: "CustomerRequest" }, FALLBACK);
    expect(result).toEqual({ queueId: "queue-1", matchedRuleId: "first" });
  });

  it("skips a disabled rule even if it would otherwise match", () => {
    const rules: RoutingRule[] = [{ id: "r1", ordinal: 1, conditions: {}, queueId: "queue-1", enabled: false }];
    const result = resolveRoutingQueue(rules, { reason: "SensitiveTopic" }, FALLBACK);
    expect(result).toEqual({ queueId: FALLBACK, matchedRuleId: null });
  });

  it("a rule with no conditions matches everything (wildcard)", () => {
    const rules: RoutingRule[] = [{ id: "catch-all", ordinal: 1, conditions: {}, queueId: "queue-1", enabled: true }];
    const result = resolveRoutingQueue(rules, { reason: "ToolFailure" }, FALLBACK);
    expect(result).toEqual({ queueId: "queue-1", matchedRuleId: "catch-all" });
  });

  it("requires every present condition key to match (AND semantics), not any", () => {
    const rules: RoutingRule[] = [
      { id: "r1", ordinal: 1, conditions: { recognizedGoal: "billing", language: "fr" }, queueId: "queue-1", enabled: true },
    ];
    // recognizedGoal matches but language doesn't -> no match, falls to fallback.
    const result = resolveRoutingQueue(rules, { recognizedGoal: "billing", language: "en", reason: "LowConfidence" }, FALLBACK);
    expect(result).toEqual({ queueId: FALLBACK, matchedRuleId: null });
  });

  it("reasons condition restricts to listed reasons only", () => {
    const rules: RoutingRule[] = [
      { id: "r1", ordinal: 1, conditions: { reasons: ["SensitiveTopic"] }, queueId: "escalation-queue", enabled: true },
    ];
    expect(resolveRoutingQueue(rules, { reason: "SensitiveTopic" }, FALLBACK).queueId).toBe("escalation-queue");
    expect(resolveRoutingQueue(rules, { reason: "LowConfidence" }, FALLBACK).queueId).toBe(FALLBACK);
  });
});
