import { describe, expect, it } from "vitest";
import { FakeRouterConfigRepository } from "../testing/fakes.js";
import { ProvisionDefaultRouterConfigForTenant } from "./provision-default-router-config.js";

const NOW = new Date("2026-09-10T00:00:00Z");

describe("ProvisionDefaultRouterConfigForTenant", () => {
  it("creates the singleton, mirroring sewa's own real defaults, for a tenant with none", async () => {
    const routerConfig = new FakeRouterConfigRepository();
    const useCase = new ProvisionDefaultRouterConfigForTenant({ routerConfig });

    const result = await useCase.execute({ now: NOW });

    expect(result.created).toBe(true);
    expect(routerConfig.created).toEqual([{ now: NOW }]);
    const row = await routerConfig.getSingleton();
    expect(row?.executionMode).toBe("Sequential");
    expect(row?.routingStrategy).toBe("IntentClassifier");
    expect(row?.agentSelectionScope).toBe("AllPublished");
    expect(row?.maxHops).toBe(6);
    expect(row?.maxLoopIterations).toBe(3);
    expect(row?.costCeilingTokens).toBe(8000);
    expect(row?.costCeilingMicroAed).toBe(350_000);
    expect(row?.conflictResolution).toBe("HighestConfidence");
    expect(row?.responseMergePolicy).toBe("DeduplicateOverlap");
    expect(row?.fallbackAgentId).toBeNull();
    // The real, persisted `sewa` value — deliberately not `apps/ai`'s separate in-memory
    // 0.55 fallback default. See this use case's own doc comment for why.
    expect(row?.minRoutingConfidence).toBe(0.3);
  });

  it("is idempotent: a tenant that already has a singleton gets nothing created, and its real values are untouched", async () => {
    const routerConfig = new FakeRouterConfigRepository();
    routerConfig.seed({
      executionMode: "Parallel",
      routingStrategy: "LlmRouter",
      agentSelectionScope: "ChannelBound",
      agentScopeListJson: null,
      maxHops: 4,
      maxLoopIterations: 2,
      costCeilingTokens: 5000,
      costCeilingMicroAed: 200_000,
      conflictResolution: "SupervisorArbitrates",
      responseMergePolicy: "SupervisorRewrite",
      fallbackAgentId: "agent_1",
      fallbackAgentName: "General FAQ Agent",
      minRoutingConfidence: 0.6,
      updatedAt: NOW,
      activePipelineVersionId: null,
    });
    const useCase = new ProvisionDefaultRouterConfigForTenant({ routerConfig });

    const result = await useCase.execute({ now: NOW });

    expect(result.created).toBe(false);
    expect(routerConfig.created).toHaveLength(0);
    const row = await routerConfig.getSingleton();
    // Untouched — this is the real invariant a re-run against `sewa` (already fully
    // seeded, with its own real, deliberately different values) must uphold.
    expect(row?.executionMode).toBe("Parallel");
    expect(row?.minRoutingConfidence).toBe(0.6);
  });
});
