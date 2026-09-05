import { DomainError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { findUserById } from "@nextbot/iam";
import { insertMessage, publishConversationEvent } from "@nextbot/conversations";
import {
  claimEscalationTransition,
  claimEscalationWithCeilingCheck,
  reassignEscalationWithLoadTransfer,
  findEscalationById,
  type EscalationRow,
} from "../infrastructure/escalation-repository.js";
import { ensureAgentPresence } from "../infrastructure/agent-presence-repository.js";

export class EscalationAlreadyClaimedError extends DomainError {
  readonly httpStatus = 409;
  readonly code = "ESCALATION_ALREADY_CLAIMED";
  constructor() {
    super("This escalation has already been claimed or is no longer waiting.");
  }
}

/**
 * Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — "a queue with zero
 * available agents does not silently accept unbounded assignments": a claim attempt
 * past a human agent's configured `max_concurrent` is rejected outright, never
 * silently over-assigned. The escalation stays `Waiting` (never a partial state
 * change) — see `escalation-repository.ts#claimEscalationWithCeilingCheck`'s doc for
 * the atomicity guarantee.
 */
export class AgentAtConcurrencyCeilingError extends DomainError {
  readonly httpStatus = 409;
  readonly code = "AGENT_AT_CONCURRENCY_CEILING";
  constructor() {
    super("This agent is already at their configured concurrent-conversation ceiling.");
  }
}

/**
 * FR-ESC-02 "Take Over" — CAS-claims `Waiting -> InProgress` (LLD §5.8: `409
 * ESCALATION_ALREADY_CLAIMED` on a lost race, mirroring Phase 14's tool-call
 * CAS-claim concurrency pattern so two agents clicking "Take Over" on the same row at
 * the same instant resolve to exactly one winner, never a duplicate assignment).
 * Posts the exact A.2.11 "Agent [Name] has joined the conversation." system message.
 *
 * Phase 13 (BL-45, FR-ESC-05) addition: the claim is now paired, in one atomic
 * transaction, with a concurrency-ceiling check-and-increment against the claiming
 * agent's own `agent_presence.current_load`/`max_concurrent` — see
 * `claimEscalationWithCeilingCheck`'s doc for why this can't be a separate
 * read-then-write step. `ensureAgentPresence` auto-provisions a default
 * (`Offline`/3/0) row the first time this user is ever referenced, per FR-ESC-05's
 * own "no separate provisioning step" requirement.
 */
export async function claimEscalation(ctx: TenantContext, escalationId: string, userId: string): Promise<EscalationRow> {
  await ensureAgentPresence(ctx, userId);

  const result = await claimEscalationWithCeilingCheck(ctx, escalationId, userId);
  if (result.outcome === "at_ceiling") {
    throw new AgentAtConcurrencyCeilingError();
  }
  if (result.outcome === "lost_race") {
    throw new EscalationAlreadyClaimedError();
  }
  const row = result.row;

  const agent = await findUserById(ctx, userId);
  const agentName = agent?.displayName ?? "A support agent";
  // QA fix (D5): spec's exact quoted copy (A.2.11) is "Agent [Name] has joined the
  // conversation." — the literal word "Agent" was previously missing.
  const systemMessage = await insertMessage(ctx, {
    conversationId: row.conversationId,
    sender: "System",
    contentType: "Text",
    payload: { contentType: "Text", text: `Agent ${agentName} has joined the conversation.` },
  });
  publishConversationEvent(row.conversationId, {
    event: "message",
    data: {
      message: {
        id: systemMessage.id,
        conversationId: systemMessage.conversationId,
        sequence: systemMessage.sequence,
        sender: systemMessage.sender,
        contentType: systemMessage.contentType,
        payload: systemMessage.payload,
        confidenceScore: systemMessage.confidenceScore,
        createdAt: systemMessage.createdAt.toISOString(),
      },
    },
  });
  publishConversationEvent(row.conversationId, { event: "conversation", data: { status: "Escalated" } });

  return row;
}

/**
 * FR-ESC-03's "Reassign" action (B.5.1) — moves a still-non-terminal escalation to a
 * different queue and/or a different agent without changing its status (an
 * `InProgress -> InProgress` self-loop, or a no-op status change while `Waiting`).
 *
 * Phase 13 (BL-45, FR-ESC-05) addition: when `input.agentId` actually changes the
 * assigned agent on an `InProgress` escalation, the outgoing agent's concurrency slot
 * is released and the incoming agent's is atomically ceiling-checked + claimed (same
 * `409 AGENT_AT_CONCURRENCY_CEILING` as the initial claim). The pre-existing
 * queue-only / agent-unchanged reassign shape (still exercised by the Live Takeover
 * Panel's "Transfer to queue" action) is untouched — it never affects any agent's
 * load, so it stays on the original `claimEscalationTransition` path.
 */
export async function reassignEscalation(
  ctx: TenantContext,
  escalationId: string,
  input: { queueId?: string; agentId?: string | null },
  actorUserId: string,
): Promise<EscalationRow> {
  const existing = await findEscalationById(ctx, escalationId);
  if (!existing) throw new Error(`reassignEscalation: escalation ${escalationId} not found`);

  const agentChanging = input.agentId !== undefined && input.agentId !== existing.assignedAgentId && existing.status === "InProgress";

  if (!agentChanging) {
    const { row } = await claimEscalationTransition(ctx, escalationId, [existing.status], existing.status, {
      queueId: input.queueId ?? null,
      assignedAgentId: input.agentId ?? undefined,
    });
    if (!row) throw new Error(`reassignEscalation: escalation ${escalationId} disappeared mid-update`);
    return row;
  }

  const incomingAgentId = input.agentId ?? null;
  if (incomingAgentId) {
    // Never trust a client-supplied agent id without an ownership/tenant check —
    // `findUserById` is itself tenant-scoped (RLS), so a cross-tenant id resolves to
    // `null` here exactly as it would for any other lookup in this codebase.
    const target = await findUserById(ctx, incomingAgentId);
    if (!target) throw new Error(`reassignEscalation: agent ${incomingAgentId} not found for this tenant`);
    await ensureAgentPresence(ctx, incomingAgentId);
  }

  if (!existing.assignedAgentId) {
    throw new Error(`reassignEscalation: escalation ${escalationId} has no currently-assigned agent to reassign from`);
  }

  const result = await reassignEscalationWithLoadTransfer(
    ctx,
    escalationId,
    existing.assignedAgentId,
    incomingAgentId,
    input.queueId,
    actorUserId,
  );
  if (result.outcome === "at_ceiling") throw new AgentAtConcurrencyCeilingError();
  if (result.outcome === "lost_race") throw new Error(`reassignEscalation: escalation ${escalationId} disappeared mid-update`);
  return result.row;
}
