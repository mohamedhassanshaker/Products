import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, getOwnerPool, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { and, eq } from "drizzle-orm";
import { emptyCheckpoint } from "../domain/checkpoint.js";
import { createWorkflowRun, findWorkflowRunById, persistNodeAdvance, terminateRun } from "./workflow-run-repository.js";
import { createFixtureWorkflowVersion, endNode, triggerNode } from "../testing/run-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2) — schema-level coverage
 * for `workflow_run` / `workflow_run_lease` / `workflow_run_step`.
 *
 * Every CHECK here is asserted to **actually fire**, via raw SQL that bypasses the
 * repository layer entirely. A constraint that exists in the migration but is never
 * exercised is indistinguishable from one that was mistyped, and these particular
 * constraints are the last line of defence for FR-WF-05's "no suspension is indefinite"
 * and for "an outcome only exists on a terminal run" — invariants the executor is also
 * expected to maintain, which is exactly why they are worth enforcing twice.
 */

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function freshTenant(): Promise<TenantContext> {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  return ctx;
}

/** Raw SQL as the schema OWNER — deliberately bypassing the repository AND RLS, so what
 *  is being tested is the database's own enforcement rather than the application's. */
async function rawInsertRun(values: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  await getOwnerPool().query(`INSERT INTO workflow_run (${columns.join(", ")}) VALUES (${placeholders})`, Object.values(values));
}

async function baseRunValues(ctx: TenantContext, name: string): Promise<Record<string, unknown>> {
  const version = await createFixtureWorkflowVersion(ctx, name, [triggerNode("end_1"), endNode("end_1")]);
  return {
    id: generateId(),
    tenant_id: ctx.tenantId,
    workflow_version_id: version.id,
    trigger_kind: "Sandbox",
    state: "Running",
    scope_hash: "hash",
    otel_trace_id: "trace",
    idempotency_key: generateId(),
  };
}

describe("workflow_run — every column round-trips", () => {
  it("stores and reads back the full LLD §14.6.2 column set", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_schema_roundtrip", [triggerNode("end_1"), endNode("end_1")]);

    const checkpoint = { ...emptyCheckpoint(), variables: { a: 1 }, frontier: [{ nodeId: "trigger_1", branchKey: null, iteration: 0 }] };
    const { run } = await createWorkflowRun(ctx, {
      workflowVersionId: version.id,
      triggerKind: "Webhook",
      checkpoint,
      scopeHash: "scope-hash",
      otelTraceId: "0af7651916cd43dd8448eb211c80319c",
      idempotencyKey: "key-1",
    });

    const read = (await findWorkflowRunById(ctx, run.id))!;
    expect(read.state).toBe("Pending");
    expect(read.checkpointSeq).toBe(0);
    expect(read.currentNodeIds).toEqual(["trigger_1"]);
    expect(read.checkpointJson).toEqual(checkpoint);
    expect(read.costUsd).toBe("0.00000000");
    expect(read.loopIterations).toEqual({});
    expect(read.depth).toBe(0);
    expect(read.otelTraceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(read.endedAt).toBeNull();
  });

  it("enforces UNIQUE (tenant_id, idempotency_key) — the mechanism behind resume-not-duplicate", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_schema_idem", [triggerNode("end_1"), endNode("end_1")]);
    const input = { workflowVersionId: version.id, triggerKind: "Webhook" as const, checkpoint: emptyCheckpoint(), scopeHash: "h", otelTraceId: "t", idempotencyKey: "dup" };

    const first = await createWorkflowRun(ctx, input);
    const second = await createWorkflowRun(ctx, input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
  });
});

describe("workflow_run CHECK constraints actually fire", () => {
  it("workflow_run_suspension_consistent — a Suspended run cannot lack its suspension fields", async () => {
    const ctx = await freshTenant();
    const values = await baseRunValues(ctx, "wf_ck_susp_missing");
    // FR-WF-05's "no suspension is indefinite", at the database.
    await expect(rawInsertRun({ ...values, state: "Suspended" })).rejects.toThrow(/workflow_run_suspension_consistent/);
    await expect(
      rawInsertRun({ ...values, id: generateId(), idempotency_key: generateId(), state: "Suspended", suspension_kind: "Wait", suspension_ref: "timer:x" }),
    ).rejects.toThrow(/workflow_run_suspension_consistent/);
  });

  it("workflow_run_suspension_consistent — a NON-suspended run cannot retain a suspension kind", async () => {
    const ctx = await freshTenant();
    const values = await baseRunValues(ctx, "wf_ck_susp_stale");
    await expect(rawInsertRun({ ...values, state: "Running", suspension_kind: "Wait" })).rejects.toThrow(/workflow_run_suspension_consistent/);
  });

  it("accepts a fully-declared suspension", async () => {
    const ctx = await freshTenant();
    const values = await baseRunValues(ctx, "wf_ck_susp_ok");
    await expect(
      rawInsertRun({
        ...values,
        state: "Suspended",
        suspension_kind: "Approval",
        suspension_ref: `approval_request:${generateId()}`,
        suspension_expires_at: new Date(Date.now() + 60_000),
        suspension_expiry_outcome: "Timeout",
      }),
    ).resolves.toBeUndefined();
  });

  it("workflow_run_outcome_terminal_only — an outcome on a running run is rejected", async () => {
    const ctx = await freshTenant();
    const values = await baseRunValues(ctx, "wf_ck_outcome");
    await expect(rawInsertRun({ ...values, state: "Running", outcome: "Resolved" })).rejects.toThrow(/workflow_run_outcome_terminal_only/);
  });

  it("workflow_run_ended_at_terminal_only — an ended_at on a running run is rejected", async () => {
    const ctx = await freshTenant();
    const values = await baseRunValues(ctx, "wf_ck_ended");
    await expect(rawInsertRun({ ...values, state: "Running", ended_at: new Date() })).rejects.toThrow(/workflow_run_ended_at_terminal_only/);
  });

  it("workflow_run_depth_bounded — depth is 0..8", async () => {
    const ctx = await freshTenant();
    const values = await baseRunValues(ctx, "wf_ck_depth");
    await expect(rawInsertRun({ ...values, depth: 9 })).rejects.toThrow(/workflow_run_depth_bounded/);
    await expect(rawInsertRun({ ...values, id: generateId(), idempotency_key: generateId(), depth: -1 })).rejects.toThrow(/workflow_run_depth_bounded/);
  });

  it("workflow_run_parent_implies_subworkflow — a parent exists iff the trigger is SubWorkflow", async () => {
    const ctx = await freshTenant();
    const values = await baseRunValues(ctx, "wf_ck_parent");
    // A Sandbox run may not have a parent...
    await expect(rawInsertRun({ ...values, trigger_kind: "Sandbox", parent_run_id: values.id })).rejects.toThrow(/workflow_run_parent_implies_subworkflow/);
    // ...and a SubWorkflow run must have one.
    await expect(rawInsertRun({ ...values, id: generateId(), idempotency_key: generateId(), trigger_kind: "SubWorkflow" })).rejects.toThrow(
      /workflow_run_parent_implies_subworkflow/,
    );
  });
});

describe("optimistic concurrency on checkpoint_seq", () => {
  it("persistNodeAdvance bumps the sequence and rejects a write against a stale one", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_seq", [triggerNode("end_1"), endNode("end_1")]);
    const { run } = await createWorkflowRun(ctx, {
      workflowVersionId: version.id,
      triggerKind: "Sandbox",
      checkpoint: emptyCheckpoint(),
      scopeHash: "h",
      otelTraceId: "t",
      idempotencyKey: generateId(),
    });

    const advanced = await persistNodeAdvance(ctx, run.id, 0, { state: "Running", checkpoint: emptyCheckpoint(), costUsd: "0", stepsExecuted: 1 }, null);
    expect(advanced.checkpointSeq).toBe(1);

    // A second writer holding the ORIGINAL sequence must lose, not clobber.
    await expect(
      persistNodeAdvance(ctx, run.id, 0, { state: "Running", checkpoint: emptyCheckpoint(), costUsd: "999", stepsExecuted: 99 }, null),
    ).rejects.toThrow(/advanced past checkpoint sequence/);

    const unchanged = (await findWorkflowRunById(ctx, run.id))!;
    expect(unchanged.stepsExecuted).toBe(1);
    expect(unchanged.costUsd).toBe("0.00000000");
  });

  it("refuses to persist a checkpoint that does not satisfy WorkflowCheckpointSchema", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_bad_ck", [triggerNode("end_1"), endNode("end_1")]);
    const { run } = await createWorkflowRun(ctx, {
      workflowVersionId: version.id,
      triggerKind: "Sandbox",
      checkpoint: emptyCheckpoint(),
      scopeHash: "h",
      otelTraceId: "t",
      idempotencyKey: generateId(),
    });

    await expect(
      persistNodeAdvance(ctx, run.id, 0, { state: "Running", checkpoint: { bogus: true } as never, costUsd: "0", stepsExecuted: 0 }, null),
    ).rejects.toThrow(/WorkflowCheckpointSchema/);
  });
});

describe("workflow_run_step", () => {
  it("enforces UNIQUE (tenant, run, node, iteration, attempt) and allows the -1 compensation sentinel", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_step_key", [triggerNode("end_1"), endNode("end_1")]);
    const { run } = await createWorkflowRun(ctx, {
      workflowVersionId: version.id,
      triggerKind: "Sandbox",
      checkpoint: emptyCheckpoint(),
      scopeHash: "h",
      otelTraceId: "t",
      idempotencyKey: generateId(),
    });

    const step = { nodeId: "n1", nodeKind: "ToolCall" as const, iteration: 0, branchKey: null, refKind: "None" as const, status: "Succeeded" as const };
    await persistNodeAdvance(ctx, run.id, 0, { state: "Running", checkpoint: emptyCheckpoint(), costUsd: "0", stepsExecuted: 1 }, step);
    // A retry of the same position gets attempt 2, not a collision.
    await persistNodeAdvance(ctx, run.id, 1, { state: "Running", checkpoint: emptyCheckpoint(), costUsd: "0", stepsExecuted: 2 }, step);
    // The compensation sentinel is a distinct position entirely.
    await persistNodeAdvance(ctx, run.id, 2, { state: "Running", checkpoint: emptyCheckpoint(), costUsd: "0", stepsExecuted: 3 }, { ...step, iteration: -1, status: "Compensated" });

    const rows = await withTenant(ctx, (db: TenantScopedClient) =>
      db.select().from(schema.workflowRunStep).where(and(eq(schema.workflowRunStep.tenantId, ctx.tenantId), eq(schema.workflowRunStep.runId, run.id))),
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.iteration === 0).map((r) => r.attempt).sort()).toEqual([1, 2]);
    expect(rows.filter((r) => r.iteration === -1)).toHaveLength(1);
  });

  it("rejects an iteration below the compensation sentinel", async () => {
    await expect(
      getOwnerPool().query(
        `INSERT INTO workflow_run_step (id, tenant_id, run_id, node_id, node_kind, iteration, ref_kind, status)
         VALUES ($1, $1, $1, 'n', 'End', -2, 'None', 'Succeeded')`,
        [generateId()],
      ),
    ).rejects.toThrow();
  });
});

describe("terminateRun", () => {
  it("clears the suspension fields in the same statement, so the CHECK cannot reject the terminate", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_terminate", [triggerNode("end_1"), endNode("end_1")]);
    const { run } = await createWorkflowRun(ctx, {
      workflowVersionId: version.id,
      triggerKind: "Sandbox",
      checkpoint: emptyCheckpoint(),
      scopeHash: "h",
      otelTraceId: "t",
      idempotencyKey: generateId(),
    });
    await persistNodeAdvance(
      ctx,
      run.id,
      0,
      {
        state: "Suspended",
        checkpoint: emptyCheckpoint(),
        costUsd: "0",
        stepsExecuted: 0,
        suspensionKind: "Wait",
        suspensionRef: "timer:2026-01-01T00:00:00.000Z",
        suspensionExpiresAt: new Date(),
        suspensionExpiryOutcome: "Timeout",
      },
      null,
    );

    const { terminated, run: after } = await terminateRun(ctx, run.id, ["Suspended"], "Timeout", "TimedOut", { reason: "SUSPENSION_EXPIRED" });
    expect(terminated).toBe(true);
    expect(after!.suspensionKind).toBeNull();
    expect(after!.suspensionRef).toBeNull();
    expect(after!.endedAt).not.toBeNull();

    // A second terminate loses the CAS rather than overwriting the real outcome.
    const again = await terminateRun(ctx, run.id, ["Suspended"], "Failed", "Failed", {});
    expect(again.terminated).toBe(false);
    expect((await findWorkflowRunById(ctx, run.id))!.outcome).toBe("Timeout");
  });
});
