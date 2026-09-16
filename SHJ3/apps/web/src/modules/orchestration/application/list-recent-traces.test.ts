import { describe, expect, it } from "vitest";
import { FakeOrchestrationTraceRepository } from "../testing/fakes.js";
import { ListRecentTraces } from "./list-recent-traces.js";

function trace(id: string, startedAt: Date) {
  return {
    id,
    conversationId: `conv_${id}`,
    channelKey: "WebWidget",
    executionMode: "Sequential" as const,
    routedAgentId: "agent_1",
    routedAgentName: "Billing Agent",
    routingConfidence: 0.9,
    hopCount: 1,
    guardrailPreResult: "Pass" as const,
    guardrailPostResult: "Pass" as const,
    startedAt,
    durationMs: 900,
    promptTextMasked: "Pay my SEWA bill",
    responseTextMasked: "Here is your balance.",
    mergePolicyApplied: "ConcatenateInOrder",
    groundingConfidence: 0.8,
    totalInputTokens: 120,
    totalOutputTokens: 80,
    totalCostMicroAed: 4000,
    escapeTriggered: false,
    steps: [],
    citations: [],
  };
}

describe("ListRecentTraces", () => {
  it("returns real traces newest-first", async () => {
    const traces = new FakeOrchestrationTraceRepository();
    traces.seed(trace("older", new Date("2026-09-10T09:00:00.000Z")));
    traces.seed(trace("newer", new Date("2026-09-10T10:00:00.000Z")));

    const result = await new ListRecentTraces({ traces }).execute();
    expect(result.map((row) => row.id)).toEqual(["newer", "older"]);
  });
});
