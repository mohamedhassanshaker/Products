import type { TenantContext } from "@nextbot/db";
import { findChannelById } from "@nextbot/channels";
import {
  findConversationById,
  insertMessage,
  publishConversationEvent,
  updateConversationStatus,
  // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — the "agent handling a
  // linked conversation can see prior context from the customer's other-channel
  // conversation(s)" half of cross-channel identity resolution, reusing this
  // escalation's own already-established `ai_context_snapshot` mechanism (Phase 14)
  // rather than threading a new concept into the live bot turn pipeline.
  resolveLinkedConversations,
} from "@nextbot/conversations";
import { resolveRoutingQueue, type EscalationReasonValue } from "../domain/escalation-routing.js";
import { createEscalation, type EscalationRow } from "../infrastructure/escalation-repository.js";
import { listRoutingRules } from "../infrastructure/routing-rule-repository.js";
import { ensureDefaultQueue, findAgentQueueById } from "../infrastructure/agent-queue-repository.js";

/** A.2.11's exact required copy — never paraphrased, mirrors FR-AI-05's own
 * "exact fixed fallback copy" convention elsewhere in this codebase. */
export const HUMAN_HANDOFF_CONNECTING_TEXT = "I'm connecting you with a support agent. Please hold on…";

export interface TriggerEscalationInput {
  conversationId: string;
  reason: EscalationReasonValue;
  reasonDetail?: Record<string, unknown> | null;
  /** FR-ESC-02's "AI context snapshot" — recognized goal/confidence/tool calls
   * attempted/where the transcript stood at the moment of escalation. */
  aiContextSnapshot: Record<string, unknown>;
  recognizedGoal?: string | null;
  language?: string | null;
  /**
   * QA Final Review minor item — the turn pipeline's own reply payload for a
   * live-triggered escalation is `humanHandoffFallback()`, which is this exact
   * `HUMAN_HANDOFF_CONNECTING_TEXT` copy, already inserted as the turn's
   * `AI`-sender message by `send-widget-message.ts` *before*
   * `apps/gateway/src/lib/turn-pipeline-adapter.ts` calls `triggerEscalation`
   * right after. Without this flag, the identical text was posted a second time
   * as a `System`-sender message here, at a later sequence number — a real
   * customer-visible duplicate, not just a cosmetic log artifact. Callers that
   * *don't* already have their own turn-produced handoff message (there are
   * none today — `triggerEscalation` has exactly one real call site — but the
   * flag defaults to posting the message, so a hypothetical future caller
   * outside the turn pipeline keeps the original "always visible" behavior).
   */
  skipConnectingMessage?: boolean;
}

export interface TriggerEscalationResult {
  escalation: EscalationRow;
  /** `false` when a concurrent trigger for the same conversation already won (see
   * `createEscalation`'s doc) — the caller should treat this as a no-op, not an error. */
  created: boolean;
}

/**
 * FR-ESC-01/03 — the single entry point every escalation trigger (low confidence,
 * tool-failure-exhausted-retries, explicit customer request, guardrail-flagged
 * sensitive topic) funnels through. Resolves the tenant's routing rules
 * (first-match-wins + a **guaranteed** fallback queue, auto-provisioned if the tenant
 * has never configured one — see `ensureDefaultQueue`'s doc), creates the `escalation`
 * row, flips `conversation.status` to `Escalated`, and posts the exact A.2.11 system
 * message so the customer sees a real state transition, not silent copy.
 *
 * Idempotent under concurrency: a second trigger for a conversation that already has
 * a non-terminal escalation returns the existing row (`created: false`) rather than
 * violating the partial unique index or double-posting the connecting message.
 */
export async function triggerEscalation(ctx: TenantContext, input: TriggerEscalationInput): Promise<TriggerEscalationResult> {
  const conversation = await findConversationById(ctx, input.conversationId);
  if (!conversation) throw new Error(`triggerEscalation: conversation ${input.conversationId} not found`);

  const channel = await findChannelById(ctx, conversation.channelId);
  const [rules, defaultQueue] = await Promise.all([listRoutingRules(ctx), ensureDefaultQueue(ctx)]);

  const routing = resolveRoutingQueue(
    rules,
    {
      recognizedGoal: input.recognizedGoal ?? null,
      channelType: channel?.type,
      reason: input.reason,
      language: input.language ?? conversation.language,
    },
    defaultQueue.id,
  );

  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — `sla_due_at` is
  // computed once, at creation, from the ACTUAL routed queue's `sla_seconds` (which
  // may differ from `defaultQueue` if a routing rule matched) — `null` when that
  // queue has no configured SLA, so the escalation is simply never swept/aged.
  const routedQueue = routing.queueId === defaultQueue.id ? defaultQueue : await findAgentQueueById(ctx, routing.queueId);
  const slaDueAt = routedQueue?.slaSeconds != null ? new Date(Date.now() + routedQueue.slaSeconds * 1000) : null;

  // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — always resolved (never
  // conditionally skipped), because `resolveLinkedConversations` itself is the
  // fail-closed gate: it returns `[]` immediately unless the tenant has explicitly
  // opted into cross-channel linking AND this conversation has a recorded customer
  // identifier. An empty array here means "no linked conversations" exactly the same
  // way it would mean "linking not enabled" — the takeover panel doesn't need (and
  // never sees) which case it was, only whether there's other-channel context to show.
  const linkedConversations = await resolveLinkedConversations(ctx, input.conversationId);

  const { row, created } = await createEscalation(ctx, {
    conversationId: input.conversationId,
    reason: input.reason,
    reasonDetail: input.reasonDetail ?? null,
    queueId: routing.queueId,
    matchedRoutingRuleId: routing.matchedRuleId,
    aiContextSnapshot: { ...input.aiContextSnapshot, linkedConversations },
    slaDueAt,
  });

  if (!created) {
    return { escalation: row, created: false };
  }

  await updateConversationStatus(ctx, input.conversationId, "Escalated");

  if (!input.skipConnectingMessage) {
    const systemMessage = await insertMessage(ctx, {
      conversationId: input.conversationId,
      sender: "System",
      contentType: "Text",
      payload: { contentType: "Text", text: HUMAN_HANDOFF_CONNECTING_TEXT },
    });
    publishConversationEvent(input.conversationId, {
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
  }

  publishConversationEvent(input.conversationId, {
    event: "conversation",
    data: { status: "Escalated", escalation: { queueName: routedQueue?.name ?? "Support" } },
  });

  return { escalation: row, created: true };
}
