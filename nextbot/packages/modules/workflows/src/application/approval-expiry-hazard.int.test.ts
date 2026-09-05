import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { and, eq } from "drizzle-orm";
import { ApprovalExpiredError, type WorkflowNode } from "@nextbot/contracts";
import { decideTier3, findApprovalRequestByToolCallId, findToolCallById, listPendingApprovalRequests, type EgressPort } from "@nextbot/orchestration";
import { updateToolRules } from "@nextbot/tool-registry";
import { newWorkerInstanceId } from "./run-executor.js";
import { pumpWorkflowRuns, sweepWorkflowSuspensionExpiry } from "./run-pump.js";
import { startWorkflowRun } from "./run-service.js";
import { findWorkflowRunById, listWorkflowRunSteps } from "../infrastructure/workflow-run-repository.js";
import { createOrchestrationNodeRuntime } from "../infrastructure/orchestration-node-runtime.js";
import { activateTenant, bringConnectorConnectedForTool, createFixtureConversation, createFixtureWorkflowVersion, endNode, toolCallNode, triggerNode } from "../testing/run-fixtures.js";
import { createFixtureMcpServerVersion, createFixtureTool } from "../testing/workflow-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b) — **the ADR-0013 §7.4 hazard proof**
 * (verification item 9c).
 *
 * The hazard, in the ADR's own words:
 *
 * > a workflow run suspended on a Human task carries `suspension_ref =
 * > 'approval_request:<uuid>'`. If `workflow.suspension-expiry-sweep` expires the run but
 * > nothing expires the underlying `approval_request`, the result is an incoherent and
 * > genuinely unsafe state: an approver sees a live, actionable Tier-3 request in the
 * > queue for a run that has already terminated — and `decideTier3()` would happily CAS
 * > `AwaitingHumanApproval -> Executing` and dispatch a real Tier-3 write tool on behalf
 * > of a dead run.
 *
 * **This suite drives the REAL production node runtime**
 * (`createOrchestrationNodeRuntime`), not the scripted fake the other executor suites
 * use — because the property under test spans two modules' real state machines
 * (`workflows`' run FSM and `orchestration`'s `tool_call` FSM), and a fake on either
 * side would prove nothing about them agreeing. Everything below is real: a real
 * `tool`/`tool_permission_rule` that resolves to Tier-3, a real suspended `tool_call`, a
 * real `approval_request` in the Approval Queue, and a real `decideTier3` attempt with a
 * counting `EgressPort` that would record a dispatch if one ever escaped.
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

/** Records every egress invocation, so "no tool was ever dispatched for a dead run" is
 *  asserted against the real dispatch boundary rather than inferred from a status. */
function countingEgress(): EgressPort & { calls: number } {
  const port = {
    calls: 0,
    async invokeTool() {
      port.calls += 1;
      return { outcome: "Succeeded" as const, output: { ok: true } };
    },
  };
  return port;
}

/** A real write tool whose permission rule resolves to Tier-3, so `runTierEngine`
 *  genuinely suspends it into the Approval Queue — never a fixture that pretends to. */
async function tier3Workflow(ctx: TenantContext, name: string): Promise<{ versionId: string; toolId: string }> {
  const toolId = await createFixtureTool(ctx, `${name}_tool`, "Write");
  const compensateToolId = await createFixtureTool(ctx, `${name}_undo`, "Write");
  const serverVersionId = await createFixtureMcpServerVersion(ctx, `${name}_srv`);
  // A fixture connector starts `Offline`, and the resolver denies an offline
  // connector's tool before it ever reaches a rule — so this must be healthy for the
  // Tier-3 rule below to be the thing that decides the outcome.
  await bringConnectorConnectedForTool(ctx, toolId);
  await bringConnectorConnectedForTool(ctx, compensateToolId);

  // The REAL permission resolver decides the tier; this is what makes the suspension
  // genuine rather than staged. `RequireApproval` + `requiredTier: 'Tier3'` is the rule
  // shape LLD §3.6 defines (and whose DB CHECK pairs the two), so `runTierEngine`
  // resolves this tool exactly as it would for any hand-configured Tier-3 tool.
  await updateToolRules(ctx, toolId, [{ scope: "Tool", toolId, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3", enabled: true }]);

  const nodes: WorkflowNode[] = [
    triggerNode("approve_1"),
    toolCallNode("approve_1", toolId, serverVersionId, "end_1", {
      idempotency: { strategy: "RunScopedUuid" },
      compensation: { toolId: compensateToolId, argMapping: {} },
    }),
    endNode("end_1"),
  ];
  const version = await createFixtureWorkflowVersion(ctx, name, nodes);
  return { versionId: version.id, toolId };
}

/** Rewinds the suspension's deadline on BOTH sides — the run row and the approval row —
 *  which is what "24 hours later" looks like without sleeping for 24 hours. */
async function backdateSuspension(ctx: TenantContext, runId: string, toolCallId: string): Promise<void> {
  const past = new Date(Date.now() - 1000);
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.update(schema.workflowRun).set({ suspensionExpiresAt: past }).where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), eq(schema.workflowRun.id, runId)));
    await db.update(schema.toolCall).set({ expiresAt: past }).where(and(eq(schema.toolCall.tenantId, ctx.tenantId), eq(schema.toolCall.id, toolCallId)));
    await db.update(schema.approvalRequest).set({ expiresAt: past }).where(and(eq(schema.approvalRequest.tenantId, ctx.tenantId), eq(schema.approvalRequest.toolCallId, toolCallId)));
  });
}

async function suspendOnRealApproval(ctx: TenantContext, name: string) {
  const conversationId = await createFixtureConversation(ctx);
  const { versionId, toolId } = await tier3Workflow(ctx, name);
  const egress = countingEgress();
  const runtimeFor = (tenantCtx: TenantContext) => createOrchestrationNodeRuntime(tenantCtx, { egress });

  const { run } = await startWorkflowRun(ctx, { workflowVersionId: versionId, triggerKind: "Sandbox", idempotencyKey: generateId(), conversationId });

  for (let tick = 0; tick < 4; tick += 1) {
    const current = await findWorkflowRunById(ctx, run.id);
    if (current?.state === "Suspended") break;
    await pumpWorkflowRuns({ runtimeFor, owner: newWorkerInstanceId(), tenantIds: [ctx.tenantId] });
  }

  const suspended = (await findWorkflowRunById(ctx, run.id))!;
  const step = (await listWorkflowRunSteps(ctx, run.id)).find((s) => s.nodeId === "approve_1")!;
  return { run: suspended, step, egress, runtimeFor, conversationId, toolId };
}

describe("the workflow genuinely stops at the EXISTING Approval Queue (FR-WF-03 / ADR-0013 §2.3)", () => {
  it("a Tier-3 ToolCall node suspends the run and creates a real, visible Approval Queue row", async () => {
    const ctx = await freshTenant();
    const { run, step, egress } = await suspendOnRealApproval(ctx, "wf_tier3_stop");

    expect(run.state).toBe("Suspended");
    expect(run.suspensionKind).toBe("Approval");
    expect(run.suspensionRef).toMatch(/^approval_request:/);
    // FR-WF-05: no suspension is indefinite, and its expiry behaviour is declared.
    expect(run.suspensionExpiresAt).not.toBeNull();
    expect(run.suspensionExpiryOutcome).toBe("Timeout");

    // The step carries the correlation ids an approver's queue row joins back through.
    expect(step.status).toBe("Suspended");
    expect(step.toolCallId).not.toBeNull();
    expect(step.approvalRequestId).not.toBeNull();

    // The row is genuinely IN the existing Approval Queue — the same list the console
    // renders. There is no third, workflow-owned queue.
    const queue = await listPendingApprovalRequests(ctx);
    expect(queue.map((q) => q.toolCallId)).toContain(step.toolCallId);

    // Nothing was dispatched: the tool stopped at the gate, it did not execute.
    expect(egress.calls).toBe(0);
  });
});

describe("THE HAZARD — an expired workflow suspension can never leave an actionable queue row", () => {
  it("(a) the approval_request is genuinely Expired, (b) decideTier3 now throws ApprovalExpiredError, (c) the run reaches its declared outcome", async () => {
    const ctx = await freshTenant();
    const { run, step, egress, runtimeFor } = await suspendOnRealApproval(ctx, "wf_hazard");
    const toolCallId = step.toolCallId!;

    // Sanity: before the deadline, the request is live and actionable, and the run waits.
    expect((await findToolCallById(ctx, toolCallId))!.status).toBe("AwaitingHumanApproval");
    expect((await findApprovalRequestByToolCallId(ctx, toolCallId))!.status).toBe("AwaitingHumanApproval");

    await backdateSuspension(ctx, run.id, toolCallId);

    // One tick of the real sweep.
    const swept = await sweepWorkflowSuspensionExpiry(runtimeFor, new Date(), [ctx.tenantId]);
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect(swept.approvalsExpired).toBeGreaterThanOrEqual(1);

    // ---- (a) the approval is genuinely Expired, on BOTH rows ------------------
    expect((await findToolCallById(ctx, toolCallId))!.status).toBe("Expired");
    expect((await findApprovalRequestByToolCallId(ctx, toolCallId))!.status).toBe("Expired");
    // And it is gone from the queue an approver actually looks at.
    expect((await listPendingApprovalRequests(ctx)).map((q) => q.toolCallId)).not.toContain(toolCallId);

    // ---- (b) the previously-DEAD branch is now live ---------------------------
    // Before Phase 16, nothing ever produced `Expired`, so this branch was unreachable
    // and this Approve click would have CAS-ed to `Executing` and dispatched a real
    // Tier-3 write tool on behalf of a run that no longer exists.
    await expect(decideTier3(ctx, { egress }, toolCallId, "Approved", undefined, "00000000-0000-4000-8000-000000000002")).rejects.toBeInstanceOf(ApprovalExpiredError);
    expect(egress.calls).toBe(0);

    // ---- (c) the run reached its DECLARED expiry outcome, not left dangling ----
    const final = (await findWorkflowRunById(ctx, run.id))!;
    expect(final.state).toBe("TimedOut");
    expect(final.outcome).toBe("Timeout");
    expect((final.outcomeDetail as { reason: string }).reason).toBe("SUSPENSION_EXPIRED");
    expect(final.endedAt).not.toBeNull();
    // Suspension fields cleared, per `workflow_run_suspension_consistent`.
    expect(final.suspensionKind).toBeNull();
    expect(final.suspensionRef).toBeNull();
  });

  it("(d) NO INTERLEAVING leaves an actionable queue row for a terminated run — the approval is always expired first", async () => {
    const ctx = await freshTenant();
    const { run, step, egress, runtimeFor } = await suspendOnRealApproval(ctx, "wf_hazard_order");
    const toolCallId = step.toolCallId!;
    await backdateSuspension(ctx, run.id, toolCallId);

    // Observe the two rows immediately after each other at the ONLY moment an
    // interleaving could exist. The sweep expires the approval FIRST and terminates the
    // run SECOND, so the unsafe direction (run terminated, approval still actionable) is
    // structurally unreachable; only the safe direction (approval Expired, run briefly
    // still Suspended) can be observed, and it self-heals on the next tick.
    await sweepWorkflowSuspensionExpiry(runtimeFor, new Date(), [ctx.tenantId]);

    const call = (await findToolCallById(ctx, toolCallId))!;
    const finalRun = (await findWorkflowRunById(ctx, run.id))!;

    const runTerminated = ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(finalRun.state);
    const approvalActionable = call.status === "AwaitingHumanApproval";
    // THE INVARIANT: never both.
    expect(runTerminated && approvalActionable).toBe(false);

    // And whichever half is observed, an Approve attempt cannot dispatch anything.
    await expect(decideTier3(ctx, { egress }, toolCallId, "Approved", undefined, "00000000-0000-4000-8000-000000000002")).rejects.toBeInstanceOf(ApprovalExpiredError);
    expect(egress.calls).toBe(0);
  });

  it("(e) the sweep is idempotent — repeated ticks neither re-expire the approval nor re-terminate the run", async () => {
    const ctx = await freshTenant();
    const { run, step, runtimeFor } = await suspendOnRealApproval(ctx, "wf_hazard_idem");
    await backdateSuspension(ctx, run.id, step.toolCallId!);

    const first = await sweepWorkflowSuspensionExpiry(runtimeFor, new Date(), [ctx.tenantId]);
    const before = (await findWorkflowRunById(ctx, run.id))!;
    const second = await sweepWorkflowSuspensionExpiry(runtimeFor, new Date(), [ctx.tenantId]);
    const after = (await findWorkflowRunById(ctx, run.id))!;

    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(second.expired).toBe(0);
    expect(second.approvalsExpired).toBe(0);
    expect(after.endedAt?.getTime()).toBe(before.endedAt?.getTime());
    expect(after.outcome).toBe(before.outcome);
  });

  it("a run whose approval is APPROVED (not expired) resumes and completes — the expiry path is not the only path", async () => {
    const ctx = await freshTenant();
    const { run, step, egress, runtimeFor } = await suspendOnRealApproval(ctx, "wf_hazard_approved");
    const toolCallId = step.toolCallId!;

    // A real human approves through the real decision function, which executes the tool.
    const decision = await decideTier3(ctx, { egress }, toolCallId, "Approved", undefined, "00000000-0000-4000-8000-000000000002");
    expect(decision.applied).toBe(true);
    expect(egress.calls).toBe(1);
    expect((await findToolCallById(ctx, toolCallId))!.status).toBe("Succeeded");

    // The reconciling pump observes the decided call and wakes the run — the
    // authoritative wake-up path, with no queue and no delayed job.
    for (let tick = 0; tick < 5; tick += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (current?.state === "Succeeded") break;
      await pumpWorkflowRuns({ runtimeFor, owner: newWorkerInstanceId(), tenantIds: [ctx.tenantId] });
    }

    const final = (await findWorkflowRunById(ctx, run.id))!;
    expect(final.state).toBe("Succeeded");
    expect(final.outcome).toBe("Resolved");
    // The approved tool executed exactly once — resuming did not dispatch it again.
    expect(egress.calls).toBe(1);
  });

  it("a REJECTED approval fails the node through its declared onError, and never dispatches", async () => {
    const ctx = await freshTenant();
    const { run, step, egress, runtimeFor } = await suspendOnRealApproval(ctx, "wf_hazard_rejected");
    const toolCallId = step.toolCallId!;

    await decideTier3(ctx, { egress }, toolCallId, "Rejected", "not authorised", "00000000-0000-4000-8000-000000000002");
    expect(egress.calls).toBe(0);

    for (let tick = 0; tick < 5; tick += 1) {
      const current = await findWorkflowRunById(ctx, run.id);
      if (current && ["Succeeded", "Failed", "TimedOut", "Cancelled"].includes(current.state)) break;
      await pumpWorkflowRuns({ runtimeFor, owner: newWorkerInstanceId(), tenantIds: [ctx.tenantId] });
    }

    const final = (await findWorkflowRunById(ctx, run.id))!;
    // `onError` defaults to `fail`, so a human saying no stops the run — it is not
    // swallowed, and it is not treated as success.
    expect(final.state).toBe("Failed");
    expect(egress.calls).toBe(0);

    const failedStep = (await listWorkflowRunSteps(ctx, run.id)).filter((s) => s.nodeId === "approve_1").at(-1)!;
    expect(failedStep.error?.code).toBe("WORKFLOW_TOOL_APPROVAL_NOT_GRANTED");
  });
});
