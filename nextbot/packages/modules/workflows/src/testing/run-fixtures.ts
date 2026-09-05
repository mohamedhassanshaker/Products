import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { eq } from "drizzle-orm";
import type { JsonValue, WorkflowGraph, WorkflowNode, WorkflowRunLimits } from "@nextbot/contracts";
import type { AgentInvokeResult, ClassifyResult, SkillInvokeResult, ToolDispatchInput, ToolDispatchResult, WorkflowNodeRuntime } from "../ports/node-runtime.js";
import { createWorkflow } from "../application/workflow-service.js";
import type { WorkflowVersionRow } from "../infrastructure/workflow-repository.js";

/**
 * **TEST-ONLY** fixtures for the durable-execution suites (Target Architecture Blueprint
 * Phase 16, BL-47b). Deliberately NOT exported from `src/index.ts` — the same convention
 * `testing/workflow-fixtures.ts`, `@nextbot/db/testing` and `@nextbot/teams`'
 * `testing/team-fixtures.ts` all follow.
 *
 * Two things live here:
 *
 *  1. **Graph builders** — small, real `WorkflowGraph`s that satisfy every V1-V12 rule,
 *     so a run fixture is always a graph the real save path would have accepted.
 *  2. **`createFakeNodeRuntime`** — a scripted `WorkflowNodeRuntime`. This is the port
 *     `@nextbot/teams` established for the identical reason: it lets the EXECUTOR's own
 *     crash/lease/budget/compensation logic be exercised deterministically without
 *     standing up a model provider or an MCP server. The PRODUCTION runtime
 *     (`infrastructure/orchestration-node-runtime.ts`) is real and is what the
 *     approval-hazard suite drives, so the fake is never standing in for an
 *     unimplemented integration.
 *
 * Crucially, the fake **records every dispatch by idempotency key**, which is how the
 * crash-resume suite asserts the real downstream side effect happened EXACTLY ONCE —
 * not merely that a key was passed.
 */

export const TEST_RUN_LIMITS: WorkflowRunLimits = {
  maxSteps: 50,
  maxCostUsd: 5,
  maxWallClockSeconds: 300,
  maxLoopIterations: 10,
  maxParallelBranches: 4,
  maxSubWorkflowDepth: 3,
};

const SYSTEM_USER = "00000000-0000-4000-8000-000000000001";

/** Builds a valid `WorkflowGraph` from a node list. Every fixture graph goes through the
 *  REAL `createWorkflow` save path (below), so a graph that would fail V1-V12 fails the
 *  fixture loudly rather than producing a run of an artifact that could never exist. */
export function graphOf(name: string, nodes: WorkflowNode[], limits: Partial<WorkflowRunLimits> = {}): WorkflowGraph {
  return {
    apiVersion: "nextbot.io/v1",
    kind: "Workflow",
    metadata: { name, version: 1 },
    spec: { nodes, runLimits: { ...TEST_RUN_LIMITS, ...limits } },
  };
}

export function triggerNode(next: string, id = "trigger_1"): WorkflowNode {
  return { id, kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next };
}

export function endNode(id: string, outcome: "Resolved" | "Escalated" | "Transferred" | "Failed" = "Resolved"): WorkflowNode {
  return { id, kind: "End", outcome };
}

export function toolCallNode(
  id: string,
  toolId: string,
  mcpServerVersionId: string,
  next: string,
  overrides: Partial<Extract<WorkflowNode, { kind: "ToolCall" }>> = {},
): WorkflowNode {
  return { id, kind: "ToolCall", toolId, mcpServerVersionId, argMapping: {}, outputVariable: `${id}_out`, next, ...overrides } as WorkflowNode;
}

/** Persists a real `workflow` + version-1 `workflow_version` through the module's own
 *  public save path (never a hand-rolled insert), so every fixture graph is one the real
 *  validator accepted. */
export async function createFixtureWorkflowVersion(ctx: TenantContext, name: string, nodes: WorkflowNode[], limits: Partial<WorkflowRunLimits> = {}): Promise<WorkflowVersionRow> {
  const artifact = graphOf(name, nodes, limits);
  const { version } = await createWorkflow(ctx, { name, artifact }, SYSTEM_USER);
  return version;
}

/** A real `channel` + `conversation` pair. Required for any run that must suspend into
 *  the Approval Queue (`tool_call.conversation_id` is a NOT NULL FK) or raise an
 *  escalation. Same shape as `@nextbot/teams`' own fixture. */
export async function createFixtureConversation(ctx: TenantContext): Promise<string> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const channelId = generateId();
    const suffix = `${channelId.slice(0, 8)}${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(schema.channel).values({
      id: channelId,
      tenantId: ctx.tenantId,
      type: "WebWidget",
      name: `Widget ${suffix}`,
      environment: "Sandbox",
      config: {},
      publicKey: `pk_${channelId}`,
    });
    const conversationId = generateId();
    await db.insert(schema.conversation).values({ id: conversationId, tenantId: ctx.tenantId, channelId, language: "en" });
    return conversationId;
  });
}

/**
 * Brings a fixture tool's connector `Connected`.
 *
 * `connector.status` defaults to `Offline` until a real health probe succeeds, and the
 * permission resolver's step 3 denies any tool behind an offline connector
 * (`connector_offline`) BEFORE it ever evaluates a rule. So a suite that needs a tool to
 * actually resolve to a tier — rather than to be denied — has to make its connector
 * healthy first, exactly as a real tenant's would be.
 *
 * Deliberately a separate helper rather than a change to `createFixtureTool`: Phase 15's
 * graph-validator suites rely on that fixture as-is (V9/V10 resolve references and fold
 * scope; neither consults connector health), and quietly changing shared fixture
 * behaviour to suit a new suite is how a passing test stops meaning what it says.
 */
export async function bringConnectorConnectedForTool(ctx: TenantContext, toolId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select({ connectorId: schema.tool.connectorId }).from(schema.tool).where(eq(schema.tool.id, toolId));
    const connectorId = rows[0]?.connectorId;
    if (!connectorId) return;
    await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connectorId));
  });
}

/** `listActiveTenantContexts()` — which every cross-tenant sweep iterates — selects
 *  `status = 'Active'`, while `createFixtureTenant` leaves the column default `Trial`.
 *  The same one-line fixture step `conversations`' idle-sweeper and `escalations`'
 *  workforce suite already use. */
export async function activateTenant(ctx: TenantContext): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) => db.update(schema.tenant).set({ status: "Active" }).where(eq(schema.tenant.id, ctx.tenantId)));
}

// ---------------------------------------------------------------------------
// The scripted node runtime
// ---------------------------------------------------------------------------

export interface DispatchRecord {
  toolId: string;
  idempotencyKey: string;
  args: Record<string, JsonValue>;
}

export interface FakeNodeRuntime extends WorkflowNodeRuntime {
  /** Every `dispatch` call, in order. */
  dispatches: DispatchRecord[];
  /**
   * **The exactly-once oracle.** The set of DISTINCT idempotency keys the fake has
   * "applied" — the fake models a downstream tool that deduplicates on the key, exactly
   * as a real write-classified tool is required to (FR-WF-04). So
   * `appliedEffects.length` is the number of real side effects, and
   * `dispatches.length` is the number of attempts. The crash-resume proof asserts the
   * FORMER is 1 while the latter is 2.
   */
  appliedEffects: string[];
  /** Set to make the next dispatch throw, simulating a crash mid-tool-call. */
  failNextDispatch: boolean;
  /** Per-tool rw_class, so a node's compensation entry is pushed for the right tools. */
  rwClasses: Map<string, "Read" | "Write">;
  /** Scripted `tool_call` statuses, keyed by tool-call id, for the reconciling pump. */
  toolCallOutcomes: Map<string, { status: string; output: unknown; errorMessage: string | null }>;
  /** Scripted approval suspensions: dispatching this tool returns `AwaitingApproval`. */
  suspendingTools: Map<string, { toolCallId: string; approvalRequestId: string; expiresAt: Date }>;
  escalationStatuses: Map<string, "Waiting" | "InProgress" | "Resolved" | "ReturnedToBot">;
  raisedEscalations: string[];
  agentResult: AgentInvokeResult;
  skillResult: SkillInvokeResult;
  classifyResult: ClassifyResult;
}

/**
 * A `WorkflowNodeRuntime` whose behaviour is fully scripted and fully observable.
 *
 * The masker is deliberately the IDENTITY here rather than a stub that redacts
 * everything: masking is `@nextbot/pii`'s own already-tested concern (and the production
 * adapter wires the real masker), whereas these suites are about executor mechanics, and
 * a redacting stub would make every `output` assertion read as a masking assertion.
 */
export function createFakeNodeRuntime(overrides: Partial<FakeNodeRuntime> = {}): FakeNodeRuntime {
  const runtime: FakeNodeRuntime = {
    dispatches: [],
    appliedEffects: [],
    failNextDispatch: false,
    rwClasses: new Map(),
    toolCallOutcomes: new Map(),
    suspendingTools: new Map(),
    escalationStatuses: new Map(),
    raisedEscalations: [],
    agentResult: { outcome: "answered", text: "agent said so", costUsd: "0.01" },
    skillResult: { text: "skill said so", costUsd: "0.002" },
    classifyResult: { choiceIndex: 0, costUsd: "0.0001" },

    tools: {
      async dispatch(input: ToolDispatchInput): Promise<ToolDispatchResult> {
        runtime.dispatches.push({ toolId: input.toolId, idempotencyKey: input.idempotencyKey, args: input.args });

        const suspension = runtime.suspendingTools.get(input.toolId);
        if (suspension) {
          return { kind: "AwaitingApproval", toolCallId: suspension.toolCallId, approvalRequestId: suspension.approvalRequestId, tier: "Tier3", expiresAt: suspension.expiresAt };
        }

        if (runtime.failNextDispatch) {
          runtime.failNextDispatch = false;
          // A THROW, not a `Failed` result — this models a process/connection death
          // mid-call, which is the case the crash-resume proof needs. The side effect
          // below is recorded FIRST, so the fake behaves like a real backend that
          // applied the write and then lost the connection before answering.
          if (!runtime.appliedEffects.includes(input.idempotencyKey)) runtime.appliedEffects.push(input.idempotencyKey);
          throw new Error("simulated worker crash mid tool call");
        }

        // The dedupe a real write-classified tool is required to implement (FR-WF-04).
        if (!runtime.appliedEffects.includes(input.idempotencyKey)) runtime.appliedEffects.push(input.idempotencyKey);
        return { kind: "Succeeded", output: { ok: true, toolId: input.toolId }, costUsd: "0.01" };
      },
      async readToolCallOutcome(toolCallId: string) {
        return runtime.toolCallOutcomes.get(toolCallId) ?? null;
      },
      async expireToolCall(toolCallId: string) {
        const existing = runtime.toolCallOutcomes.get(toolCallId);
        if (!existing || existing.status === "Expired") return { expired: false };
        runtime.toolCallOutcomes.set(toolCallId, { ...existing, status: "Expired" });
        return { expired: true };
      },
      async resolveToolRwClass(toolId: string) {
        return runtime.rwClasses.get(toolId) ?? "Read";
      },
    },

    agents: { async invoke() { return runtime.agentResult; } },
    skills: { async invoke() { return runtime.skillResult; } },
    classifier: { async classify() { return runtime.classifyResult; } },

    escalations: {
      async raise() {
        const escalationId = generateId();
        runtime.raisedEscalations.push(escalationId);
        runtime.escalationStatuses.set(escalationId, "Waiting");
        return { escalationId };
      },
      async readEscalationStatus(escalationId: string) {
        return runtime.escalationStatuses.get(escalationId) ?? null;
      },
    },

    masker: { async mask(value: unknown) { return value ?? null; } },

    ...overrides,
  };
  return runtime;
}
