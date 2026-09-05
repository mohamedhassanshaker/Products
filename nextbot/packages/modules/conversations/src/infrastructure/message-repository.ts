import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { MessageContentTypeValue, MessageSenderValue } from "@nextbot/contracts";
import { claimNextSequence } from "./conversation-repository.js";

export interface MessageRow {
  id: string;
  tenantId: string;
  conversationId: string;
  sequence: number;
  sender: MessageSenderValue;
  contentType: MessageContentTypeValue;
  payload: Record<string, unknown>;
  confidenceScore: number | null;
  clientMessageId: string | null;
  /** Phase 13 (BL-06) — join key back to `agent_run`/`agent_run_span` for the trace
   * viewer. `null` for customer/human/system messages and for any AI reply produced
   * without a resolved `agentDefinitionVersionId` (see `send-widget-message.ts`'s doc). */
  agentRunId: string | null;
  createdAt: Date;
  /** BE1 (QA fix pass): true only when `insertMessage` caught a concurrent
   * unique-violation on `clientMessageId` and returned the *other* request's
   * already-committed row instead of inserting a new one — see `insertMessage`'s
   * doc comment. Absent (falsy) on every normal insert. Callers (`sendWidgetMessage`)
   * use this to avoid re-running the AI-reply/SSE-publish side effects a second time
   * for what is, from the database's point of view, the same message. */
  reused?: boolean;
}

/** Postgres's `unique_violation` SQLSTATE — the correctness backstop `insertMessage`
 * leans on for BE1 (see its doc comment), distinguished from any other insert
 * failure (which must still propagate, not be silently swallowed). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

/**
 * Looks up a message already persisted for `clientMessageId` (LLD §5.3's offline
 * replay dedup contract). Returning the existing row instead of inserting a second
 * one is what makes re-sending the same queued message after a reconnect a no-op.
 */
export async function findMessageByClientId(
  ctx: TenantContext,
  conversationId: string,
  clientMessageId: string,
): Promise<MessageRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.message)
      .where(
        and(
          eq(schema.message.tenantId, ctx.tenantId),
          eq(schema.message.conversationId, conversationId),
          eq(schema.message.clientMessageId, clientMessageId),
        ),
      );
    return (rows[0] as MessageRow | undefined) ?? null;
  });
}

/**
 * Persists a customer-authored message with the next atomically-claimed sequence
 * number.
 *
 * **BE1 fix (QA fix pass):** correctness for the "resending the same
 * `clientMessageId` is safe" contract now comes from this function's own
 * insert-then-catch handling of the `(tenantId, conversationId, clientMessageId)`
 * unique constraint, not from a caller-side SELECT-then-INSERT check (which is a
 * classic TOCTOU race — under true concurrency, two callers can both pass the
 * SELECT-first "not found" check before either has committed its INSERT, and the
 * loser previously surfaced a spurious 500 to a client whose entire reason for
 * resending was supposed to be safe). A `SAVEPOINT` isolates the insert attempt:
 * Postgres aborts an *entire* transaction on any uncaught statement error, so
 * without the savepoint a caught unique-violation would still leave the
 * transaction unusable for the follow-up `SELECT` that fetches the winning row.
 * `sendWidgetMessage`'s own `findMessageByClientId` pre-check remains as a fast
 * path for the common *sequential* retry case (skips claiming a sequence number
 * and attempting an insert at all for an already-known duplicate) — it is an
 * optimization now, not the correctness mechanism.
 */
export async function insertMessage(
  ctx: TenantContext,
  input: {
    conversationId: string;
    sender: MessageSenderValue;
    contentType: MessageContentTypeValue;
    payload: Record<string, unknown>;
    clientMessageId?: string | null;
    confidenceScore?: number | null;
    agentRunId?: string | null;
    /** Phase 16 (BL-09) addition — the acting human agent's `app_user.id` for a
     * `HumanAgent`-sender message (FR-ESC-02: messages sent from the Live Takeover
     * Panel). `null`/omitted for every other sender, unchanged from before. */
    senderUserId?: string | null;
  },
): Promise<MessageRow> {
  const id = generateId();
  const sequence = await claimNextSequence(ctx, input.conversationId);
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.execute(sql`SAVEPOINT insert_message`);
    try {
      await db.insert(schema.message).values({
        id,
        tenantId: ctx.tenantId,
        conversationId: input.conversationId,
        sequence,
        sender: input.sender,
        senderUserId: input.senderUserId ?? null,
        contentType: input.contentType,
        payload: input.payload,
        clientMessageId: input.clientMessageId ?? null,
        confidenceScore: input.confidenceScore ?? null,
        agentRunId: input.agentRunId ?? null,
      });
      await db.execute(sql`RELEASE SAVEPOINT insert_message`);
    } catch (err) {
      if (isUniqueViolation(err) && input.clientMessageId) {
        // A genuinely concurrent request for the same clientMessageId already won
        // the race and committed its row (this only happens for a truly concurrent
        // send — a sequential retry is already caught by `findMessageByClientId`'s
        // fast path before `insertMessage` is even called). Roll back just the
        // failed insert (not the whole transaction) and re-read the winner's row.
        await db.execute(sql`ROLLBACK TO SAVEPOINT insert_message`);
        const rows = await db
          .select()
          .from(schema.message)
          .where(
            and(
              eq(schema.message.tenantId, ctx.tenantId),
              eq(schema.message.conversationId, input.conversationId),
              eq(schema.message.clientMessageId, input.clientMessageId),
            ),
          );
        const existing = rows[0] as MessageRow | undefined;
        if (existing) return { ...existing, reused: true };
      }
      throw err;
    }
    return {
      id,
      tenantId: ctx.tenantId,
      conversationId: input.conversationId,
      sequence,
      sender: input.sender,
      contentType: input.contentType,
      payload: input.payload,
      confidenceScore: input.confidenceScore ?? null,
      clientMessageId: input.clientMessageId ?? null,
      agentRunId: input.agentRunId ?? null,
      createdAt: new Date(),
    };
  });
}

/** LLD §5.3 gap replay: every message with `sequence > sinceSequence`, oldest first —
 * the SSE reconnect path calls this once before switching to live event forwarding. */
export async function listMessagesSince(ctx: TenantContext, conversationId: string, sinceSequence: number): Promise<MessageRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    return (await db
      .select()
      .from(schema.message)
      .where(
        and(
          eq(schema.message.tenantId, ctx.tenantId),
          eq(schema.message.conversationId, conversationId),
          gt(schema.message.sequence, sinceSequence),
        ),
      )
      .orderBy(asc(schema.message.sequence))) as MessageRow[];
  });
}

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5, LLD §15.5) — a single
 * message by id, scoped to its conversation.
 *
 * Added for shadow evaluation's replay, which stores **pointers rather than a transcript
 * copy** (deliberately: duplicating customer text into `shadow_run` would create a new PII
 * sink with its own retention-purge and DSR-cascade obligations). The pointer has to be
 * dereferenced somewhere, and a read-only by-id lookup owned by the module that owns the
 * table is the right place.
 *
 * Returns `null` — never throws — when the message is gone, which is a real and expected
 * outcome: a conversation purged by retention or a DSR erasure between enqueue and replay
 * must terminate the shadow run as `Skipped(SourceGone)`, not as an error and never by
 * resurrecting purged content.
 */
export async function findMessageById(ctx: TenantContext, conversationId: string, id: string): Promise<MessageRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.message)
      .where(and(eq(schema.message.tenantId, ctx.tenantId), eq(schema.message.conversationId, conversationId), eq(schema.message.id, id)));
    return (rows[0] as MessageRow | undefined) ?? null;
  });
}

/** Phase 17 (BL-48) — the conversation's transcript up to and including `sequence`,
 *  oldest first. The bounded history a shadow replay is allowed to see: it must reproduce
 *  what the live turn saw at that moment, never messages that came after it. */
export async function listMessagesUpToSequence(ctx: TenantContext, conversationId: string, sequence: number): Promise<MessageRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    return (await db
      .select()
      .from(schema.message)
      .where(and(eq(schema.message.tenantId, ctx.tenantId), eq(schema.message.conversationId, conversationId), lte(schema.message.sequence, sequence)))
      .orderBy(asc(schema.message.sequence))) as MessageRow[];
  });
}
