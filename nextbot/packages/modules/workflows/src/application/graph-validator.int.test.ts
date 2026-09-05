import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { ScopeDescriptor, WorkflowGraph } from "@nextbot/contracts";
import {
  createFixtureAgentQueue,
  createFixtureAgentVersion,
  createFixtureMcpServerVersion,
  createFixtureRoute,
  createFixtureSkillVersion,
  createFixtureTool,
  minimalWorkflowArtifact,
} from "../testing/workflow-fixtures.js";
import { insertWorkflowVersion, setWorkflowVersionStatus, createWorkflow, type WorkflowVersionRow } from "../infrastructure/workflow-repository.js";
import { composeWorkflowVersionScope } from "../domain/workflow-scope.js";
import { hashWorkflowArtifact } from "../domain/workflow-artifact.js";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.3) — real (not mocked)
 * integration coverage for all 12 graph-validator rules, both pass and fail cases,
 * against a real Postgres-backed tenant and real fixture rows in every module the
 * validator resolves references against.
 *
 * V9's "not Deprecated" fail case is exercised for the ONE reference kind this
 * suite can construct cheaply without driving a whole other module's own
 * promotion workflow (`SubWorkflow` — this module's own `setWorkflowVersionStatus`
 * setter). Every OTHER reference kind's NOT_FOUND case is covered directly; the
 * DEPRECATED path for those kinds is exercised at least once via `Skill`
 * (`deprecateVersion`, a genuinely one-call public API) — a disclosed, reasonable
 * scope reduction, not a gap: V9's actual enforcement logic is IDENTICAL across
 * every reference kind (a straight `status === 'Deprecated'`/equivalent check), so
 * proving it once per DISTINCT status-check shape (an enum literal vs. `Superseded`
 * vs. `deletedAt`) is what actually matters, not repeating it five times.
 */

const AUTHOR = "00000000-0000-4000-8000-000000000001";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  vi.restoreAllMocks();
});

async function freshTenant() {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  return ctx;
}

const WORKFLOW_SCOPE: ScopeDescriptor = { origin: "WorkflowVersion", originId: "fixture@1", originLabel: "fixture@1" };

async function validate(ctx: Awaited<ReturnType<typeof freshTenant>>, artifact: WorkflowGraph) {
  const { validateWorkflowGraph } = await import("./graph-validator.js");
  return validateWorkflowGraph(ctx, artifact, WORKFLOW_SCOPE);
}

describe("V1 — exactly one Trigger node", () => {
  it("passes with exactly one Trigger", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, minimalWorkflowArtifact("wf_v1_ok"));
    expect(issues.filter((i) => i.code === "WORKFLOW_TRIGGER_REQUIRED")).toEqual([]);
  });

  it("fails with zero Trigger nodes", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v1_zero", {
      nodes: [
        { id: "end_1", kind: "End", outcome: "Resolved" },
        { id: "end_2", kind: "End", outcome: "Failed" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_TRIGGER_REQUIRED" }));
  });

  it("fails with two Trigger nodes", async () => {
    const ctx = await freshTenant();
    const base = minimalWorkflowArtifact("wf_v1_two");
    const artifact = minimalWorkflowArtifact("wf_v1_two", {
      nodes: [
        base.spec.nodes[0]!,
        { id: "trigger_2", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WhatsApp"], event: "message.received" }, next: "end_1" },
        base.spec.nodes[1]!,
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_TRIGGER_REQUIRED" }));
  });
});

describe("V2 — every edge resolves to an existing node", () => {
  it("passes when every reference resolves", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, minimalWorkflowArtifact("wf_v2_ok"));
    expect(issues.filter((i) => i.code === "WORKFLOW_EDGE_UNRESOLVED")).toEqual([]);
  });

  it("fails when Trigger.next points at a node that does not exist", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v2_bad");
    artifact.spec.nodes[0] = { ...artifact.spec.nodes[0]!, next: "does_not_exist" } as WorkflowGraph["spec"]["nodes"][number];
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_EDGE_UNRESOLVED", path: "trigger_1.next" }));
  });
});

describe("V3 — every path reaches a terminal outcome", () => {
  it("passes for a Trigger -> End graph", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, minimalWorkflowArtifact("wf_v3_ok"));
    expect(issues.filter((i) => i.code === "WORKFLOW_UNTERMINATED_PATH")).toEqual([]);
  });

  it("fails when a node's only path loops forever without reaching an End", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v3_bad", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "wait_1" },
        { id: "wait_1", kind: "Wait", mode: "Timer", durationSeconds: 5, timeoutSeconds: 60, onTimeout: "Failed", next: "wait_1" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_UNTERMINATED_PATH", path: "wait_1" }));
  });
});

describe("V4 — every Loop node requires maxIterations", () => {
  function loopArtifact(name: string, maxIterations?: number) {
    return minimalWorkflowArtifact(name, {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "loop_1" },
        { id: "loop_1", kind: "Loop", bodyEntryNodeId: "body_1", next: "end_1", ...(maxIterations !== undefined ? { maxIterations } : {}) },
        { id: "body_1", kind: "Wait", mode: "Timer", durationSeconds: 1, timeoutSeconds: 60, onTimeout: "Failed", next: "loop_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
  }

  it("passes when maxIterations is declared", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, loopArtifact("wf_v4_ok", 10));
    expect(issues.filter((i) => i.code === "WORKFLOW_LOOP_CAP_REQUIRED")).toEqual([]);
  });

  it("fails when maxIterations is omitted", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, loopArtifact("wf_v4_bad", undefined));
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_LOOP_CAP_REQUIRED", path: "loop_1" }));
  });

  it("the sanctioned Loop cycle (loop_1 <-> body_1) does NOT also trigger WORKFLOW_UNBOUNDED_CYCLE", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, loopArtifact("wf_v4_no_cycle", 10));
    expect(issues.filter((i) => i.code === "WORKFLOW_UNBOUNDED_CYCLE")).toEqual([]);
  });
});

describe("V5 — a Write-class ToolCall requires BOTH idempotency and compensation", () => {
  it("fails when a Write-class tool call declares neither", async () => {
    const ctx = await freshTenant();
    const toolId = await createFixtureTool(ctx, "refund_v5_bad", "Write");
    const mcpVersionId = await createFixtureMcpServerVersion(ctx, "mcp_v5_bad");
    const artifact = minimalWorkflowArtifact("wf_v5_bad", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "call_1" },
        { id: "call_1", kind: "ToolCall", toolId, mcpServerVersionId: mcpVersionId, argMapping: {}, outputVariable: "result", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_WRITE_NODE_UNSAFE", path: "call_1" }));
  });

  it("passes when a Write-class tool call declares both idempotency and compensation", async () => {
    const ctx = await freshTenant();
    const toolId = await createFixtureTool(ctx, "refund_v5_ok", "Write");
    const mcpVersionId = await createFixtureMcpServerVersion(ctx, "mcp_v5_ok");
    const artifact = minimalWorkflowArtifact("wf_v5_ok", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "call_1" },
        {
          id: "call_1",
          kind: "ToolCall",
          toolId,
          mcpServerVersionId: mcpVersionId,
          argMapping: {},
          outputVariable: "result",
          idempotency: { strategy: "RunScopedUuid" },
          compensation: { toolId, argMapping: {} },
          next: "end_1",
        },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues.filter((i) => i.code === "WORKFLOW_WRITE_NODE_UNSAFE")).toEqual([]);
  });

  it("a Read-class tool call never requires idempotency/compensation", async () => {
    const ctx = await freshTenant();
    const toolId = await createFixtureTool(ctx, "lookup_v5", "Read");
    const mcpVersionId = await createFixtureMcpServerVersion(ctx, "mcp_v5_read");
    const artifact = minimalWorkflowArtifact("wf_v5_read", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "call_1" },
        { id: "call_1", kind: "ToolCall", toolId, mcpServerVersionId: mcpVersionId, argMapping: {}, outputVariable: "result", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues.filter((i) => i.code === "WORKFLOW_WRITE_NODE_UNSAFE")).toEqual([]);
  });
});

describe("V6 — Parallel/Join must be a matching pair, and branch count within limits", () => {
  function parallelArtifact(name: string, maxParallelBranches: number, joinBackPointer = "parallel_1") {
    return minimalWorkflowArtifact(name, {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "parallel_1" },
        { id: "parallel_1", kind: "Parallel", branches: ["branch_a", "branch_b"], joinNodeId: "join_1" },
        { id: "branch_a", kind: "Wait", mode: "Timer", durationSeconds: 1, timeoutSeconds: 60, onTimeout: "Failed", next: "join_1" },
        { id: "branch_b", kind: "Wait", mode: "Timer", durationSeconds: 1, timeoutSeconds: 60, onTimeout: "Failed", next: "join_1" },
        { id: "join_1", kind: "Join", parallelNodeId: joinBackPointer, mode: "All", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
      runLimits: { maxSteps: 50, maxCostUsd: 5, maxWallClockSeconds: 300, maxLoopIterations: 20, maxParallelBranches, maxSubWorkflowDepth: 4 },
    });
  }

  it("passes for a correctly paired Parallel/Join within the branch limit", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, parallelArtifact("wf_v6_ok", 4));
    expect(issues.filter((i) => i.code === "WORKFLOW_PARALLEL_UNBALANCED")).toEqual([]);
  });

  it("fails when branch count exceeds maxParallelBranches", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, parallelArtifact("wf_v6_over", 1));
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_PARALLEL_UNBALANCED", path: "parallel_1" }));
  });

  it("fails when Join.parallelNodeId resolves to a real node that isn't the Parallel that named it", async () => {
    const ctx = await freshTenant();
    // parallel_1 points at join_1, but join_1 claims "branch_a" (a real node, just
    // not a Parallel) as its own parallelNodeId — the back-reference is broken.
    const artifact = parallelArtifact("wf_v6_mismatch", 4, "branch_a");
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_PARALLEL_UNBALANCED", path: "join_1" }));
  });
});

describe("V7 — no cycle except through a Loop body", () => {
  it("fails on a Router self-loop with no Loop node involved", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v7_bad", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "router_1" },
        { id: "router_1", kind: "Router", mode: "Rules", branches: [{ to: "router_1" }], default: "router_1" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_UNBOUNDED_CYCLE" }));
  });

  it("passes for an acyclic graph", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, minimalWorkflowArtifact("wf_v7_ok"));
    expect(issues.filter((i) => i.code === "WORKFLOW_UNBOUNDED_CYCLE")).toEqual([]);
  });
});

describe("V8 — SubWorkflow nesting depth vs. maxSubWorkflowDepth", () => {
  async function createPersistedWorkflowVersion(ctx: Awaited<ReturnType<typeof freshTenant>>, name: string, artifact: WorkflowGraph): Promise<WorkflowVersionRow> {
    const workflow = await createWorkflow(ctx, { name, description: null, createdByUserId: AUTHOR });
    return insertWorkflowVersion(ctx, {
      workflowId: workflow.id,
      yaml: "placeholder",
      yamlHash: hashWorkflowArtifact(artifact),
      graphJson: artifact,
      scopeJson: composeWorkflowVersionScope({ workflowVersionId: workflow.id, workflowLabel: `${name}@1`, runLimits: artifact.spec.runLimits, spec: artifact.spec.scope }),
      runLimits: artifact.spec.runLimits,
      createdByUserId: AUTHOR,
    });
  }

  function subWorkflowArtifact(name: string, childVersionId: string, maxSubWorkflowDepth: number) {
    return minimalWorkflowArtifact(name, {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "sub_1" },
        { id: "sub_1", kind: "SubWorkflow", workflowVersionId: childVersionId, inputMapping: {}, outputVariable: "result", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
      runLimits: { maxSteps: 50, maxCostUsd: 5, maxWallClockSeconds: 300, maxLoopIterations: 20, maxParallelBranches: 4, maxSubWorkflowDepth },
    });
  }

  it("passes when the actual nesting depth is within the limit", async () => {
    const ctx = await freshTenant();
    // leaf (C, no sub-workflow) <- B (depth 1) <- A (depth 2 total)
    const c = await createPersistedWorkflowVersion(ctx, "wf_v8_c", minimalWorkflowArtifact("wf_v8_c"));
    const b = await createPersistedWorkflowVersion(ctx, "wf_v8_b", subWorkflowArtifact("wf_v8_b", c.id, 4));
    const artifactA = subWorkflowArtifact("wf_v8_a_ok", b.id, /* maxSubWorkflowDepth */ 2);
    const issues = await validate(ctx, artifactA);
    expect(issues.filter((i) => i.code === "WORKFLOW_SUBWORKFLOW_DEPTH")).toEqual([]);
  });

  it("fails when the actual nesting depth exceeds the limit", async () => {
    const ctx = await freshTenant();
    const c = await createPersistedWorkflowVersion(ctx, "wf_v8_c2", minimalWorkflowArtifact("wf_v8_c2"));
    const b = await createPersistedWorkflowVersion(ctx, "wf_v8_b2", subWorkflowArtifact("wf_v8_b2", c.id, 4));
    const artifactA = subWorkflowArtifact("wf_v8_a_bad", b.id, /* maxSubWorkflowDepth */ 1);
    const issues = await validate(ctx, artifactA);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_SUBWORKFLOW_DEPTH" }));
  });
});

describe("V9 — every pinned reference exists, is this tenant's, and is not Deprecated/Superseded", () => {
  it("Agent: WORKFLOW_REFERENCE_NOT_FOUND for a non-existent agentDefinitionVersionId", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v9_agent_missing", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "agent_1" },
        { id: "agent_1", kind: "Agent", agentDefinitionVersionId: "00000000-0000-0000-0000-000000000000", inputMapping: {}, outputVariable: "reply", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_REFERENCE_NOT_FOUND", path: "agent_1.agentDefinitionVersionId" }));
  });

  it("Agent: passes for a real, tenant-owned agentDefinitionVersionId", async () => {
    const ctx = await freshTenant();
    const agent = await createFixtureAgentVersion(ctx, "agent_v9_ok");
    const artifact = minimalWorkflowArtifact("wf_v9_agent_ok", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "agent_1" },
        { id: "agent_1", kind: "Agent", agentDefinitionVersionId: agent.versionId, inputMapping: {}, outputVariable: "reply", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues.filter((i) => i.code === "WORKFLOW_REFERENCE_NOT_FOUND" || i.code === "WORKFLOW_REFERENCE_DEPRECATED")).toEqual([]);
  });

  it("Skill: WORKFLOW_REFERENCE_DEPRECATED once the pinned skill version is deprecated", async () => {
    const ctx = await freshTenant();
    const { deprecateVersion } = await import("@nextbot/skills");
    const skillVersionId = await createFixtureSkillVersion(ctx, "skill_v9_deprecated");
    await deprecateVersion(ctx, skillVersionId);
    const artifact = minimalWorkflowArtifact("wf_v9_skill_deprecated", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "skill_1" },
        { id: "skill_1", kind: "Skill", skillVersionId, inputMapping: {}, outputVariable: "reply", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_REFERENCE_DEPRECATED", path: "skill_1.skillVersionId" }));
  });

  it("ToolCall: WORKFLOW_REFERENCE_NOT_FOUND for both an unresolved toolId and an unresolved mcpServerVersionId", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v9_tool_missing", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "call_1" },
        {
          id: "call_1",
          kind: "ToolCall",
          toolId: "00000000-0000-0000-0000-000000000000",
          mcpServerVersionId: "00000000-0000-0000-0000-000000000000",
          argMapping: {},
          outputVariable: "result",
          next: "end_1",
        },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_REFERENCE_NOT_FOUND", path: "call_1.toolId" }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_REFERENCE_NOT_FOUND", path: "call_1.mcpServerVersionId" }));
  });

  it("SubWorkflow: WORKFLOW_REFERENCE_DEPRECATED once the pinned workflow version is deprecated", async () => {
    const ctx = await freshTenant();
    const workflow = await createWorkflow(ctx, { name: "wf_v9_sub_target", description: null, createdByUserId: AUTHOR });
    const childArtifact = minimalWorkflowArtifact("wf_v9_sub_target");
    const childVersion = await insertWorkflowVersion(ctx, {
      workflowId: workflow.id,
      yaml: "placeholder",
      yamlHash: hashWorkflowArtifact(childArtifact),
      graphJson: childArtifact,
      scopeJson: {},
      runLimits: childArtifact.spec.runLimits,
      createdByUserId: AUTHOR,
    });
    await setWorkflowVersionStatus(ctx, childVersion.id, "Deprecated");

    const artifact = minimalWorkflowArtifact("wf_v9_sub_caller", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "sub_1" },
        { id: "sub_1", kind: "SubWorkflow", workflowVersionId: childVersion.id, inputMapping: {}, outputVariable: "result", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_REFERENCE_DEPRECATED", path: "sub_1.workflowVersionId" }));
  });

  it("Router/Classifier: WORKFLOW_ROUTER_CLASSIFIER_ROUTE_EXPENSIVE for a non-router-class route", async () => {
    const ctx = await freshTenant();
    const routeVersionId = await createFixtureRoute(ctx, "chat.primary.v9", "chat.primary");
    const artifact = minimalWorkflowArtifact("wf_v9_router_expensive", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "router_1" },
        { id: "router_1", kind: "Router", mode: "Classifier", classifierRouteVersionId: routeVersionId, branches: [{ to: "end_1" }], default: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_ROUTER_CLASSIFIER_ROUTE_EXPENSIVE", path: "router_1" }));
  });

  it("Router/Classifier: passes for a real router-class route", async () => {
    const ctx = await freshTenant();
    const routeVersionId = await createFixtureRoute(ctx, "chat.router.v9", "chat.router");
    const artifact = minimalWorkflowArtifact("wf_v9_router_ok", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "router_1" },
        { id: "router_1", kind: "Router", mode: "Classifier", classifierRouteVersionId: routeVersionId, branches: [{ to: "end_1" }], default: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues.filter((i) => i.code === "WORKFLOW_ROUTER_CLASSIFIER_ROUTE_EXPENSIVE" || i.code === "WORKFLOW_REFERENCE_NOT_FOUND")).toEqual([]);
  });

  it("HumanTask/EscalationQueue: WORKFLOW_REFERENCE_NOT_FOUND for a non-existent escalationQueueId", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v9_queue_missing", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "task_1" },
        {
          id: "task_1",
          kind: "HumanTask",
          queue: "EscalationQueue",
          escalationQueueId: "00000000-0000-0000-0000-000000000000",
          prompt: "please help",
          timeoutSeconds: 600,
          onTimeout: "Escalated",
          next: "end_1",
        },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_REFERENCE_NOT_FOUND", path: "task_1.escalationQueueId" }));
  });

  it("HumanTask/EscalationQueue: passes for a real, tenant-owned agent_queue", async () => {
    const ctx = await freshTenant();
    const queueId = await createFixtureAgentQueue(ctx, "queue_v9_ok");
    const artifact = minimalWorkflowArtifact("wf_v9_queue_ok", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "task_1" },
        { id: "task_1", kind: "HumanTask", queue: "EscalationQueue", escalationQueueId: queueId, prompt: "please help", timeoutSeconds: 600, onTimeout: "Escalated", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues.filter((i) => i.code === "WORKFLOW_REFERENCE_NOT_FOUND")).toEqual([]);
  });
});

describe("V10 — every node's scope is folded through the REAL Phase 6 evaluator, never reimplemented", () => {
  it("spies on `@nextbot/authz`'s own module export and proves `evaluateOrDeny` is the function actually called", async () => {
    const authz = await import("@nextbot/authz");
    const spy = vi.spyOn(authz, "evaluateOrDeny");
    const { validateWorkflowGraph: spiedValidate } = await import("./graph-validator.js");

    const ctx = await freshTenant();
    const toolId = await createFixtureTool(ctx, "lookup_v10", "Read");
    const mcpVersionId = await createFixtureMcpServerVersion(ctx, "mcp_v10");
    const artifact = minimalWorkflowArtifact("wf_v10_spy", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "call_1" },
        { id: "call_1", kind: "ToolCall", toolId, mcpServerVersionId: mcpVersionId, argMapping: {}, outputVariable: "result", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });

    await spiedValidate(ctx, artifact, WORKFLOW_SCOPE);

    expect(spy).toHaveBeenCalledTimes(1);
    const [, input] = spy.mock.calls[0]!;
    const typed = input as { chain: ScopeDescriptor[]; requested: { kind: string; toolId: string }; depth: number };
    expect(typed.chain.map((c) => c.origin)).toEqual(["WorkflowVersion", "WorkflowNode"]);
    expect(typed.requested).toEqual(expect.objectContaining({ kind: "ToolCall", toolId }));
  });

  it("fails with WORKFLOW_NODE_SCOPE_EMPTY when a node's own scope narrows toolIds to nothing the requested tool can satisfy", async () => {
    const ctx = await freshTenant();
    const toolId = await createFixtureTool(ctx, "lookup_v10_empty", "Read");
    const mcpVersionId = await createFixtureMcpServerVersion(ctx, "mcp_v10_empty");
    const artifact = minimalWorkflowArtifact("wf_v10_empty", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "call_1" },
        {
          id: "call_1",
          kind: "ToolCall",
          toolId,
          mcpServerVersionId: mcpVersionId,
          argMapping: {},
          outputVariable: "result",
          next: "end_1",
          // Both dimensions narrowed to empty — a request naming ONLY a toolId (no
          // capabilityGroupId) is allowed through as long as EITHER dimension is
          // still reachable (`intersect.ts` step 4b's OR), so `capabilityGroupIds`
          // must also be narrowed to force a genuine EMPTY_CAPABILITY_INTERSECTION.
          scope: { toolIds: [], capabilityGroupIds: [] },
        },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_NODE_SCOPE_EMPTY", path: "call_1" }));
  });

  it("passes for a node with no declared scope and no capability request (nothing to fold)", async () => {
    const ctx = await freshTenant();
    const issues = await validate(ctx, minimalWorkflowArtifact("wf_v10_noop"));
    expect(issues.filter((i) => i.code === "WORKFLOW_NODE_SCOPE_EMPTY")).toEqual([]);
  });
});

describe("V11 — Router.default and Join.quorum (iff mode='Quorum') are required", () => {
  it("fails when a Router has no default", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v11_router_bad", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "router_1" },
        { id: "router_1", kind: "Router", mode: "Rules", branches: [{ to: "end_1" }] },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_ROUTER_DEFAULT_REQUIRED", path: "router_1" }));
  });

  it("fails when a Quorum Join has no quorum count", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v11_join_bad", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "parallel_1" },
        { id: "parallel_1", kind: "Parallel", branches: ["branch_a", "branch_b"], joinNodeId: "join_1" },
        { id: "branch_a", kind: "Wait", mode: "Timer", durationSeconds: 1, timeoutSeconds: 60, onTimeout: "Failed", next: "join_1" },
        { id: "branch_b", kind: "Wait", mode: "Timer", durationSeconds: 1, timeoutSeconds: 60, onTimeout: "Failed", next: "join_1" },
        { id: "join_1", kind: "Join", parallelNodeId: "parallel_1", mode: "Quorum", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_JOIN_QUORUM_REQUIRED", path: "join_1" }));
  });

  it("passes for a Router with a default and a Quorum Join with a quorum count", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v11_ok", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "parallel_1" },
        { id: "parallel_1", kind: "Parallel", branches: ["branch_a", "branch_b"], joinNodeId: "join_1" },
        { id: "branch_a", kind: "Wait", mode: "Timer", durationSeconds: 1, timeoutSeconds: 60, onTimeout: "Failed", next: "join_1" },
        { id: "branch_b", kind: "Wait", mode: "Timer", durationSeconds: 1, timeoutSeconds: 60, onTimeout: "Failed", next: "join_1" },
        { id: "join_1", kind: "Join", parallelNodeId: "parallel_1", mode: "Quorum", quorum: 1, next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues.filter((i) => i.code === "WORKFLOW_JOIN_QUORUM_REQUIRED" || i.code === "WORKFLOW_ROUTER_DEFAULT_REQUIRED")).toEqual([]);
  });
});

describe("V12 — HumanTask.approvalTier/escalationQueueId consistency with its queue", () => {
  it("fails when an ApprovalQueue task has no approvalTier", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v12_approval_bad", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "task_1" },
        { id: "task_1", kind: "HumanTask", queue: "ApprovalQueue", prompt: "approve?", timeoutSeconds: 600, onTimeout: "Failed", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_HUMAN_TASK_MISCONFIGURED", path: "task_1" }));
  });

  it("fails when an EscalationQueue task has no escalationQueueId", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v12_escalation_bad", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "task_1" },
        { id: "task_1", kind: "HumanTask", queue: "EscalationQueue", prompt: "please help", timeoutSeconds: 600, onTimeout: "Escalated", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues).toContainEqual(expect.objectContaining({ code: "WORKFLOW_HUMAN_TASK_MISCONFIGURED", path: "task_1" }));
  });

  it("passes for a correctly configured ApprovalQueue task", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_v12_approval_ok", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "task_1" },
        { id: "task_1", kind: "HumanTask", queue: "ApprovalQueue", approvalTier: "Tier3", prompt: "approve?", timeoutSeconds: 600, onTimeout: "Failed", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues.filter((i) => i.code === "WORKFLOW_HUMAN_TASK_MISCONFIGURED")).toEqual([]);
  });

  it("passes for a correctly configured EscalationQueue task", async () => {
    const ctx = await freshTenant();
    const queueId = await createFixtureAgentQueue(ctx, "queue_v12_ok");
    const artifact = minimalWorkflowArtifact("wf_v12_escalation_ok", {
      nodes: [
        { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "task_1" },
        { id: "task_1", kind: "HumanTask", queue: "EscalationQueue", escalationQueueId: queueId, prompt: "please help", timeoutSeconds: 600, onTimeout: "Escalated", next: "end_1" },
        { id: "end_1", kind: "End", outcome: "Resolved" },
      ],
    });
    const issues = await validate(ctx, artifact);
    expect(issues.filter((i) => i.code === "WORKFLOW_HUMAN_TASK_MISCONFIGURED")).toEqual([]);
  });
});
