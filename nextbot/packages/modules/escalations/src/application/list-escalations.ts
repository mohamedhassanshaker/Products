import type { TenantContext } from "@nextbot/db";
import { findChannelById } from "@nextbot/channels";
import { findConversationById, listMessagesSince } from "@nextbot/conversations";
import { listActiveEscalations, findEscalationById, type EscalationRow } from "../infrastructure/escalation-repository.js";
import { findAgentQueueById } from "../infrastructure/agent-queue-repository.js";

export interface EscalationQueueItem {
  id: string;
  conversationId: string;
  channelType: string | null;
  customerIdentifier: string | null;
  recognizedGoal: string | null;
  reason: string;
  waitSeconds: number;
  queueId: string;
  queueName: string | null;
  status: string;
  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — SLA aging indicator.
  slaDueAt: string | null;
  slaBreached: boolean;
}

/** B.5.1 Escalation Queue list — active (Waiting/InProgress) escalations, enriched
 * with the display fields the screen inventory names (conversation id, channel,
 * customer, recognized goal, reason, wait time, queue). SLA-aware sort (longest wait
 * first) is applied by the caller/UI once `waitSeconds` is computed here from "now",
 * matching the Approval Queue's own established convention. */
export async function listEscalationsForAdmin(ctx: TenantContext): Promise<EscalationQueueItem[]> {
  const rows = await listActiveEscalations(ctx);
  const now = Date.now();
  const items: EscalationQueueItem[] = [];
  for (const row of rows) {
    const [conversation, queue] = await Promise.all([findConversationById(ctx, row.conversationId), findAgentQueueById(ctx, row.queueId)]);
    const channel = conversation ? await findChannelById(ctx, conversation.channelId) : null;
    items.push({
      id: row.id,
      conversationId: row.conversationId,
      channelType: channel?.type ?? null,
      customerIdentifier: null, // masked at the DTO layer by the composition-root route, same convention as Conversation List's customerIdentifier masking.
      recognizedGoal: (row.aiContextSnapshot as { recognizedGoal?: string | null }).recognizedGoal ?? null,
      reason: row.reason,
      waitSeconds: Math.max(0, Math.floor((now - row.waitingSince.getTime()) / 1000)),
      queueId: row.queueId,
      queueName: queue?.name ?? null,
      status: row.status,
      slaDueAt: row.slaDueAt ? row.slaDueAt.toISOString() : null,
      slaBreached: row.slaBreached,
    });
  }
  return items;
}

export interface EscalationDetail extends EscalationQueueItem {
  reasonDetail: Record<string, unknown> | null;
  aiContextSnapshot: Record<string, unknown>;
  assignedAgentId: string | null;
  transcriptExcerpt: Array<{ sender: string; text: string; at: string }>;
  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — CSAT (feeds FR-RP-01
  // reporting and, non-blockingly, an escalation's own eval-harvest transcript).
  csatScore: number | null;
  csatComment: string | null;
  csatCapturedAt: string | null;
}

/** B.5.2's Context Panel data — everything short of the tool-call attempt list
 * (`aiAttempts`), which the composition-root route assembles separately by resolving
 * `aiContextSnapshot.toolCallIds` against `@nextbot/orchestration`'s `findToolCallById`
 * (a module `escalations` has no allowed dependency edge to — LLD §2.3 — so that join
 * can only happen at the `apps/*` composition-root layer, the same pattern Phase 14's
 * Tier-3 decision route already established). */
export async function getEscalationDetail(ctx: TenantContext, escalationId: string): Promise<(EscalationDetail & { row: EscalationRow }) | null> {
  const row = await findEscalationById(ctx, escalationId);
  if (!row) return null;
  const [conversation, queue] = await Promise.all([findConversationById(ctx, row.conversationId), findAgentQueueById(ctx, row.queueId)]);
  const channel = conversation ? await findChannelById(ctx, conversation.channelId) : null;
  const transcript = await listMessagesSince(ctx, row.conversationId, 0);
  const now = Date.now();
  return {
    row,
    id: row.id,
    conversationId: row.conversationId,
    channelType: channel?.type ?? null,
    customerIdentifier: null,
    recognizedGoal: (row.aiContextSnapshot as { recognizedGoal?: string | null }).recognizedGoal ?? null,
    reason: row.reason,
    reasonDetail: row.reasonDetail,
    aiContextSnapshot: row.aiContextSnapshot,
    assignedAgentId: row.assignedAgentId,
    waitSeconds: Math.max(0, Math.floor((now - row.waitingSince.getTime()) / 1000)),
    queueId: row.queueId,
    queueName: queue?.name ?? null,
    status: row.status,
    slaDueAt: row.slaDueAt ? row.slaDueAt.toISOString() : null,
    slaBreached: row.slaBreached,
    csatScore: row.csatScore,
    csatComment: row.csatComment,
    csatCapturedAt: row.csatCapturedAt ? row.csatCapturedAt.toISOString() : null,
    transcriptExcerpt: transcript.slice(-30).map((m) => ({
      sender: m.sender,
      text: m.contentType === "Text" && "text" in m.payload ? String(m.payload.text) : `[${m.contentType}]`,
      at: m.createdAt.toISOString(),
    })),
  };
}
