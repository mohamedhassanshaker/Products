import { describe, expect, it } from "vitest";
import type { WorkflowGraph, WorkflowNode } from "@nextbot/contracts";
import { emptyCheckpoint, setResumeMarker, withVariables } from "../domain/checkpoint.js";
import { executeNode, findNode, type NodeExecutionContext, type NodeOutcome } from "./node-executors.js";
import { createFakeNodeRuntime, graphOf, endNode, triggerNode } from "../testing/run-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.3) — direct unit coverage of
 * every node kind's semantics.
 *
 * `executeNode` is deliberately pure with respect to persistence — it returns a
 * `NodeOutcome` describing the new checkpoint and the step row, and `run-executor.ts`
 * commits both. That is exactly what makes this suite possible without a database, and
 * it is why the twelve node semantics can be exercised exhaustively (including the
 * failure and edge branches an integration test would need contrived fixtures to reach)
 * rather than only along the paths a happy-path run happens to take.
 *
 * The integration suites (`run-executor.int.test.ts`, the three adversarial proofs)
 * cover the persistence, lease and crash behaviour these outcomes feed into.
 */

const TOOL_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const SKILL_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const SUB_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const ROUTE_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const MCP_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const QUEUE_ID = "77777777-7777-4777-8777-777777777777";
const COMPENSATE_TOOL_ID = "88888888-8888-4888-8888-888888888888";

function ctxFor(
  nodes: WorkflowNode[],
  nodeId: string,
  overrides: Partial<NodeExecutionContext> = {},
): NodeExecutionContext {
  const graph: WorkflowGraph = graphOf("wf_unit", nodes);
  return {
    runId: "99999999-9999-4999-8999-999999999999",
    agentRunId: null,
    conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    graph,
    limits: graph.spec.runLimits,
    checkpoint: emptyCheckpoint(),
    entry: { nodeId, branchKey: null, iteration: 0 },
    depth: 0,
    runtime: createFakeNodeRuntime(),
    ...overrides,
  };
}

function successorIds(outcome: NodeOutcome): string[] {
  return outcome.kind === "Advance" ? outcome.successors.map((s) => s.nodeId) : [];
}

// ---------------------------------------------------------------------------

describe("findNode / the unknown-node defect path", () => {
  it("terminates loudly at Failed for a node id not in the graph (V2 makes this unreachable for a saved graph)", async () => {
    const nodes = [triggerNode("end_1"), endNode("end_1")];
    const outcome = await executeNode(ctxFor(nodes, "ghost_node"));
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind !== "Terminate") return;
    expect(outcome.outcome).toBe("Failed");
    expect(outcome.step.error?.code).toBe("WORKFLOW_NODE_NOT_FOUND");
  });

  it("finds a node by its authored id", () => {
    expect(findNode(graphOf("wf", [triggerNode("end_1"), endNode("end_1")]), "end_1")?.kind).toBe("End");
  });
});

describe("Trigger / End", () => {
  it("Trigger advances to `next` and writes a step, so the trace shows the run entering the graph", async () => {
    const outcome = await executeNode(ctxFor([triggerNode("end_1"), endNode("end_1")], "trigger_1"));
    expect(successorIds(outcome)).toEqual(["end_1"]);
    expect(outcome.step.status).toBe("Succeeded");
    expect(outcome.step.nodeKind).toBe("Trigger");
  });

  it.each(["Resolved", "Escalated", "Transferred", "Failed"] as const)("End terminates at its authored outcome %s", async (authored) => {
    const outcome = await executeNode(ctxFor([triggerNode("end_1"), endNode("end_1", authored)], "end_1"));
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind === "Terminate") expect(outcome.outcome).toBe(authored);
  });
});

describe("Agent node", () => {
  const nodes = (overrides: Partial<Extract<WorkflowNode, { kind: "Agent" }>> = {}): WorkflowNode[] => [
    triggerNode("agent_1"),
    { id: "agent_1", kind: "Agent", agentDefinitionVersionId: AGENT_VERSION_ID, inputMapping: { task: "$.variables.q" }, outputVariable: "answer", next: "end_1", ...overrides } as WorkflowNode,
    endNode("end_1"),
  ];

  it("binds the agent's answer to outputVariable and records the pinned version on the step", async () => {
    const ctx = ctxFor(nodes(), "agent_1", { checkpoint: withVariables(emptyCheckpoint(), { q: "where is my order" }) });
    const outcome = await executeNode(ctx);
    expect(successorIds(outcome)).toEqual(["end_1"]);
    if (outcome.kind !== "Advance") return;
    expect(outcome.checkpoint.variables.answer).toBe("agent said so");
    expect(outcome.step.refKind).toBe("AgentVersion");
    expect(outcome.step.refVersionId).toBe(AGENT_VERSION_ID);
    expect(outcome.costUsd).toBeCloseTo(0.01);
  });

  it("an agent asking to ESCALATE terminates the run at Escalated — a decision, not a failure to swallow", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.agentResult = { outcome: "escalate", text: "needs a human", costUsd: "0" };
    const outcome = await executeNode(ctxFor(nodes(), "agent_1", { runtime }));
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind === "Terminate") expect(outcome.outcome).toBe("Escalated");
  });

  it("an UNAVAILABLE pinned version routes through onError, never a silent answer", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.agentResult = { outcome: "answered", text: null, costUsd: "0", unavailableReason: "The pinned agent version is Deprecated." };
    const outcome = await executeNode(ctxFor(nodes(), "agent_1", { runtime }));
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind === "Terminate") expect(outcome.step.error?.code).toBe("WORKFLOW_AGENT_UNAVAILABLE");
  });

  it("a THROWN invocation is caught and routed through onError, never propagated into the pump tick", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.agents = { async invoke() { throw new Error("model gateway exploded"); } };
    const outcome = await executeNode(ctxFor(nodes({ onError: "continue" } as never), "agent_1", { runtime }));
    // `continue` proceeds to `next` with the failure recorded on the step.
    expect(successorIds(outcome)).toEqual(["end_1"]);
    expect(outcome.step.status).toBe("Failed");
    expect(outcome.step.error?.code).toBe("WORKFLOW_AGENT_FAILED");
  });
});

describe("Skill node", () => {
  const nodes: WorkflowNode[] = [
    triggerNode("skill_1"),
    { id: "skill_1", kind: "Skill", skillVersionId: SKILL_VERSION_ID, inputMapping: { task: "$.variables.q" }, outputVariable: "summary", next: "end_1" },
    endNode("end_1"),
  ];

  it("binds the skill's output and records the pinned skill version", async () => {
    const outcome = await executeNode(ctxFor(nodes, "skill_1", { checkpoint: withVariables(emptyCheckpoint(), { q: "summarise" }) }));
    expect(successorIds(outcome)).toEqual(["end_1"]);
    if (outcome.kind !== "Advance") return;
    expect(outcome.checkpoint.variables.summary).toBe("skill said so");
    expect(outcome.step.refKind).toBe("SkillVersion");
    expect(outcome.step.refVersionId).toBe(SKILL_VERSION_ID);
  });

  it("an unavailable skill version routes through onError", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.skillResult = { text: null, costUsd: "0", unavailableReason: "The pinned skill version no longer exists." };
    const outcome = await executeNode(ctxFor(nodes, "skill_1", { runtime }));
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind === "Terminate") expect(outcome.step.error?.code).toBe("WORKFLOW_SKILL_UNAVAILABLE");
  });

  it("a thrown skill invocation is caught", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.skills = { async invoke() { throw new Error("route missing"); } };
    const outcome = await executeNode(ctxFor(nodes, "skill_1", { runtime }));
    expect(outcome.step.error?.code).toBe("WORKFLOW_SKILL_FAILED");
  });
});

describe("Router — Classifier mode", () => {
  const nodes: WorkflowNode[] = [
    triggerNode("router_1"),
    {
      id: "router_1",
      kind: "Router",
      mode: "Classifier",
      classifierRouteVersionId: ROUTE_VERSION_ID,
      branches: [{ to: "end_a", when: "billing" }, { to: "end_b", when: "shipping" }],
      default: "end_c",
    },
    endNode("end_a"),
    endNode("end_b", "Transferred"),
    endNode("end_c", "Failed"),
  ];

  it("takes the branch the classifier chose", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.classifyResult = { choiceIndex: 1, costUsd: "0.0002" };
    const outcome = await executeNode(ctxFor(nodes, "router_1", { runtime }));
    expect(successorIds(outcome)).toEqual(["end_b"]);
    expect(outcome.costUsd).toBeCloseTo(0.0002);
  });

  it("falls back to the REQUIRED default when the classifier abstains", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.classifyResult = { choiceIndex: null, costUsd: "0" };
    expect(successorIds(await executeNode(ctxFor(nodes, "router_1", { runtime })))).toEqual(["end_c"]);
  });

  it("falls back to the default when the classifier returns an OUT-OF-RANGE index", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.classifyResult = { choiceIndex: 99, costUsd: "0" };
    expect(successorIds(await executeNode(ctxFor(nodes, "router_1", { runtime })))).toEqual(["end_c"]);
  });

  it("falls back to the default when the classifier THROWS, and records why on the step", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.classifier = { async classify() { throw new Error("route offline"); } };
    const outcome = await executeNode(ctxFor(nodes, "router_1", { runtime }));
    expect(successorIds(outcome)).toEqual(["end_c"]);
    expect(outcome.step.error?.code).toBe("WORKFLOW_ROUTER_CLASSIFIER_FAILED");
    // A classifier failure must not fail the RUN — the author declared a default
    // precisely so the graph has a defined behaviour when classification is unavailable.
    expect(outcome.step.status).toBe("Succeeded");
  });
});

describe("ToolCall — error policies and the compensation push", () => {
  const toolNodes = (overrides: Partial<Extract<WorkflowNode, { kind: "ToolCall" }>> = {}): WorkflowNode[] => [
    triggerNode("tool_1"),
    { id: "tool_1", kind: "ToolCall", toolId: TOOL_ID, mcpServerVersionId: MCP_VERSION_ID, argMapping: { amount: "$.variables.amount" }, outputVariable: "receipt", next: "end_1", ...overrides } as WorkflowNode,
    endNode("end_1"),
  ];

  it("does NOT push a compensation for a READ-classified tool", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.rwClasses.set(TOOL_ID, "Read");
    const outcome = await executeNode(ctxFor(toolNodes({ compensation: { toolId: COMPENSATE_TOOL_ID, argMapping: {} } } as never), "tool_1", { runtime }));
    if (outcome.kind !== "Advance") throw new Error("expected Advance");
    expect(outcome.checkpoint.compensations).toEqual([]);
  });

  it("pushes a compensation for a WRITE-classified tool that declares one, AFTER the call succeeded", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.rwClasses.set(TOOL_ID, "Write");
    const outcome = await executeNode(
      ctxFor(toolNodes({ idempotency: { strategy: "RunScopedUuid" }, compensation: { toolId: COMPENSATE_TOOL_ID, argMapping: {} } } as never), "tool_1", { runtime }),
    );
    if (outcome.kind !== "Advance") throw new Error("expected Advance");
    expect(outcome.checkpoint.compensations).toHaveLength(1);
    expect(outcome.checkpoint.compensations[0]!.toolId).toBe(COMPENSATE_TOOL_ID);
    // The compensating entry carries the FORWARD key, so the unwind can derive its own.
    expect(outcome.checkpoint.compensations[0]!.idempotencyKey).toBe(runtime.dispatches[0]!.idempotencyKey);
  });

  it("a WRITE tool with no declared compensation pushes nothing (V5 forbids this graph, so this is defense in depth)", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.rwClasses.set(TOOL_ID, "Write");
    const outcome = await executeNode(ctxFor(toolNodes(), "tool_1", { runtime }));
    if (outcome.kind !== "Advance") throw new Error("expected Advance");
    expect(outcome.checkpoint.compensations).toEqual([]);
  });

  it("a DENIED dispatch is terminal for the node and is never retried — a denial is a decision", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.tools.dispatch = async () => ({ kind: "Denied", reason: "policy_denied" });
    const outcome = await executeNode(ctxFor(toolNodes(), "tool_1", { runtime }));
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind === "Terminate") expect(outcome.step.error?.code).toBe("WORKFLOW_TOOL_DENIED");
  });

  it.each([
    ["fail", "Terminate"],
    ["escalate", "Terminate"],
    ["compensate", "Compensate"],
    ["continue", "Advance"],
  ] as const)("onError '%s' produces a %s outcome", async (onError, expectedKind) => {
    const runtime = createFakeNodeRuntime();
    runtime.tools.dispatch = async () => ({ kind: "Failed", errorMessage: "boom", retriable: false });
    const outcome = await executeNode(ctxFor(toolNodes({ onError } as never), "tool_1", { runtime }));
    expect(outcome.kind).toBe(expectedKind);
    if (onError === "escalate" && outcome.kind === "Terminate") expect(outcome.outcome).toBe("Escalated");
  });

  it("SUSPENDS with the approval's own deadline and a declared Timeout outcome when the tier engine interrupts", async () => {
    const runtime = createFakeNodeRuntime();
    const expiresAt = new Date(Date.now() + 3600_000);
    runtime.suspendingTools.set(TOOL_ID, { toolCallId: "call-1", approvalRequestId: "approval-1", expiresAt });
    const outcome = await executeNode(ctxFor(toolNodes(), "tool_1", { runtime }));
    expect(outcome.kind).toBe("Suspend");
    if (outcome.kind !== "Suspend") return;
    expect(outcome.suspension.kind).toBe("Approval");
    expect(outcome.suspension.ref).toBe("approval_request:approval-1");
    expect(outcome.suspension.expiresAt).toBe(expiresAt);
    // A ToolCall node has no authored `onTimeout`, so an undecided approval TIMES THE
    // RUN OUT — distinct from `Failed`, because nothing failed.
    expect(outcome.suspension.expiryOutcome).toBe("Timeout");
    expect(outcome.step.toolCallId).toBe("call-1");
  });

  it("falls back to the run's wall-clock ceiling if the dispatcher returns no deadline — bounded, never indefinite", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.tools.dispatch = async () => ({ kind: "AwaitingApproval", toolCallId: "c", approvalRequestId: null, tier: "Tier3", expiresAt: null });
    const outcome = await executeNode(ctxFor(toolNodes(), "tool_1", { runtime }));
    if (outcome.kind !== "Suspend") throw new Error("expected Suspend");
    expect(outcome.suspension.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(outcome.suspension.ref).toBe("approval_request:c");
  });

  it("RESUMES from a decided approval without dispatching again", async () => {
    const runtime = createFakeNodeRuntime();
    const checkpoint = setResumeMarker(emptyCheckpoint(), "tool_1", 0, { status: "Succeeded", output: { receiptId: "R1" } });
    const outcome = await executeNode(ctxFor(toolNodes(), "tool_1", { runtime, checkpoint }));
    expect(successorIds(outcome)).toEqual(["end_1"]);
    if (outcome.kind !== "Advance") return;
    expect(outcome.checkpoint.variables.receipt).toEqual({ receiptId: "R1" });
    // The whole point: no second, unapproved tool call.
    expect(runtime.dispatches).toHaveLength(0);
  });

  it("a REJECTED/EXPIRED approval routes through onError and never dispatches", async () => {
    const runtime = createFakeNodeRuntime();
    const checkpoint = setResumeMarker(emptyCheckpoint(), "tool_1", 0, { status: "Cancelled", errorMessage: "declined by approver" });
    const outcome = await executeNode(ctxFor(toolNodes(), "tool_1", { runtime, checkpoint }));
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind === "Terminate") expect(outcome.step.error?.code).toBe("WORKFLOW_TOOL_APPROVAL_NOT_GRANTED");
    expect(runtime.dispatches).toHaveLength(0);
  });
});

describe("HumanTask", () => {
  const escalationNodes = (overrides: Partial<Extract<WorkflowNode, { kind: "HumanTask" }>> = {}): WorkflowNode[] => [
    triggerNode("human_1"),
    { id: "human_1", kind: "HumanTask", queue: "EscalationQueue", escalationQueueId: QUEUE_ID, prompt: "review", timeoutSeconds: 600, onTimeout: "Failed", next: "end_1", ...overrides } as WorkflowNode,
    endNode("end_1"),
  ];

  it("raises a real escalation and suspends with the node's DECLARED onTimeout", async () => {
    const runtime = createFakeNodeRuntime();
    const outcome = await executeNode(ctxFor(escalationNodes({ onTimeout: "Transferred" } as never), "human_1", { runtime }));
    expect(outcome.kind).toBe("Suspend");
    if (outcome.kind !== "Suspend") return;
    expect(outcome.suspension.kind).toBe("HumanTask");
    expect(outcome.suspension.expiryOutcome).toBe("Transferred");
    expect(runtime.raisedEscalations).toHaveLength(1);
  });

  it("maps an authored escalationReason onto the real enum, and falls back to CustomerRequest for anything else", async () => {
    const runtime = createFakeNodeRuntime();
    let seenReason: string | undefined;
    runtime.escalations = {
      async raise(input) { seenReason = input.reason; return { escalationId: "e1" }; },
      async readEscalationStatus() { return "Waiting"; },
    };
    await executeNode(ctxFor(escalationNodes({ escalationReason: "SensitiveTopic" } as never), "human_1", { runtime }));
    expect(seenReason).toBe("SensitiveTopic");
    await executeNode(ctxFor(escalationNodes({ escalationReason: "something the author typed" } as never), "human_1", { runtime }));
    expect(seenReason).toBe("CustomerRequest");
  });

  it("fails with its own code when the run has no conversation to escalate into", async () => {
    const outcome = await executeNode(ctxFor(escalationNodes(), "human_1", { conversationId: null }));
    expect(outcome.step.error?.code).toBe("WORKFLOW_HUMAN_TASK_NO_CONVERSATION");
  });

  it("refuses the Approval Queue LOUDLY (disclosed Phase 16 narrowing, not a silent skip)", async () => {
    const nodes: WorkflowNode[] = [
      triggerNode("human_1"),
      { id: "human_1", kind: "HumanTask", queue: "ApprovalQueue", approvalTier: "Tier3", prompt: "approve", timeoutSeconds: 600, onTimeout: "Failed", next: "end_1" },
      endNode("end_1"),
    ];
    const outcome = await executeNode(ctxFor(nodes, "human_1"));
    expect(outcome.step.error?.code).toBe("WORKFLOW_HUMAN_TASK_APPROVAL_QUEUE_UNSUPPORTED");
    expect(outcome.step.error?.message).toMatch(/EscalationQueue|ToolCall node/);
  });

  it("RESUMES to `next` when the escalation resolved, and to `onReject` when it was returned to the bot", async () => {
    const resolved = setResumeMarker(emptyCheckpoint(), "human_1", 0, { status: "Resolved", escalationId: "e1" });
    expect(successorIds(await executeNode(ctxFor(escalationNodes(), "human_1", { checkpoint: resolved })))).toEqual(["end_1"]);

    const nodes = escalationNodes({ onReject: "end_2" } as never).concat([endNode("end_2", "Transferred")]);
    const returned = setResumeMarker(emptyCheckpoint(), "human_1", 0, { status: "ReturnedToBot", escalationId: "e1" });
    expect(successorIds(await executeNode(ctxFor(nodes, "human_1", { checkpoint: returned })))).toEqual(["end_2"]);
  });

  it("a THROWN escalation raise is caught and routed through onError", async () => {
    const runtime = createFakeNodeRuntime();
    runtime.escalations = { async raise() { throw new Error("queue gone"); }, async readEscalationStatus() { return null; } };
    const outcome = await executeNode(ctxFor(escalationNodes(), "human_1", { runtime }));
    expect(outcome.step.error?.code).toBe("WORKFLOW_HUMAN_TASK_FAILED");
  });
});

describe("Wait", () => {
  const waitNodes = (overrides: Partial<Extract<WorkflowNode, { kind: "Wait" }>> = {}): WorkflowNode[] => [
    triggerNode("wait_1"),
    { id: "wait_1", kind: "Wait", mode: "Timer", durationSeconds: 60, timeoutSeconds: 600, onTimeout: "Failed", next: "end_1", ...overrides } as WorkflowNode,
    endNode("end_1"),
  ];

  it("Timer mode suspends on a `timer:` ref whose instant is the DURATION, bounded by the TIMEOUT", async () => {
    const outcome = await executeNode(ctxFor(waitNodes(), "wait_1"));
    if (outcome.kind !== "Suspend") throw new Error("expected Suspend");
    const fireAt = new Date(outcome.suspension.ref.slice("timer:".length)).getTime();
    // The timer fires at ~duration; the run EXPIRES at ~timeout, which is later.
    expect(fireAt).toBeLessThan(outcome.suspension.expiresAt.getTime());
  });

  it("a duration LONGER than the timeout still expires at the timeout — a declared outer bound wins", async () => {
    const outcome = await executeNode(ctxFor(waitNodes({ durationSeconds: 5000, timeoutSeconds: 60 } as never), "wait_1"));
    if (outcome.kind !== "Suspend") throw new Error("expected Suspend");
    const fireAt = new Date(outcome.suspension.ref.slice("timer:".length)).getTime();
    expect(outcome.suspension.expiresAt.getTime()).toBeLessThan(fireAt);
  });

  it("ExternalEvent mode suspends on an `event:` ref (disclosed: nothing can satisfy it early)", async () => {
    const outcome = await executeNode(ctxFor(waitNodes({ mode: "ExternalEvent", eventKey: "payment.settled", durationSeconds: undefined } as never), "wait_1"));
    if (outcome.kind !== "Suspend") throw new Error("expected Suspend");
    expect(outcome.suspension.ref).toBe("event:payment.settled");
    expect(outcome.suspension.expiryOutcome).toBe("Failed");
  });

  it("RESUMES to `next` once the wait elapsed, instead of restarting the clock", async () => {
    const checkpoint = setResumeMarker(emptyCheckpoint(), "wait_1", 0, { waited: true });
    expect(successorIds(await executeNode(ctxFor(waitNodes(), "wait_1", { checkpoint })))).toEqual(["end_1"]);
  });
});

describe("Parallel / Join", () => {
  const parallelNodes: WorkflowNode[] = [
    triggerNode("par_1"),
    { id: "par_1", kind: "Parallel", branches: ["a_1", "b_1"], joinNodeId: "join_1" },
    { id: "a_1", kind: "Router", mode: "Rules", branches: [{ to: "join_1", when: "true" }], default: "join_1" },
    { id: "b_1", kind: "Router", mode: "Rules", branches: [{ to: "join_1", when: "true" }], default: "join_1" },
    { id: "join_1", kind: "Join", parallelNodeId: "par_1", mode: "All", next: "end_1" },
    endNode("end_1"),
  ];

  it("fans out one frontier entry per branch, keyed by the branch entry node id", async () => {
    const outcome = await executeNode(ctxFor(parallelNodes, "par_1"));
    if (outcome.kind !== "Advance") throw new Error("expected Advance");
    expect(outcome.successors.map((s) => [s.nodeId, s.branchKey])).toEqual([
      ["a_1", "a_1"],
      ["b_1", "b_1"],
    ]);
    // The barrier is initialized here, with the fan-out this node actually opened.
    expect(outcome.checkpoint.joinBarriers.join_1).toEqual({ expected: 2, arrived: [] });
  });

  it("re-initializes the barrier on re-entry, so a Parallel inside a Loop does not inherit stale arrivals", async () => {
    const stale = { ...emptyCheckpoint(), joinBarriers: { join_1: { expected: 2, arrived: ["a_1", "b_1"] } } };
    const outcome = await executeNode(ctxFor(parallelNodes, "par_1", { checkpoint: stale }));
    if (outcome.kind !== "Advance") throw new Error("expected Advance");
    expect(outcome.checkpoint.joinBarriers.join_1!.arrived).toEqual([]);
  });

  it("terminates at BudgetExceeded when the fan-out exceeds maxParallelBranches (run-time re-check of V6)", async () => {
    const ctx = ctxFor(parallelNodes, "par_1");
    const outcome = await executeNode({ ...ctx, limits: { ...ctx.limits, maxParallelBranches: 1 } });
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind !== "Terminate") return;
    expect(outcome.outcome).toBe("BudgetExceeded");
    expect(outcome.detail.reason).toBe("PARALLEL_BRANCHES_EXCEEDED");
  });

  it("a Join that is not yet satisfied consumes its frontier entry with NO successor", async () => {
    const checkpoint = { ...emptyCheckpoint(), joinBarriers: { join_1: { expected: 2, arrived: [] } } };
    const outcome = await executeNode(ctxFor(parallelNodes, "join_1", { checkpoint, entry: { nodeId: "join_1", branchKey: "a_1", iteration: 0 } }));
    if (outcome.kind !== "Advance") throw new Error("expected Advance");
    expect(outcome.successors).toEqual([]);
    expect((outcome.step.output as { released: boolean }).released).toBe(false);
  });

  it("a satisfied Join continues UNBRANCHED and clears its barrier", async () => {
    const checkpoint = { ...emptyCheckpoint(), joinBarriers: { join_1: { expected: 2, arrived: ["a_1"] } } };
    const outcome = await executeNode(ctxFor(parallelNodes, "join_1", { checkpoint, entry: { nodeId: "join_1", branchKey: "b_1", iteration: 0 } }));
    if (outcome.kind !== "Advance") throw new Error("expected Advance");
    expect(outcome.successors).toEqual([{ nodeId: "end_1", branchKey: null, iteration: 0 }]);
    expect(outcome.checkpoint.joinBarriers.join_1).toBeUndefined();
  });

  it("an `Any` join releases on the FIRST arrival; a `Quorum` join waits for its quorum", async () => {
    const anyNodes = parallelNodes.map((n) => (n.id === "join_1" ? { ...n, mode: "Any" as const } : n)) as WorkflowNode[];
    const anyOutcome = await executeNode(ctxFor(anyNodes, "join_1", { entry: { nodeId: "join_1", branchKey: "a_1", iteration: 0 } }));
    if (anyOutcome.kind !== "Advance") throw new Error("expected Advance");
    expect(anyOutcome.successors.map((s) => s.nodeId)).toEqual(["end_1"]);

    const quorumNodes = parallelNodes.map((n) => (n.id === "join_1" ? { ...n, mode: "Quorum" as const, quorum: 2 } : n)) as WorkflowNode[];
    const quorumOutcome = await executeNode(ctxFor(quorumNodes, "join_1", { entry: { nodeId: "join_1", branchKey: "a_1", iteration: 0 } }));
    if (quorumOutcome.kind !== "Advance") throw new Error("expected Advance");
    expect(quorumOutcome.successors).toEqual([]);
  });
});

describe("Loop", () => {
  const loopNodes = (overrides: Partial<Extract<WorkflowNode, { kind: "Loop" }>> = {}): WorkflowNode[] => [
    triggerNode("loop_1"),
    { id: "loop_1", kind: "Loop", maxIterations: 3, bodyEntryNodeId: "body_1", next: "end_1", ...overrides } as WorkflowNode,
    { id: "body_1", kind: "Router", mode: "Rules", branches: [{ to: "loop_1", when: "true" }], default: "loop_1" },
    endNode("end_1"),
  ];

  it("enters the body with an incremented iteration index", async () => {
    const outcome = await executeNode(ctxFor(loopNodes(), "loop_1"));
    if (outcome.kind !== "Advance") throw new Error("expected Advance");
    expect(outcome.successors).toEqual([{ nodeId: "body_1", branchKey: null, iteration: 1 }]);
    expect(outcome.checkpoint.loopCounters.loop_1).toBe(1);
  });

  it("EXITS to `next` (not a failure) once its own maxIterations is reached, and resets the counter", async () => {
    const checkpoint = { ...emptyCheckpoint(), loopCounters: { loop_1: 3 } };
    const outcome = await executeNode(ctxFor(loopNodes(), "loop_1", { checkpoint }));
    if (outcome.kind !== "Advance") throw new Error("expected Advance");
    expect(outcome.successors.map((s) => s.nodeId)).toEqual(["end_1"]);
    expect((outcome.step.output as { reason: string }).reason).toBe("max_iterations_reached");
    expect(outcome.checkpoint.loopCounters.loop_1).toBe(0);
  });

  it("binds `<nodeId>_item`/`<nodeId>_index` when iterating a collection, and exits when it is exhausted", async () => {
    const nodes = loopNodes({ over: "$.variables.items" } as never);
    const checkpoint = withVariables(emptyCheckpoint(), { items: ["a", "b"] });

    const first = await executeNode(ctxFor(nodes, "loop_1", { checkpoint }));
    if (first.kind !== "Advance") throw new Error("expected Advance");
    expect(first.checkpoint.variables.loop_1_item).toBe("a");
    expect(first.checkpoint.variables.loop_1_index).toBe(0);

    const exhausted = await executeNode(ctxFor(nodes, "loop_1", { checkpoint: { ...checkpoint, loopCounters: { loop_1: 2 } } }));
    if (exhausted.kind !== "Advance") throw new Error("expected Advance");
    expect((exhausted.step.output as { reason: string }).reason).toBe("collection_exhausted");
  });

  it("exits when `over` does not resolve to an array, rather than looping on nothing", async () => {
    const outcome = await executeNode(ctxFor(loopNodes({ over: "$.variables.missing" } as never), "loop_1"));
    expect((outcome.step.output as { reason: string }).reason).toBe("collection_unresolved");
  });

  it("exits when `whileCondition` is false", async () => {
    const nodes = loopNodes({ whileCondition: '$.variables.keep == "yes"' } as never);
    const outcome = await executeNode(ctxFor(nodes, "loop_1", { checkpoint: withVariables(emptyCheckpoint(), { keep: "no" }) }));
    expect((outcome.step.output as { reason: string }).reason).toBe("condition_false");
  });

  it("is clamped by the RUN-WIDE maxLoopIterations even when the node's own cap is higher", async () => {
    const ctx = ctxFor(loopNodes({ maxIterations: 1000 } as never), "loop_1", { checkpoint: { ...emptyCheckpoint(), loopCounters: { loop_1: 10 } } });
    const outcome = await executeNode({ ...ctx, limits: { ...ctx.limits, maxLoopIterations: 10 } });
    expect((outcome.step.output as { reason: string }).reason).toBe("max_iterations_reached");
  });
});

describe("SubWorkflow", () => {
  const subNodes: WorkflowNode[] = [
    triggerNode("sub_1"),
    { id: "sub_1", kind: "SubWorkflow", workflowVersionId: SUB_VERSION_ID, inputMapping: { order: "$.variables.orderId" }, outputVariable: "child_out", next: "end_1" },
    endNode("end_1"),
  ];

  it("asks for a child run with the mapped input, and declares a bounded suspension", async () => {
    const checkpoint = withVariables(emptyCheckpoint(), { orderId: "ORD-9" });
    const outcome = await executeNode(ctxFor(subNodes, "sub_1", { checkpoint }));
    expect(outcome.kind).toBe("SpawnChild");
    if (outcome.kind !== "SpawnChild") return;
    expect(outcome.child.workflowVersionId).toBe(SUB_VERSION_ID);
    expect(outcome.child.input).toEqual({ order: "ORD-9" });
    expect(outcome.suspensionExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(outcome.suspensionExpiryOutcome).toBe("Timeout");
    expect(outcome.step.refKind).toBe("WorkflowVersion");
  });

  it("terminates at BudgetExceeded when the child would exceed maxSubWorkflowDepth", async () => {
    const ctx = ctxFor(subNodes, "sub_1", { depth: 3 });
    const outcome = await executeNode({ ...ctx, limits: { ...ctx.limits, maxSubWorkflowDepth: 3 } });
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind !== "Terminate") return;
    expect(outcome.outcome).toBe("BudgetExceeded");
    expect(outcome.detail.reason).toBe("SUBWORKFLOW_DEPTH_EXCEEDED");
  });

  it("RESUMES by folding a SUCCEEDED child's variables into outputVariable — never spawning a second child", async () => {
    const checkpoint = setResumeMarker(emptyCheckpoint(), "sub_1", 0, { runId: "child-1", state: "Succeeded", outcome: "Resolved", variables: { total: 42 } });
    const outcome = await executeNode(ctxFor(subNodes, "sub_1", { checkpoint }));
    expect(successorIds(outcome)).toEqual(["end_1"]);
    if (outcome.kind !== "Advance") return;
    expect(outcome.checkpoint.variables.child_out).toEqual({ total: 42 });
    expect(outcome.step.childRunId).toBe("child-1");
  });

  it("routes a FAILED child through the node's onError", async () => {
    const checkpoint = setResumeMarker(emptyCheckpoint(), "sub_1", 0, { runId: "child-1", state: "Failed", outcome: "Failed", variables: {} });
    const outcome = await executeNode(ctxFor(subNodes, "sub_1", { checkpoint }));
    expect(outcome.kind).toBe("Terminate");
    if (outcome.kind === "Terminate") expect(outcome.step.error?.code).toBe("WORKFLOW_SUBWORKFLOW_FAILED");
  });
});
