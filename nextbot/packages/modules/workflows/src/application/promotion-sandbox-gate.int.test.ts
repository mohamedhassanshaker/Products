import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, type TenantContext } from "@nextbot/db";
import { WorkflowPromotionBlockedError, WorkflowRunIdempotencyKeyRequiredError, WorkflowRunNotActionableError, type WorkflowNode } from "@nextbot/contracts";
import { getAllowedTransitions, reachableNodesFromTrigger, transitionWorkflowVersion } from "./workflow-service.js";
import { cancelRun, getRunWithTrace, listRuns, resumeRun, startSandboxRun } from "./run-service.js";
import { newWorkerInstanceId } from "./run-executor.js";
import { pumpWorkflowRuns } from "./run-pump.js";
import { findWorkflowRunById } from "../infrastructure/workflow-run-repository.js";
import { bindWorkflowVersionSandboxRun, setWorkflowVersionEvalBinding, setWorkflowVersionStatus } from "../infrastructure/workflow-repository.js";
import { activateTenant, createFakeNodeRuntime, createFixtureWorkflowVersion, endNode, graphOf, triggerNode } from "../testing/run-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.1/§14.6.5) — the sandbox-run
 * API and the promotion gate it finally makes satisfiable.
 *
 * Phase 15 shipped `HumanReview -> Approved` gated on `sandbox_run_id IS NOT NULL` and
 * disclosed that the gate was **genuinely unreachable**, because `workflow_run` did not
 * exist and the column was NULL for every version. This suite proves two things at once:
 * that the gate is now reachable through a real run, and that each of the three
 * sub-checks LLD §14.6.1 requires blocks INDEPENDENTLY — a gate that passes only when
 * everything is right is not evidence that any individual check works.
 */

const AUTHOR = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";

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

/** The three-node graph every case below uses: Trigger -> Router -> two Ends. The Router
 *  matters — it means a completed run legitimately SKIPS one End, which is exactly the
 *  case the coverage bar must tolerate (see `domain/promotion-policy.ts`'s own doc). */
function routedNodes(): WorkflowNode[] {
  return [
    triggerNode("router_1"),
    { id: "router_1", kind: "Router", mode: "Rules", branches: [{ to: "end_a", when: "true" }], default: "end_b" },
    endNode("end_a"),
    endNode("end_b", "Transferred"),
  ];
}

/** Walks a version to `HumanReview` with a green eval binding, which is everything the
 *  `Approved` gate needs EXCEPT the sandbox run — so each test can then vary only the
 *  sandbox condition it is about. */
async function versionAtHumanReview(ctx: TenantContext, name: string, nodes: WorkflowNode[] = routedNodes()) {
  const version = await createFixtureWorkflowVersion(ctx, name, nodes);
  await setWorkflowVersionStatus(ctx, version.id, "HumanReview");
  await setWorkflowVersionEvalBinding(ctx, version.id, { lastEvalRunId: generateId() });
  return version;
}

/**
 * The promotion policy reads `lastEvalRun` through the application service, which passes
 * `null` (no eval-run-trigger endpoint exists in this module's API surface — Phase 15's
 * own disclosed consequence). So `HumanReview -> Approved` is still blocked by the EVAL
 * gate in this build, independently of the sandbox gate.
 *
 * That is not a gap this phase introduces or should paper over, and it is the reason the
 * sandbox sub-checks below are asserted against the POLICY function directly (with a
 * green eval run supplied) as well as end-to-end: it is the only way to prove the
 * sandbox checks work without also inventing an eval-run mechanism this phase does not own.
 */
async function assertSandboxCheck(
  ctx: TenantContext,
  versionId: string,
  expectation: { allowed: boolean; reason?: RegExp },
): Promise<void> {
  const { canPromoteWorkflowVersion } = await import("../domain/promotion-policy.js");
  const { findWorkflowVersionById } = await import("../infrastructure/workflow-repository.js");
  const { listWorkflowRunSteps } = await import("../infrastructure/workflow-run-repository.js");

  const version = (await findWorkflowVersionById(ctx, versionId))!;
  const sandboxRun = version.sandboxRunId ? await findWorkflowRunById(ctx, version.sandboxRunId) : null;
  const steps = sandboxRun ? await listWorkflowRunSteps(ctx, sandboxRun.id) : [];

  const result = canPromoteWorkflowVersion({
    currentStatus: "HumanReview",
    targetStatus: "Approved",
    versionId: version.id,
    createdByUserId: AUTHOR,
    actingUserId: REVIEWER,
    // A green eval run for THIS version's content, so only the sandbox checks vary.
    lastEvalRun: { status: "Passed", artifactHash: version.yamlHash },
    yamlHash: version.yamlHash,
    sandboxRunId: version.sandboxRunId,
    sandboxRun: sandboxRun ? { workflowVersionId: sandboxRun.workflowVersionId, state: sandboxRun.state, coveredNodeIds: [...new Set(steps.map((s) => s.nodeId))] } : null,
    reachableNodeIds: reachableNodesFromTrigger(version.graphJson),
    hasActiveTraffic: false,
  });

  expect(result.allowed).toBe(expectation.allowed);
  if (!result.allowed && expectation.reason) expect(result.reason).toMatch(expectation.reason);
}

/** Runs the version's sandbox run to completion through the real pump. */
async function completedSandboxRun(ctx: TenantContext, versionId: string): Promise<string> {
  const runtime = createFakeNodeRuntime();
  const { run } = await startSandboxRun(ctx, versionId, generateId(), {});
  for (let tick = 0; tick < 8; tick += 1) {
    const current = await findWorkflowRunById(ctx, run.id);
    if (current && ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(current.state)) break;
    await pumpWorkflowRuns({ runtimeFor: () => runtime, owner: newWorkerInstanceId(), tenantIds: [ctx.tenantId] });
  }
  return run.id;
}

describe("reachableNodesFromTrigger — the coverage bar's denominator", () => {
  it("walks every edge kind from the Trigger", () => {
    const graph = graphOf("wf_reach", [
      triggerNode("router_1"),
      { id: "router_1", kind: "Router", mode: "Rules", branches: [{ to: "loop_1", when: "true" }], default: "end_b" },
      { id: "loop_1", kind: "Loop", maxIterations: 2, bodyEntryNodeId: "body_1", next: "end_a" },
      { id: "body_1", kind: "Router", mode: "Rules", branches: [{ to: "loop_1", when: "true" }], default: "loop_1" },
      endNode("end_a"),
      endNode("end_b", "Transferred"),
    ]);
    expect(reachableNodesFromTrigger(graph).sort()).toEqual(["body_1", "end_a", "end_b", "loop_1", "router_1", "trigger_1"]);
  });

  it("returns nothing for a graph with no Trigger (V1 makes this unreachable for a saved graph)", () => {
    expect(reachableNodesFromTrigger(graphOf("wf_no_trigger", [endNode("end_1"), endNode("end_2")]))).toEqual([]);
  });
});

describe("the Approved gate's three sandbox sub-checks each block INDEPENDENTLY", () => {
  it("blocks when no sandbox run is recorded at all", async () => {
    const ctx = await freshTenant();
    const version = await versionAtHumanReview(ctx, "wf_gate_none");
    await assertSandboxCheck(ctx, version.id, { allowed: false, reason: /no recorded sandbox run/ });
  });

  it("blocks when the recorded run belongs to a DIFFERENT version of the same workflow", async () => {
    const ctx = await freshTenant();
    const target = await versionAtHumanReview(ctx, "wf_gate_other");
    const sibling = await createFixtureWorkflowVersion(ctx, "wf_gate_other_sibling", routedNodes());
    const siblingRunId = await completedSandboxRun(ctx, sibling.id);

    await bindWorkflowVersionSandboxRun(ctx, target.id, siblingRunId);
    await assertSandboxCheck(ctx, target.id, { allowed: false, reason: /different version/ });
  });

  it("blocks when the recorded run did not SUCCEED", async () => {
    const ctx = await freshTenant();
    // A graph whose only path ends at `Failed` — a completed run, but not a successful one.
    const version = await versionAtHumanReview(ctx, "wf_gate_failed", [
      triggerNode("end_1"),
      endNode("end_1", "Failed"),
    ]);
    const runId = await completedSandboxRun(ctx, version.id);
    expect((await findWorkflowRunById(ctx, runId))!.state).toBe("Failed");

    await bindWorkflowVersionSandboxRun(ctx, version.id, runId);
    await assertSandboxCheck(ctx, version.id, { allowed: false, reason: /did not succeed/ });
  });

  it("blocks when the run succeeded but did not EXERCISE THE WHOLE GRAPH (FR-WF-02(c))", async () => {
    const ctx = await freshTenant();
    // A graph with a node no run of it will ever reach in one pass: the Router takes
    // `end_a`, so `end_b` never gets a step row.
    const version = await versionAtHumanReview(ctx, "wf_gate_coverage");
    const runId = await completedSandboxRun(ctx, version.id);
    expect((await findWorkflowRunById(ctx, runId))!.state).toBe("Succeeded");

    await bindWorkflowVersionSandboxRun(ctx, version.id, runId);
    // This is the real failure mode the bar exists to catch: a trivially-completing run
    // that left part of the graph untested.
    await assertSandboxCheck(ctx, version.id, { allowed: false, reason: /did not exercise the whole graph.*end_b/s });
  });

  it("ALLOWS when the run is this version's, succeeded, and covered every reachable node", async () => {
    const ctx = await freshTenant();
    // A single linear path, so one run genuinely covers the whole graph.
    const version = await versionAtHumanReview(ctx, "wf_gate_ok", [triggerNode("end_1"), endNode("end_1")]);
    const runId = await completedSandboxRun(ctx, version.id);
    await bindWorkflowVersionSandboxRun(ctx, version.id, runId);
    await assertSandboxCheck(ctx, version.id, { allowed: true });
  });
});

describe("the gate through the real transition endpoint", () => {
  it("still refuses Approved end-to-end, because this module's API surface has no eval-run trigger (Phase 15's disclosed consequence)", async () => {
    const ctx = await freshTenant();
    const version = await versionAtHumanReview(ctx, "wf_gate_e2e", [triggerNode("end_1"), endNode("end_1")]);
    const runId = await completedSandboxRun(ctx, version.id);
    await bindWorkflowVersionSandboxRun(ctx, version.id, runId);

    // The sandbox half is now genuinely satisfied — but the EVAL half is not, and the
    // refusal names that, not the sandbox. That distinction is the point: Phase 16
    // removed one blocker and did not silently paper over the other.
    await expect(transitionWorkflowVersion(ctx, version.id, "Approved", REVIEWER)).rejects.toBeInstanceOf(WorkflowPromotionBlockedError);
    await expect(transitionWorkflowVersion(ctx, version.id, "Approved", REVIEWER)).rejects.toThrow(/eval suite/i);
    expect(await getAllowedTransitions(ctx, version.id)).not.toContain("Approved");
  });
});

describe("the run API surface (LLD §14.6.5)", () => {
  it("sandbox-run is idempotent on its REQUIRED Idempotency-Key, and rejects a missing one", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_api_sandbox", routedNodes());
    const key = generateId();

    const first = await startSandboxRun(ctx, version.id, key, {});
    const replay = await startSandboxRun(ctx, version.id, key, {});
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.run.id).toBe(first.run.id);

    await expect(startSandboxRun(ctx, version.id, "   ", {})).rejects.toBeInstanceOf(WorkflowRunIdempotencyKeyRequiredError);
  });

  it("GET /workflow-runs/{id} returns the run, its OWN pinned graph, and its steps (FR-WF-07)", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_api_trace", routedNodes());
    const runId = await completedSandboxRun(ctx, version.id);

    const trace = await getRunWithTrace(ctx, runId);
    expect(trace.run.id).toBe(runId);
    // The graph is the RUN'S version's, so the trace renders over the artifact that
    // actually executed — not over whatever the workflow's current version is.
    expect(trace.graph.metadata.name).toBe("wf_api_trace");
    expect(trace.steps.map((s) => s.nodeId)).toContain("router_1");
    // `checkpoint_json` is deliberately not part of the DTO.
    expect(trace.run).not.toHaveProperty("checkpointJson");
  });

  it("the runs list filters by workflow version, state and outcome", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_api_list", routedNodes());
    const runId = await completedSandboxRun(ctx, version.id);

    expect((await listRuns(ctx, { workflowVersionId: version.id })).map((r) => r.id)).toContain(runId);
    expect((await listRuns(ctx, { state: "Succeeded" })).map((r) => r.id)).toContain(runId);
    expect((await listRuns(ctx, { outcome: "Resolved" })).map((r) => r.id)).toContain(runId);
    expect((await listRuns(ctx, { state: "Suspended" })).map((r) => r.id)).not.toContain(runId);
  });

  it("resume is a NUDGE — it never executes, and refuses a terminal or externally-blocked run", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_api_resume", routedNodes());

    // A Pending run is resumable (the pump will claim it) and nothing is executed here.
    const { run } = await startSandboxRun(ctx, version.id, generateId(), {});
    const nudged = await resumeRun(ctx, run.id);
    expect(nudged.state).toBe("Pending");
    expect(nudged.stepsExecuted).toBe(0);

    // A terminal run is not resumable.
    await cancelRun(ctx, run.id, "done", REVIEWER);
    await expect(resumeRun(ctx, run.id)).rejects.toBeInstanceOf(WorkflowRunNotActionableError);
  });
});
