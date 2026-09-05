import { describe, expect, it } from "vitest";
import { EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES, allSubscribableDomainEventTypes, categoriesForDomainEventType } from "./event-category.js";

describe("webhook event-category <-> domain_event.type mapping (pure)", () => {
  it("maps every FR-API-02 category to at least one real domain_event type", () => {
    for (const category of Object.keys(EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES) as Array<keyof typeof EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES>) {
      expect(EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES[category].length).toBeGreaterThan(0);
    }
  });

  it("resolves a real domain_event.type back to its category", () => {
    expect(categoriesForDomainEventType("escalations.escalation_created")).toEqual(["EscalationCreated"]);
    expect(categoriesForDomainEventType("agent-platform.deployment_created")).toEqual(["DeploymentChanged"]);
    expect(categoriesForDomainEventType("mcp-registry.drift_detected")).toEqual(["DriftDetected"]);
  });

  it("an unrecognized domain_event.type (unrelated to any of the five categories) resolves to no category, not an error", () => {
    expect(categoriesForDomainEventType("guardrail.evaluator_error")).toEqual([]);
  });

  it("deliberately excludes the evaluator-error type from GuardrailTripped — a system failure, not a guardrail actually tripping", () => {
    expect(EVENT_CATEGORY_TO_DOMAIN_EVENT_TYPES.GuardrailTripped).not.toContain("guardrail.evaluator_error");
  });

  it("allSubscribableDomainEventTypes de-duplicates and covers every mapped type", () => {
    const all = allSubscribableDomainEventTypes();
    expect(all).toContain("orchestration.tool_call.awaiting_human_approval");
    expect(new Set(all).size).toBe(all.length);
  });
});
