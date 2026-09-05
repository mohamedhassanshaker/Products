import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, type TenantContext } from "@nextbot/db";
import type { WorkflowNode } from "@nextbot/contracts";
import { newWorkerInstanceId } from "./run-executor.js";
import { pumpWorkflowRuns } from "./run-pump.js";
import { startWorkflowRun } from "./run-service.js";
import { findWorkflowRunById, listWorkflowRuns, listWorkflowRunSteps } from "../infrastructure/workflow-run-repository.js";
import { activateTenant, createFakeNodeRuntime, createFixtureWorkflowVersion, endNode, triggerNode, type FakeNodeRuntime } from "../testing/run-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2/§14.6.3) — `SubWorkflow`
 * nodes end to end, against real Postgres.
 *
 * A sub-workflow is deliberately NOT a special kind of execution: it is a real
 * `workflow_run` with a `parent_run_id` and `trigger_kind = 'SubWorkflow'`, claimed and
 * advanced by the same pump as any other run. This suite proves that — including the two
 * properties that make it safe: the parent's spawn is idempotent under re-execution
 * (a crash must not fork a second child), and the parent's wake-up is idempotent under
 * the two independent paths that can trigger it (the child's own terminal write, and the
 * reconciling sweep).
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

async function tick(ctx: TenantContext, runtime: FakeNodeRuntime, owner = newWorkerInstanceId()): Promise<void> {
  await pumpWorkflowRuns({ runtimeFor: () => runtime, owner, tenantIds: [ctx.tenantId] });
}

/** A child graph whose Router writes a distinguishable variable, so the parent can be
 *  asserted to have received the CHILD's data rather than its own. */
function childNodes(): WorkflowNode[] {
  return [
    triggerNode("child_router"),
    { id: "child_router", kind: "Router", mode: "Rules", branches: [{ to: "child_end", when: "true" }], default: "child_end" },
    endNode("child_end"),
  ];
}

function parentNodes(childVersionId: string, overrides: Partial<Extract<WorkflowNode, { kind: "SubWorkflow" }>> = {}): WorkflowNode[] {
  return [
    triggerNode("sub_1"),
    { id: "sub_1", kind: "SubWorkflow", workflowVersionId: childVersionId, inputMapping: { seed: "$.variables.seed" }, outputVariable: "child_out", next: "end_1", ...overrides } as WorkflowNode,
    endNode("end_1"),
  ];
}

describe("a SubWorkflow node spawns a real child run and suspends the parent on it", () => {
  it("the child is a real run with parent_run_id and depth+1, and the parent waits on it", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const child = await createFixtureWorkflowVersion(ctx, "wf_sub_child", childNodes());
    const parent = await createFixtureWorkflowVersion(ctx, "wf_sub_parent", parentNodes(child.id));

    const { run } = await startWorkflowRun(ctx, {
      workflowVersionId: parent.id,
      triggerKind: "Sandbox",
      idempotencyKey: generateId(),
      input: { seed: "from-parent" },
    });

    // Two ticks: seed the frontier + Trigger, then execute the SubWorkflow node.
    await tick(ctx, runtime);

    const suspended = (await findWorkflowRunById(ctx, run.id))!;
    expect(suspended.state).toBe("Suspended");
    expect(suspended.suspensionKind).toBe("SubWorkflow");
    expect(suspended.suspensionRef).toMatch(/^workflow_run:/);
    // FR-WF-05 again: waiting on a child is bounded, exactly like waiting on a human.
    expect(suspended.suspensionExpiresAt).not.toBeNull();
    expect(suspended.suspensionExpiryOutcome).toBe("Timeout");

    const childRunId = suspended.suspensionRef!.slice("workflow_run:".length);
    const childRun = (await findWorkflowRunById(ctx, childRunId))!;
    expect(childRun.parentRunId).toBe(run.id);
    expect(childRun.depth).toBe(1);
    expect(childRun.triggerKind).toBe("SubWorkflow");
    // The mapped input became the child's seed variables.
    expect((childRun.checkpointJson as { variables: Record<string, unknown> }).variables).toMatchObject({ seed: "from-parent" });

    // The parent's step records the correlation, so the trace links the two runs.
    const step = (await listWorkflowRunSteps(ctx, run.id)).find((s) => s.nodeId === "sub_1")!;
    expect(step.childRunId).toBe(childRunId);
    expect(step.refKind).toBe("WorkflowVersion");
  });

  it("the child runs to completion and the PARENT resumes with the child's variables bound to outputVariable", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const child = await createFixtureWorkflowVersion(ctx, "wf_sub2_child", childNodes());
    const parent = await createFixtureWorkflowVersion(ctx, "wf_sub2_parent", parentNodes(child.id));

    const { run } = await startWorkflowRun(ctx, { workflowVersionId: parent.id, triggerKind: "Sandbox", idempotencyKey: generateId(), input: { seed: "s" } });

    for (let i = 0; i < 8; i += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (current && ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(current.state)) break;
      await tick(ctx, runtime);
    }

    const final = (await findWorkflowRunById(ctx, run.id))!;
    expect(final.state).toBe("Succeeded");
    expect(final.outcome).toBe("Resolved");
    // The child's own variables reached the parent's declared output variable.
    expect((final.checkpointJson as { variables: Record<string, unknown> }).variables.child_out).toMatchObject({ seed: "s" });

    // Exactly ONE child was created for the whole run — a re-executed SubWorkflow node
    // resumes the same child rather than forking a second.
    const children = (await listWorkflowRuns(ctx, { limit: 50 })).filter((r) => r.parentRunId === run.id);
    expect(children).toHaveLength(1);
    expect(children[0]!.state).toBe("Succeeded");

    // And the parent executed its SubWorkflow node twice (spawn, then resume) without
    // ever writing a duplicate spawn.
    const subSteps = (await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "sub_1");
    expect(subSteps.map((s) => s.status)).toEqual(["Suspended", "Succeeded"]);
  });

  it("a FAILED child fails the parent's node through its declared onError", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    // A child whose only path ends at `Failed`.
    const child = await createFixtureWorkflowVersion(ctx, "wf_sub3_child", [triggerNode("child_end"), endNode("child_end", "Failed")]);
    const parent = await createFixtureWorkflowVersion(ctx, "wf_sub3_parent", parentNodes(child.id));

    const { run } = await startWorkflowRun(ctx, { workflowVersionId: parent.id, triggerKind: "Sandbox", idempotencyKey: generateId() });
    for (let i = 0; i < 8; i += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (current && ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(current.state)) break;
      await tick(ctx, runtime);
    }

    const final = (await findWorkflowRunById(ctx, run.id))!;
    expect(final.state).toBe("Failed");
    const step = (await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "sub_1").at(-1)!;
    expect(step.error?.code).toBe("WORKFLOW_SUBWORKFLOW_FAILED");
  });

  it("a child that continues to `next` lets the parent proceed past the SubWorkflow node with onError: continue", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const child = await createFixtureWorkflowVersion(ctx, "wf_sub4_child", [triggerNode("child_end"), endNode("child_end", "Failed")]);
    const parent = await createFixtureWorkflowVersion(ctx, "wf_sub4_parent", parentNodes(child.id, { onError: "continue" } as never));

    const { run } = await startWorkflowRun(ctx, { workflowVersionId: parent.id, triggerKind: "Sandbox", idempotencyKey: generateId() });
    for (let i = 0; i < 8; i += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (current && ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(current.state)) break;
      await tick(ctx, runtime);
    }
    expect((await findWorkflowRunById(ctx, run.id))!.state).toBe("Succeeded");
  });
});

describe("depth", () => {
  it("a grandchild reaches depth 2, and the chain is bounded by maxSubWorkflowDepth", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();

    const grandchild = await createFixtureWorkflowVersion(ctx, "wf_depth_gc", childNodes());
    const middle = await createFixtureWorkflowVersion(ctx, "wf_depth_mid", parentNodes(grandchild.id), { maxSubWorkflowDepth: 3 });
    const top = await createFixtureWorkflowVersion(ctx, "wf_depth_top", parentNodes(middle.id), { maxSubWorkflowDepth: 3 });

    const { run } = await startWorkflowRun(ctx, { workflowVersionId: top.id, triggerKind: "Sandbox", idempotencyKey: generateId() });
    for (let i = 0; i < 14; i += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (current && ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(current.state)) break;
      await tick(ctx, runtime);
    }

    expect((await findWorkflowRunById(ctx, run.id))!.state).toBe("Succeeded");
    const all = await listWorkflowRuns(ctx, { limit: 50 });
    expect(all.map((r) => r.depth).sort()).toEqual([0, 1, 2]);
  });

  it("maxSubWorkflowDepth is enforced at SAVE time by V8, so no run of an over-deep chain can exist", async () => {
    const ctx = await freshTenant();
    const child = await createFixtureWorkflowVersion(ctx, "wf_depth0_child", childNodes());

    // `maxSubWorkflowDepth: 0` forbids any child at all, and V8 resolves the chain
    // statically through the pinned version — so the graph cannot be SAVED, and no run
    // of it can ever reach the executor. That is the correct primary enforcement.
    await expect(createFixtureWorkflowVersion(ctx, "wf_depth0_parent", parentNodes(child.id), { maxSubWorkflowDepth: 0 })).rejects.toThrow(
      /Sub-workflow nesting depth/,
    );

    // The executor's own run-time re-check is DEFENSE IN DEPTH behind that — the same
    // "static check plus run-time re-check" shape this codebase applies at the egress PEP
    // re-check. It is exercised directly (`node-executors.test.ts`, `run-budget.test.ts`),
    // which is the only honest way to reach a branch the save path structurally prevents,
    // and it is what keeps `workflow_run.depth`'s own 0..8 DB CHECK from ever being the
    // thing that surfaces the problem.
    const { checkSubWorkflowDepth } = await import("../domain/run-budget.js");
    const { TEST_RUN_LIMITS } = await import("../testing/run-fixtures.js");
    expect(checkSubWorkflowDepth({ ...TEST_RUN_LIMITS, maxSubWorkflowDepth: 0 }, 1)).toEqual({
      ok: false,
      reason: "SUBWORKFLOW_DEPTH_EXCEEDED",
      limit: 0,
      observed: 1,
    });
  });
});

describe("the parent's wake-up is idempotent across BOTH paths that can trigger it", () => {
  it("the child's own terminal write and the reconciling sweep converge on one resume", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const child = await createFixtureWorkflowVersion(ctx, "wf_sub_idem_child", childNodes());
    const parent = await createFixtureWorkflowVersion(ctx, "wf_sub_idem_parent", parentNodes(child.id));

    const { run } = await startWorkflowRun(ctx, { workflowVersionId: parent.id, triggerKind: "Sandbox", idempotencyKey: generateId() });
    await tick(ctx, runtime); // parent suspends on the child

    const suspended = (await findWorkflowRunById(ctx, run.id))!;
    const childRunId = suspended.suspensionRef!.slice("workflow_run:".length);

    // Drive the CHILD to completion. Its terminal write wakes the parent directly (the
    // optimization), and the very next tick's reconciling sweep would also have woken it
    // (the authoritative path). Running both must not double-apply the child's result.
    for (let i = 0; i < 6; i += 1) {
      const c = await findWorkflowRunById(ctx, childRunId);
      if (c && ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(c.state)) break;
      await tick(ctx, runtime);
    }
    const { reconcileSuspendedRuns } = await import("./run-pump.js");
    await reconcileSuspendedRuns(ctx, runtime);
    await reconcileSuspendedRuns(ctx, runtime);

    for (let i = 0; i < 6; i += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (current && ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(current.state)) break;
      await tick(ctx, runtime);
    }

    const final = (await findWorkflowRunById(ctx, run.id))!;
    expect(final.state).toBe("Succeeded");
    // Still exactly one child, and the SubWorkflow node resumed exactly once.
    expect((await listWorkflowRuns(ctx, { limit: 50 })).filter((r) => r.parentRunId === run.id)).toHaveLength(1);
    expect((await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "sub_1" && s.status === "Succeeded")).toHaveLength(1);
  });
});
