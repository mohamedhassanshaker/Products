import { describe, expect, it } from "vitest";
import { FakePublishedAgentPort, FakeRouterConfigRepository } from "../testing/fakes.js";
import { UpdateRouterConfig, type UpdateRouterConfigInput } from "./update-router-config.js";

const now = new Date("2026-09-15T10:00:00.000Z");

function validInput(overrides: Partial<UpdateRouterConfigInput> = {}): UpdateRouterConfigInput {
  return {
    executionMode: "Sequential",
    routingStrategy: "IntentClassifier",
    agentSelectionScope: "AllPublished",
    agentScopeListJson: null,
    maxHops: 6,
    maxLoopIterations: 3,
    costCeilingTokens: 8000,
    costCeilingMicroAed: 350_000,
    conflictResolution: "HighestConfidence",
    responseMergePolicy: "DeduplicateOverlap",
    fallbackAgentId: null,
    minRoutingConfidence: 0.3,
    ...overrides,
  };
}

function harness() {
  const routerConfig = new FakeRouterConfigRepository();
  routerConfig.seed({
    executionMode: "Sequential",
    routingStrategy: "IntentClassifier",
    agentSelectionScope: "AllPublished",
    agentScopeListJson: null,
    maxHops: 6,
    maxLoopIterations: 3,
    costCeilingTokens: 8000,
    costCeilingMicroAed: 350_000,
    conflictResolution: "HighestConfidence",
    responseMergePolicy: "DeduplicateOverlap",
    fallbackAgentId: null,
    fallbackAgentName: null,
    minRoutingConfidence: 0.3,
    updatedAt: now,
    activePipelineVersionId: null,
  });
  const agents = new FakePublishedAgentPort();
  return { routerConfig, agents, updateRouterConfig: new UpdateRouterConfig({ routerConfig, agents }) };
}

describe("UpdateRouterConfig", () => {
  it("saves a valid config and returns it", async () => {
    const { updateRouterConfig } = harness();
    const result = await updateRouterConfig.execute(validInput({ executionMode: "Parallel" }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.config.executionMode).toBe("Parallel");
  });

  it("rejects maxHops below 1 or above 10 (CK_RouterConfigs_maxHops)", async () => {
    const { updateRouterConfig } = harness();
    expect((await updateRouterConfig.execute(validInput({ maxHops: 0 }))).ok).toBe(false);
    expect((await updateRouterConfig.execute(validInput({ maxHops: 11 }))).ok).toBe(false);
    const result = await updateRouterConfig.execute(validInput({ maxHops: 0 }));
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("orchestration.max_hops_out_of_range");
  });

  it("rejects maxLoopIterations below 1 or above 20", async () => {
    const { updateRouterConfig } = harness();
    const result = await updateRouterConfig.execute(validInput({ maxLoopIterations: 21 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("orchestration.max_loop_iterations_out_of_range");
  });

  it("rejects a non-positive cost ceiling, tokens or AED", async () => {
    const { updateRouterConfig } = harness();
    const tokens = await updateRouterConfig.execute(validInput({ costCeilingTokens: 0 }));
    if (tokens.ok) throw new Error("unreachable");
    expect(tokens.reason).toBe("orchestration.cost_ceiling_must_be_positive");

    const aed = await updateRouterConfig.execute(validInput({ costCeilingMicroAed: 0 }));
    if (aed.ok) throw new Error("unreachable");
    expect(aed.reason).toBe("orchestration.cost_ceiling_must_be_positive");
  });

  it("rejects minRoutingConfidence outside [0, 1]", async () => {
    const { updateRouterConfig } = harness();
    const result = await updateRouterConfig.execute(validInput({ minRoutingConfidence: 1.5 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("orchestration.min_routing_confidence_out_of_range");
  });

  it("rejects Parallel/SupervisorWorker with ConcatenateInOrder merge policy", async () => {
    const { updateRouterConfig } = harness();
    const parallel = await updateRouterConfig.execute(
      validInput({ executionMode: "Parallel", responseMergePolicy: "ConcatenateInOrder" }),
    );
    if (parallel.ok) throw new Error("unreachable");
    expect(parallel.reason).toBe("orchestration.parallel_requires_overlap_resolving_merge_policy");

    const supervisor = await updateRouterConfig.execute(
      validInput({
        executionMode: "SupervisorWorker",
        responseMergePolicy: "ConcatenateInOrder",
        maxHops: 5,
      }),
    );
    if (supervisor.ok) throw new Error("unreachable");
    expect(supervisor.reason).toBe("orchestration.parallel_requires_overlap_resolving_merge_policy");
  });

  it("allows Sequential with ConcatenateInOrder (the rule only restricts multi-agent modes)", async () => {
    const { updateRouterConfig } = harness();
    const result = await updateRouterConfig.execute(
      validInput({ executionMode: "Sequential", responseMergePolicy: "ConcatenateInOrder" }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects SupervisorWorker with maxHops below 3", async () => {
    const { updateRouterConfig } = harness();
    const result = await updateRouterConfig.execute(
      validInput({
        executionMode: "SupervisorWorker",
        responseMergePolicy: "DeduplicateOverlap",
        maxHops: 2,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("orchestration.supervisor_worker_requires_min_hops");
  });

  it("rejects ExplicitList with a null or empty agent list", async () => {
    const { updateRouterConfig } = harness();
    const result = await updateRouterConfig.execute(
      validInput({ agentSelectionScope: "ExplicitList", agentScopeListJson: null }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("orchestration.explicit_list_requires_non_empty_agent_list");

    const empty = await updateRouterConfig.execute(
      validInput({ agentSelectionScope: "ExplicitList", agentScopeListJson: "[]" }),
    );
    expect(empty.ok).toBe(false);
  });

  it("rejects ExplicitList with malformed JSON", async () => {
    const { updateRouterConfig } = harness();
    const result = await updateRouterConfig.execute(
      validInput({ agentSelectionScope: "ExplicitList", agentScopeListJson: "not json" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("orchestration.agent_scope_list_must_be_valid_json_array");
  });

  it("rejects ExplicitList naming an agent id that is not currently Published", async () => {
    const { updateRouterConfig, agents } = harness();
    agents.seedPublished("agt_published");
    const result = await updateRouterConfig.execute(
      validInput({
        agentSelectionScope: "ExplicitList",
        agentScopeListJson: JSON.stringify(["agt_published", "agt_does_not_exist"]),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("orchestration.explicit_list_agents_must_be_published");
  });

  it("accepts ExplicitList naming only real, currently-Published agent ids", async () => {
    const { updateRouterConfig, agents } = harness();
    agents.seedPublished("agt_1");
    agents.seedPublished("agt_2");
    const result = await updateRouterConfig.execute(
      validInput({
        agentSelectionScope: "ExplicitList",
        agentScopeListJson: JSON.stringify(["agt_1", "agt_2"]),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.config.agentScopeListJson).toBe(JSON.stringify(["agt_1", "agt_2"]));
  });

  it("normalizes agentScopeListJson to null for every scope other than ExplicitList", async () => {
    const { updateRouterConfig } = harness();
    const result = await updateRouterConfig.execute(
      validInput({ agentSelectionScope: "AllPublished", agentScopeListJson: '["stray-leftover"]' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.config.agentScopeListJson).toBeNull();
  });
});
