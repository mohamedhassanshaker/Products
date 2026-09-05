import type { MessageDto } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { listMessagesSince } from "../infrastructure/message-repository.js";
import { subscribeToConversation, type ConversationEvent } from "../infrastructure/message-bus.js";

/** LLD §5.3 SSE reconnect: every message with `sequence > sinceSequence`, in order —
 * called once before the caller switches to forwarding live `ConversationEvent`s. */
export async function replayMessagesSince(ctx: TenantContext, conversationId: string, sinceSequence: number): Promise<MessageDto[]> {
  const rows = await listMessagesSince(ctx, conversationId, sinceSequence);
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    sequence: row.sequence,
    sender: row.sender,
    contentType: row.contentType,
    payload: row.payload,
    confidenceScore: row.confidenceScore,
    createdAt: row.createdAt.toISOString(),
    // D6: same reasoning as `send-widget-message.ts`'s `toDto` — the gap-replay
    // path on SSE reconnect must carry the same dedup key live events do.
    clientMessageId: row.clientMessageId ?? undefined,
  }));
}

/** Re-exported so `apps/gateway`'s SSE route handler doesn't need to reach into
 * `infrastructure/` directly (LLD §2.2's single-entrypoint-per-module rule). */
export { subscribeToConversation, type ConversationEvent };
