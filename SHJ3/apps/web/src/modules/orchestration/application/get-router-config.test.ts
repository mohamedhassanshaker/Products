import { describe, expect, it } from "vitest";
import { FakeRouterConfigRepository } from "../testing/fakes.js";
import { GetRouterConfig } from "./get-router-config.js";

const now = new Date("2026-09-10T10:00:00.000Z");

describe("GetRouterConfig", () => {
  it("returns the real singleton unchanged", async () => {
    const routerConfig = new FakeRouterConfigRepository();
    routerConfig.seed({
      executionMode: "Parallel",
      routingStrategy: "LlmRouter",
      agentSelectionScope: "AllPublished",
      agentScopeListJson: null,
      maxHops: 6,
      maxLoopIterations: 3,
      costCeilingTokens: 8000,
      costCeilingMicroAed: 500_000,
      conflictResolution: "HighestConfidence",
      responseMergePolicy: "DeduplicateOverlap",
      fallbackAgentId: "agent_1",
      fallbackAgentName: "General FAQ Agent",
      minRoutingConfidence: 0.55,
      updatedAt: now,
      activePipelineVersionId: null,
    });

    const result = await new GetRouterConfig({ routerConfig }).execute();
    expect(result?.executionMode).toBe("Parallel");
    expect(result?.fallbackAgentName).toBe("General FAQ Agent");
  });

  it("returns null when a tenant never had this singleton provisioned", async () => {
    const routerConfig = new FakeRouterConfigRepository();
    const result = await new GetRouterConfig({ routerConfig }).execute();
    expect(result).toBeNull();
  });
});
