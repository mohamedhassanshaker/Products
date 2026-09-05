import { generateId, type TenantContext } from "@nextbot/db";
import type { DelegationChainEntry, MessagePayload } from "@nextbot/contracts";
import { ApprovalAlreadyDecidedError, ApprovalExpiredError, ApprovalNoteRequiredError, ToolCallNotFoundError } from "@nextbot/contracts";
import type { EgressPort } from "../ports/egress.js";
import { maskArgsForLogging } from "../domain/mask-args.js";
import { selectRenderedCard } from "../domain/render-selection.js";
import { maskToolOutputForRendering } from "./mask-tool-output.js";
import { toolCallFailureFallback } from "../domain/fallback-messages.js";
import {
  appendToolCallEvent,
  claimToolCallTransition,
  completeToolCallExecution,
  createApprovalRequest,
  createToolCall,
  findApprovalRequestByToolCallId,
  findToolCallById,
  updateApprovalRequestStatus,
  type ToolCallRow,
} from "../infrastructure/tool-call-repository.js";
import { appendDomainEvent } from "../infrastructure/domain-event-repository.js";
import { TIER2_TIMEOUT_MS, TIER3_TIMEOUT_MS } from "./approval-expiry-service.js";

// Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4) — **this gap is now
// closed.** Phase 14's original comment here read "Tier-2's 900s timeout (LLD §6.4
// default) has no expiry-sweeper this phase … Tier-3's timeout below is still
// recorded on `approval_request.expires_at` even though nothing sweeps it yet".
// `application/approval-expiry-service.ts` + `apps/worker`'s `approvals.expiry-sweep`
// (60s) are that sweeper, and BOTH tiers now stamp the already-existing-but-never-
// written `tool_call.expires_at` below so the sweep has a deadline to scan. That is
// what finally makes `decideTier2()`/`decideTier3()`'s `ApprovalExpiredError` branch —
// shipped and unit-tested since Phase 14, but until now unreachable — genuinely live.
// The timeout constants themselves live in the expiry service so the writer of the
// deadline and the sweeper of the deadline can never drift apart.

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-04, LLD §14.7.3 step 5) —
 * the delegation chain that produced this call, when it was made by a team member
 * rather than by a single agent. Threaded here (rather than re-derived at read
 * time) because the terminal hop's own `delegation_event` row does not exist yet at
 * the moment the call suspends — it is written when the hop completes — so a
 * read-time join would be missing exactly the hop an approver most needs to see.
 *
 * Entirely optional and additive: every pre-existing caller passes nothing and gets
 * byte-identical behavior, including an unchanged `risk_summary` shape.
 */
export interface ToolCallDelegationContext {
  agentRunId: string;
  /** Supervisor first, terminal specialist last. */
  chain: DelegationChainEntry[];
}

export interface CreateSuspendedCallInput {
  conversationId: string;
  toolId: string;
  toolName: string;
  connectorId: string | null;
  args: Record<string, unknown>;
  tier: "Tier2" | "Tier3";
  delegation?: ToolCallDelegationContext;
}

/**
 * LLD §6.2 steps 6/7 for the two suspending tiers. Creates the `Created` row,
 * immediately transitions it to the tier's suspended state, and (Tier-3 only) opens
 * the `approval_request` queue row. Returns the payload the turn pipeline renders
 * into the conversation (a Confirmation card for Tier-2, or nothing — Tier-3 is
 * queue-only, no customer-facing card per the screen inventory).
 */
export async function createSuspendedToolCall(
  ctx: TenantContext,
  input: CreateSuspendedCallInput,
): Promise<{ toolCall: ToolCallRow; payload: MessagePayload | null }> {
  const masked = maskArgsForLogging(input.args);
  // ADR-0013 §7.4 — computed ONCE and used for both `tool_call.expires_at` (which
  // `approvals.expiry-sweep` scans, for both tiers) and, for Tier-3, the
  // `approval_request.expires_at` the queue UI renders as "expires in". Deriving both
  // from the same instant is what guarantees the queue and the sweeper can never
  // disagree about when a request stops being actionable.
  const expiresAt = new Date(Date.now() + (input.tier === "Tier2" ? TIER2_TIMEOUT_MS : TIER3_TIMEOUT_MS));
  const row = await createToolCall(ctx, {
    conversationId: input.conversationId,
    toolId: input.toolId,
    toolName: input.toolName,
    connectorId: input.connectorId,
    approvalTier: input.tier,
    inputArgs: input.args,
    inputArgsMasked: masked,
    agentRunId: input.delegation?.agentRunId ?? null,
    expiresAt,
  });

  const suspendedStatus = input.tier === "Tier2" ? "AwaitingCustomerConfirmation" : "AwaitingHumanApproval";
  await claimToolCallTransition(ctx, row.id, ["Created"], suspendedStatus);
  await appendToolCallEvent(ctx, {
    toolCallId: row.id,
    fromStatus: "Created",
    toStatus: suspendedStatus,
    actorType: "System",
    accepted: true,
  });

  if (input.tier === "Tier3") {
    await createApprovalRequest(ctx, {
      toolCallId: row.id,
      conversationId: input.conversationId,
      expiresAt,
      riskSummary: {
        toolName: input.toolName,
        argsMasked: masked,
        // FR-ORC-04: "the Approval Queue must display the full delegation chain
        // that produced the request so an approver has enough context, not just
        // the terminal agent's name." Absent (key not written at all) for a
        // non-delegated call, so no existing consumer of `risk_summary` sees a
        // shape change.
        ...(input.delegation ? { delegationChain: input.delegation.chain, agentRunId: input.delegation.agentRunId } : {}),
      },
    });
    await appendDomainEvent(ctx, {
      type: "orchestration.tool_call.awaiting_human_approval",
      payload: {
        toolCallId: row.id,
        toolId: input.toolId,
        toolName: input.toolName,
        args: masked,
        ...(input.delegation
          ? {
              // FR-ORC-08 — the audit entry for a delegated tool call is attributed
              // to the terminal agent, with the full path in `details`. The `actor`
              // COLUMN shape is unchanged (audit's outbox mapper already reads
              // `payload.actorLabel`), so no existing audit query breaks.
              actorLabel: `agent:${input.delegation.chain[input.delegation.chain.length - 1]?.agentLabel ?? "unknown"}`,
              delegationChain: input.delegation.chain,
              correlationId: input.delegation.agentRunId,
              targetType: "tool_call",
              targetId: row.id,
            }
          : {}),
      },
    });
    // Tier-3 has no customer-facing card (screen inventory: queue-only, admin-side) —
    // the turn pipeline instead tells the customer conversationally that a human
    // needs to approve this before it proceeds.
    return { toolCall: row, payload: null };
  }

  await appendDomainEvent(ctx, {
    type: "orchestration.tool_call.awaiting_customer_confirmation",
    payload: { toolCallId: row.id, toolId: input.toolId, toolName: input.toolName, args: masked },
  });

  return {
    toolCall: row,
    payload: {
      contentType: "Confirmation",
      toolCallId: row.id,
      title: `Confirm: ${input.toolName}`,
      summary: Object.entries(masked).map(([label, value]) => ({ label, value: String(value) })),
      disclaimer: "Please review the details above before confirming.",
      state: "pending",
    },
  };
}

interface DecisionOutcome {
  /** `false` if the decision could not be applied (already decided / expired / not
   * claimed by this caller due to a race) — the caller must not treat this as success. */
  applied: boolean;
  toolCall: ToolCallRow;
  /** The message to post back into the conversation, if any (execution result,
   * rejection notice, or nothing for a still-pending MoreInfoRequested). */
  resultPayload: MessagePayload | null;
}

/** LLD §6.4 — Tier-2 customer Confirm/Cancel. Cancel performs **zero backend
 * mutation** beyond the FSM's own bookkeeping (no tool call ever reaches the MCP
 * server) — the defining Tier-2 guarantee. */
export async function decideTier2(
  ctx: TenantContext,
  deps: { egress: EgressPort },
  toolCallId: string,
  decision: "Confirm" | "Cancel",
): Promise<DecisionOutcome> {
  const existing = await findToolCallById(ctx, toolCallId);
  if (!existing) throw new ToolCallNotFoundError();
  if (existing.approvalTier !== "Tier2") throw new ToolCallNotFoundError();

  if (existing.status === "Expired") throw new ApprovalExpiredError();
  if (existing.status !== "AwaitingCustomerConfirmation") {
    // Already decided by a prior (possibly concurrent) request — logged as a
    // rejected duplicate attempt (LLD §6.3), not silently re-applied.
    await appendToolCallEvent(ctx, {
      toolCallId,
      fromStatus: existing.status,
      toStatus: existing.status,
      actorType: "Customer",
      accepted: false,
      note: `duplicate ${decision} attempt`,
    });
    throw new ApprovalAlreadyDecidedError();
  }

  if (decision === "Cancel") {
    const { claimed, row } = await claimToolCallTransition(ctx, toolCallId, ["AwaitingCustomerConfirmation"], "Cancelled");
    await appendToolCallEvent(ctx, {
      toolCallId,
      fromStatus: "AwaitingCustomerConfirmation",
      toStatus: "Cancelled",
      actorType: "Customer",
      accepted: claimed,
    });
    if (!claimed) throw new ApprovalAlreadyDecidedError();
    return { applied: true, toolCall: row as ToolCallRow, resultPayload: null };
  }

  // Confirm — CAS-claim into Executing; the loser of a race never reaches the MCP server.
  const claim = await claimToolCallTransition(ctx, toolCallId, ["AwaitingCustomerConfirmation"], "Executing");
  await appendToolCallEvent(ctx, {
    toolCallId,
    fromStatus: "AwaitingCustomerConfirmation",
    toStatus: "Executing",
    actorType: "Customer",
    accepted: claim.claimed,
  });
  if (!claim.claimed || !claim.row) throw new ApprovalAlreadyDecidedError();

  return executeAndComplete(ctx, deps, claim.row);
}

/** LLD §6.5 — Tier-3 human Approve/Reject/MoreInfoRequested. */
export async function decideTier3(
  ctx: TenantContext,
  deps: { egress: EgressPort },
  toolCallId: string,
  decision: "Approved" | "Rejected" | "MoreInfoRequested",
  note: string | undefined,
  actorUserId: string,
): Promise<DecisionOutcome> {
  if ((decision === "Rejected" || decision === "MoreInfoRequested") && !note?.trim()) {
    throw new ApprovalNoteRequiredError();
  }

  const existing = await findToolCallById(ctx, toolCallId);
  if (!existing) throw new ToolCallNotFoundError();
  if (existing.approvalTier !== "Tier3") throw new ToolCallNotFoundError();
  if (existing.status === "Expired") throw new ApprovalExpiredError();
  if (existing.status !== "AwaitingHumanApproval") {
    await appendToolCallEvent(ctx, {
      toolCallId,
      fromStatus: existing.status,
      toStatus: existing.status,
      actorType: "HumanAgent",
      actorUserId,
      accepted: false,
      note: `duplicate ${decision} attempt`,
    });
    throw new ApprovalAlreadyDecidedError();
  }

  if (decision === "MoreInfoRequested") {
    // Stays AwaitingHumanApproval (self-loop, LLD §6.5) — pending call is not discarded.
    const claim = await claimToolCallTransition(ctx, toolCallId, ["AwaitingHumanApproval"], "AwaitingHumanApproval", {
      decisionNote: note ?? null,
      decidedByUserId: actorUserId,
    });
    await appendToolCallEvent(ctx, {
      toolCallId,
      fromStatus: "AwaitingHumanApproval",
      toStatus: "AwaitingHumanApproval",
      actorType: "HumanAgent",
      actorUserId,
      note,
      accepted: claim.claimed,
    });
    if (!claim.claimed || !claim.row) throw new ApprovalAlreadyDecidedError();
    const approvalRequest = await findApprovalRequestByToolCallId(ctx, toolCallId);
    if (approvalRequest) await updateApprovalRequestStatus(ctx, approvalRequest.id, "AwaitingHumanApproval", note);
    return { applied: true, toolCall: claim.row, resultPayload: { contentType: "Text", text: note ?? "" } };
  }

  if (decision === "Rejected") {
    const claim = await claimToolCallTransition(ctx, toolCallId, ["AwaitingHumanApproval"], "Cancelled", {
      decisionNote: note ?? null,
      decidedByUserId: actorUserId,
    });
    await appendToolCallEvent(ctx, {
      toolCallId,
      fromStatus: "AwaitingHumanApproval",
      toStatus: "Cancelled",
      actorType: "HumanAgent",
      actorUserId,
      note,
      accepted: claim.claimed,
    });
    if (!claim.claimed || !claim.row) throw new ApprovalAlreadyDecidedError();
    const approvalRequest = await findApprovalRequestByToolCallId(ctx, toolCallId);
    if (approvalRequest) await updateApprovalRequestStatus(ctx, approvalRequest.id, "Cancelled");
    return {
      applied: true,
      toolCall: claim.row,
      resultPayload: { contentType: "Text", text: `Your request was declined: ${note}` },
    };
  }

  // Approved — CAS-claim into Executing; only one of any concurrent decision calls wins.
  const claim = await claimToolCallTransition(ctx, toolCallId, ["AwaitingHumanApproval"], "Executing", {
    decisionNote: note ?? null,
    decidedByUserId: actorUserId,
  });
  await appendToolCallEvent(ctx, {
    toolCallId,
    fromStatus: "AwaitingHumanApproval",
    toStatus: "Executing",
    actorType: "HumanAgent",
    actorUserId,
    note,
    accepted: claim.claimed,
  });
  if (!claim.claimed || !claim.row) throw new ApprovalAlreadyDecidedError();
  const approvalRequest = await findApprovalRequestByToolCallId(ctx, toolCallId);
  if (approvalRequest) await updateApprovalRequestStatus(ctx, approvalRequest.id, "Executing");

  return executeAndComplete(ctx, deps, claim.row);
}

/**
 * Shared `Executing` -> terminal path for both tiers' "go ahead" decision. Per LLD
 * §6.5's resume-degraded precedent (schema drift after a deploy degrades to
 * "execute + post result directly, log resume_degraded"): this phase's turn
 * pipeline has no stateful ADK session to literally resume (goal/tool-selection is
 * a single `generateStructured` call, not a running graph — see Phase 12's own
 * disclosed deviation), so every Tier-2/3 resume takes this same, always-disclosed
 * degraded-equivalent path: execute for real (through the exact-once CAS claim
 * above) and hand the caller a rendered result/failure card to post into the
 * conversation as a fresh AI message. This is a deliberate, bounded simplification
 * of full ADK checkpoint/resume — flagged explicitly in this phase's report.
 */
async function executeAndComplete(ctx: TenantContext, deps: { egress: EgressPort }, claimed: ToolCallRow): Promise<DecisionOutcome> {
  const toolCallId = generateId(); // egress-facing id, distinct from the persisted tool_call.id
  try {
    const result = await deps.egress.invokeTool({
      toolCallId,
      tenantId: ctx.tenantId,
      toolId: claimed.toolId,
      connectorId: claimed.connectorId ?? "",
      toolName: claimed.toolName,
      args: claimed.inputArgs,
      idempotencyKey: claimed.idempotencyKey,
    });

    if (result.outcome === "Succeeded") {
      await completeToolCallExecution(ctx, claimed.id, { status: "Succeeded", output: result.output });
      await appendToolCallEvent(ctx, { toolCallId: claimed.id, fromStatus: "Executing", toStatus: "Succeeded", actorType: "System", accepted: true });
      const row = (await findToolCallById(ctx, claimed.id)) as ToolCallRow;
      // QA Final Review S3: same PII masking applied to the live-turn rendering
      // path (`turn-pipeline.ts`) — a Tier-3-approved tool's real output goes
      // through the same customer-facing render, so it needs the same masking.
      const maskedOutput = await maskToolOutputForRendering(ctx, result.output);
      return { applied: true, toolCall: row, resultPayload: selectRenderedCard(claimed.toolName, maskedOutput) };
    }

    const errorMessage = result.outcome === "Denied" ? result.reason : result.errorMessage;
    await completeToolCallExecution(ctx, claimed.id, { status: "Failed", errorMessage });
    await appendToolCallEvent(ctx, { toolCallId: claimed.id, fromStatus: "Executing", toStatus: "Failed", actorType: "System", accepted: true, note: errorMessage });
    await appendDomainEvent(ctx, {
      type: "orchestration.tool_call.failed",
      payload: { toolCallId: claimed.id, toolId: claimed.toolId, toolName: claimed.toolName, errorMessage, args: maskArgsForLogging(claimed.inputArgs) },
    });
    const row = (await findToolCallById(ctx, claimed.id)) as ToolCallRow;
    return { applied: true, toolCall: row, resultPayload: toolCallFailureFallback() };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await completeToolCallExecution(ctx, claimed.id, { status: "Failed", errorMessage });
    await appendToolCallEvent(ctx, { toolCallId: claimed.id, fromStatus: "Executing", toStatus: "Failed", actorType: "System", accepted: true, note: errorMessage });
    const row = (await findToolCallById(ctx, claimed.id)) as ToolCallRow;
    return { applied: true, toolCall: row, resultPayload: toolCallFailureFallback() };
  }
}
