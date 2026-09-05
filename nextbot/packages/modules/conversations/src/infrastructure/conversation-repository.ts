import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { computeCustomerIdentifierHash } from "../domain/customer-identifier-hash.js";

export interface ConversationRow {
  id: string;
  tenantId: string;
  channelId: string;
  status: "Active" | "Resolved" | "Escalated" | "Abandoned";
  language: string;
  lastActivityAt: Date;
  startedAt: Date;
  nextSequence: number;
  /** Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — added to this
   * interface's declared shape (the underlying `select()` calls already returned
   * these columns; they just weren't declared here yet) so
   * `resolveLinkedConversations()` can read them without an unsafe cast. */
  customerIdentifier?: string | null;
  customerIdentifierHash?: string | null;
}

/**
 * Phase 17 (BL-10) — the DSR (Data Subject Request) tool's search step: every
 * conversation this tenant has for a customer identifier (matched by the plaintext
 * column — the hashed column exists for indexed matching at scale but this admin
 * tool searches by the identifier the operator actually types in, not a
 * pre-computed hash). Composition-root DSR orchestration (`apps/web`) also joins
 * this against `message` (via `listMessagesSince`-style reads) and `escalation` to
 * assemble the full cross-module export, since `conversations` cannot import those
 * modules directly (LLD §2.3) — only the app layer can.
 */
export async function findConversationsByCustomerIdentifier(
  ctx: TenantContext,
  customerIdentifier: string,
): Promise<ConversationRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.conversation)
      .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.customerIdentifier, customerIdentifier)));
    return rows as ConversationRow[];
  });
}

/**
 * Phase 17 (BL-10) DSR "Delete" — hard-deletes every conversation (and, via
 * `ON DELETE CASCADE`/explicit message delete below, its messages) for this
 * customer identifier. This is a genuinely destructive, hard-to-reverse action —
 * exactly the class of change the operating instructions require flagging rather
 * than deciding silently; it is only reached via the explicit, admin-gated DSR
 * "Delete" tool (never automatically), which is the documented GDPR erasure
 * mechanism B.8.4 calls for, not an ad hoc deletion path.
 */
export async function deleteConversationsByCustomerIdentifier(ctx: TenantContext, customerIdentifier: string): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const matches = await db
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.customerIdentifier, customerIdentifier)));
    const ids = matches.map((m) => m.id);
    if (ids.length === 0) return 0;
    await db.delete(schema.message).where(and(eq(schema.message.tenantId, ctx.tenantId), inArray(schema.message.conversationId, ids)));
    await db.delete(schema.conversation).where(and(eq(schema.conversation.tenantId, ctx.tenantId), inArray(schema.conversation.id, ids)));
    return ids.length;
  });
}

/**
 * Phase 17 (BL-10, FR-ADM-06) retention purge sweeper's lookup step: returns the
 * ids of every conversation whose `last_activity_at` is older than `cutoff`, without
 * deleting anything yet.
 *
 * QA fix (Defect A) — split out of what used to be a single `deleteConversationsOlderThan`
 * function so the composition root (`apps/worker`) can delete FK-referencing
 * `tool_call`/`escalation` rows (via `@nextbot/approvals`'s
 * `deleteToolCallsByConversationIds` and `@nextbot/escalations`'s
 * `deleteEscalationsByConversationIds`) *before* the conversation/message rows they
 * point at are removed — the same FK-safe ordering already established for DSR
 * Delete (`apps/web/src/lib/dsr-service.ts`). This module cannot import
 * `approvals`/`escalations` itself (LLD §2.3 allow-list), so that orchestration has
 * to live one layer up; this function only exposes the id set that orchestration
 * needs.
 */
export async function findConversationIdsOlderThan(ctx: TenantContext, cutoff: Date): Promise<string[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const matches = await db
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(and(eq(schema.conversation.tenantId, ctx.tenantId), sql`${schema.conversation.lastActivityAt} < ${cutoff}`));
    return matches.map((m) => m.id);
  });
}

/**
 * Phase 17 (BL-10, FR-ADM-06) retention purge sweeper's delete step: hard-deletes
 * the messages and conversation rows for the given, already-computed set of
 * conversation ids. Only ever called for a tenant whose `tenant_data_policy`
 * retention field is *not* `-1` (Indefinite) — the caller (`apps/worker`'s
 * retention-purge job) is responsible for that gate; this function has no opinion
 * on the policy itself, it just deletes what it's told to.
 *
 * QA fix (Defect A) — callers MUST delete any `tool_call`/`escalation` rows
 * referencing these conversation ids first (see `findConversationIdsOlderThan`'s
 * doc comment); this function does not do so itself since neither table is
 * reachable from this module.
 */
export async function deleteConversationsByIds(ctx: TenantContext, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.delete(schema.message).where(and(eq(schema.message.tenantId, ctx.tenantId), inArray(schema.message.conversationId, ids)));
    await db.delete(schema.conversation).where(and(eq(schema.conversation.tenantId, ctx.tenantId), inArray(schema.conversation.id, ids)));
    return ids.length;
  });
}

/**
 * QA fix (BE-2, FR-ADM-06) — `tenant_data_policy.retention_pii_days` enforcement.
 * There is no dedicated "PII" table separate from the transcript itself: raw PII
 * lives inline as the conversation's plaintext `customer_identifier` and each
 * message's raw `payload` (both of which the PII masking module, `packages/
 * modules/pii`, already produces a masked counterpart for — `payload_masked` —
 * at write time). This category's retention window is therefore interpreted as
 * "how long the *raw, unmasked* PII-bearing fields survive independently of the
 * overall transcript retention window" — once a conversation/message ages past
 * this cutoff, its raw PII fields are redacted in place (row kept, masked
 * counterpart and non-PII fields left intact) rather than the whole record being
 * deleted (that remains `retention_transcripts_days`'s job).
 *
 * Deliberately independent of, and typically shorter than,
 * `retention_transcripts_days`: a tenant can keep a transcript's *shape* (for
 * analytics/QA) far longer than it keeps the *raw* customer PII inside it.
 */
export async function redactRawPiiOlderThan(ctx: TenantContext, cutoff: Date): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    let redacted = 0;

    const conversations = await db
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.tenantId, ctx.tenantId),
          sql`${schema.conversation.lastActivityAt} < ${cutoff}`,
          sql`${schema.conversation.customerIdentifier} IS NOT NULL`,
        ),
      );
    if (conversations.length > 0) {
      await db
        .update(schema.conversation)
        // Target Architecture Blueprint Phase 19 (BL-50) fix: `customerIdentifierHash`
        // must be redacted alongside the raw identifier — leaving it populated after
        // a PII-retention redaction would let the customer's identity keep resolving
        // via `resolveLinkedConversations()` (cross-channel linking) even though the
        // raw PII field it is derived from was supposed to have been removed. This is
        // a real, previously-latent gap (the hash column had no writer, let alone a
        // redaction path, before this phase) — closed here since this phase is the
        // hash's first real writer.
        .set({ customerIdentifier: null, customerIdentifierHash: null })
        .where(
          and(
            eq(schema.conversation.tenantId, ctx.tenantId),
            inArray(
              schema.conversation.id,
              conversations.map((c) => c.id),
            ),
          ),
        );
      redacted += conversations.length;
    }

    const messages = await db
      .select({ id: schema.message.id })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.tenantId, ctx.tenantId),
          sql`${schema.message.createdAt} < ${cutoff}`,
          sql`${schema.message.payload} <> '{}'::jsonb`,
        ),
      );
    if (messages.length > 0) {
      await db
        .update(schema.message)
        .set({ payload: {} })
        .where(
          and(
            eq(schema.message.tenantId, ctx.tenantId),
            inArray(
              schema.message.id,
              messages.map((m) => m.id),
            ),
          ),
        );
      redacted += messages.length;
    }

    return redacted;
  });
}

export async function findConversationById(ctx: TenantContext, id: string): Promise<ConversationRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.conversation)
      .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, id)));
    return (rows[0] as ConversationRow | undefined) ?? null;
  });
}

export async function insertConversation(
  ctx: TenantContext,
  input: {
    channelId: string;
    language: string;
    metadata?: Record<string, unknown> | null;
    /** Phase 6 (client-feedback-batch item 9): set only for a server-verified
     * sandbox-preview conversation (`create-widget-session.ts`) — the exact
     * `agent_definition_version` id this conversation is testing. `undefined` for
     * every ordinary customer conversation, matching this column's pre-existing
     * "deferred, no FK yet" state (Phase 10, BL-07) for the non-preview case. */
    agentDefinitionVersionId?: string;
  },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.conversation).values({
      id,
      tenantId: ctx.tenantId,
      channelId: input.channelId,
      language: input.language,
      metadata: input.metadata ?? null,
      agentDefinitionVersionId: input.agentDefinitionVersionId ?? null,
    });
  });
  return id;
}

/**
 * Atomically claims the next gap-free `sequence` number for a conversation and bumps
 * `last_activity_at` in the same statement (LLD §5.3: "`sequence` is gap-free per
 * conversation" — the SSE resume cursor's core guarantee). A single `UPDATE ...
 * RETURNING` takes a row lock for the statement's duration, which is strictly
 * sufficient under Postgres's read-committed default: two concurrent callers
 * serialize on the row lock rather than racing a read-then-write.
 */
export async function claimNextSequence(ctx: TenantContext, conversationId: string): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const result = await db.execute<{ claimed: number }>(sql`
      UPDATE conversation
      SET next_sequence = next_sequence + 1, last_activity_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${conversationId}
      RETURNING next_sequence - 1 AS claimed
    `);
    const row = result.rows[0];
    if (!row) throw new Error(`claimNextSequence: conversation ${conversationId} not found`);
    return row.claimed;
  });
}

/**
 * BL-15 (WhatsApp) — the inbound-webhook analogue of `insertConversation`/widget
 * session creation: one conversation per (channel, customer) pair, keyed by the
 * `conversation_tenant_channel_thread_key` unique index (`externalThreadId` =
 * the customer's WhatsApp `wa_id`). Concurrency-safe the same way every other
 * "idempotent by unique constraint" write in this codebase is (LLD §11 rule:
 * "catch the real DB unique-constraint violation and reconcile; never
 * check-then-act") — a genuinely concurrent webhook redelivery racing to create the
 * same conversation reconciles onto the winner's row rather than erroring.
 */
export async function findOrCreateConversationForChannelCustomer(
  ctx: TenantContext,
  input: { channelId: string; externalThreadId: string; customerIdentifier: string; language: string },
): Promise<ConversationRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select()
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.tenantId, ctx.tenantId),
          eq(schema.conversation.channelId, input.channelId),
          eq(schema.conversation.externalThreadId, input.externalThreadId),
        ),
      );
    if (existing[0]) return existing[0] as ConversationRow;

    const id = generateId();
    try {
      await db.insert(schema.conversation).values({
        id,
        tenantId: ctx.tenantId,
        channelId: input.channelId,
        externalThreadId: input.externalThreadId,
        customerIdentifier: input.customerIdentifier,
        // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — the first real
        // writer of this column (confirmed by inspection before this phase: the
        // column existed but nothing ever populated it). Computed unconditionally,
        // regardless of whether this tenant has cross-channel linking enabled —
        // the hash itself is inert data; `resolveLinkedConversations()` is the only
        // place that ever reads it, and it fails closed on the tenant's own opt-in.
        customerIdentifierHash: computeCustomerIdentifierHash(input.customerIdentifier),
        language: input.language,
      });
    } catch (err) {
      // Unique-violation reconciliation: a concurrent webhook redelivery already
      // won the insert race for this (channel, externalThreadId) pair.
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err;
      const raced = await db
        .select()
        .from(schema.conversation)
        .where(
          and(
            eq(schema.conversation.tenantId, ctx.tenantId),
            eq(schema.conversation.channelId, input.channelId),
            eq(schema.conversation.externalThreadId, input.externalThreadId),
          ),
        );
      if (raced[0]) return raced[0] as ConversationRow;
      throw err;
    }

    const created = await db.select().from(schema.conversation).where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, id)));
    return created[0] as ConversationRow;
  });
}

/** BL-15 (FR-META-01): stamps `conversation.metadata.lastInboundAt` — the 24h
 * session-window anchor `WhatsAppSendOptions.lastInboundAt` reads at send time. */
export async function updateConversationLastInboundAt(ctx: TenantContext, conversationId: string, occurredAt: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select({ metadata: schema.conversation.metadata }).from(schema.conversation).where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, conversationId)));
    const currentMetadata = rows[0]?.metadata ?? {};
    await db
      .update(schema.conversation)
      .set({ metadata: { ...currentMetadata, lastInboundAt: occurredAt } })
      .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, conversationId)));
  });
}

export async function updateConversationLanguage(ctx: TenantContext, conversationId: string, language: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.conversation)
      .set({ language })
      .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, conversationId)));
  });
}

/**
 * Phase 16 (BL-09) addition: flips `conversation.status` — used by the escalations
 * module (allowed dep, LLD §2.3) to move a conversation to/from `Escalated` on
 * trigger/return-to-bot, and to `Resolved` on "Resolve & Close" (FR-ESC-02/04). Also
 * bumps `last_activity_at` so the idle-sweeper's own timing logic (Phase 13) isn't
 * confused by a status flip that wasn't itself a customer/AI message.
 */
export async function updateConversationStatus(
  ctx: TenantContext,
  conversationId: string,
  status: "Active" | "Resolved" | "Escalated" | "Abandoned",
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.conversation)
      .set({ status, lastActivityAt: new Date(), ...(status === "Resolved" ? { endedAt: new Date() } : {}) })
      .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, conversationId)));
  });
}

/**
 * U6 fix (QA fix pass) — Conversation List bulk "tag"/"archive" actions (screen
 * inventory B.4.1). Applies the requested action to every id in `conversationIds`
 * that belongs to `ctx.tenantId` (ids the caller supplied for a different tenant are
 * silently excluded by the `withTenant`-scoped `WHERE`, never cross-tenant-updated).
 * Each row is read-then-merged individually rather than a single bulk `UPDATE ...
 * SET metadata = metadata || jsonb` expression, because "tag" must append to an
 * existing `tags` array without clobbering other rows' distinct existing tags/
 * archived state — jsonb concatenation would need per-row conditional logic anyway,
 * and this list is capped at 200 rows (`BulkConversationActionRequestSchema`) so a
 * per-row round trip is not a scale concern here.
 */
export async function bulkApplyConversationAction(
  ctx: TenantContext,
  conversationIds: string[],
  action: { kind: "tag"; tag: string } | { kind: "archive" },
): Promise<{ updated: number }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ id: schema.conversation.id, metadata: schema.conversation.metadata })
      .from(schema.conversation)
      .where(and(eq(schema.conversation.tenantId, ctx.tenantId), inArray(schema.conversation.id, conversationIds)));

    let updated = 0;
    for (const row of rows) {
      const currentMetadata = row.metadata ?? {};
      const nextMetadata =
        action.kind === "tag"
          ? { ...currentMetadata, tags: Array.from(new Set([...(currentMetadata.tags ?? []), action.tag])) }
          : { ...currentMetadata, archived: true, archivedAt: new Date().toISOString() };
      await db
        .update(schema.conversation)
        .set({ metadata: nextMetadata })
        .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, row.id)));
      updated += 1;
    }
    return { updated };
  });
}

/**
 * Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — the admin-facing "record
 * a confirmed customer identifier" action. This is the one bounded mechanism this
 * phase adds for a WIDGET conversation (which never gets a `customerIdentifier` at
 * session-creation time — see `create-widget-session.ts`) to gain one: a human agent,
 * having confirmed the customer's phone/email during a live conversation, records it
 * here. Works identically for any channel (not just the widget) — a WhatsApp
 * conversation's auto-populated identifier can also be corrected this way if it was
 * ever wrong. Always recomputes the hash alongside the raw value; never leaves them
 * out of sync.
 */
export async function updateConversationCustomerIdentifier(ctx: TenantContext, conversationId: string, customerIdentifier: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.conversation)
      .set({ customerIdentifier, customerIdentifierHash: computeCustomerIdentifierHash(customerIdentifier) })
      .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, conversationId)));
  });
}

/**
 * Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — the cross-channel
 * identity resolution's ONLY matching query: every OTHER conversation in this tenant
 * (`ne(...)` excludes the conversation the caller is asking about) whose
 * `customer_identifier_hash` EXACTLY equals `hash`. There is no fuzzy/partial/prefix
 * matching anywhere in this query — a single differing character in the underlying
 * identifier produces a completely different hash, never a "close" match. The caller
 * (`application/identity-resolution.ts#resolveLinkedConversations`) is responsible
 * for the tenant opt-in gate; this function has no opinion on it.
 */
export async function findConversationsByCustomerIdentifierHash(
  ctx: TenantContext,
  hash: string,
  excludeConversationId: string,
): Promise<ConversationRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.tenantId, ctx.tenantId),
          eq(schema.conversation.customerIdentifierHash, hash),
          ne(schema.conversation.id, excludeConversationId),
        ),
      );
    return rows as ConversationRow[];
  });
}
