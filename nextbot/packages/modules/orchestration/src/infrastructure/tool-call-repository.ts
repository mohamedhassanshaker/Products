import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ToolCallStatusValue } from "@nextbot/contracts";

export interface ToolCallRow {
  id: string;
  tenantId: string;
  conversationId: string;
  toolId: string;
  toolName: string;
  connectorId: string | null;
  approvalTier: "Tier1" | "Tier2" | "Tier3";
  status: ToolCallStatusValue;
  inputArgs: Record<string, unknown>;
  inputArgsMasked: Record<string, unknown> | null;
  idempotencyKey: string;
  attemptCount: number;
  output: unknown;
  errorMessage: string | null;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  /** Phase 14 (BL-46, FR-ORC-04) — see `createToolCall`'s own doc. */
  agentRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Appends one row to the append-only `tool_call_event` transition log (LLD §6.3) —
 * called for *every* transition attempt, including a rejected duplicate/illegal one
 * (`accepted: false`), so the audit trail always shows what was attempted, not just
 * what succeeded. */
export async function appendToolCallEvent(
  ctx: TenantContext,
  input: {
    toolCallId: string;
    fromStatus: ToolCallStatusValue | null;
    toStatus: ToolCallStatusValue;
    actorType: "Customer" | "HumanAgent" | "System";
    actorUserId?: string | null;
    note?: string | null;
    accepted: boolean;
  },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.toolCallEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      toolCallId: input.toolCallId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? null,
      accepted: input.accepted,
    });
  });
}

/** Creates the `Created` row for a suspended (Tier-2/3) tool call, per LLD §6.2 step 6. */
export async function createToolCall(
  ctx: TenantContext,
  input: {
    conversationId: string;
    toolId: string;
    toolName: string;
    connectorId: string | null;
    approvalTier: "Tier2" | "Tier3";
    inputArgs: Record<string, unknown>;
    inputArgsMasked: Record<string, unknown> | null;
    /** Phase 14 (BL-46, FR-ORC-04) — the `agent_run` this call was made inside, so a
     * suspended call made at any delegation depth is joinable back to that run's
     * delegation tree. `undefined` for every pre-existing (non-delegated) caller. */
    agentRunId?: string | null;
    /**
     * Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4) — the call's own
     * suspension deadline. `tool_call.expires_at` has existed (nullable) since Phase
     * 14's migration but was **never written**, because no expiry sweeper existed;
     * `approvals.expiry-sweep` is that sweeper, and this is the column it scans. Both
     * tiers now stamp it (Tier-2: LLD §6.4's 900s default; Tier-3: `TIER3_TIMEOUT_MS`,
     * kept identical to the `approval_request.expires_at` written in the same call).
     *
     * Still optional here rather than required, so a caller that genuinely has no
     * deadline concept keeps `NULL` — a `NULL` `expires_at` is simply never swept,
     * which is the same behavior every row had before this phase.
     */
    expiresAt?: Date | null;
  },
): Promise<ToolCallRow> {
  const id = generateId();
  const idempotencyKey = generateId();
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.toolCall).values({
      id,
      tenantId: ctx.tenantId,
      conversationId: input.conversationId,
      toolId: input.toolId,
      toolName: input.toolName,
      connectorId: input.connectorId,
      approvalTier: input.approvalTier,
      status: "Created",
      inputArgs: input.inputArgs,
      inputArgsMasked: input.inputArgsMasked,
      idempotencyKey,
      agentRunId: input.agentRunId ?? null,
      expiresAt: input.expiresAt ?? null,
    });
    // Read back within the SAME transaction/connection (not a nested `withTenant`
    // call, which would open a second connection that can't see this still-
    // uncommitted insert and would incorrectly resolve to `null`).
    const rows = await db.select().from(schema.toolCall).where(and(eq(schema.toolCall.tenantId, ctx.tenantId), eq(schema.toolCall.id, id)));
    return rows[0] as ToolCallRow;
  });
}

export async function findToolCallById(ctx: TenantContext, id: string): Promise<ToolCallRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.toolCall).where(and(eq(schema.toolCall.tenantId, ctx.tenantId), eq(schema.toolCall.id, id)));
    return (rows[0] as ToolCallRow | undefined) ?? null;
  });
}

/**
 * LLD §6.3 layer 2 — the compare-and-set claim. A single conditional `UPDATE`
 * transitions `from` -> `to` only if the row is *still* in one of the eligible
 * `fromStatuses` at the moment the statement runs; Postgres's row-level lock inside
 * the UPDATE makes this atomic under true concurrency (two simultaneous callers can
 * never both see 1 row affected). The loser gets `claimed: false` and must not
 * execute anything — this is what turns "duplicate Approve click" / "duplicate
 * decision POST" into "exactly one caller ever proceeds", independent of the
 * HTTP-layer Idempotency-Key (defense in depth, not a substitute for it).
 */
export async function claimToolCallTransition(
  ctx: TenantContext,
  id: string,
  fromStatuses: ToolCallStatusValue[],
  to: ToolCallStatusValue,
  extra?: { decisionNote?: string | null; decidedByUserId?: string | null; expiresAt?: Date | null },
): Promise<{ claimed: boolean; row: ToolCallRow | null }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const result = await db.execute(sql`
      UPDATE tool_call
         SET status = ${to},
             attempt_count = attempt_count + 1,
             decision_note = COALESCE(${extra?.decisionNote ?? null}, decision_note),
             decided_by_user_id = COALESCE(${extra?.decidedByUserId ?? null}, decided_by_user_id),
             decided_at = CASE WHEN ${to} IN ('Executing','Cancelled','Expired') THEN now() ELSE decided_at END,
             updated_at = now()
       WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
         AND status = ANY(${sql.raw(`ARRAY[${fromStatuses.map((s) => `'${s}'`).join(",")}]::tool_call_status[]`)})
      RETURNING id
    `);
    const claimed = ((result as unknown as { rowCount: number | null }).rowCount ?? 0) > 0;
    // Read back within the SAME transaction/connection — a nested `findToolCallById`
    // call would open a second connection that can't see this still-uncommitted
    // UPDATE and would incorrectly return the pre-transition row (or, worse, race
    // with a concurrent caller's own uncommitted transaction).
    const rows = await db.select().from(schema.toolCall).where(and(eq(schema.toolCall.tenantId, ctx.tenantId), eq(schema.toolCall.id, id)));
    return { claimed, row: (rows[0] as ToolCallRow | undefined) ?? null };
  });
}

/** Marks a claimed (`Executing`) call's terminal outcome — the only writer of
 * `output`/`errorMessage`, called exactly once per call since `Executing` only
 * transitions to a terminal state (LLD §6.1). */
export async function completeToolCallExecution(
  ctx: TenantContext,
  id: string,
  outcome: { status: "Succeeded"; output: unknown } | { status: "Failed"; errorMessage: string },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.toolCall)
      .set({
        status: outcome.status,
        output: outcome.status === "Succeeded" ? outcome.output : null,
        errorMessage: outcome.status === "Failed" ? outcome.errorMessage : null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.toolCall.tenantId, ctx.tenantId), eq(schema.toolCall.id, id)));
  });
}

export interface ApprovalRequestRow {
  id: string;
  tenantId: string;
  toolCallId: string;
  conversationId: string;
  requestedAt: Date;
  expiresAt: Date;
  status: ToolCallStatusValue;
  riskSummary: Record<string, unknown>;
  moreInfoQuestion: string | null;
  createdAt: Date;
}

export async function createApprovalRequest(
  ctx: TenantContext,
  input: { toolCallId: string; conversationId: string; expiresAt: Date; riskSummary: Record<string, unknown> },
): Promise<ApprovalRequestRow> {
  const id = generateId();
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.approvalRequest).values({
      id,
      tenantId: ctx.tenantId,
      toolCallId: input.toolCallId,
      conversationId: input.conversationId,
      expiresAt: input.expiresAt,
      status: "AwaitingHumanApproval",
      riskSummary: input.riskSummary,
    });
    const rows = await db.select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.tenantId, ctx.tenantId), eq(schema.approvalRequest.id, id)));
    return rows[0] as ApprovalRequestRow;
  });
}

export async function findApprovalRequestByToolCallId(ctx: TenantContext, toolCallId: string): Promise<ApprovalRequestRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.approvalRequest)
      .where(and(eq(schema.approvalRequest.tenantId, ctx.tenantId), eq(schema.approvalRequest.toolCallId, toolCallId)));
    return (rows[0] as ApprovalRequestRow | undefined) ?? null;
  });
}

export async function updateApprovalRequestStatus(
  ctx: TenantContext,
  id: string,
  status: ToolCallStatusValue,
  moreInfoQuestion?: string | null,
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.approvalRequest)
      .set({ status, moreInfoQuestion: moreInfoQuestion ?? null })
      .where(and(eq(schema.approvalRequest.tenantId, ctx.tenantId), eq(schema.approvalRequest.id, id)));
  });
}

/** The two statuses a suspended (undecided) call can be in. Shared by the expiry
 *  sweep's scan and its CAS, so the two can never drift apart. */
export const SUSPENDED_TOOL_CALL_STATUSES: ToolCallStatusValue[] = ["AwaitingCustomerConfirmation", "AwaitingHumanApproval"];

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4) — the scan half of
 * `approvals.expiry-sweep`: every still-suspended call whose own `expires_at` has
 * passed, for one tenant.
 *
 * Deliberately driven by `tool_call.expires_at` and NOT by `approval_request.
 * expires_at`, even though Tier-3 writes both: `tool_call` is the row that exists for
 * BOTH tiers (Tier-2 has no `approval_request` at all), so scanning it is the only
 * way one sweep closes both gaps with no second code path — which is precisely why
 * ADR-0013 §7.4 calls the fix "retroactive by construction". The two columns are
 * written in the same call with the same instant for Tier-3, so they cannot disagree.
 *
 * A `NULL` `expires_at` (every row written before this phase) is never selected — such
 * a call has no declared deadline and expiring it would be inventing one.
 *
 * @param ctx tenant context.
 * @param asOf the instant to compare `expires_at` against (injected rather than
 *   `now()` so tests can drive the boundary deterministically).
 * @returns the due rows, oldest deadline first.
 */
export async function findExpiredSuspendedToolCalls(ctx: TenantContext, asOf: Date): Promise<ToolCallRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.toolCall)
      .where(
        and(
          eq(schema.toolCall.tenantId, ctx.tenantId),
          inArray(schema.toolCall.status, SUSPENDED_TOOL_CALL_STATUSES),
          isNotNull(schema.toolCall.expiresAt),
          lt(schema.toolCall.expiresAt, asOf),
        ),
      )
      .orderBy(schema.toolCall.expiresAt);
    return rows as ToolCallRow[];
  });
}

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4) — **the shared expiry
 * primitive**, in ONE transaction: CAS the call from either suspended status to the
 * already-defined terminal `Expired` (LLD §6.1's edge set already contains both
 * `AwaitingCustomerConfirmation -> Expired` and `AwaitingHumanApproval -> Expired`;
 * this is the first code that ever traverses them), append the `tool_call_event` row
 * the append-only transition log requires, and — for Tier-3 — flip the queue row's
 * `approval_request.status` to `Expired` too.
 *
 * All three writes share one `withTenant` transaction on purpose: a call marked
 * `Expired` whose queue row still reads `AwaitingHumanApproval` is exactly the
 * incoherent state ADR-0013 §7.4 exists to forbid (an approver acting on a request
 * whose call is already dead). Doing them in one statement-group makes that window
 * unreachable rather than merely short.
 *
 * Idempotent and race-safe by construction: the CAS's `status = ANY(...)` predicate
 * means a call that a concurrent sweep tick (or a real human decision) already moved
 * out of a suspended status affects zero rows, and this returns `{ expired: false }`
 * without writing anything else. It can therefore be called speculatively — which is
 * what `workflow.suspension-expiry-sweep` does.
 *
 * @param ctx tenant context.
 * @param toolCallId the `tool_call.id` to expire.
 * @returns `expired` — whether THIS call won the CAS — and the row as it now stands.
 */
export async function claimToolCallExpiry(ctx: TenantContext, toolCallId: string): Promise<{ expired: boolean; row: ToolCallRow | null }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const before = await db.select().from(schema.toolCall).where(and(eq(schema.toolCall.tenantId, ctx.tenantId), eq(schema.toolCall.id, toolCallId)));
    const previous = (before[0] as ToolCallRow | undefined) ?? null;
    if (!previous) return { expired: false, row: null };

    const result = await db.execute(sql`
      UPDATE tool_call
         SET status = 'Expired',
             decided_at = now(),
             updated_at = now()
       WHERE id = ${toolCallId} AND tenant_id = ${ctx.tenantId}
         AND status = ANY(ARRAY['AwaitingCustomerConfirmation','AwaitingHumanApproval']::tool_call_status[])
      RETURNING id
    `);
    const expired = ((result as unknown as { rowCount: number | null }).rowCount ?? 0) > 0;

    if (expired) {
      await db.insert(schema.toolCallEvent).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        toolCallId,
        fromStatus: previous.status,
        toStatus: "Expired",
        actorType: "System",
        note: "approvals.expiry-sweep: deadline passed",
        accepted: true,
      });
      // Tier-2 has no `approval_request` row at all — this simply affects zero rows
      // there, which is why one primitive serves both tiers with no branch.
      await db
        .update(schema.approvalRequest)
        .set({ status: "Expired" })
        .where(and(eq(schema.approvalRequest.tenantId, ctx.tenantId), eq(schema.approvalRequest.toolCallId, toolCallId)));
    }

    const after = await db.select().from(schema.toolCall).where(and(eq(schema.toolCall.tenantId, ctx.tenantId), eq(schema.toolCall.id, toolCallId)));
    return { expired, row: (after[0] as ToolCallRow | undefined) ?? null };
  });
}

/** Approval Queue list (screen inventory B.3.6) — pending Tier-3 approvals, oldest
 * (longest-waiting) first. */
export async function listPendingApprovalRequests(ctx: TenantContext): Promise<Array<ApprovalRequestRow & { toolName: string; connectorId: string | null }>> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        id: schema.approvalRequest.id,
        tenantId: schema.approvalRequest.tenantId,
        toolCallId: schema.approvalRequest.toolCallId,
        conversationId: schema.approvalRequest.conversationId,
        requestedAt: schema.approvalRequest.requestedAt,
        expiresAt: schema.approvalRequest.expiresAt,
        status: schema.approvalRequest.status,
        riskSummary: schema.approvalRequest.riskSummary,
        moreInfoQuestion: schema.approvalRequest.moreInfoQuestion,
        createdAt: schema.approvalRequest.createdAt,
        toolName: schema.toolCall.toolName,
        connectorId: schema.toolCall.connectorId,
      })
      .from(schema.approvalRequest)
      .innerJoin(schema.toolCall, eq(schema.toolCall.id, schema.approvalRequest.toolCallId))
      .where(and(eq(schema.approvalRequest.tenantId, ctx.tenantId), eq(schema.approvalRequest.status, "AwaitingHumanApproval")))
      .orderBy(schema.approvalRequest.requestedAt);
    return rows as Array<ApprovalRequestRow & { toolName: string; connectorId: string | null }>;
  });
}

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5) — how many real
 * `tool_call` rows one `agent_run` produced.
 *
 * Added for shadow evaluation's comparison report: the candidate's *intended* tool calls
 * are recorded on `shadow_run.would_have_tool_calls` (nothing was executed), and this is
 * the live side of that comparison. A count rather than the rows themselves, deliberately:
 * the report needs "did the candidate want to do more/fewer things than production
 * actually did", not the arguments, so nothing about this read widens what a shadow report
 * can see of a customer's data.
 *
 * Also the assertion this codebase's shadow-containment tests use to prove **zero**
 * `tool_call` rows were written by a shadow run (`ShadowSuppressed`'s core promise).
 */
export async function countToolCallsForAgentRun(ctx: TenantContext, agentRunId: string): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.toolCall)
      .where(and(eq(schema.toolCall.tenantId, ctx.tenantId), eq(schema.toolCall.agentRunId, agentRunId)));
    return rows[0]?.count ?? 0;
  });
}
