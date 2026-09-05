import type { TenantContext } from "@nextbot/db";
import type { JsonValue } from "@nextbot/contracts";
import {
  expireSuspendedToolCall,
  findApprovalRequestByToolCallId,
  findToolCallById,
  runTierEngine,
  runTurnPipeline,
  type EgressPort,
} from "@nextbot/orchestration";
import { findToolById } from "@nextbot/tool-registry";
import { findAgentDefinitionVersionById } from "@nextbot/agent-platform";
import { findSkillVersionById } from "@nextbot/skills";
import { callModelGatewayText, getRouteOrThrow, getRouteVersion } from "@nextbot/model-gateway";
import { findEscalationById, triggerEscalation } from "@nextbot/escalations";
import { buildPolicyLookup, listCustomPiiRulesForMasking, maskJsonValue } from "@nextbot/pii";
import type {
  AgentInvokeInput,
  AgentInvokeResult,
  AgentInvoker,
  ClassifyInput,
  ClassifyResult,
  EscalationRaiser,
  RaiseEscalationInput,
  RouterClassifier,
  SkillInvokeInput,
  SkillInvokeResult,
  SkillInvoker,
  StepMasker,
  ToolDispatchInput,
  ToolDispatchResult,
  ToolDispatcher,
  WorkflowNodeRuntime,
} from "../ports/node-runtime.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, **LLD §14.6.4**) — the PRODUCTION
 * implementations of `ports/node-runtime.ts`.
 *
 * **This file is where FR-WF-03 ("tool tiering survives orchestration") is made true,
 * and it is made true structurally rather than by checking.** LLD §14.6.4:
 *
 * > The `ToolCall` node executor **does not call the MCP client**. It calls
 * > `orchestration`'s existing tool-call pipeline … That pipeline is where `resolve()`,
 * > `evaluate()`, guardrails, tiering, the approval interrupt and idempotency already
 * > live. A workflow therefore *cannot* route around tiering, because it has no other
 * > path to a tool.
 *
 * Three things enforce that here, and each is independently sufficient:
 *
 *  1. `dispatchTool` below goes through `runTierEngine` — the identical function a
 *     single agent's tool call and a team delegation hop both use — and only reaches
 *     `EgressPort` for a `Tier1Executable` resolution. There is no other code path in
 *     this module that can reach a tool.
 *  2. `workflows` may not import `@nextbot/mcp-client` at all, enforced by the
 *     `no-mcp-client-inside-workflows` dependency-cruiser rule (same shape as
 *     `no-neo4j-driver-outside-graph-store` and `no-raw-authz-evaluate-outside-authz`).
 *     A future dispatcher that tried to open its own MCP connection would fail the lint
 *     gate, not a code review.
 *  3. `workflows` has no `EgressPort` implementation of its own — the composition root
 *     supplies `apps/gateway`'s, exactly as `orchestration` does. This module cannot
 *     open an outbound connection (ADR-0004).
 */

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function createToolDispatcher(ctx: TenantContext, deps: { egress: EgressPort }): ToolDispatcher {
  return {
    async dispatch(input: ToolDispatchInput): Promise<ToolDispatchResult> {
      const tool = await findToolById(ctx, input.toolId);
      if (!tool) {
        return { kind: "Denied", reason: `Tool '${input.toolId}' is no longer present in this tenant's catalog.` };
      }

      // Step 1 — `resolve()` + tiering, through the EXACT function every other tool
      // caller in this codebase uses. A Tier-2/Tier-3 resolution creates the real
      // `tool_call` (+ `approval_request` for Tier-3) and returns
      // `SuspendedForApproval`; this module never constructs either row itself.
      //
      // `callContext` is supplied only when the run has a conversation. Without one,
      // `runTierEngine` returns a `PolicyDenied` with reason `no_conversation_context`
      // rather than executing above Tier-1 — its own long-standing, deliberate
      // behaviour, and exactly the fail-closed outcome a workflow needs. It is
      // surfaced to the author as a node denial, never worked around.
      const tier = await runTierEngine(
        ctx,
        input.toolId,
        {},
        input.conversationId
          ? {
              conversationId: input.conversationId,
              tool: { toolId: tool.id, toolName: tool.name, connectorId: tool.connectorId },
              args: input.args as Record<string, unknown>,
            }
          : undefined,
      );

      if (tier.kind === "PolicyDenied") {
        return { kind: "Denied", reason: tier.resolution.reason ?? "policy_denied" };
      }

      if (tier.kind === "SuspendedForApproval") {
        const approval = await findApprovalRequestByToolCallId(ctx, tier.toolCallId);
        const call = await findToolCallById(ctx, tier.toolCallId);
        return {
          kind: "AwaitingApproval",
          toolCallId: tier.toolCallId,
          approvalRequestId: approval?.id ?? null,
          tier: tier.resolution.tier ?? "Tier3",
          // The approval's OWN deadline — the same instant `approvals.expiry-sweep`
          // scans — so the run and the queue row are governed by one clock, which is
          // the whole point of ADR-0013 §7.4.
          expiresAt: call?.expiresAt ?? approval?.expiresAt ?? null,
        };
      }

      // Tier-1 executable. `connectorId` comes straight off the already-resolved tool
      // row, exactly as `orchestration`'s own turn pipeline does — this module has no
      // dependency on `@nextbot/connectors` and never resolves credentials itself
      // (ADR-0004: that is the gateway's job, on the other side of `EgressPort`).
      if (tool.connectorId === null) {
        return { kind: "Denied", reason: "This tool has no connector and cannot be dispatched from a workflow." };
      }

      try {
        const result = await deps.egress.invokeTool({
          toolCallId: input.workflowRunStepId,
          tenantId: ctx.tenantId,
          toolId: tool.id,
          connectorId: tool.connectorId,
          toolName: tool.name,
          args: input.args as Record<string, unknown>,
          // FR-WF-04's key, deterministic across a crash-resume — see
          // `domain/idempotency.ts` for why that determinism is the whole safety story.
          idempotencyKey: input.idempotencyKey,
        });
        if (result.outcome === "Succeeded") return { kind: "Succeeded", output: result.output, costUsd: "0" };
        if (result.outcome === "Denied") return { kind: "Denied", reason: result.reason };
        return { kind: "Failed", errorMessage: result.errorMessage, retriable: true };
      } catch (err) {
        return { kind: "Failed", errorMessage: err instanceof Error ? err.message : String(err), retriable: true };
      }
    },

    async readToolCallOutcome(toolCallId: string) {
      const call = await findToolCallById(ctx, toolCallId);
      if (!call) return null;
      return { status: call.status, output: call.output, errorMessage: call.errorMessage };
    },

    async expireToolCall(toolCallId: string) {
      // `orchestration`'s SHARED primitive (ADR-0013 §7.4) — never a `tool_call` write
      // of this module's own, so the Approval Queue and a workflow suspension are
      // governed by one mechanism rather than two clocks that can disagree.
      const result = await expireSuspendedToolCall(ctx, toolCallId);
      return { expired: result.expired };
    },

    async resolveToolRwClass(toolId: string) {
      const tool = await findToolById(ctx, toolId);
      return tool?.rwClass ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * Runs a PINNED `agent_definition_version` through `@nextbot/orchestration`'s EXISTING
 * turn pipeline — the same thing `@nextbot/teams`' `createTurnPipelineSpecialistRunner`
 * does for a delegated team member, and for the same reason: any Tier-3 tool call the
 * agent makes during its turn takes the ordinary path to the Approval Queue, at any
 * depth, because the pipeline's own `runTierEngine` call is what handles it.
 *
 * Availability is checked BEFORE dispatch (a deprecated or deleted pinned version) so a
 * node never consumes a tool-call row or an approval slot for an agent that cannot run —
 * mirroring the FR-ORC-10 discipline `teams`' delegation executor already established.
 */
export function createAgentInvoker(ctx: TenantContext, deps: { egress: EgressPort }): AgentInvoker {
  return {
    async invoke(input: AgentInvokeInput): Promise<AgentInvokeResult> {
      const version = await findAgentDefinitionVersionById(ctx, input.agentDefinitionVersionId);
      if (!version) return { outcome: "not_understood", text: null, costUsd: "0", unavailableReason: "The pinned agent version no longer exists." };
      if (version.status === "Deprecated") {
        return { outcome: "not_understood", text: null, costUsd: "0", unavailableReason: "The pinned agent version is Deprecated." };
      }

      const result = await runTurnPipeline(ctx, deps, {
        customerText: input.task,
        agentDefinitionVersionId: input.agentDefinitionVersionId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      });

      const text = typeof (result.payload as { text?: unknown }).text === "string" ? ((result.payload as { text: string }).text) : null;
      // Mapped from the turn's own already-established signals rather than from a
      // second classifier — identical to how `teams`' specialist runner maps them.
      if (result.escalationSignal) return { outcome: "escalate", text, costUsd: "0" };
      if (result.payload.contentType === "Error" && (result.payload as { reason?: string }).reason === "GoalNotUnderstood") {
        return { outcome: "not_understood", text, costUsd: "0" };
      }
      return { outcome: "answered", text, costUsd: "0" };
    },
  };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/**
 * Invokes a PINNED `skill_version` as a SINGLE model call — LLD §14.6.3's own
 * distinction between an `Agent` node (a full turn: goal selection, tool catalog,
 * guardrails, tiering) and a `Skill` node (one skill, no turn).
 *
 * **Disclosed design choice.** A skill artifact declares `instructions`, a `trigger` and
 * `successCriteria`, but no model route of its own — `@nextbot/skills` has no executor,
 * because until now skills were only ever *composed into* an agent version. Rather than
 * inventing a skill-level route field (a schema change the LLD does not specify), this
 * runs the skill's `instructions` as the system prompt through the tenant's existing
 * `chat.primary` logical route.
 *
 * That route key is a LOGICAL name resolved by the Model Gateway, never a vendor model
 * id, so provider choice stays env/registry-driven exactly as ADR-0011 requires — this
 * adapter imports no provider SDK and knows nothing about which model answers.
 */
export function createSkillInvoker(ctx: TenantContext): SkillInvoker {
  return {
    async invoke(input: SkillInvokeInput): Promise<SkillInvokeResult> {
      const version = await findSkillVersionById(ctx, input.skillVersionId);
      if (!version) return { text: null, costUsd: "0", unavailableReason: "The pinned skill version no longer exists." };
      if (version.status === "Deprecated") return { text: null, costUsd: "0", unavailableReason: "The pinned skill version is Deprecated." };

      // `skill_version` stores the artifact's fields as real columns rather than as a
      // blob, so the prompt is composed from those directly — no re-parse of the stored
      // YAML, and no second place that has to know the artifact's shape.
      const system = [version.instructions, version.successCriteria ? `Success criteria: ${version.successCriteria}` : ""].filter(Boolean).join("\n\n");

      try {
        const text = await callModelGatewayText(ctx, { routeKey: "chat.primary", system, messages: [{ role: "user", content: input.task }] });
        return { text, costUsd: "0" };
      } catch (err) {
        return { text: null, costUsd: "0", unavailableReason: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Router classifier
// ---------------------------------------------------------------------------

/**
 * Classifies a `Router` node's branches through the PINNED `model_route_version`.
 *
 * The graph validator already proved at save time that this route is router-class
 * (`isRouterClassRoute`, FR-AGT-23's cheap-route guidance), so this adapter does not
 * re-litigate the choice — it resolves the version to its route's logical KEY and calls
 * the gateway with it, keeping provider selection registry-driven.
 *
 * The model is asked for a bare index and anything unparseable becomes `null`, which
 * routes to the Router's REQUIRED `default` (V11). A classifier can therefore never
 * dead-end a run, only choose or abstain.
 */
export function createRouterClassifier(ctx: TenantContext): RouterClassifier {
  return {
    async classify(input: ClassifyInput): Promise<ClassifyResult> {
      const routeVersion = await getRouteVersion(ctx, input.routeVersionId);
      if (!routeVersion) return { choiceIndex: null, costUsd: "0" };
      const route = await getRouteOrThrow(ctx, routeVersion.routeId);

      const system =
        "You are a routing classifier. Choose the single option that best matches the input. " +
        "Reply with ONLY the zero-based index of your choice, as a bare integer. No other text.";
      const listed = input.choices.map((choice, index) => `${index}: ${choice}`).join("\n");
      const text = await callModelGatewayText(ctx, {
        routeKey: route.name,
        system,
        messages: [{ role: "user", content: `Options:\n${listed}\n\nInput:\n${input.text}` }],
      });

      const match = /-?\d+/.exec(text ?? "");
      const parsed = match ? Number(match[0]) : Number.NaN;
      const valid = Number.isInteger(parsed) && parsed >= 0 && parsed < input.choices.length;
      return { choiceIndex: valid ? parsed : null, costUsd: "0" };
    },
  };
}

// ---------------------------------------------------------------------------
// Escalations
// ---------------------------------------------------------------------------

/**
 * Raises a real `escalation` through `@nextbot/escalations`' own `triggerEscalation` —
 * ADR-0013 §2.3's "routes into an EXISTING queue; there is no third queue".
 *
 * `skipConnectingMessage` is set: a workflow's Human-task node is not a customer-facing
 * turn, so posting `escalations`' "connecting you to a human" copy into the transcript
 * would be a message the customer never prompted. FR-ORC-06's
 * one-active-escalation-per-conversation guarantee is `escalations`' own partial unique
 * index and is inherited unchanged — a second Human-task node in the same conversation
 * attaches rather than raising a second escalation.
 */
export function createEscalationRaiser(ctx: TenantContext): EscalationRaiser {
  return {
    async raise(input: RaiseEscalationInput) {
      const result = await triggerEscalation(ctx, {
        conversationId: input.conversationId,
        reason: input.reason,
        reasonDetail: { source: "workflow", runId: input.runId, nodeId: input.nodeId, prompt: input.prompt },
        aiContextSnapshot: { recognizedGoal: null, workflowRunId: input.runId, workflowNodeId: input.nodeId, prompt: input.prompt },
        skipConnectingMessage: true,
      });
      // `created: false` means a concurrent trigger already opened THE one active
      // escalation for this conversation (FR-ORC-06's partial unique index). Attaching
      // to it is the correct outcome — the run suspends on the escalation that exists,
      // never on a second one this node tried to create.
      return { escalationId: result.escalation.id };
    },

    async readEscalationStatus(escalationId: string) {
      const row = await findEscalationById(ctx, escalationId);
      return row?.status ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// PII masking
// ---------------------------------------------------------------------------

/**
 * Masks a step's persisted `input`/`output` through `@nextbot/pii`'s EXISTING masker —
 * LLD §14.6.2's own instruction, and deliberately not a second masking path.
 *
 * Context is `ToolCallPayload`, the same context `@nextbot/teams`' delegation executor
 * chose and documented: this codebase's `PiiContext` vocabulary (FR-SEC-04) names that
 * context for "text this system hands to a downstream executor rather than to a human",
 * and a persisted workflow step payload is exactly that. Trust level is `Untrusted` —
 * the most aggressive masking the policy allows — because a `workflow_run_step` row is
 * read by the Runs trace viewer and retained under `FR-ADM-06`, so it is the wrong place
 * to be permissive.
 *
 * The tenant's policy lookup and custom rules are resolved ONCE per runtime construction
 * (i.e. once per pump tick), not per step: a pass can mask dozens of payloads and
 * re-reading the policy for each would dominate the tick's cost for no behavioural gain.
 */
export function createStepMasker(ctx: TenantContext): StepMasker {
  let cached: Promise<{ resolvePolicy: Awaited<ReturnType<typeof buildPolicyLookup>>; customRules: Awaited<ReturnType<typeof listCustomPiiRulesForMasking>> }> | null = null;

  return {
    async mask(value: unknown): Promise<unknown> {
      if (value === null || value === undefined) return null;
      cached ??= (async () => ({ resolvePolicy: await buildPolicyLookup(ctx), customRules: await listCustomPiiRulesForMasking(ctx) }))();
      const { resolvePolicy, customRules } = await cached;
      return maskJsonValue(value as JsonValue, "ToolCallPayload", "Untrusted", resolvePolicy, customRules);
    },
  };
}

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

/**
 * Builds the whole production `WorkflowNodeRuntime` for one tenant.
 *
 * `egress` is supplied by the composition root (`apps/worker`), never constructed here —
 * ADR-0004's egress discipline: this module has no outbound network access of its own,
 * exactly like `orchestration`.
 */
export function createOrchestrationNodeRuntime(ctx: TenantContext, deps: { egress: EgressPort }): WorkflowNodeRuntime {
  return {
    tools: createToolDispatcher(ctx, deps),
    agents: createAgentInvoker(ctx, deps),
    skills: createSkillInvoker(ctx),
    classifier: createRouterClassifier(ctx),
    escalations: createEscalationRaiser(ctx),
    masker: createStepMasker(ctx),
  };
}
