import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, type TenantContext } from "@nextbot/db";
import { findToolCallById, type EgressPort } from "@nextbot/orchestration";
import { updateToolRules } from "@nextbot/tool-registry";
import { setPiiPolicy } from "@nextbot/pii";
import { deprecateVersion } from "@nextbot/skills";
import {
  createAgentInvoker,
  createEscalationRaiser,
  createRouterClassifier,
  createSkillInvoker,
  createStepMasker,
  createToolDispatcher,
} from "./orchestration-node-runtime.js";
import { activateTenant, bringConnectorConnectedForTool, createFixtureConversation } from "../testing/run-fixtures.js";
import { createFixtureAgentQueue, createFixtureSkillVersion, createFixtureTool } from "../testing/workflow-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.4) — the PRODUCTION node
 * runtime adapters, against real Postgres and the real sibling modules.
 *
 * These are the adapters that make FR-WF-03 true: a `ToolCall` node's only path to a tool
 * is `orchestration`'s existing tier engine, and a workflow has no other. The cases below
 * concentrate on the FAIL-CLOSED behaviours, because those are the ones a happy-path
 * integration test never reaches and the ones that matter if they regress.
 *
 * The model-calling adapters (`createSkillInvoker`, `createRouterClassifier`) are
 * exercised on their resolution/availability paths only — driving a real completion would
 * require a live provider, which this codebase deliberately does not do in tests
 * (`@nextbot/model-gateway` owns and tests the call path itself). Their node-level
 * semantics are covered exhaustively against the port in `node-executors.test.ts`.
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

function countingEgress(outcome: "Succeeded" | "Failed" = "Succeeded"): EgressPort & { calls: number } {
  const port = {
    calls: 0,
    async invokeTool() {
      port.calls += 1;
      return outcome === "Succeeded" ? ({ outcome: "Succeeded" as const, output: { ok: true } }) : ({ outcome: "Failed" as const, errorMessage: "backend down" });
    },
  };
  return port;
}

describe("createToolDispatcher — the ONLY path a workflow has to a tool (FR-WF-03)", () => {
  it("dispatches a Tier-1 tool through the egress port after the tier engine allows it", async () => {
    const ctx = await freshTenant();
    const egress = countingEgress();
    const toolId = await createFixtureTool(ctx, "wf_rt_read", "Read");
    await bringConnectorConnectedForTool(ctx, toolId);
    // The resolver is fail-closed: with no matching rule it denies (`no_matching_rule`),
    // so a dispatchable tool needs an explicit Allow — asserted on its own below.
    await updateToolRules(ctx, toolId, [{ scope: "Tool", toolId, ordinal: 0, conditions: {}, effect: "Allow", enabled: true }]);

    const result = await createToolDispatcher(ctx, { egress }).dispatch({
      toolId,
      args: { q: "x" },
      conversationId: null,
      idempotencyKey: generateId(),
      workflowRunStepId: generateId(),
    });

    expect(result.kind).toBe("Succeeded");
    expect(egress.calls).toBe(1);
  });

  it("DENIES a tool that no longer exists, rather than dispatching with a dangling id", async () => {
    const ctx = await freshTenant();
    const egress = countingEgress();
    const result = await createToolDispatcher(ctx, { egress }).dispatch({
      toolId: generateId(),
      args: {},
      conversationId: null,
      idempotencyKey: generateId(),
      workflowRunStepId: generateId(),
    });
    expect(result.kind).toBe("Denied");
    expect(egress.calls).toBe(0);
  });

  it("DENIES a tool behind an offline connector — the resolver's own fail-closed step 3", async () => {
    const ctx = await freshTenant();
    const egress = countingEgress();
    // Deliberately NOT brought online.
    const toolId = await createFixtureTool(ctx, "wf_rt_offline", "Read");

    const result = await createToolDispatcher(ctx, { egress }).dispatch({
      toolId,
      args: {},
      conversationId: null,
      idempotencyKey: generateId(),
      workflowRunStepId: generateId(),
    });
    expect(result.kind).toBe("Denied");
    if (result.kind === "Denied") expect(result.reason).toBe("connector_offline");
    expect(egress.calls).toBe(0);
  });

  it("DENIES a Tier-3 tool on a run with NO conversation, instead of executing above Tier-1", async () => {
    const ctx = await freshTenant();
    const egress = countingEgress();
    const toolId = await createFixtureTool(ctx, "wf_rt_tier3", "Write");
    await bringConnectorConnectedForTool(ctx, toolId);
    await updateToolRules(ctx, toolId, [{ scope: "Tool", toolId, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3", enabled: true }]);

    // A schedule/webhook-triggered run has no conversation, so there is no `tool_call`
    // row to suspend into. `runTierEngine` reports that as a denial — the fail-closed
    // outcome — and this adapter surfaces it verbatim rather than working around it.
    const result = await createToolDispatcher(ctx, { egress }).dispatch({
      toolId,
      args: {},
      conversationId: null,
      idempotencyKey: generateId(),
      workflowRunStepId: generateId(),
    });
    expect(result.kind).toBe("Denied");
    if (result.kind === "Denied") expect(result.reason).toBe("no_conversation_context");
    expect(egress.calls).toBe(0);
  });

  it("SUSPENDS a Tier-3 tool into the real Approval Queue when the run has a conversation, carrying the approval's own deadline", async () => {
    const ctx = await freshTenant();
    const egress = countingEgress();
    const conversationId = await createFixtureConversation(ctx);
    const toolId = await createFixtureTool(ctx, "wf_rt_tier3b", "Write");
    await bringConnectorConnectedForTool(ctx, toolId);
    await updateToolRules(ctx, toolId, [{ scope: "Tool", toolId, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3", enabled: true }]);

    const dispatcher = createToolDispatcher(ctx, { egress });
    const result = await dispatcher.dispatch({ toolId, args: { amount: 5 }, conversationId, idempotencyKey: generateId(), workflowRunStepId: generateId() });

    expect(result.kind).toBe("AwaitingApproval");
    if (result.kind !== "AwaitingApproval") return;
    expect(result.tier).toBe("Tier3");
    expect(result.approvalRequestId).not.toBeNull();
    expect(result.expiresAt).not.toBeNull();
    expect(egress.calls).toBe(0);

    // The read-back and expiry paths the reconciling pump and the expiry sweep use.
    expect((await dispatcher.readToolCallOutcome(result.toolCallId))!.status).toBe("AwaitingHumanApproval");
    expect(await dispatcher.readToolCallOutcome(generateId())).toBeNull();

    expect(await dispatcher.expireToolCall(result.toolCallId)).toEqual({ expired: true });
    expect((await findToolCallById(ctx, result.toolCallId))!.status).toBe("Expired");
    // Idempotent: a second sweep tick expires nothing new.
    expect(await dispatcher.expireToolCall(result.toolCallId)).toEqual({ expired: false });
  });

  it("reports a FAILED egress call as retriable rather than swallowing it", async () => {
    const ctx = await freshTenant();
    const egress = countingEgress("Failed");
    const toolId = await createFixtureTool(ctx, "wf_rt_fail", "Read");
    await bringConnectorConnectedForTool(ctx, toolId);
    await updateToolRules(ctx, toolId, [{ scope: "Tool", toolId, ordinal: 0, conditions: {}, effect: "Allow", enabled: true }]);

    const result = await createToolDispatcher(ctx, { egress }).dispatch({
      toolId,
      args: {},
      conversationId: null,
      idempotencyKey: generateId(),
      workflowRunStepId: generateId(),
    });
    expect(result.kind).toBe("Failed");
    if (result.kind === "Failed") expect(result.retriable).toBe(true);
  });

  it("catches a THROWN egress call — a workflow node must never propagate a transport error into the pump tick", async () => {
    const ctx = await freshTenant();
    const toolId = await createFixtureTool(ctx, "wf_rt_throw", "Read");
    await bringConnectorConnectedForTool(ctx, toolId);
    await updateToolRules(ctx, toolId, [{ scope: "Tool", toolId, ordinal: 0, conditions: {}, effect: "Allow", enabled: true }]);
    const egress: EgressPort = { async invokeTool() { throw new Error("socket hang up"); } };

    const result = await createToolDispatcher(ctx, { egress }).dispatch({
      toolId,
      args: {},
      conversationId: null,
      idempotencyKey: generateId(),
      workflowRunStepId: generateId(),
    });
    expect(result.kind).toBe("Failed");
    if (result.kind === "Failed") expect(result.errorMessage).toMatch(/socket hang up/);
  });

  it("resolves a tool's LIVE rw_class, so a reclassified tool still gets its compensation entry", async () => {
    const ctx = await freshTenant();
    const readId = await createFixtureTool(ctx, "wf_rt_rw_read", "Read");
    const writeId = await createFixtureTool(ctx, "wf_rt_rw_write", "Write");
    const dispatcher = createToolDispatcher(ctx, { egress: countingEgress() });

    expect(await dispatcher.resolveToolRwClass(readId)).toBe("Read");
    expect(await dispatcher.resolveToolRwClass(writeId)).toBe("Write");
    expect(await dispatcher.resolveToolRwClass(generateId())).toBeNull();
  });
});

describe("createAgentInvoker — availability is checked BEFORE dispatch (FR-ORC-10 discipline)", () => {
  it("reports a pinned version that no longer exists as unavailable, never as an answer", async () => {
    const ctx = await freshTenant();
    const result = await createAgentInvoker(ctx, { egress: countingEgress() }).invoke({
      agentDefinitionVersionId: generateId(),
      task: "anything",
      conversationId: null,
      agentRunId: null,
    });
    expect(result.unavailableReason).toMatch(/no longer exists/);
    expect(result.text).toBeNull();
  });

  it("does NOT report a live (Draft) pinned version as unavailable — only a missing or Deprecated one is", async () => {
    const ctx = await freshTenant();
    const { createFixtureAgentVersion } = await import("../testing/workflow-fixtures.js");
    const { versionId } = await createFixtureAgentVersion(ctx, "wf_rt_agent");

    // The turn itself needs a model route this fixture tenant does not have, so the
    // invocation degrades through the pipeline's own FR-AI-05 fallback — but the
    // AVAILABILITY pre-check, which is what this adapter owns, must not fire.
    const result = await createAgentInvoker(ctx, { egress: countingEgress() }).invoke({
      agentDefinitionVersionId: versionId,
      task: "anything",
      conversationId: null,
      agentRunId: null,
    });
    expect(result.unavailableReason).toBeUndefined();
    // The `Deprecated` branch is covered against the port in `node-executors.test.ts`
    // (`an UNAVAILABLE pinned version routes through onError`); `@nextbot/agent-platform`
    // exposes no public status setter to reach it here without inventing one.
  });
});

describe("the resolver is FAIL-CLOSED for a tool with no permission rule at all", () => {
  it("denies with `no_matching_rule` rather than defaulting to allow", async () => {
    const ctx = await freshTenant();
    const egress = countingEgress();
    const toolId = await createFixtureTool(ctx, "wf_rt_norule", "Read");
    await bringConnectorConnectedForTool(ctx, toolId);

    const result = await createToolDispatcher(ctx, { egress }).dispatch({
      toolId,
      args: {},
      conversationId: null,
      idempotencyKey: generateId(),
      workflowRunStepId: generateId(),
    });
    expect(result.kind).toBe("Denied");
    if (result.kind === "Denied") expect(result.reason).toBe("no_matching_rule");
    expect(egress.calls).toBe(0);
  });
});

describe("createSkillInvoker", () => {
  it("reports a missing pinned skill version as unavailable", async () => {
    const ctx = await freshTenant();
    const result = await createSkillInvoker(ctx).invoke({ skillVersionId: generateId(), task: "x" });
    expect(result.unavailableReason).toMatch(/no longer exists/);
  });

  it("reports a DEPRECATED pinned skill version as unavailable", async () => {
    const ctx = await freshTenant();
    const skillVersionId = await createFixtureSkillVersion(ctx, "wf_rt_skill");
    await deprecateVersion(ctx, skillVersionId);
    const result = await createSkillInvoker(ctx).invoke({ skillVersionId, task: "x" });
    expect(result.unavailableReason).toMatch(/Deprecated/);
  });

  it("degrades to `unavailableReason` rather than throwing when the model route cannot be resolved", async () => {
    const ctx = await freshTenant();
    const skillVersionId = await createFixtureSkillVersion(ctx, "wf_rt_skill_noroute");
    // This tenant has no `chat.primary` route, so the gateway call fails — which must be
    // an unavailability signal the node's `onError` handles, never a thrown pump tick.
    const result = await createSkillInvoker(ctx).invoke({ skillVersionId, task: "x" });
    expect(result.text).toBeNull();
    expect(result.unavailableReason).toBeTruthy();
  });
});

describe("createRouterClassifier", () => {
  it("abstains (choiceIndex null) when the pinned route version does not resolve — routing falls to the REQUIRED default", async () => {
    const ctx = await freshTenant();
    const result = await createRouterClassifier(ctx).classify({ routeVersionId: generateId(), text: "hello", choices: ["a", "b"] });
    expect(result.choiceIndex).toBeNull();
  });
});

describe("createEscalationRaiser", () => {
  it("raises a REAL escalation through @nextbot/escalations and reads its status back", async () => {
    const ctx = await freshTenant();
    const conversationId = await createFixtureConversation(ctx);
    await createFixtureAgentQueue(ctx, "wf_rt_queue");
    const raiser = createEscalationRaiser(ctx);

    const { escalationId } = await raiser.raise({
      conversationId,
      queueId: generateId(), // routing is `escalations`' own concern; it resolves its own queue
      reason: "CustomerRequest",
      prompt: "please review",
      runId: generateId(),
      nodeId: "human_1",
    });

    expect(await raiser.readEscalationStatus(escalationId)).toBe("Waiting");
    expect(await raiser.readEscalationStatus(generateId())).toBeNull();
  });

  it("ATTACHES to the one active escalation per conversation rather than raising a second (FR-ORC-06)", async () => {
    const ctx = await freshTenant();
    const conversationId = await createFixtureConversation(ctx);
    await createFixtureAgentQueue(ctx, "wf_rt_queue2");
    const raiser = createEscalationRaiser(ctx);
    const input = { conversationId, queueId: generateId(), reason: "CustomerRequest" as const, prompt: "p", runId: generateId(), nodeId: "human_1" };

    const first = await raiser.raise(input);
    const second = await raiser.raise({ ...input, nodeId: "human_2" });
    // `escalations`' own partial unique index is inherited unchanged — a second
    // Human-task node in the same conversation attaches, it does not fork a queue row.
    expect(second.escalationId).toBe(first.escalationId);
  });
});

describe("createStepMasker — the EXISTING @nextbot/pii masker, never a second path", () => {
  it("masks a configured PII entity out of a persisted step payload", async () => {
    const ctx = await freshTenant();
    // `ToolCallPayload` is the context a persisted workflow step uses (the same one
    // `@nextbot/teams`' delegation executor chose and documented).
    await setPiiPolicy(ctx, "Email", "ToolCallPayload", "Untrusted", "FullMask");

    const masked = await createStepMasker(ctx).mask({ note: "reach me at customer@example.com" });
    expect(JSON.stringify(masked)).not.toContain("customer@example.com");
  });

  it("normalizes null/undefined to null so a checkpoint stays schema-valid", async () => {
    const ctx = await freshTenant();
    const masker = createStepMasker(ctx);
    expect(await masker.mask(null)).toBeNull();
    expect(await masker.mask(undefined)).toBeNull();
  });

  it("passes non-PII structure through intact", async () => {
    const ctx = await freshTenant();
    expect(await createStepMasker(ctx).mask({ orderId: "ORD-1", total: 42, nested: { ok: true } })).toEqual({ orderId: "ORD-1", total: 42, nested: { ok: true } });
  });
});
