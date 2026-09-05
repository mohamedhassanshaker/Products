import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { isTerminalEscalationStatus, type EscalationStatusValue } from "../domain/escalation-fsm.js";
import type { EscalationReasonValue } from "../domain/escalation-routing.js";
import { tryIncrementCurrentLoadInTx, decrementCurrentLoadInTx } from "./agent-presence-repository.js";
import { appendAssignmentLogInTx } from "./escalation-assignment-log-repository.js";

export interface EscalationRow {
  id: string;
  tenantId: string;
  conversationId: string;
  reason: EscalationReasonValue;
  reasonDetail: Record<string, unknown> | null;
  queueId: string;
  matchedRoutingRuleId: string | null;
  assignedAgentId: string | null;
  status: EscalationStatusValue;
  waitingSince: Date;
  pickedUpAt: Date | null;
  closedAt: Date | null;
  waitSeconds: number | null;
  aiContextSnapshot: Record<string, unknown>;
  createdAt: Date;
  // --- Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) ---
  assignedAt: Date | null;
  slaDueAt: Date | null;
  slaBreached: boolean;
  delegationRunId: string | null;
  csatScore: number | null;
  csatComment: string | null;
  csatCapturedAt: Date | null;
}

/** Postgres's `unique_violation` SQLSTATE. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

/**
 * Creates a `Waiting` escalation row for `conversationId`. **Never check-then-act**:
 * relies on the partial unique index `(tenant_id, conversation_id) WHERE status IN
 * ('Waiting','InProgress')` (LLD §3.9) to make "at most one non-terminal escalation
 * per conversation" a real database guarantee, not an application-level race. A
 * genuinely concurrent duplicate trigger (e.g. two turns of the same conversation
 * both deciding to escalate) loses the unique-violation race and this function
 * reconciles by returning the winner's already-existing row instead of throwing —
 * exactly the "catch the real constraint violation and reconcile, never check-then-
 * act" convention this codebase's Phase 14 dispatch established for `tool_call`.
 */
export async function createEscalation(
  ctx: TenantContext,
  input: {
    conversationId: string;
    reason: EscalationReasonValue;
    reasonDetail: Record<string, unknown> | null;
    queueId: string;
    matchedRoutingRuleId: string | null;
    aiContextSnapshot: Record<string, unknown>;
    /** Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — computed by the
     * caller (`trigger-escalation.ts`) from the routed queue's `sla_seconds`; `null`
     * when the queue has no configured SLA (never swept, never ages). */
    slaDueAt?: Date | null;
  },
): Promise<{ row: EscalationRow; created: boolean }> {
  const id = generateId();
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.execute(sql`SAVEPOINT insert_escalation`);
    try {
      await db.insert(schema.escalation).values({
        id,
        tenantId: ctx.tenantId,
        conversationId: input.conversationId,
        reason: input.reason,
        reasonDetail: input.reasonDetail,
        queueId: input.queueId,
        matchedRoutingRuleId: input.matchedRoutingRuleId,
        status: "Waiting",
        aiContextSnapshot: input.aiContextSnapshot,
        slaDueAt: input.slaDueAt ?? null,
      });
      await db.execute(sql`RELEASE SAVEPOINT insert_escalation`);
      // Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — the outbound-
      // webhook subscriber's "escalation created" category. Appended in the SAME
      // transaction as the row insert above, matching `domain_event`'s own stated
      // contract ("writers append a row here in the same transaction as the state
      // change they describe", packages/db/src/schema/domain-event.ts). This module
      // had NO domain_event producer at all before this phase (confirmed by
      // inspection) — closing a real, disclosed gap, not routing around one.
      // Payload deliberately carries no PII: `reasonDetail`/`aiContextSnapshot` are
      // never included, only identifiers and the routing reason enum.
      await db.insert(schema.domainEvent).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        type: "escalations.escalation_created",
        payload: { escalationId: id, conversationId: input.conversationId, queueId: input.queueId, reason: input.reason },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      await db.execute(sql`ROLLBACK TO SAVEPOINT insert_escalation`);
      const rows = await db
        .select()
        .from(schema.escalation)
        .where(
          and(
            eq(schema.escalation.tenantId, ctx.tenantId),
            eq(schema.escalation.conversationId, input.conversationId),
            sql`${schema.escalation.status} IN ('Waiting','InProgress')`,
          ),
        );
      const winner = rows[0] as EscalationRow | undefined;
      if (!winner) throw err;
      return { row: winner, created: false };
    }
    const rows = await db.select().from(schema.escalation).where(and(eq(schema.escalation.tenantId, ctx.tenantId), eq(schema.escalation.id, id)));
    return { row: rows[0] as EscalationRow, created: true };
  });
}

export async function findEscalationById(ctx: TenantContext, id: string): Promise<EscalationRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.escalation).where(and(eq(schema.escalation.tenantId, ctx.tenantId), eq(schema.escalation.id, id)));
    return (rows[0] as EscalationRow | undefined) ?? null;
  });
}

/**
 * QA fix (BE-3, FR-ADM-06) — the DSR export/delete aggregation's escalation
 * lookup: every escalation row (any status, not just active ones — a DSR export
 * must return *all* of a customer's data, not just their currently-open queue
 * items) for a given set of conversation ids. Used by `apps/web`'s
 * `dsr-service.ts` composition-root orchestration (escalations cannot be
 * imported alongside `conversations`/`pii` from within any single module per
 * LLD §2.3 — only the app layer may).
 */
export async function findEscalationsByConversationIds(ctx: TenantContext, conversationIds: string[]): Promise<EscalationRow[]> {
  if (conversationIds.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.escalation)
      .where(and(eq(schema.escalation.tenantId, ctx.tenantId), inArray(schema.escalation.conversationId, conversationIds)));
    return rows as EscalationRow[];
  });
}

/**
 * QA fix (BE-3, FR-ADM-06) — the DSR **Delete** path's missing escalation
 * cleanup. `escalation.conversation_id` is a plain FK with no `ON DELETE
 * CASCADE`, so hard-deleting a conversation that still had escalation rows would
 * either orphan them or fail the FK constraint. Called before the
 * conversation/message delete step in `apps/web`'s `dsr-service.ts`
 * orchestration.
 */
export async function deleteEscalationsByConversationIds(ctx: TenantContext, conversationIds: string[]): Promise<number> {
  if (conversationIds.length === 0) return 0;
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const matches = await db
      .select({ id: schema.escalation.id })
      .from(schema.escalation)
      .where(and(eq(schema.escalation.tenantId, ctx.tenantId), inArray(schema.escalation.conversationId, conversationIds)));
    if (matches.length === 0) return 0;
    await db
      .delete(schema.escalation)
      .where(and(eq(schema.escalation.tenantId, ctx.tenantId), inArray(schema.escalation.conversationId, conversationIds)));
    return matches.length;
  });
}

/**
 * Compare-and-set claim, the same concurrency-safety shape as
 * `orchestration`'s `claimToolCallTransition` — this is what makes "two agents racing
 * to Take Over the same escalation" resolve to exactly one winner instead of a
 * check-then-act race. `extra.assignedAgentId` is set on the `Waiting -> InProgress`
 * claim transition; omitted (left unchanged) on every other transition. **Not** used
 * for the initial `Waiting -> InProgress` claim itself as of Phase 13 (BL-45) — that
 * path needs an atomic concurrency-ceiling check paired with the claim, which this
 * generic function doesn't perform; see `claimEscalationWithCeilingCheck` below. This
 * function remains the vehicle for `Resolved`/`ReturnedToBot` (return-to-bot.ts) and
 * the agent-unchanged reassign self-loop, and now ALSO releases the assigned agent's
 * concurrency slot (Phase 13, FR-ESC-05) whenever the transition lands on a terminal
 * status — "current_load must decrement on both Resolved and ReturnedToBot" (an
 * escalation stops occupying a slot whichever way it ends).
 */
export async function claimEscalationTransition(
  ctx: TenantContext,
  id: string,
  fromStatuses: EscalationStatusValue[],
  to: EscalationStatusValue,
  extra?: { assignedAgentId?: string | null; queueId?: string | null; csatScore?: number | null; csatComment?: string | null },
): Promise<{ claimed: boolean; row: EscalationRow | null }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    // Read the pre-transition row within this SAME transaction so the terminal-release
    // check below can never race with a concurrent claim on the identical row (mirrors
    // `claimEscalationWithCeilingCheck`'s own "read inside the transaction, not before
    // it" discipline).
    const beforeRows = await db.select().from(schema.escalation).where(and(eq(schema.escalation.tenantId, ctx.tenantId), eq(schema.escalation.id, id)));
    const before = beforeRows[0] as EscalationRow | undefined;

    const csatProvided = extra?.csatScore != null;
    const result = await db.execute(sql`
      UPDATE escalation
         SET status = ${to},
             assigned_agent_id = COALESCE(${extra?.assignedAgentId ?? null}, assigned_agent_id),
             queue_id = COALESCE(${extra?.queueId ?? null}, queue_id),
             picked_up_at = CASE WHEN ${to} = 'InProgress' AND picked_up_at IS NULL THEN now() ELSE picked_up_at END,
             wait_seconds = CASE WHEN ${to} = 'InProgress' AND picked_up_at IS NULL
                                  THEN EXTRACT(EPOCH FROM (now() - waiting_since))::integer
                                  ELSE wait_seconds END,
             closed_at = CASE WHEN ${to} IN ('Resolved','ReturnedToBot') THEN now() ELSE closed_at END,
             csat_score = COALESCE(${extra?.csatScore ?? null}, csat_score),
             csat_comment = COALESCE(${extra?.csatComment ?? null}, csat_comment),
             csat_captured_at = CASE WHEN ${csatProvided} THEN now() ELSE csat_captured_at END
       WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
         AND status = ANY(${sql.raw(`ARRAY[${fromStatuses.map((s) => `'${s}'`).join(",")}]::escalation_status[]`)})
      RETURNING id
    `);
    const claimed = ((result as unknown as { rowCount: number | null }).rowCount ?? 0) > 0;

    // FR-ESC-05 — releasing the concurrency slot on a terminal transition. Uses the
    // PRE-transition `assignedAgentId` (not `extra.assignedAgentId`, which on
    // Resolve/Return-to-Bot is stamped as the *acting* user and may differ from
    // whoever actually held the slot if a different agent closes it out) so the
    // correct agent's load is released regardless of who performed the close.
    if (claimed && isTerminalEscalationStatus(to) && before?.assignedAgentId) {
      await decrementCurrentLoadInTx(db, ctx.tenantId, before.assignedAgentId);
      await appendAssignmentLogInTx(db, ctx.tenantId, id, before.assignedAgentId, "Released", extra?.assignedAgentId ?? before.assignedAgentId);
    }

    const rows = await db.select().from(schema.escalation).where(and(eq(schema.escalation.tenantId, ctx.tenantId), eq(schema.escalation.id, id)));
    return { claimed, row: (rows[0] as EscalationRow | undefined) ?? null };
  });
}

/** Internal sentinel — never leaves this module. Lets `claimEscalationWithCeilingCheck`/
 * `reassignEscalationWithLoadTransfer` throw from deep inside a `withTenant` callback
 * (the only way to guarantee the ceiling-check increment and the paired escalation
 * CAS-update commit or roll back TOGETHER, since `withTenant` commits on normal return
 * and rolls back only on a thrown error) while still returning a plain discriminated
 * result to their own callers, matching this repository's existing "infra returns
 * data, application throws the public `DomainError`" convention. */
class AtCeilingSentinel extends Error {}
class LostClaimRaceSentinel extends Error {}

/**
 * FR-ESC-05's core atomic mechanic: the `Waiting -> InProgress` claim, paired with an
 * atomic concurrency-ceiling check-and-increment on the SAME transaction, so a claim
 * attempt past `max_concurrent` is rejected before any escalation-status write
 * commits — never a read-then-write race, never a partial state change (a rejected
 * claim leaves both the escalation `Waiting` and the agent's `current_load`
 * untouched). Caller (`application/claim-escalation.ts`) must call
 * `ensureAgentPresence` first so the presence row is guaranteed to exist (that
 * provisioning step is independently idempotent and does not need to be atomic with
 * the claim itself).
 */
export async function claimEscalationWithCeilingCheck(
  ctx: TenantContext,
  id: string,
  userId: string,
): Promise<{ outcome: "claimed"; row: EscalationRow } | { outcome: "at_ceiling" } | { outcome: "lost_race" }> {
  try {
    const row = await withTenant(ctx, async (db: TenantScopedClient) => {
      const incremented = await tryIncrementCurrentLoadInTx(db, ctx.tenantId, userId);
      if (!incremented) throw new AtCeilingSentinel();

      const result = await db.execute(sql`
        UPDATE escalation
           SET status = 'InProgress',
               assigned_agent_id = ${userId},
               assigned_at = now(),
               picked_up_at = CASE WHEN picked_up_at IS NULL THEN now() ELSE picked_up_at END,
               wait_seconds = CASE WHEN picked_up_at IS NULL
                                    THEN EXTRACT(EPOCH FROM (now() - waiting_since))::integer
                                    ELSE wait_seconds END
         WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'Waiting'
        RETURNING id
      `);
      const claimed = ((result as unknown as { rowCount: number | null }).rowCount ?? 0) > 0;
      // Losing this race must roll back the increment above too — throwing here (as
      // opposed to returning a "not claimed" value) is what makes that happen; see
      // `AtCeilingSentinel`/`LostClaimRaceSentinel`'s own doc comment.
      if (!claimed) throw new LostClaimRaceSentinel();

      await appendAssignmentLogInTx(db, ctx.tenantId, id, userId, "Claimed", userId);
      const rows = await db.select().from(schema.escalation).where(and(eq(schema.escalation.tenantId, ctx.tenantId), eq(schema.escalation.id, id)));
      return rows[0] as EscalationRow;
    });
    return { outcome: "claimed", row };
  } catch (err) {
    if (err instanceof AtCeilingSentinel) return { outcome: "at_ceiling" };
    if (err instanceof LostClaimRaceSentinel) return { outcome: "lost_race" };
    throw err;
  }
}

/**
 * FR-ESC-05's "Reassign" load-transfer path — used only when `input.agentId` actually
 * changes the assigned agent on an `InProgress` escalation (the pre-existing
 * queue-only / agent-unchanged reassign shape is untouched, still routed through
 * `claimEscalationTransition` above, since it never affects any agent's load).
 * Decrements the outgoing agent's `current_load` and atomically ceiling-checks +
 * increments the incoming agent's, in the SAME transaction as the escalation update,
 * for the identical "commit or roll back together" reason `claimEscalationWithCeilingCheck`
 * documents. `input.agentId === null` is a legal "unassign" (decrement only, no
 * increment, no ceiling check).
 */
export async function reassignEscalationWithLoadTransfer(
  ctx: TenantContext,
  id: string,
  outgoingAgentId: string,
  incomingAgentId: string | null,
  queueId: string | undefined,
  actorUserId: string,
): Promise<{ outcome: "reassigned"; row: EscalationRow } | { outcome: "at_ceiling" } | { outcome: "lost_race" }> {
  try {
    const row = await withTenant(ctx, async (db: TenantScopedClient) => {
      await decrementCurrentLoadInTx(db, ctx.tenantId, outgoingAgentId);
      if (incomingAgentId) {
        const incremented = await tryIncrementCurrentLoadInTx(db, ctx.tenantId, incomingAgentId);
        if (!incremented) throw new AtCeilingSentinel();
      }

      const result = await db.execute(sql`
        UPDATE escalation
           SET assigned_agent_id = ${incomingAgentId},
               queue_id = COALESCE(${queueId ?? null}, queue_id)
         WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'InProgress'
        RETURNING id
      `);
      const claimed = ((result as unknown as { rowCount: number | null }).rowCount ?? 0) > 0;
      if (!claimed) throw new LostClaimRaceSentinel();

      await appendAssignmentLogInTx(db, ctx.tenantId, id, incomingAgentId ?? outgoingAgentId, "Reassigned", actorUserId);
      const rows = await db.select().from(schema.escalation).where(and(eq(schema.escalation.tenantId, ctx.tenantId), eq(schema.escalation.id, id)));
      return rows[0] as EscalationRow;
    });
    return { outcome: "reassigned", row };
  } catch (err) {
    if (err instanceof AtCeilingSentinel) return { outcome: "at_ceiling" };
    if (err instanceof LostClaimRaceSentinel) return { outcome: "lost_race" };
    throw err;
  }
}

/** Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — the SLA sweep's read
 * side: every non-terminal escalation whose `sla_due_at` has passed and isn't already
 * flagged. */
export async function findEscalationsPastSlaDue(ctx: TenantContext, asOf: Date): Promise<EscalationRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.escalation)
      .where(
        and(
          eq(schema.escalation.tenantId, ctx.tenantId),
          eq(schema.escalation.slaBreached, false),
          lte(schema.escalation.slaDueAt, asOf),
          sql`${schema.escalation.status} IN ('Waiting','InProgress')`,
        ),
      );
    return rows as EscalationRow[];
  });
}

/** Flips `sla_breached` true for a batch of escalation ids (the sweep's write side).
 * Idempotent — re-flipping an already-`true` row is a no-op, so a sweep tick
 * overlapping its own previous run (or running on N worker replicas) never corrupts
 * state, matching `apps/worker`'s own documented "at most duplicate work" scheduler
 * contract. */
export async function markEscalationsSlaBreached(ctx: TenantContext, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.escalation)
      .set({ slaBreached: true })
      .where(and(eq(schema.escalation.tenantId, ctx.tenantId), inArray(schema.escalation.id, ids)));
    return ids.length;
  });
}

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-06) — attaches a delegation
 * run's identity and full chain to an escalation.
 *
 * Called AFTER `createEscalation`'s own create-or-attach, deliberately: FR-ORC-06's
 * "one conversation raises exactly one active `Escalation`" guarantee is the partial
 * unique index that function already relies on, and this must never become a second
 * path that could create one. When multiple team members trip an escalation in the
 * same run, the first call sets these fields and later calls MERGE their chain into
 * the existing record rather than overwriting it — so the record ends up carrying
 * every hop, which is exactly what the takeover panel needs to render the whole
 * delegation tree rather than only the terminal agent.
 *
 * `delegation_run_id` is the column Phase 13 already reserved for this
 * (`escalations.ts`'s own doc comment names Phase 14/BL-46 as its consumer).
 */
export async function attachDelegationContextToEscalation(
  ctx: TenantContext,
  escalationId: string,
  input: { delegationRunId: string; delegationChain: unknown[] },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ snapshot: schema.escalation.aiContextSnapshot, existingRunId: schema.escalation.delegationRunId })
      .from(schema.escalation)
      .where(and(eq(schema.escalation.tenantId, ctx.tenantId), eq(schema.escalation.id, escalationId)));
    const row = rows[0];
    if (!row) return;

    const snapshot = (row.snapshot ?? {}) as Record<string, unknown>;
    const existingChain = Array.isArray(snapshot.delegationChain) ? (snapshot.delegationChain as unknown[]) : [];
    // Longest-wins rather than append: a later member's chain is a SUPERSET of the
    // earlier one (both start at the same supervisor), so concatenating would
    // duplicate every shared hop.
    const mergedChain = input.delegationChain.length >= existingChain.length ? input.delegationChain : existingChain;

    await db
      .update(schema.escalation)
      .set({
        delegationRunId: row.existingRunId ?? input.delegationRunId,
        aiContextSnapshot: { ...snapshot, delegationChain: mergedChain, delegationRunId: row.existingRunId ?? input.delegationRunId },
      })
      .where(and(eq(schema.escalation.tenantId, ctx.tenantId), eq(schema.escalation.id, escalationId)));
  });
}

/** B.5.1 Escalation Queue list — active (non-terminal) escalations, longest-wait-first
 * is computed by the caller (needs "now" at render/serialize time, not query time). */
export async function listActiveEscalations(ctx: TenantContext): Promise<EscalationRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.escalation)
      .where(and(eq(schema.escalation.tenantId, ctx.tenantId), sql`${schema.escalation.status} IN ('Waiting','InProgress')`))
      .orderBy(desc(schema.escalation.waitingSince));
    return rows as EscalationRow[];
  });
}
