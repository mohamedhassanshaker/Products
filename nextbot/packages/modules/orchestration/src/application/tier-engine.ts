import { resolveToolPermission, type ResolverContext } from "@nextbot/tool-registry";
import type { TenantContext } from "@nextbot/db";
import type { MessagePayload, PermissionResolution } from "@nextbot/contracts";
import { createSuspendedToolCall, type ToolCallDelegationContext } from "./approval-service.js";

/**
 * `PERMIT` + `ROUTE` (LLD §6.2 steps 4/7). Wraps `@nextbot/tool-registry`'s
 * `resolveToolPermission` (the same fail-closed resolver the Admin Console's
 * "simulate" panel uses) so the pipeline and the admin preview can never disagree
 * about what a given call resolves to.
 *
 * Phase 14 (BL-08) extends this from the Phase-12 Tier-1-only stub to genuinely
 * suspend Tier-2/3 calls: a Tier-2 resolution creates a `tool_call` row in
 * `AwaitingCustomerConfirmation` and returns a Confirmation card payload for the
 * turn pipeline to post; a Tier-3 resolution creates the row plus an
 * `approval_request` queue entry in `AwaitingHumanApproval` and returns no
 * customer-facing card (queue-only, per the screen inventory).
 */
export type TierOutcome =
  | { kind: "Tier1Executable"; resolution: PermissionResolution }
  | { kind: "PolicyDenied"; resolution: PermissionResolution }
  | { kind: "SuspendedForApproval"; resolution: PermissionResolution; toolCallId: string; payload: MessagePayload | null }
  /**
   * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5, LLD §15.5) — a Tier-2/3
   * call made by a turn running in `executionMode: "Shadow"`.
   *
   * **No `tool_call` row and no `approval_request` row are created.** A shadow-mode
   * approval request landing in a real approver's queue would be a serious defect: a human
   * would be asked to authorize an action for a customer conversation that is not actually
   * waiting on it, against a version that is not actually serving them.
   *
   * Deliberately a NEW, DISTINCT outcome rather than reusing the existing
   * `PolicyDenied{reason: "no_conversation_context"}` shortcut below. "The candidate wanted
   * a Tier-3 call" is precisely the finding a reviewer needs out of a shadow experiment;
   * labelling it a denial would hide it behind a reason that means something else entirely.
   * `wouldHaveTier` carries the tier it *would* have required, which is what the shadow
   * report renders.
   */
  | { kind: "ShadowSuppressed"; resolution: PermissionResolution; wouldHaveTier: "Tier2" | "Tier3" };

export interface TierEngineToolInfo {
  toolId: string;
  toolName: string;
  connectorId: string | null;
}

/**
 * `callContext` is only consulted when the resolution actually requires suspension
 * (Tier-2/3) — the many Tier-1/PolicyDenied call sites and tests that predate BL-08
 * never need to supply a conversation, so it stays optional here rather than forcing
 * every existing caller to thread one through for a branch that never uses it.
 *
 * **Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-04)**: `callContext.
 * delegation`, when present, carries the delegation chain that produced this call
 * so the Approval Queue can render "billing_agent@9, delegated by triage@14" rather
 * than a bare terminal name. It changes nothing about tiering itself — that is the
 * entire point: a Tier-3 call made by a team member at depth N takes THIS SAME path
 * to the Approval Queue, at every depth, because delegation reuses the ordinary
 * tool-call pipeline instead of a parallel one.
 */
export async function runTierEngine(
  ctx: TenantContext,
  toolId: string,
  resolverCtx: ResolverContext,
  callContext?: {
    conversationId: string;
    tool: TierEngineToolInfo;
    args: Record<string, unknown>;
    delegation?: ToolCallDelegationContext;
  },
  /**
   * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5) — optional and
   * additive; defaults to `"Live"`, so every caller that predates shadow evaluation
   * behaves byte-identically. See the `ShadowSuppressed` outcome's doc above.
   */
  executionMode: "Live" | "Shadow" = "Live",
): Promise<TierOutcome> {
  const resolution = await resolveToolPermission(ctx, toolId, resolverCtx);

  if (resolution.effect === "Deny") {
    return { kind: "PolicyDenied", resolution };
  }
  if (resolution.tier === "Tier1" || resolution.tier === null) {
    return { kind: "Tier1Executable", resolution };
  }

  // Phase 17: checked BEFORE the `no_conversation_context` shortcut below, and before
  // `createSuspendedToolCall` is reachable at all, so a shadow turn can never write a
  // `tool_call`/`approval_request` row no matter what conversation context it carries
  // (a shadow replay genuinely does carry a real `conversationId` — it replays against
  // the real conversation — so relying on the missing-context path would NOT have
  // contained it).
  if (executionMode === "Shadow") {
    return { kind: "ShadowSuppressed", resolution, wouldHaveTier: resolution.tier };
  }

  if (!callContext?.conversationId) {
    // Tier-2/3 suspension needs a durable `tool_call` row scoped to a real
    // conversation (LLD §6.2) — a caller with no conversation context (e.g. a
    // sandbox/dry run) cannot suspend, so this is surfaced as a policy denial
    // rather than silently executing a call above Tier-1 or crashing on a missing FK.
    return { kind: "PolicyDenied", resolution: { effect: "Deny", tier: resolution.tier, matchedRuleId: null, reason: "no_conversation_context" } };
  }

  const { toolCall, payload } = await createSuspendedToolCall(ctx, {
    conversationId: callContext.conversationId,
    toolId: callContext.tool.toolId,
    toolName: callContext.tool.toolName,
    connectorId: callContext.tool.connectorId,
    args: callContext.args,
    tier: resolution.tier,
    delegation: callContext.delegation,
  });
  return { kind: "SuspendedForApproval", resolution, toolCallId: toolCall.id, payload };
}
