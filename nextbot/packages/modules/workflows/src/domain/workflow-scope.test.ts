import { describe, expect, it } from "vitest";
import type { WorkflowRunLimits, WorkflowScopeSpec } from "@nextbot/contracts";
import { composeWorkflowNodeScope, composeWorkflowVersionScope } from "./workflow-scope.js";

const RUN_LIMITS: WorkflowRunLimits = { maxSteps: 10, maxCostUsd: 2.5, maxWallClockSeconds: 120, maxLoopIterations: 5, maxParallelBranches: 3, maxSubWorkflowDepth: 2 };

describe("composeWorkflowVersionScope", () => {
  it("projects runLimits onto the budget dimension (maxLoopIterations deliberately NOT projected)", () => {
    const scope = composeWorkflowVersionScope({ workflowVersionId: "wf@1", workflowLabel: "wf@1", runLimits: RUN_LIMITS, spec: undefined });
    expect(scope).toEqual({
      origin: "WorkflowVersion",
      originId: "wf@1",
      originLabel: "wf@1",
      budget: { maxSteps: 10, usdPerTurn: 2.5, seconds: 120, maxDepth: 2, maxFanOut: 3 },
    });
  });

  it("copies every declared scope dimension, omitting undeclared ones entirely", () => {
    const spec: WorkflowScopeSpec = {
      capabilityGroupIds: ["11111111-1111-1111-1111-111111111111"],
      toolIds: "*",
      deniedToolIds: ["22222222-2222-2222-2222-222222222222"],
      knowledgeCollectionIds: ["33333333-3333-3333-3333-333333333333"],
      rwClasses: ["Read"],
      autonomyCeiling: "Tier2",
      minRequiredTier: "Tier1",
      trustLevel: "SemiTrusted",
    };
    const scope = composeWorkflowVersionScope({ workflowVersionId: "wf@2", workflowLabel: "wf@2", runLimits: RUN_LIMITS, spec });
    expect(scope).toMatchObject(spec);
    expect(scope.origin).toBe("WorkflowVersion");
  });
});

describe("composeWorkflowNodeScope", () => {
  it("declares no budget of its own, even when the version-level scope has one", () => {
    const scope = composeWorkflowNodeScope({ nodeOriginId: "call_1", nodeLabel: "call_1", spec: undefined });
    expect(scope).toEqual({ origin: "WorkflowNode", originId: "call_1", originLabel: "call_1" });
  });

  it("copies every declared dimension the same way the version-level scope does", () => {
    const spec: WorkflowScopeSpec = { toolIds: [], capabilityGroupIds: [] };
    const scope = composeWorkflowNodeScope({ nodeOriginId: "call_1", nodeLabel: "call_1", spec });
    expect(scope).toEqual({ origin: "WorkflowNode", originId: "call_1", originLabel: "call_1", toolIds: [], capabilityGroupIds: [] });
  });
});
