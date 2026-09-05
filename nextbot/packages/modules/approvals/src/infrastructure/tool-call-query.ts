import { and, eq, inArray } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/** Shape of a `tool_call` row as returned by the DSR aggregation query below —
 * intentionally the full row (this is the "export everything" GDPR path, not a
 * display-optimized projection). */
export interface ToolCallRow {
  id: string;
  tenantId: string;
  conversationId: string;
  toolId: string;
  toolName: string;
  connectorId: string | null;
  approvalTier: string;
  status: string;
  inputArgs: Record<string, unknown>;
  inputArgsMasked: Record<string, unknown> | null;
  output: unknown;
  errorMessage: string | null;
  decisionNote: string | null;
  createdAt: Date;
}

/**
 * QA fix (BE-3, FR-ADM-06) — the DSR export/delete aggregation's tool-call
 * lookup: every `tool_call` row for a given set of conversation ids (a
 * customer's conversations). Used by `apps/web`'s `dsr-service.ts` composition
 * root, since `approvals` cannot import `conversations`/`pii` itself (LLD §2.3).
 */
export async function findToolCallsByConversationIds(ctx: TenantContext, conversationIds: string[]): Promise<ToolCallRow[]> {
  if (conversationIds.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.toolCall)
      .where(and(eq(schema.toolCall.tenantId, ctx.tenantId), inArray(schema.toolCall.conversationId, conversationIds)));
    return rows as unknown as ToolCallRow[];
  });
}

/**
 * QA fix (BE-3, FR-ADM-06) — the DSR **Delete** path's missing tool-call cleanup.
 * `tool_call.conversation_id`/`approval_request.tool_call_id`/
 * `tool_call_event.tool_call_id` are plain FKs with no `ON DELETE CASCADE`, so
 * hard-deleting a conversation that still has `tool_call` rows referencing it
 * would previously either silently leave orphaned tool-call data behind (if
 * deletion order happened to avoid the FK) or fail outright with a foreign-key
 * violation — either way, an incomplete/broken "erase all of this customer's
 * data" request. This deletes a conversation's tool-call rows (and their
 * dependents, in FK-safe order) *before* the conversation/message delete step
 * that follows it in `apps/web`'s `dsr-service.ts` orchestration.
 */
export async function deleteToolCallsByConversationIds(ctx: TenantContext, conversationIds: string[]): Promise<number> {
  if (conversationIds.length === 0) return 0;
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const matches = await db
      .select({ id: schema.toolCall.id })
      .from(schema.toolCall)
      .where(and(eq(schema.toolCall.tenantId, ctx.tenantId), inArray(schema.toolCall.conversationId, conversationIds)));
    const ids = matches.map((m) => m.id);
    if (ids.length === 0) return 0;

    await db.delete(schema.toolCallEvent).where(and(eq(schema.toolCallEvent.tenantId, ctx.tenantId), inArray(schema.toolCallEvent.toolCallId, ids)));
    await db.delete(schema.approvalRequest).where(and(eq(schema.approvalRequest.tenantId, ctx.tenantId), inArray(schema.approvalRequest.toolCallId, ids)));
    await db.delete(schema.toolCall).where(and(eq(schema.toolCall.tenantId, ctx.tenantId), inArray(schema.toolCall.id, ids)));

    return ids.length;
  });
}
