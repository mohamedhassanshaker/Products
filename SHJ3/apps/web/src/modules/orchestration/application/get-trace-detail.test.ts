import { describe, expect, it } from "vitest";
import { FakeOrchestrationTraceRepository } from "../testing/fakes.js";
import { GetTraceDetail, TraceNotFoundError } from "./get-trace-detail.js";

const now = new Date("2026-09-10T10:00:00.000Z");

describe("GetTraceDetail", () => {
  it("returns the real ordered steps for a known trace", async () => {
    const traces = new FakeOrchestrationTraceRepository();
    traces.seed({
      id: "trace_1",
      conversationId: "conv_1",
      channelKey: "WebWidget",
      executionMode: "Sequential",
      routedAgentId: "agent_1",
      routedAgentName: "Billing Agent",
      routingConfidence: 0.9,
      hopCount: 1,
      guardrailPreResult: "Pass",
      guardrailPostResult: "Pass",
      startedAt: now,
      durationMs: 900,
      promptTextMasked: "Pay my SEWA bill",
      responseTextMasked: "Here is your balance.",
      mergePolicyApplied: "ConcatenateInOrder",
      groundingConfidence: 0.8,
      totalInputTokens: 120,
      totalOutputTokens: 80,
      totalCostMicroAed: 4000,
      escapeTriggered: false,
      steps: [
        {
          id: "step_1",
          ordinal: 1,
          kind: "GuardrailPre",
          agentId: null,
          agentName: null,
          toolBindingId: null,
          label: "PII mask + prompt-injection filter",
          argumentsMasked: null,
          resultSummary: "Pay my SEWA bill",
          confidence: null,
          status: "Ok",
          errorCode: null,
          isSecondaryAgent: false,
          durationMs: 0,
        },
        {
          id: "step_2",
          ordinal: 2,
          kind: "Route",
          agentId: "agent_1",
          agentName: "Billing Agent",
          toolBindingId: null,
          label: "Routed to billing_agent (mode=Sequential)",
          argumentsMasked: null,
          resultSummary: null,
          confidence: 0.9,
          status: "Ok",
          errorCode: null,
          isSecondaryAgent: false,
          durationMs: 0,
        },
      ],
      citations: [],
    });

    const detail = await new GetTraceDetail({ traces }).execute("trace_1");
    expect(detail.steps.map((step) => step.kind)).toEqual(["GuardrailPre", "Route"]);
    expect(detail.steps.every((step, index) => step.ordinal === index + 1)).toBe(true);
  });

  it("throws TraceNotFoundError for an unknown id", async () => {
    const traces = new FakeOrchestrationTraceRepository();
    await expect(new GetTraceDetail({ traces }).execute("missing")).rejects.toBeInstanceOf(
      TraceNotFoundError,
    );
  });
});
