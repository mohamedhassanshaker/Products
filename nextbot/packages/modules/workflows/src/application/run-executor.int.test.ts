import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, type TenantContext } from "@nextbot/db";
import type { WorkflowNode } from "@nextbot/contracts";
import { executeRun, newWorkerInstanceId } from "./run-executor.js";
import { pumpWorkflowRuns, reconcileSuspendedRuns, sweepWorkflowSuspensionExpiry } from "./run-pump.js";
import { startWorkflowRun } from "./run-service.js";
import { findWorkflowRunById, listWorkflowRunSteps, type WorkflowRunRow } from "../infrastructure/workflow-run-repository.js";
import {
  activateTenant,
  createFakeNodeRuntime,
  createFixtureConversation,
  createFixtureWorkflowVersion,
  endNode,
  toolCallNode,
  triggerNode,
  TEST_RUN_LIMITS,
  type FakeNodeRuntime,
} from "../testing/run-fixtures.js";
import { createFixtureMcpServerVersion, createFixtureTool } from "../testing/workflow-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-01/04/05/06/07, LLD §14.6.2) —
 * real (not mocked) integration coverage for the executor against real Postgres.
 *
 * The DATABASE is real throughout: real `workflow_version` rows saved through the module's
 * own V1-V12 validator, real `workflow_run`/`workflow_run_step`/`workflow_run_lease`
 * rows, real RLS, real CHECK constraints, real optimistic concurrency. Only the NODE
 * RUNTIME is scripted — the same port-with-a-real-production-implementation shape
 * `@nextbot/teams` established, so the executor's own frontier/checkpoint/budget/
 * compensation logic can be driven deterministically without a model provider.
 */

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function freshTenant(): Promise<TenantContext> {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  await activateTenant(ctx);
  return ctx;
}

/** Drives the run to completion the way the real 5s pump would, but synchronously and
 *  with a bounded tick count so a stuck run fails the test instead of hanging it. */
async function driveToCompletion(ctx: TenantContext, runtime: FakeNodeRuntime, runId: string, maxTicks = 12): Promise<WorkflowRunRow> {
  const owner = newWorkerInstanceId();
  for (let tick = 0; tick < maxTicks; tick += 1) {
    // `tenantIds` scopes the sweep to THIS suite's tenant. Without it, a cross-tenant
    // pump would claim and advance runs belonging to a concurrently-running suite using
    // this suite's scripted runtime — non-deterministic, and genuinely wrong.
    await pumpWorkflowRuns({ runtimeFor: () => runtime, owner, tenantIds: [ctx.tenantId] });
    const run = await findWorkflowRunById(ctx, runId);
    if (run && ["Succeeded", "Failed", "TimedOut", "Cancelled", "Suspended"].includes(run.state)) return run;
  }
  return (await findWorkflowRunById(ctx, runId))!;
}

async function startRun(ctx: TenantContext, versionId: string, extra: { conversationId?: string; input?: Record<string, never> } = {}) {
  const { run } = await startWorkflowRun(ctx, {
    workflowVersionId: versionId,
    triggerKind: "Sandbox",
    idempotencyKey: generateId(),
    ...(extra.conversationId ? { conversationId: extra.conversationId } : {}),
    ...(extra.input ? { input: extra.input } : {}),
  });
  return run;
}

// ---------------------------------------------------------------------------

describe("the happy path — Trigger -> End", () => {
  it("runs to Succeeded/Resolved and writes one step per executed node", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const version = await createFixtureWorkflowVersion(ctx, "wf_happy", [triggerNode("end_1"), endNode("end_1")]);
    const run = await startRun(ctx, version.id);

    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.state).toBe("Succeeded");
    expect(final.outcome).toBe("Resolved");
    expect(final.endedAt).not.toBeNull();
    // The frontier is emptied on termination, so the run is not re-claimed forever.
    expect(final.currentNodeIds).toEqual([]);

    const steps = await listWorkflowRunSteps(ctx, run.id);
    expect(steps.map((s) => s.nodeId)).toEqual(["trigger_1", "end_1"]);
    expect(steps.every((s) => s.status === "Succeeded")).toBe(true);
    // FR-WF-07: `node_kind` is stamped so the trace renders over the authored graph
    // without re-parsing `graph_json` per step.
    expect(steps.map((s) => s.nodeKind)).toEqual(["Trigger", "End"]);
  });

  it("is idempotent on the run's own idempotency key — a redelivered start resumes, never duplicates", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_idem", [triggerNode("end_1"), endNode("end_1")]);
    const key = generateId();

    const first = await startWorkflowRun(ctx, { workflowVersionId: version.id, triggerKind: "Webhook", idempotencyKey: key });
    const second = await startWorkflowRun(ctx, { workflowVersionId: version.id, triggerKind: "Webhook", idempotencyKey: key });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
  });
});

describe("Router — Rules mode", () => {
  it("takes the first branch whose `when` is true, in AUTHORED order", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("router_1"),
      {
        id: "router_1",
        kind: "Router",
        mode: "Rules",
        branches: [
          { to: "end_gold", when: '$.variables.tier == "gold"' },
          { to: "end_any", when: "true" },
        ],
        default: "end_default",
      },
      endNode("end_gold"),
      endNode("end_any", "Transferred"),
      endNode("end_default", "Failed"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_router_rules", nodes);
    const run = await startRun(ctx, version.id, { input: { tier: "gold" } as never });

    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.outcome).toBe("Resolved");
    const router = (await listWorkflowRunSteps(ctx, run.id)).find((s) => s.nodeId === "router_1")!;
    expect((router.output as { selected: string }).selected).toBe("end_gold");
  });

  it("falls through to the REQUIRED default when no branch matches — never a dead end", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("router_1"),
      { id: "router_1", kind: "Router", mode: "Rules", branches: [{ to: "end_gold", when: '$.variables.tier == "gold"' }], default: "end_default" },
      endNode("end_gold"),
      endNode("end_default", "Transferred"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_router_default", nodes);
    const run = await startRun(ctx, version.id, { input: { tier: "bronze" } as never });

    expect((await driveToCompletion(ctx, runtime, run.id)).outcome).toBe("Transferred");
  });

  it("an UNPARSEABLE condition fails closed to the default rather than taking the branch or crashing the tick", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("router_1"),
      { id: "router_1", kind: "Router", mode: "Rules", branches: [{ to: "end_bad", when: "constructor.constructor('return 1')()" }], default: "end_default" },
      endNode("end_bad"),
      endNode("end_default", "Transferred"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_router_hostile", nodes);
    const run = await startRun(ctx, version.id);

    expect((await driveToCompletion(ctx, runtime, run.id)).outcome).toBe("Transferred");
  });
});

describe("ToolCall — dispatch, output binding, and FR-WF-04 compensation", () => {
  it("binds the tool's output to the node's declared outputVariable and records a masked step", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const toolId = await createFixtureTool(ctx, "lookup_order", "Read");
    const serverVersionId = await createFixtureMcpServerVersion(ctx, "srv_lookup");
    const nodes = [triggerNode("tool_1"), toolCallNode("tool_1", toolId, serverVersionId, "end_1"), endNode("end_1")];
    const version = await createFixtureWorkflowVersion(ctx, "wf_tool_ok", nodes);
    const run = await startRun(ctx, version.id);

    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.state).toBe("Succeeded");
    expect(runtime.dispatches).toHaveLength(1);

    const step = (await listWorkflowRunSteps(ctx, run.id)).find((s) => s.nodeId === "tool_1")!;
    expect(step.refKind).toBe("Tool");
    expect(step.refVersionId).toBe(toolId);
    expect(step.output).toEqual({ ok: true, toolId });
  });

  it("pushes a compensation entry only for a WRITE-classified tool, and unwinds it on a later failure", async () => {
    const ctx = await freshTenant();
    const writeToolId = await createFixtureTool(ctx, "issue_refund", "Write");
    const failToolId = await createFixtureTool(ctx, "notify_customer", "Read");
    const compensateToolId = await createFixtureTool(ctx, "reverse_refund", "Write");
    const serverVersionId = await createFixtureMcpServerVersion(ctx, "srv_wf");

    const runtime = createFakeNodeRuntime();
    runtime.rwClasses.set(writeToolId, "Write");

    const nodes: WorkflowNode[] = [
      triggerNode("write_1"),
      toolCallNode("write_1", writeToolId, serverVersionId, "fail_1", {
        idempotency: { strategy: "RunScopedUuid" },
        compensation: { toolId: compensateToolId, argMapping: {} },
      }),
      // This node fails and declares `compensate`, which is what enters the unwind.
      toolCallNode("fail_1", failToolId, serverVersionId, "end_1", { onError: "compensate" } as never),
      endNode("end_1"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_compensate", nodes);
    const run = await startRun(ctx, version.id);

    // Make the SECOND dispatch (the `fail_1` node) fail.
    const originalDispatch = runtime.tools.dispatch.bind(runtime.tools);
    runtime.tools.dispatch = async (input) => {
      if (input.toolId === failToolId) return { kind: "Failed", errorMessage: "downstream 503", retriable: false };
      return originalDispatch(input);
    };

    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.state).toBe("Failed");
    expect((final.outcomeDetail as { compensated?: boolean }).compensated).toBe(true);

    const steps = await listWorkflowRunSteps(ctx, run.id);
    const compensated = steps.filter((s) => s.status === "Compensated");
    expect(compensated).toHaveLength(1);
    expect(compensated[0]!.refVersionId).toBe(compensateToolId);
    // A compensating step is a NEW row (NFR-10) — the original write step is untouched.
    expect(steps.find((s) => s.nodeId === "write_1" && s.iteration === 0)!.status).toBe("Succeeded");
    // Its `iteration: -1` keeps it out of the forward attempts' unique key.
    expect(compensated[0]!.iteration).toBe(-1);
  });

  it("a node with `onError: continue` records the failure and proceeds — the run still reaches its End", async () => {
    const ctx = await freshTenant();
    const toolId = await createFixtureTool(ctx, "optional_ping", "Read");
    const serverVersionId = await createFixtureMcpServerVersion(ctx, "srv_opt");
    const runtime = createFakeNodeRuntime();
    runtime.tools.dispatch = async () => ({ kind: "Failed", errorMessage: "flaky", retriable: true });

    const nodes = [triggerNode("tool_1"), toolCallNode("tool_1", toolId, serverVersionId, "end_1", { onError: "continue" } as never), endNode("end_1")];
    const version = await createFixtureWorkflowVersion(ctx, "wf_continue", nodes);
    const run = await startRun(ctx, version.id);

    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.state).toBe("Succeeded");
    const step = (await listWorkflowRunSteps(ctx, run.id)).find((s) => s.nodeId === "tool_1")!;
    expect(step.status).toBe("Failed");
    expect(step.error?.code).toBe("WORKFLOW_TOOL_FAILED");
  });
});

describe("run-level budgets (FR-WF-06) — logged DISTINCTLY from a node-level Failed", () => {
  it("terminates at BudgetExceeded when the step ceiling is reached, naming the ceiling in outcome_detail", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("loop_1"),
      { id: "loop_1", kind: "Loop", maxIterations: 50, bodyEntryNodeId: "body_1", next: "end_1" },
      { id: "body_1", kind: "Router", mode: "Rules", branches: [{ to: "loop_1", when: "true" }], default: "loop_1" },
      endNode("end_1"),
    ];
    // `maxSteps: 4` is hit long before the loop's own 50-iteration cap.
    const version = await createFixtureWorkflowVersion(ctx, "wf_budget_steps", nodes, { maxSteps: 4 });
    const run = await startRun(ctx, version.id);

    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.state).toBe("Failed");
    expect(final.outcome).toBe("BudgetExceeded");
    expect((final.outcomeDetail as { reason: string }).reason).toBe("STEP_BUDGET_EXCEEDED");
    expect((final.outcomeDetail as { limit: number }).limit).toBe(4);
  });

  it("a Loop reaching its OWN maxIterations exits normally to `next` — that is not a budget failure", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("loop_1"),
      { id: "loop_1", kind: "Loop", maxIterations: 2, bodyEntryNodeId: "body_1", next: "end_1" },
      { id: "body_1", kind: "Router", mode: "Rules", branches: [{ to: "loop_1", when: "true" }], default: "loop_1" },
      endNode("end_1"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_loop_cap", nodes, { maxSteps: 40 });
    const run = await startRun(ctx, version.id);

    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.state).toBe("Succeeded");
    expect(final.outcome).toBe("Resolved");

    const loopSteps = (await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "loop_1");
    expect((loopSteps.at(-1)!.output as { exited: boolean; reason: string })).toMatchObject({ exited: true, reason: "max_iterations_reached" });
  });
});

describe("Parallel / Join", () => {
  it("fans out, records each branch's arrival durably, and releases the Join exactly once", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("par_1"),
      { id: "par_1", kind: "Parallel", branches: ["left_1", "right_1"], joinNodeId: "join_1" },
      { id: "left_1", kind: "Router", mode: "Rules", branches: [{ to: "join_1", when: "true" }], default: "join_1" },
      { id: "right_1", kind: "Router", mode: "Rules", branches: [{ to: "join_1", when: "true" }], default: "join_1" },
      { id: "join_1", kind: "Join", parallelNodeId: "par_1", mode: "All", next: "end_1" },
      endNode("end_1"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_parallel", nodes);
    const run = await startRun(ctx, version.id);

    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.state).toBe("Succeeded");

    const joinSteps = (await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "join_1");
    // One arrival per branch; exactly one of them released.
    expect(joinSteps).toHaveLength(2);
    expect(joinSteps.filter((s) => (s.output as { released: boolean }).released)).toHaveLength(1);
    // Downstream of the join the run is ONE path again, not one per arrived branch.
    expect((await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "end_1")).toHaveLength(1);
  });

  it("maxParallelBranches is enforced at SAVE time by V6, so the run-time re-check is unreachable through the normal path — by design", async () => {
    const ctx = await freshTenant();
    const nodes: WorkflowNode[] = [
      triggerNode("par_1"),
      { id: "par_1", kind: "Parallel", branches: ["a_1", "b_1"], joinNodeId: "join_1" },
      { id: "a_1", kind: "Router", mode: "Rules", branches: [{ to: "join_1", when: "true" }], default: "join_1" },
      { id: "b_1", kind: "Router", mode: "Rules", branches: [{ to: "join_1", when: "true" }], default: "join_1" },
      { id: "join_1", kind: "Join", parallelNodeId: "par_1", mode: "All", next: "end_1" },
      endNode("end_1"),
    ];

    // A graph whose fan-out exceeds its own `maxParallelBranches` cannot be SAVED (V6),
    // so no run of it can ever exist. That is the correct primary enforcement, and it is
    // asserted here so the layering stays honest.
    await expect(createFixtureWorkflowVersion(ctx, "wf_parallel_budget", nodes, { maxParallelBranches: 1 })).rejects.toThrow(/maxParallelBranches/);

    // `executeParallel`'s own run-time re-check is therefore DEFENSE IN DEPTH for a
    // graph that somehow reached the executor without passing V6 — the same
    // "static check plus run-time re-check" shape this codebase applies at the egress
    // PEP re-check and at `runTierEngine`'s capability-group re-derivation. It is
    // exercised directly at the unit level (`domain/run-budget.test.ts`), which is the
    // only honest way to reach a branch the save path structurally prevents.
    const { checkParallelBudget } = await import("../domain/run-budget.js");
    expect(checkParallelBudget({ ...TEST_RUN_LIMITS, maxParallelBranches: 1 }, 2)).toEqual({
      ok: false,
      reason: "PARALLEL_BRANCHES_EXCEEDED",
      limit: 1,
      observed: 2,
    });
  });
});

describe("suspension and resume (FR-WF-05)", () => {
  it("a Wait/Timer node suspends with a DECLARED deadline and outcome, then resumes once the timer passes", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("wait_1"),
      { id: "wait_1", kind: "Wait", mode: "Timer", durationSeconds: 1, timeoutSeconds: 3600, onTimeout: "Failed", next: "end_1" },
      endNode("end_1"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_wait", nodes);
    const run = await startRun(ctx, version.id);

    const suspended = await driveToCompletion(ctx, runtime, run.id);
    expect(suspended.state).toBe("Suspended");
    expect(suspended.suspensionKind).toBe("Wait");
    expect(suspended.suspensionRef).toMatch(/^timer:/);
    // FR-WF-05: no suspension is indefinite, and its expiry behaviour is DECLARED.
    expect(suspended.suspensionExpiresAt).not.toBeNull();
    expect(suspended.suspensionExpiryOutcome).toBe("Failed");

    // Before the timer fires, reconciliation is a no-op.
    expect(await reconcileSuspendedRuns(ctx, runtime)).toBe(0);

    // Rewind the timer into the past — the deterministic equivalent of waiting 1s.
    const { withTenant, schema } = await import("@nextbot/db");
    const { eq } = await import("drizzle-orm");
    await withTenant(ctx, (db) => db.update(schema.workflowRun).set({ suspensionRef: `timer:${new Date(Date.now() - 1000).toISOString()}` }).where(eq(schema.workflowRun.id, run.id)));

    expect(await reconcileSuspendedRuns(ctx, runtime)).toBe(1);
    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.state).toBe("Succeeded");

    // The step written when the node suspended is closed out, not left pending forever.
    const waitSteps = (await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "wait_1");
    expect(waitSteps.every((s) => s.status !== "Suspended")).toBe(true);
  });

  it("a suspension past its deadline transitions to its DECLARED onTimeout outcome, never lingering", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("wait_1"),
      { id: "wait_1", kind: "Wait", mode: "ExternalEvent", eventKey: "payment.settled", timeoutSeconds: 60, onTimeout: "Transferred", next: "end_1" },
      endNode("end_1"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_wait_expiry", nodes);
    const run = await startRun(ctx, version.id);

    const suspended = await driveToCompletion(ctx, runtime, run.id);
    expect(suspended.state).toBe("Suspended");

    // Sweep with an `asOf` past the deadline rather than sleeping 60s.
    const result = await sweepWorkflowSuspensionExpiry(() => runtime, new Date(Date.now() + 120_000), [ctx.tenantId]);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const final = await findWorkflowRunById(ctx, run.id);
    expect(final?.outcome).toBe("Transferred");
    expect(final?.state).toBe("Succeeded"); // Transferred is a successful completion of the authored graph.
    expect((final?.outcomeDetail as { reason: string }).reason).toBe("SUSPENSION_EXPIRED");
    // The suspension fields are cleared, satisfying `workflow_run_suspension_consistent`.
    expect(final?.suspensionKind).toBeNull();
  });

  it("a HumanTask targeting the Approval Queue fails LOUDLY with its own code (disclosed Phase 16 narrowing)", async () => {
    const ctx = await freshTenant();
    const conversationId = await createFixtureConversation(ctx);
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("human_1"),
      { id: "human_1", kind: "HumanTask", queue: "ApprovalQueue", approvalTier: "Tier3", prompt: "approve this", timeoutSeconds: 3600, onTimeout: "Failed", next: "end_1" },
      endNode("end_1"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_human_approval", nodes);
    const run = await startRun(ctx, version.id, { conversationId });

    const final = await driveToCompletion(ctx, runtime, run.id);
    expect(final.state).toBe("Failed");
    const step = (await listWorkflowRunSteps(ctx, run.id)).find((s) => s.nodeId === "human_1")!;
    // Never silently skipped: the refusal is a first-class, greppable error code.
    expect(step.error?.code).toBe("WORKFLOW_HUMAN_TASK_APPROVAL_QUEUE_UNSUPPORTED");
  });

  it("a HumanTask targeting the Escalation Queue raises a real escalation, suspends, and resumes when a human closes it", async () => {
    const ctx = await freshTenant();
    const conversationId = await createFixtureConversation(ctx);
    const { createFixtureAgentQueue } = await import("../testing/workflow-fixtures.js");
    const queueId = await createFixtureAgentQueue(ctx, "billing_queue");
    const runtime = createFakeNodeRuntime();

    const nodes: WorkflowNode[] = [
      triggerNode("human_1"),
      { id: "human_1", kind: "HumanTask", queue: "EscalationQueue", escalationQueueId: queueId, prompt: "please review", timeoutSeconds: 3600, onTimeout: "Failed", next: "end_1" },
      endNode("end_1"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_human_escalation", nodes);
    const run = await startRun(ctx, version.id, { conversationId });

    const suspended = await driveToCompletion(ctx, runtime, run.id);
    expect(suspended.state).toBe("Suspended");
    expect(suspended.suspensionKind).toBe("HumanTask");
    expect(suspended.suspensionRef).toMatch(/^escalation:/);

    const escalationId = runtime.raisedEscalations[0]!;
    const step = (await listWorkflowRunSteps(ctx, run.id)).find((s) => s.nodeId === "human_1")!;
    expect(step.escalationId).toBe(escalationId);

    // Still waiting on the human — reconciliation is a no-op.
    expect(await reconcileSuspendedRuns(ctx, runtime)).toBe(0);

    runtime.escalationStatuses.set(escalationId, "Resolved");
    expect(await reconcileSuspendedRuns(ctx, runtime)).toBe(1);
    expect((await driveToCompletion(ctx, runtime, run.id)).state).toBe("Succeeded");
  });
});

describe("cancel", () => {
  it("terminates a live run at Cancelled and clears its suspension fields", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const nodes: WorkflowNode[] = [
      triggerNode("wait_1"),
      { id: "wait_1", kind: "Wait", mode: "Timer", durationSeconds: 600, timeoutSeconds: 3600, onTimeout: "Failed", next: "end_1" },
      endNode("end_1"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_cancel", nodes);
    const run = await startRun(ctx, version.id);
    await driveToCompletion(ctx, runtime, run.id);

    const { cancelRun } = await import("./run-service.js");
    const cancelled = await cancelRun(ctx, run.id, "operator stopped it", "00000000-0000-4000-8000-000000000009");
    expect(cancelled.state).toBe("Cancelled");
    expect(cancelled.outcome).toBe("Cancelled");
    expect(cancelled.suspensionKind).toBeNull();

    // A second cancel is a clean rejection, not a second terminal write.
    await expect(cancelRun(ctx, run.id, undefined, "00000000-0000-4000-8000-000000000009")).rejects.toThrow(/cannot be cancelled/);
  });
});

describe("executor pass mechanics", () => {
  it("a losing claimer no-ops rather than advancing a run another executor holds", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const version = await createFixtureWorkflowVersion(ctx, "wf_lease_noop", [triggerNode("end_1"), endNode("end_1")]);
    const run = await startRun(ctx, version.id);

    const holder = newWorkerInstanceId();
    const { acquireRunLease } = await import("../infrastructure/workflow-run-lease-repository.js");
    expect(await acquireRunLease(ctx, run.id, holder, run.checkpointSeq)).toBe(true);

    const loser = await executeRun(ctx, { runtime, owner: newWorkerInstanceId() }, run);
    expect(loser.claimed).toBe(false);
    expect(loser.nodesExecuted).toBe(0);
    expect((await findWorkflowRunById(ctx, run.id))!.state).toBe("Pending");
  });
});
