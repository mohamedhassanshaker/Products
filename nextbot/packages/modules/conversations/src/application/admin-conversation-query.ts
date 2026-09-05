import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ChannelTypeValue, ConversationStatusValue } from "@nextbot/contracts";
import { listMessagesSince } from "../infrastructure/message-repository.js";
import { findConversationById } from "../infrastructure/conversation-repository.js";

/**
 * Phase 13 (BL-06) — Conversation List admin API's read model (screen inventory
 * B.4.1: filter by channel/status/date/recognized task/language). A `backend` filter
 * (which connector backend type handled a conversation's tool calls) is **not**
 * implemented here — flagged, not silently omitted: no `tool_call` table exists yet
 * anywhere in this schema (Phase 12/BL-05 never introduced one; it only appends
 * `domain_event` rows), so there is no queryable per-conversation "which backend(s)
 * did this turn touch" join to filter on. Adding a real `tool_call` fact table is
 * BL-05's own follow-up scope, not something this phase should retrofit as a side
 * effect of a list-filter UI.
 */
export interface ConversationListFilters {
  channelId?: string;
  status?: ConversationStatusValue;
  recognizedGoal?: string;
  language?: string;
  startedAfter?: Date;
  startedBefore?: Date;
  limit?: number;
  offset?: number;
}

export interface ConversationListItem {
  id: string;
  channelId: string;
  /** U2 fix (QA fix pass) — the channel's `type` (e.g. `WebWidget`/`WhatsApp`), so the
   * list can render a per-row channel icon without a second round-trip. */
  channelType: ChannelTypeValue;
  status: ConversationStatusValue;
  recognizedGoal: string | null;
  resolutionType: string | null;
  language: string;
  startedAt: Date;
  endedAt: Date | null;
  lastActivityAt: Date;
  totalCostUsd: string;
  totalTokensIn: number;
  totalTokensOut: number;
  /** U1/U2 fix (QA fix pass) — surfaced (still masked/hashed at rest; this is the
   * same raw value the Detail screen's context panel renders) so an operator can
   * identify which customer a row belongs to without opening it. */
  customerIdentifier: string | null;
  /** U2 fix (QA fix pass) — truncated preview of the conversation's most recent
   * message, so a row is triageable without opening the full transcript. */
  lastMessagePreview: string | null;
}

/** Builds the shared `WHERE` predicate for both the paged list and (later) the CSV/
 * JSON export — kept in one place so the two can never silently drift apart. */
function buildFilterPredicate(ctx: TenantContext, filters: ConversationListFilters): SQL {
  const clauses = [eq(schema.conversation.tenantId, ctx.tenantId)];
  if (filters.channelId) clauses.push(eq(schema.conversation.channelId, filters.channelId));
  if (filters.status) clauses.push(eq(schema.conversation.status, filters.status));
  if (filters.recognizedGoal) clauses.push(eq(schema.conversation.recognizedGoal, filters.recognizedGoal));
  if (filters.language) clauses.push(eq(schema.conversation.language, filters.language));
  if (filters.startedAfter) clauses.push(gte(schema.conversation.startedAt, filters.startedAfter));
  if (filters.startedBefore) clauses.push(lte(schema.conversation.startedAt, filters.startedBefore));
  return and(...clauses)!;
}

/** Paged, filtered, tenant-scoped conversation list (screen inventory B.4.1) — newest
 * first by `startedAt`, matching the transcript-browsing convention every other list
 * screen in this admin console uses. */
export async function listConversationsForAdmin(
  ctx: TenantContext,
  filters: ConversationListFilters = {},
): Promise<{ items: ConversationListItem[]; total: number }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const predicate = buildFilterPredicate(ctx, filters);
    const limit = Math.min(filters.limit ?? 50, 500);
    const offset = filters.offset ?? 0;

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: schema.conversation.id,
          channelId: schema.conversation.channelId,
          channelType: schema.channel.type,
          status: schema.conversation.status,
          recognizedGoal: schema.conversation.recognizedGoal,
          resolutionType: schema.conversation.resolutionType,
          language: schema.conversation.language,
          startedAt: schema.conversation.startedAt,
          endedAt: schema.conversation.endedAt,
          lastActivityAt: schema.conversation.lastActivityAt,
          totalCostUsd: schema.conversation.totalCostUsd,
          totalTokensIn: schema.conversation.totalTokensIn,
          totalTokensOut: schema.conversation.totalTokensOut,
          customerIdentifier: schema.conversation.customerIdentifier,
        })
        .from(schema.conversation)
        .innerJoin(schema.channel, eq(schema.channel.id, schema.conversation.channelId))
        .where(predicate)
        .orderBy(desc(schema.conversation.startedAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: sql<number>`count(*)::int` }).from(schema.conversation).where(predicate),
    ]);

    // U2 fix (QA fix pass): batch-fetch each row's most recent message for the
    // "last-message preview" column — one query for the whole page (DISTINCT ON),
    // not an N+1 per row.
    const conversationIds = rows.map((r) => r.id);
    const lastMessageByConversationId = new Map<string, string | null>();
    if (conversationIds.length > 0) {
      const lastMessageRows = await db
        .select({
          conversationId: schema.message.conversationId,
          payload: schema.message.payload,
          contentType: schema.message.contentType,
        })
        .from(schema.message)
        .where(and(eq(schema.message.tenantId, ctx.tenantId), inArray(schema.message.conversationId, conversationIds)))
        .orderBy(schema.message.conversationId, desc(schema.message.sequence));
      for (const row of lastMessageRows) {
        // `orderBy(conversationId, sequence desc)` groups each conversation's rows
        // together with its latest message first — keep only the first row seen per
        // conversation id (equivalent to a `DISTINCT ON` without relying on a
        // Postgres-specific drizzle helper).
        if (lastMessageByConversationId.has(row.conversationId)) continue;
        const payload = row.payload as { text?: string; title?: string };
        const preview = typeof payload.text === "string" ? payload.text : typeof payload.title === "string" ? payload.title : `[${row.contentType}]`;
        lastMessageByConversationId.set(row.conversationId, preview.length > 140 ? `${preview.slice(0, 140)}…` : preview);
      }
    }

    return {
      items: rows.map((r) => ({
        id: r.id,
        channelId: r.channelId,
        channelType: r.channelType,
        status: r.status,
        recognizedGoal: r.recognizedGoal,
        resolutionType: r.resolutionType,
        language: r.language,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        lastActivityAt: r.lastActivityAt,
        totalCostUsd: r.totalCostUsd,
        totalTokensIn: r.totalTokensIn,
        totalTokensOut: r.totalTokensOut,
        customerIdentifier: r.customerIdentifier,
        lastMessagePreview: lastMessageByConversationId.get(r.id) ?? null,
      })),
      total: totalRows[0]?.value ?? 0,
    };
  });
}

/** Unpaged variant for CSV/JSON export — same filter predicate, capped at a hard
 * ceiling (`EXPORT_HARD_CAP`) so an export request itself can't be used as an
 * unbounded-resource-exhaustion vector (defense in depth alongside the export
 * endpoint's own rate limit). */
const EXPORT_HARD_CAP = 20_000;
export async function listAllConversationsForExport(ctx: TenantContext, filters: ConversationListFilters = {}): Promise<ConversationListItem[]> {
  const { items } = await listConversationsForAdmin(ctx, { ...filters, limit: EXPORT_HARD_CAP, offset: 0 });
  return items;
}

export interface ConversationDetail extends ConversationListItem {
  externalThreadId: string | null;
  customerIdentifier: string | null;
  metadata: Record<string, unknown> | null;
  messages: Array<{
    id: string;
    sequence: number;
    sender: string;
    contentType: string;
    payload: Record<string, unknown>;
    confidenceScore: number | null;
    agentRunId: string | null;
    createdAt: Date;
  }>;
}

/** Conversation Detail / Trace Viewer's transcript + context-panel data (screen
 * inventory B.4.2) — the conversation row plus every message, oldest first. Trace
 * data itself (`agent_run`/`agent_run_span`) is fetched separately by the caller via
 * `@nextbot/agent-platform`'s `getAgentRun`/`packages/db/src/clickhouse.ts`'s
 * `queryAgentRunSpans`, keyed off each message's `agentRunId` — this function stays
 * scoped to what `conversations` (Data Plane) itself owns, per the module allow-list
 * (`conversations` has no allowed dependency on `agent-platform`). */
export async function getConversationDetailForAdmin(ctx: TenantContext, conversationId: string): Promise<ConversationDetail | null> {
  const conversation = await findConversationById(ctx, conversationId);
  if (!conversation) return null;

  const fullConversation = await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ conversation: schema.conversation, channelType: schema.channel.type })
      .from(schema.conversation)
      .innerJoin(schema.channel, eq(schema.channel.id, schema.conversation.channelId))
      .where(eq(schema.conversation.id, conversationId));
    return rows[0];
  });
  if (!fullConversation) return null;
  const { conversation: fullConversationRow, channelType } = fullConversation;
  const fullConversationData = fullConversationRow;

  const messages = await listMessagesSince(ctx, conversationId, 0);
  const lastMessage = messages[messages.length - 1];
  const lastMessagePreview = lastMessage
    ? (() => {
        const payload = lastMessage.payload as { text?: string; title?: string };
        const preview = typeof payload.text === "string" ? payload.text : typeof payload.title === "string" ? payload.title : `[${lastMessage.contentType}]`;
        return preview.length > 140 ? `${preview.slice(0, 140)}…` : preview;
      })()
    : null;

  return {
    id: fullConversationData.id,
    channelId: fullConversationData.channelId,
    channelType,
    lastMessagePreview,
    status: fullConversationData.status,
    recognizedGoal: fullConversationData.recognizedGoal,
    resolutionType: fullConversationData.resolutionType,
    language: fullConversationData.language,
    startedAt: fullConversationData.startedAt,
    endedAt: fullConversationData.endedAt,
    lastActivityAt: fullConversationData.lastActivityAt,
    totalCostUsd: fullConversationData.totalCostUsd,
    totalTokensIn: fullConversationData.totalTokensIn,
    totalTokensOut: fullConversationData.totalTokensOut,
    externalThreadId: fullConversationData.externalThreadId,
    customerIdentifier: fullConversationData.customerIdentifier,
    metadata: fullConversationData.metadata,
    messages: messages.map((m) => ({
      id: m.id,
      sequence: m.sequence,
      sender: m.sender,
      contentType: m.contentType,
      payload: m.payload,
      confidenceScore: m.confidenceScore,
      agentRunId: m.agentRunId,
      createdAt: m.createdAt,
    })),
  };
}
