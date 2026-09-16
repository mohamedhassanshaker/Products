import { describe, expect, it } from "vitest";
import {
  FakeOrchestrationStepSampleRepository,
  FakeServiceHealthRepository,
} from "../testing/fakes.js";
import { RecordServiceHealthSample } from "./record-service-health-sample.js";

const windowStart = new Date("2026-09-10T09:00:00.000Z");
const windowEnd = new Date("2026-09-10T10:00:00.000Z");

describe("RecordServiceHealthSample", () => {
  it("computes p95/error rate from real OrchestrationTraceSteps and persists a Degraded sample", async () => {
    const steps = new FakeOrchestrationStepSampleRepository();
    for (const durationMs of [200, 250, 260, 280, 310, 320, 900, 1000, 1200, 1900]) {
      steps.seed("ToolCall", new Date(windowStart.getTime() + 1000), { durationMs, status: "Ok" });
    }
    steps.seed("ToolCall", new Date(windowStart.getTime() + 2000), {
      durationMs: 50,
      status: "Failed",
    });

    const samples = new FakeServiceHealthRepository();
    const result = await new RecordServiceHealthSample({ steps, samples }).execute({
      targetKind: "McpTool",
      targetKey: "mcp-tool",
      displayName: "Sharjah Services Gateway (MCP)",
      windowStart,
      windowEnd,
    });

    expect(result.requestCount).toBe(11);
    expect(result.status).toBe("Degraded"); // p95 (1900ms) exceeds the 300ms MCP tool budget
  });

  it("reports Healthy when both thresholds are met", async () => {
    const steps = new FakeOrchestrationStepSampleRepository();
    for (let i = 0; i < 20; i++) {
      steps.seed("Retrieval", new Date(windowStart.getTime() + 1000), {
        durationMs: 200,
        status: "Ok",
      });
    }

    const samples = new FakeServiceHealthRepository();
    const result = await new RecordServiceHealthSample({ steps, samples }).execute({
      targetKind: "GraphRetrieval",
      targetKey: "graph-rag-retrieval",
      displayName: "Graph RAG retrieval",
      windowStart,
      windowEnd,
    });

    expect(result.status).toBe("Healthy");
  });
});
