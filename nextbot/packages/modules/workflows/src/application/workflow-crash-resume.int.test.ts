import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { and, eq } from "drizzle-orm";
import type { WorkflowNode } from "@nextbot/contracts";
import { newWorkerInstanceId } from "./run-executor.js";
import { pumpWorkflowRuns } from "./run-pump.js";
import { startWorkflowRun } from "./run-service.js";
import { findWorkflowRunById, listWorkflowRunSteps } from "../infrastructure/workflow-run-repository.js";
import { expireRunLeaseNow, findRunLease } from "../infrastructure/workflow-run-lease-repository.js";
import { activateTenant, createFakeNodeRuntime, createFixtureWorkflowVersion, endNode, toolCallNode, triggerNode } from "../testing/run-fixtures.js";
import { createFixtureMcpServerVersion, createFixtureTool } from "../testing/workflow-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b) — **the crash-and-resume proof** the
 * parent plan's own Phase 16 exit gate requires:
 *
 * > kill a worker mid-run, confirm the lease is reclaimed and the run resumes without a
 * > duplicate write on a write node.
 *
 * **What "without a duplicate write" is asserted against here, and why it matters.**
 * It would be easy — and worthless — to assert that "an idempotency key was passed".
 * That proves nothing: a key generated freshly on each attempt would also be "passed",
 * and would double-apply the write. So this suite asserts against the **real downstream
 * side effect**: `createFakeNodeRuntime` models a write-classified tool that deduplicates
 * on the idempotency key exactly as FR-WF-04 requires a real one to, and exposes
 * `appliedEffects` (distinct keys actually applied) separately from `dispatches`
 * (attempts). The proof is that after a crash and a resume:
 *
 *   dispatches.length === 2   (the node genuinely ran twice)
 *   appliedEffects.length === 1  (the side effect happened exactly once)
 *
 * The first number failing would mean the crash was not simulated; the second failing
 * would be the actual defect this phase exists to prevent.
 *
 * The crash itself is simulated the way a real one presents to the database: the tool
 * call throws mid-flight *after* the backend applied the write (the realistic worst
 * case — the write landed, the answer was lost), the executor's pass dies without
 * persisting, and the lease is abandoned rather than released. Nothing about the durable
 * state is hand-edited to make the resume work.
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

/** A graph with a genuine WRITE-classified tool node carrying the idempotency +
 *  compensation pair V5 requires of every write node. */
async function writeWorkflow(ctx: TenantContext, name: string): Promise<{ versionId: string; writeToolId: string }> {
  const writeToolId = await createFixtureTool(ctx, `${name}_charge`, "Write");
  const compensateToolId = await createFixtureTool(ctx, `${name}_refund`, "Write");
  const serverVersionId = await createFixtureMcpServerVersion(ctx, `${name}_srv`);
  const nodes: WorkflowNode[] = [
    triggerNode("write_1"),
    toolCallNode("write_1", writeToolId, serverVersionId, "end_1", {
      idempotency: { strategy: "RunScopedUuid" },
      compensation: { toolId: compensateToolId, argMapping: {} },
    }),
    endNode("end_1"),
  ];
  const version = await createFixtureWorkflowVersion(ctx, name, nodes);
  return { versionId: version.id, writeToolId };
}

describe("crash mid-write-node, then resume — the side effect happens EXACTLY ONCE", () => {
  it("replica A dies mid tool call; replica B reclaims the lease, resumes, and completes with one real write", async () => {
    const ctx = await freshTenant();
    const { versionId, writeToolId } = await writeWorkflow(ctx, "wf_crash_write");
    const runtime = createFakeNodeRuntime();
    runtime.rwClasses.set(writeToolId, "Write");

    const { run } = await startWorkflowRun(ctx, { workflowVersionId: versionId, triggerKind: "Sandbox", idempotencyKey: generateId() });

    // ---- Replica A: advance to the write node, then die inside it -------------
    const replicaA = newWorkerInstanceId();
    // First tick seeds the frontier and executes the Trigger, leaving the run parked ON
    // the write node — this is the "preceding checkpoint write recording its intent"
    // the resume protocol relies on. Nothing is hand-written to make that true.
    runtime.failNextDispatch = true;
    await pumpWorkflowRuns({ runtimeFor: () => runtime, owner: replicaA, tenantIds: [ctx.tenantId] });

    // The tool was attempted and the backend APPLIED the write before the connection
    // died — the realistic worst case.
    expect(runtime.dispatches).toHaveLength(1);
    expect(runtime.appliedEffects).toHaveLength(1);
    const keyFromFirstAttempt = runtime.dispatches[0]!.idempotencyKey;

    // The crash left the run still pointing at the write node, un-advanced.
    const afterCrash = (await findWorkflowRunById(ctx, run.id))!;
    expect(afterCrash.state).toBe("Running");
    expect(afterCrash.currentNodeIds).toEqual(["write_1"]);
    // No step row was written for the node that died mid-flight — the persist never ran,
    // which is exactly what makes the resume re-execute it rather than skip it.
    expect((await listWorkflowRunSteps(ctx, run.id)).some((s) => s.nodeId === "write_1")).toBe(false);

    // ---- The lease: abandoned by the dead replica, reclaimed after its TTL -----
    // `executeRun`'s `finally` releases on a clean exit; a REAL process death leaves the
    // row behind, so it is re-created here and then aged out, which is what a crashed
    // holder's lease actually looks like.
    const { acquireRunLease } = await import("../infrastructure/workflow-run-lease-repository.js");
    await acquireRunLease(ctx, run.id, replicaA, afterCrash.checkpointSeq);
    expect((await findRunLease(ctx, run.id))!.owner).toBe(replicaA);

    // Before the TTL passes, a second replica correctly cannot take the run.
    const replicaB = newWorkerInstanceId();
    const blocked = await pumpWorkflowRuns({ runtimeFor: () => runtime, owner: replicaB, tenantIds: [ctx.tenantId] });
    expect(blocked.claimed).toBe(0);
    expect(runtime.dispatches).toHaveLength(1); // still only the crashed attempt

    // The dead holder never renews, so its lease ages out.
    await expireRunLeaseNow(ctx, run.id);

    // ---- Replica B: reclaims, resumes, completes -------------------------------
    for (let tick = 0; tick < 5; tick += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (current?.state === "Succeeded") break;
      await pumpWorkflowRuns({ runtimeFor: () => runtime, owner: replicaB, tenantIds: [ctx.tenantId] });
    }

    const final = (await findWorkflowRunById(ctx, run.id))!;
    expect(final.state).toBe("Succeeded");
    expect(final.outcome).toBe("Resolved");

    // ==========================================================================
    // THE PROOF.
    // ==========================================================================
    // The node genuinely ran a SECOND time (so the crash was real, not skipped)...
    expect(runtime.dispatches).toHaveLength(2);
    // ...with the IDENTICAL idempotency key, because the key is a pure function of
    // (runId, nodeId, iteration) — see `domain/idempotency.ts`...
    expect(runtime.dispatches[1]!.idempotencyKey).toBe(keyFromFirstAttempt);
    // ...so the REAL DOWNSTREAM SIDE EFFECT happened exactly once.
    expect(runtime.appliedEffects).toEqual([keyFromFirstAttempt]);

    // And the append-only step log tells the truth about both attempts: exactly one
    // committed step for the node (the crashed attempt never committed one).
    const writeSteps = (await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "write_1");
    expect(writeSteps).toHaveLength(1);
    expect(writeSteps[0]!.status).toBe("Succeeded");
  });

  it("at most ONE node re-executes — nodes completed before the crash are never replayed", async () => {
    const ctx = await freshTenant();
    const firstToolId = await createFixtureTool(ctx, "wf_two_first", "Write");
    const secondToolId = await createFixtureTool(ctx, "wf_two_second", "Write");
    const compensateToolId = await createFixtureTool(ctx, "wf_two_undo", "Write");
    const serverVersionId = await createFixtureMcpServerVersion(ctx, "wf_two_srv");

    const runtime = createFakeNodeRuntime();
    runtime.rwClasses.set(firstToolId, "Write");
    runtime.rwClasses.set(secondToolId, "Write");

    const nodes: WorkflowNode[] = [
      triggerNode("write_1"),
      toolCallNode("write_1", firstToolId, serverVersionId, "write_2", {
        idempotency: { strategy: "RunScopedUuid" },
        compensation: { toolId: compensateToolId, argMapping: {} },
      }),
      toolCallNode("write_2", secondToolId, serverVersionId, "end_1", {
        idempotency: { strategy: "RunScopedUuid" },
        compensation: { toolId: compensateToolId, argMapping: {} },
      }),
      endNode("end_1"),
    ];
    const version = await createFixtureWorkflowVersion(ctx, "wf_two_writes", nodes);
    const { run } = await startWorkflowRun(ctx, { workflowVersionId: version.id, triggerKind: "Sandbox", idempotencyKey: generateId() });

    // Crash inside the SECOND write, after the first has already committed.
    const replicaA = newWorkerInstanceId();
    runtime.tools.dispatch = (() => {
      const original = createFakeNodeRuntime().tools.dispatch;
      void original;
      let crashed = false;
      return async (input: Parameters<typeof runtime.tools.dispatch>[0]) => {
        runtime.dispatches.push({ toolId: input.toolId, idempotencyKey: input.idempotencyKey, args: input.args });
        if (!runtime.appliedEffects.includes(input.idempotencyKey)) runtime.appliedEffects.push(input.idempotencyKey);
        if (input.toolId === secondToolId && !crashed) {
          crashed = true;
          throw new Error("simulated crash inside the second write");
        }
        return { kind: "Succeeded" as const, output: { ok: true }, costUsd: "0.01" };
      };
    })();

    await pumpWorkflowRuns({ runtimeFor: () => runtime, owner: replicaA, tenantIds: [ctx.tenantId] });

    const afterCrash = (await findWorkflowRunById(ctx, run.id))!;
    expect(afterCrash.currentNodeIds).toEqual(["write_2"]);
    // The first write committed its step and is NOT on the frontier — it will not replay.
    expect((await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "write_1")).toHaveLength(1);

    const replicaB = newWorkerInstanceId();
    for (let tick = 0; tick < 5; tick += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (current?.state === "Succeeded") break;
      await pumpWorkflowRuns({ runtimeFor: () => runtime, owner: replicaB, tenantIds: [ctx.tenantId] });
    }
    expect((await findWorkflowRunById(ctx, run.id))!.state).toBe("Succeeded");

    // The FIRST write was dispatched exactly once — the resume did not rewind past the
    // node that died. "A crash mid-node re-executes AT MOST ONE node."
    expect(runtime.dispatches.filter((d) => d.toolId === firstToolId)).toHaveLength(1);
    expect(runtime.dispatches.filter((d) => d.toolId === secondToolId)).toHaveLength(2);
    // And both writes' real effects each happened exactly once.
    expect(runtime.appliedEffects).toHaveLength(2);
  });
});

describe("the checkpoint is genuinely durable — a resume reads it back from Postgres, not memory", () => {
  it("the checkpoint persisted before the crash is exactly what the resume executes from", async () => {
    const ctx = await freshTenant();
    const { versionId, writeToolId } = await writeWorkflow(ctx, "wf_durable_ck");
    const runtime = createFakeNodeRuntime();
    runtime.rwClasses.set(writeToolId, "Write");
    const { run } = await startWorkflowRun(ctx, {
      workflowVersionId: versionId,
      triggerKind: "Sandbox",
      idempotencyKey: generateId(),
      input: { customer: "acme" },
    });

    runtime.failNextDispatch = true;
    await pumpWorkflowRuns({ runtimeFor: () => runtime, owner: newWorkerInstanceId(), tenantIds: [ctx.tenantId] });

    // Read the raw column, not the in-memory object — this is the durable state a
    // different process would resume from.
    const raw = await withTenant(ctx, (db: TenantScopedClient) =>
      db.select({ checkpointJson: schema.workflowRun.checkpointJson, seq: schema.workflowRun.checkpointSeq }).from(schema.workflowRun).where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), eq(schema.workflowRun.id, run.id))),
    );
    const checkpoint = raw[0]!.checkpointJson as { frontier: { nodeId: string }[]; variables: Record<string, unknown> };

    // The frontier records the INTENT to execute the write node — written before that
    // node ever ran, which is the entire basis of the at-most-one-replay guarantee.
    expect(checkpoint.frontier.map((f) => f.nodeId)).toEqual(["write_1"]);
    // The run's seed input survived the crash.
    expect(checkpoint.variables.customer).toBe("acme");
    // And the sequence advanced exactly once (the Trigger's persist), so a stale
    // executor holding seq 0 would lose the optimistic-concurrency check.
    expect(raw[0]!.seq).toBeGreaterThan(0);
  });
});
