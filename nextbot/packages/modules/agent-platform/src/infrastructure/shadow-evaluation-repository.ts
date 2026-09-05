import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ShadowToolCallRecord } from "@nextbot/db/schema";

/**
 * Persistence for shadow evaluation (Target Architecture Blueprint Phase 17, BL-48,
 * ADR-0019 §2.5, LLD §15.2/§15.5).
 *
 * The `shadow_run` claim/lease/reclaim trio below follows the
 * `knowledge_ingestion_job` / `claimDueJobs()` / `reclaimExpiredLeases()` idiom
 * (`packages/modules/knowledge/src/infrastructure/ingestion-job-repository.ts`, Phase 7b,
 * QA-approved) **verbatim** rather than inventing a second leasing pattern:
 * `FOR UPDATE SKIP LOCKED` to claim, `lease_owner` + `lease_expires_at` to hold, an
 * `attempts` counter to bound retries, and a reaper that returns an expired lease to
 * `Pending` so a crashed worker replica can never strand a row forever. ADR-0013 §7
 * established that idiom as this codebase's durable-executor pattern.
 */

export type ShadowEvaluationRow = typeof schema.shadowEvaluation.$inferSelect;
export type ShadowRunRow = typeof schema.shadowRun.$inferSelect;

// ---------------------------------------------------------------------------
// shadow_evaluation
// ---------------------------------------------------------------------------

export async function insertShadowEvaluation(
  ctx: TenantContext,
  input: {
    agentDefinitionId: string;
    environment: "Sandbox" | "Staging" | "Production";
    candidateVersionId: string;
    samplePct: number;
    maxRuns: number;
    maxCostUsd: string;
    createdByUserId: string | null;
  },
): Promise<ShadowEvaluationRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.shadowEvaluation).values({
      id,
      tenantId: ctx.tenantId,
      agentDefinitionId: input.agentDefinitionId,
      environment: input.environment as never,
      candidateVersionId: input.candidateVersionId,
      samplePct: input.samplePct,
      maxRuns: input.maxRuns,
      maxCostUsd: input.maxCostUsd,
      createdByUserId: input.createdByUserId,
    });
    const [row] = await db.select().from(schema.shadowEvaluation).where(eq(schema.shadowEvaluation.id, id));
    if (!row) throw new Error("insertShadowEvaluation: insert did not return a row");
    return row;
  });
}

/** The single `Active` experiment for a triple, if any — the enqueue path's hot read
 *  (backed by the partial unique index from migration `0084`). */
export async function findActiveShadowEvaluation(
  ctx: TenantContext,
  agentDefinitionId: string,
  environment: "Sandbox" | "Staging" | "Production",
): Promise<ShadowEvaluationRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.shadowEvaluation)
      .where(
        and(
          eq(schema.shadowEvaluation.tenantId, ctx.tenantId),
          eq(schema.shadowEvaluation.agentDefinitionId, agentDefinitionId),
          eq(schema.shadowEvaluation.environment, environment as never),
          eq(schema.shadowEvaluation.status, "Active"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function getShadowEvaluation(ctx: TenantContext, id: string): Promise<ShadowEvaluationRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.shadowEvaluation)
      .where(and(eq(schema.shadowEvaluation.tenantId, ctx.tenantId), eq(schema.shadowEvaluation.id, id)));
    return rows[0] ?? null;
  });
}

export async function listShadowEvaluations(ctx: TenantContext, agentDefinitionId: string): Promise<ShadowEvaluationRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.shadowEvaluation)
      .where(and(eq(schema.shadowEvaluation.tenantId, ctx.tenantId), eq(schema.shadowEvaluation.agentDefinitionId, agentDefinitionId)))
      .orderBy(desc(schema.shadowEvaluation.createdAt)),
  );
}

/** Terminates an experiment. `AutoStopped` is what a breached `max_runs`/`max_cost_usd`
 *  ceiling produces; `Stopped` is an admin action; `Completed` is reserved for a future
 *  "ran to a planned end" path and is accepted here so the enum has no unwritable value. */
export async function stopShadowEvaluation(
  ctx: TenantContext,
  id: string,
  input: { status: "Stopped" | "Completed" | "AutoStopped"; stopReason: string; stoppedByUserId: string | null },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.shadowEvaluation)
      .set({ status: input.status, stopReason: input.stopReason, stoppedByUserId: input.stoppedByUserId, stoppedAt: new Date() })
      .where(and(eq(schema.shadowEvaluation.tenantId, ctx.tenantId), eq(schema.shadowEvaluation.id, id), eq(schema.shadowEvaluation.status, "Active"))),
  );
}

/**
 * Atomically increments `runs_enqueued` **only while the experiment is still `Active` and
 * strictly under its `max_runs` ceiling**, and reports whether it won.
 *
 * Deliberately a single conditional `UPDATE … WHERE runs_enqueued < max_runs` rather than
 * a read-then-write: `max_runs` is a real spend ceiling, and a check-then-act would let N
 * concurrent live turns each observe "under the cap" and all enqueue, overshooting by up
 * to N. This is the enforcement, not the documentation, of ADR-0019's "hard ceilings".
 *
 * @returns `true` if a slot was claimed and the caller may insert a `shadow_run`.
 */
export async function tryClaimEnqueueSlot(ctx: TenantContext, shadowEvaluationId: string): Promise<boolean> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const updated = await db
      .update(schema.shadowEvaluation)
      .set({ runsEnqueued: sql`${schema.shadowEvaluation.runsEnqueued} + 1` })
      .where(
        and(
          eq(schema.shadowEvaluation.tenantId, ctx.tenantId),
          eq(schema.shadowEvaluation.id, shadowEvaluationId),
          eq(schema.shadowEvaluation.status, "Active"),
          sql`${schema.shadowEvaluation.runsEnqueued} < ${schema.shadowEvaluation.maxRuns}`,
          sql`${schema.shadowEvaluation.spendUsd} < ${schema.shadowEvaluation.maxCostUsd}`,
        ),
      )
      .returning({ id: schema.shadowEvaluation.id });
    return updated.length > 0;
  });
}

/**
 * Records one completed replay's real cost against the experiment and auto-stops it if
 * either ceiling is now breached.
 *
 * Cost is accumulated *after* the fact (the model call has to happen before its price is
 * known), so `max_cost_usd` is a stop-the-experiment ceiling rather than a per-call
 * pre-authorization — the same shape `model_budget` already uses. Combined with
 * `tryClaimEnqueueSlot`'s pre-check, the worst-case overshoot is bounded by the runs
 * already in flight, which is exactly what a bounded experiment needs and is disclosed
 * here rather than implied.
 */
export async function recordShadowSpendAndMaybeAutoStop(ctx: TenantContext, shadowEvaluationId: string, costUsd: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.shadowEvaluation)
      .set({
        runsCompleted: sql`${schema.shadowEvaluation.runsCompleted} + 1`,
        spendUsd: sql`${schema.shadowEvaluation.spendUsd} + ${costUsd}::numeric`,
      })
      .where(and(eq(schema.shadowEvaluation.tenantId, ctx.tenantId), eq(schema.shadowEvaluation.id, shadowEvaluationId)));

    await db
      .update(schema.shadowEvaluation)
      .set({
        status: "AutoStopped",
        stopReason: "Reached the configured max runs or max cost ceiling.",
        stoppedAt: new Date(),
      })
      .where(
        and(
          eq(schema.shadowEvaluation.tenantId, ctx.tenantId),
          eq(schema.shadowEvaluation.id, shadowEvaluationId),
          eq(schema.shadowEvaluation.status, "Active"),
          or(
            sql`${schema.shadowEvaluation.runsCompleted} >= ${schema.shadowEvaluation.maxRuns}`,
            sql`${schema.shadowEvaluation.spendUsd} >= ${schema.shadowEvaluation.maxCostUsd}`,
          ),
        ),
      );
  });
}

// ---------------------------------------------------------------------------
// shadow_run — the durable work table
// ---------------------------------------------------------------------------

export async function insertShadowRun(
  ctx: TenantContext,
  input: {
    shadowEvaluationId: string;
    conversationId: string;
    liveAgentRunId: string;
    liveMessageId: string;
    candidateVersionId: string;
  },
): Promise<ShadowRunRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.shadowRun).values({ id, tenantId: ctx.tenantId, ...input });
    const [row] = await db.select().from(schema.shadowRun).where(eq(schema.shadowRun.id, id));
    if (!row) throw new Error("insertShadowRun: insert did not return a row");
    return row;
  });
}

/**
 * Claims up to `limit` `Pending` shadow runs via `FOR UPDATE SKIP LOCKED` — the exact
 * claim shape `knowledge_ingestion_job`'s `claimDueJobs` uses, so two worker replicas
 * pumping simultaneously never process the same row.
 */
export async function claimDueShadowRuns(ctx: TenantContext, limit: number, leaseOwner: string, leaseSeconds: number): Promise<ShadowRunRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const candidates = await db
      .select()
      .from(schema.shadowRun)
      .where(and(eq(schema.shadowRun.tenantId, ctx.tenantId), eq(schema.shadowRun.status, "Pending")))
      .orderBy(asc(schema.shadowRun.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    const claimed: ShadowRunRow[] = [];
    for (const run of candidates as ShadowRunRow[]) {
      await db
        .update(schema.shadowRun)
        .set({ status: "Claimed", leaseOwner, leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000), attempts: run.attempts + 1 })
        .where(eq(schema.shadowRun.id, run.id));
      claimed.push({ ...run, status: "Claimed", leaseOwner, attempts: run.attempts + 1 });
    }
    return claimed;
  });
}

/** Terminal success. `shadowAgentRunId` is what keeps the shadow trace reachable at all
 *  (every ordinary `agent_run` reader excludes `trigger = 'ShadowEvaluation'`). */
export async function completeShadowRun(
  ctx: TenantContext,
  id: string,
  input: {
    shadowAgentRunId: string | null;
    durationMs: number;
    costUsd: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    replyText: string | null;
    replyPayloadHash: string | null;
    liveReplyPayloadHash: string | null;
    liveToolCallCount: number | null;
    wouldHaveToolCalls: ShadowToolCallRecord[];
    escalationSignal: unknown;
    guardrailOutcome: unknown;
  },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.shadowRun)
      .set({
        status: "Completed",
        shadowAgentRunId: input.shadowAgentRunId,
        durationMs: input.durationMs,
        costUsd: input.costUsd,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        replyText: input.replyText,
        replyPayloadHash: input.replyPayloadHash,
        liveReplyPayloadHash: input.liveReplyPayloadHash,
        liveToolCallCount: input.liveToolCallCount,
        wouldHaveToolCalls: input.wouldHaveToolCalls,
        escalationSignal: input.escalationSignal,
        guardrailOutcome: input.guardrailOutcome,
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
      })
      .where(and(eq(schema.shadowRun.tenantId, ctx.tenantId), eq(schema.shadowRun.id, id))),
  );
}

/** Maximum replay attempts before a shadow run is given up on. Deliberately small: a
 *  shadow run is *evidence*, never a customer-facing obligation, so retrying it hard would
 *  spend real money chasing a data point nobody is blocked on. */
export const SHADOW_RUN_MAX_ATTEMPTS = 3;

/** A failed attempt below `SHADOW_RUN_MAX_ATTEMPTS` returns to `Pending` for a retry; at
 *  the ceiling it is terminally `Failed`. Mirrors `failJob`'s semantics in the knowledge
 *  pipeline. */
export async function failShadowRun(ctx: TenantContext, id: string, error: { code: string; message: string }): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db
      .select({ attempts: schema.shadowRun.attempts })
      .from(schema.shadowRun)
      .where(and(eq(schema.shadowRun.tenantId, ctx.tenantId), eq(schema.shadowRun.id, id)));
    const terminal = (row?.attempts ?? SHADOW_RUN_MAX_ATTEMPTS) >= SHADOW_RUN_MAX_ATTEMPTS;
    await db
      .update(schema.shadowRun)
      .set({
        status: terminal ? "Failed" : "Pending",
        error,
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: terminal ? new Date() : null,
      })
      .where(and(eq(schema.shadowRun.tenantId, ctx.tenantId), eq(schema.shadowRun.id, id)));
  });
}

/**
 * Terminal, non-error skip.
 *
 * `SourceGone` is the one ADR-0019 §4 specifically calls out: `shadow_run` stores pointers
 * rather than a transcript copy, so a conversation purged by retention/DSR between enqueue
 * and replay yields a run that *cannot* execute. That must terminate the row cleanly —
 * never as an error, never by resurrecting purged content, and never as a dangling
 * reference the report screen crashes on.
 */
export async function skipShadowRun(ctx: TenantContext, id: string, reason: "SourceGone" | "QuotaDeferredTooLong" | "EvaluationStopped"): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.shadowRun)
      .set({ status: "Skipped", skipReason: reason, leaseOwner: null, leaseExpiresAt: null, completedAt: new Date() })
      .where(and(eq(schema.shadowRun.tenantId, ctx.tenantId), eq(schema.shadowRun.id, id))),
  );
}

/** Returns a claimed run to `Pending` without consuming a further attempt beyond the one
 *  already counted — used when the tenant's concurrency quota is saturated, so a shadow
 *  experiment defers rather than competing with (and 429-ing) real customers. */
export async function deferShadowRun(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.shadowRun)
      .set({ status: "Pending", leaseOwner: null, leaseExpiresAt: null })
      .where(and(eq(schema.shadowRun.tenantId, ctx.tenantId), eq(schema.shadowRun.id, id))),
  );
}

/** `deployment.shadow-lease-reaper`'s reclaim query — any `Claimed` run whose lease has
 *  expired (the worker replica that leased it crashed mid-replay) goes back to `Pending`.
 *  Identical in shape to `reclaimExpiredLeases` in the knowledge pipeline. */
export async function reclaimExpiredShadowLeases(ctx: TenantContext): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const expired = await db
      .select({ id: schema.shadowRun.id })
      .from(schema.shadowRun)
      .where(
        and(
          eq(schema.shadowRun.tenantId, ctx.tenantId),
          eq(schema.shadowRun.status, "Claimed"),
          or(isNull(schema.shadowRun.leaseExpiresAt), lt(schema.shadowRun.leaseExpiresAt, new Date())),
        ),
      );
    for (const { id } of expired) {
      await db.update(schema.shadowRun).set({ status: "Pending", leaseOwner: null, leaseExpiresAt: null }).where(eq(schema.shadowRun.id, id));
    }
    return expired.length;
  });
}

export async function listShadowRuns(ctx: TenantContext, shadowEvaluationId: string, limit = 100): Promise<ShadowRunRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.shadowRun)
      .where(and(eq(schema.shadowRun.tenantId, ctx.tenantId), eq(schema.shadowRun.shadowEvaluationId, shadowEvaluationId)))
      .orderBy(desc(schema.shadowRun.createdAt))
      .limit(limit),
  );
}

export async function getShadowRun(ctx: TenantContext, id: string): Promise<ShadowRunRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.shadowRun).where(and(eq(schema.shadowRun.tenantId, ctx.tenantId), eq(schema.shadowRun.id, id)));
    return rows[0] ?? null;
  });
}
