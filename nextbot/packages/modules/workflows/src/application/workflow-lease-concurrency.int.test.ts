import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, type TenantContext } from "@nextbot/db";
import { executeRun, newWorkerInstanceId } from "./run-executor.js";
import { pumpWorkflowRuns } from "./run-pump.js";
import { startWorkflowRun } from "./run-service.js";
import { findWorkflowRunById, listWorkflowRunSteps } from "../infrastructure/workflow-run-repository.js";
import {
  acquireRunLease,
  expireRunLeaseNow,
  findRunLease,
  reclaimExpiredRunLeases,
  releaseRunLease,
  renewRunLease,
} from "../infrastructure/workflow-run-lease-repository.js";
import { activateTenant, createFakeNodeRuntime, createFixtureWorkflowVersion, endNode, toolCallNode, triggerNode } from "../testing/run-fixtures.js";
import { createFixtureMcpServerVersion, createFixtureTool } from "../testing/workflow-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b) — **the concurrent-claim proof**
 * ADR-0013 §7.6 verification item 8 requires:
 *
 * > N genuinely concurrent worker replicas pump the same `Pending` run; exactly one
 * > acquires the lease and advances it; the losers no-op. Kill the lease holder mid-step
 * > and assert `workflow.lease-reaper` makes the run claimable again after the TTL and
 * > that the re-executed node is idempotent.
 *
 * **Why this suite is held to a higher bar than an ordinary integration test.**
 * `apps/worker`'s scheduler has no distributed lock, by design — its own doc comment
 * explains that every job predating this one is idempotent and therefore race-tolerant:
 * "a job overlapping its own previous run, or running on N worker replicas
 * simultaneously, does at most duplicate work, never corrupts state." The workflow
 * executor is the FIRST job in that process for which that is false. `workflow_run_lease`
 * is what restores the assumption, and ADR-0013 §7.2 constraint 3 is explicit that it
 * "must be tested against genuinely concurrent claimers, not asserted".
 *
 * So every concurrency assertion below races REAL `Promise.all`-dispatched claimers
 * against REAL Postgres. None of them serializes the claimers first and then checks a
 * counter — that would test nothing about atomicity.
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

async function pendingRun(ctx: TenantContext, name: string) {
  const version = await createFixtureWorkflowVersion(ctx, name, [triggerNode("end_1"), endNode("end_1")]);
  const { run } = await startWorkflowRun(ctx, { workflowVersionId: version.id, triggerKind: "Sandbox", idempotencyKey: generateId() });
  return run;
}

describe("acquireRunLease — the claim is atomic under GENUINE concurrency", () => {
  it("exactly one of 16 simultaneous claimers wins; the other 15 lose", async () => {
    const ctx = await freshTenant();
    const run = await pendingRun(ctx, "wf_claim_race");

    // Dispatched together, resolved together — no `await` between them, so all 16
    // statements are genuinely in flight against Postgres at once.
    const owners = Array.from({ length: 16 }, () => newWorkerInstanceId());
    const results = await Promise.all(owners.map((owner) => acquireRunLease(ctx, run.id, owner, run.checkpointSeq)));

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => !r)).toHaveLength(15);

    // And the lease genuinely belongs to the winner — not merely "someone got true".
    const lease = await findRunLease(ctx, run.id);
    expect(owners[results.indexOf(true)]).toBe(lease!.owner);
  });

  it("holds across REPEATED races — a single lucky pass is not evidence of atomicity", async () => {
    const ctx = await freshTenant();
    for (let round = 0; round < 8; round += 1) {
      const run = await pendingRun(ctx, `wf_claim_race_${round}`);
      const results = await Promise.all(Array.from({ length: 8 }, () => acquireRunLease(ctx, run.id, newWorkerInstanceId(), run.checkpointSeq)));
      expect(results.filter(Boolean)).toHaveLength(1);
    }
  });

  it("a LIVE lease cannot be stolen, however many claimers try", async () => {
    const ctx = await freshTenant();
    const run = await pendingRun(ctx, "wf_no_steal");
    const holder = newWorkerInstanceId();
    expect(await acquireRunLease(ctx, run.id, holder, run.checkpointSeq)).toBe(true);

    const attempts = await Promise.all(Array.from({ length: 10 }, () => acquireRunLease(ctx, run.id, newWorkerInstanceId(), run.checkpointSeq)));
    expect(attempts.every((r) => r === false)).toBe(true);
    expect((await findRunLease(ctx, run.id))!.owner).toBe(holder);
  });

  it("an EXPIRED lease is reclaimable — and again, by exactly one of many racing claimers", async () => {
    const ctx = await freshTenant();
    const run = await pendingRun(ctx, "wf_reclaim_race");
    const dead = newWorkerInstanceId();
    expect(await acquireRunLease(ctx, run.id, dead, run.checkpointSeq)).toBe(true);

    // The holder "crashed": it stopped renewing, so its lease aged out.
    await expireRunLeaseNow(ctx, run.id);

    const results = await Promise.all(Array.from({ length: 12 }, () => acquireRunLease(ctx, run.id, newWorkerInstanceId(), run.checkpointSeq)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await findRunLease(ctx, run.id))!.owner).not.toBe(dead);
  });

  it("records the checkpoint_seq at acquisition, so a holder can detect the run moved under it", async () => {
    const ctx = await freshTenant();
    const run = await pendingRun(ctx, "wf_lease_seq");
    await acquireRunLease(ctx, run.id, newWorkerInstanceId(), 7);
    expect((await findRunLease(ctx, run.id))!.checkpointSeqAtAcquire).toBe(7);
  });
});

describe("renew and release are OWNER-SCOPED — a dispossessed holder cannot steal its run back", () => {
  it("renewal fails for a holder whose lease was taken over mid-step", async () => {
    const ctx = await freshTenant();
    const run = await pendingRun(ctx, "wf_renew_scope");
    const first = newWorkerInstanceId();
    const second = newWorkerInstanceId();

    expect(await acquireRunLease(ctx, run.id, first, run.checkpointSeq)).toBe(true);
    expect(await renewRunLease(ctx, run.id, first)).toBe(true);

    await expireRunLeaseNow(ctx, run.id);
    expect(await acquireRunLease(ctx, run.id, second, run.checkpointSeq)).toBe(true);

    // The dispossessed holder learns it lost, and must abandon its pass — this boolean
    // is exactly the signal `executeRun`'s loop breaks on.
    expect(await renewRunLease(ctx, run.id, first)).toBe(false);
    expect((await findRunLease(ctx, run.id))!.owner).toBe(second);
  });

  it("release does nothing for a non-owner — releasing a live holder's run would hand it to a third claimer", async () => {
    const ctx = await freshTenant();
    const run = await pendingRun(ctx, "wf_release_scope");
    const holder = newWorkerInstanceId();
    await acquireRunLease(ctx, run.id, holder, run.checkpointSeq);

    await releaseRunLease(ctx, run.id, newWorkerInstanceId());
    expect(await findRunLease(ctx, run.id)).not.toBeNull();

    await releaseRunLease(ctx, run.id, holder);
    expect(await findRunLease(ctx, run.id)).toBeNull();
  });
});

describe("workflow.lease-reaper", () => {
  it("removes an expired lease and leaves a live one alone", async () => {
    const ctx = await freshTenant();
    const expired = await pendingRun(ctx, "wf_reap_expired");
    const live = await pendingRun(ctx, "wf_reap_live");

    await acquireRunLease(ctx, expired.id, newWorkerInstanceId(), 0);
    await acquireRunLease(ctx, live.id, newWorkerInstanceId(), 0);
    await expireRunLeaseNow(ctx, expired.id);

    expect(await reclaimExpiredRunLeases(ctx)).toBe(1);
    expect(await findRunLease(ctx, expired.id)).toBeNull();
    expect(await findRunLease(ctx, live.id)).not.toBeNull();
  });

  it("is NOT what makes reclaim work — an expired lease is claimable even with the reaper never run", async () => {
    // This is the property that keeps crash recovery working if the reaper job is
    // stopped: `acquireRunLease`'s own `WHERE expires_at < now()` does the real work.
    const ctx = await freshTenant();
    const run = await pendingRun(ctx, "wf_reap_not_required");
    await acquireRunLease(ctx, run.id, newWorkerInstanceId(), 0);
    await expireRunLeaseNow(ctx, run.id);

    expect(await acquireRunLease(ctx, run.id, newWorkerInstanceId(), 0)).toBe(true);
  });
});

describe("the executor under concurrent claimers — the property that actually matters", () => {
  it("N concurrent executeRun passes advance the run exactly once each, never duplicating a step", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const toolId = await createFixtureTool(ctx, "concurrent_read", "Read");
    const serverVersionId = await createFixtureMcpServerVersion(ctx, "srv_concurrent");
    const version = await createFixtureWorkflowVersion(ctx, "wf_concurrent_exec", [
      triggerNode("tool_1"),
      toolCallNode("tool_1", toolId, serverVersionId, "end_1"),
      endNode("end_1"),
    ]);
    const { run } = await startWorkflowRun(ctx, { workflowVersionId: version.id, triggerKind: "Sandbox", idempotencyKey: generateId() });

    // Six "replicas" run the REAL pump against the same tenant simultaneously,
    // repeatedly, until the run finishes. This is the production shape: replicas run
    // `workflow.run-pump`, not `executeRun` directly, so racing the pump exercises the
    // scan + claim + advance sequence end to end rather than only the claim.
    for (let round = 0; round < 6; round += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (!current || ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(current.state)) break;
      const results = await Promise.all(
        Array.from({ length: 6 }, () => pumpWorkflowRuns({ runtimeFor: () => runtime, owner: newWorkerInstanceId(), tenantIds: [ctx.tenantId] })),
      );
      // At most one replica claims this run per round; the rest are honest no-ops.
      expect(results.reduce((sum, r) => sum + r.claimed, 0)).toBeLessThanOrEqual(1);
    }

    const final = await findWorkflowRunById(ctx, run.id);
    expect(final!.state).toBe("Succeeded");

    // The real invariant: the append-only step log has exactly one row per node, with no
    // duplicate attempts — six racing replicas produced one run's worth of work.
    const steps = await listWorkflowRunSteps(ctx, run.id);
    expect(steps.map((s) => s.nodeId).sort()).toEqual(["end_1", "tool_1", "trigger_1"]);
    expect(steps.every((s) => s.attempt === 1)).toBe(true);

    // And the tool's real side effect happened exactly once.
    expect(runtime.appliedEffects).toHaveLength(1);
  });

  it("a claimer holding a STALE view of the run loses the optimistic-concurrency check instead of clobbering it", async () => {
    const ctx = await freshTenant();
    const runtime = createFakeNodeRuntime();
    const version = await createFixtureWorkflowVersion(ctx, "wf_stale_view", [triggerNode("end_1"), endNode("end_1")]);
    const { run } = await startWorkflowRun(ctx, { workflowVersionId: version.id, triggerKind: "Sandbox", idempotencyKey: generateId() });

    // Seed the frontier the way the real pump does, then take replica A's snapshot.
    await pumpWorkflowRuns({ runtimeFor: () => runtime, owner: newWorkerInstanceId(), maxRunsPerTenant: 0, tenantIds: [ctx.tenantId] });
    const staleView = (await findWorkflowRunById(ctx, run.id))!;

    // Replica B now runs the whole thing to completion.
    for (let i = 0; i < 5; i += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (!current || current.state === "Succeeded") break;
      await pumpWorkflowRuns({ runtimeFor: () => runtime, owner: newWorkerInstanceId(), tenantIds: [ctx.tenantId] });
    }
    expect((await findWorkflowRunById(ctx, run.id))!.state).toBe("Succeeded");

    const stepsBefore = (await listWorkflowRunSteps(ctx, run.id)).length;

    // Replica A now acts on its stale snapshot. It must NOT throw, must NOT resurrect
    // the finished run, and must NOT append a duplicate step.
    const stale = await executeRun(ctx, { runtime, owner: newWorkerInstanceId() }, staleView);
    expect(stale.nodesExecuted).toBe(0);

    const after = await findWorkflowRunById(ctx, run.id);
    expect(after!.state).toBe("Succeeded");
    expect((await listWorkflowRunSteps(ctx, run.id)).length).toBe(stepsBefore);
  });
});
