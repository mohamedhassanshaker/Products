import { and, eq, isNull, lt, or } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { IngestionJobError } from "@nextbot/db";

export type KnowledgeIngestionJobRow = typeof schema.knowledgeIngestionJob.$inferSelect;

/** `stage_ordinal` (LLD §14.4.3's stage table) — 1..10, fixed order. */
export const STAGE_ORDINAL: Record<KnowledgeIngestionJobRow["stage"], number> = {
  Ingest: 1,
  Parse: 2,
  Chunk: 3,
  ExtractEntities: 4,
  Resolve: 5,
  BuildGraph: 6,
  CommunityDetection: 7,
  CommunitySummaries: 8,
  Embed: 9,
  Index: 10,
};

export interface EnqueueJobInput {
  generationId: string;
  sourceId?: string | null;
  documentId?: string | null;
  stage: KnowledgeIngestionJobRow["stage"];
  dependsOnJobId?: string | null;
  input?: unknown;
}

/**
 * Enqueues a unit of work — idempotent by construction (`UNIQUE (tenant_id,
 * generation_id, stage, coalesce(document_id, source_id, generation_id))`,
 * LLD §14.4.3): re-enqueuing the same unit of work is a no-op, caught here as a
 * duplicate-key error and swallowed rather than propagated, since "already queued/
 * done" is exactly the idempotent outcome the caller wants.
 */
export async function enqueueJob(ctx: TenantContext, job: EnqueueJobInput): Promise<KnowledgeIngestionJobRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    try {
      await db.insert(schema.knowledgeIngestionJob).values({
        id,
        tenantId: ctx.tenantId,
        generationId: job.generationId,
        sourceId: job.sourceId,
        documentId: job.documentId,
        stage: job.stage,
        stageOrdinal: STAGE_ORDINAL[job.stage],
        dependsOnJobId: job.dependsOnJobId,
        input: job.input,
      });
    } catch {
      return null; // idempotency-key collision — this unit of work is already queued/done.
    }
    const [row] = await db.select().from(schema.knowledgeIngestionJob).where(eq(schema.knowledgeIngestionJob.id, id));
    return (row as KnowledgeIngestionJobRow | undefined) ?? null;
  });
}

/**
 * Claims up to `limit` due jobs via `FOR UPDATE SKIP LOCKED` (LLD §14.4.3's pump
 * query) — a job whose dependency hasn't succeeded yet, or whose stage_ordinal
 * exceeds the generation's current collection-wide-stage floor, is never claimed
 * (see `pump.ts`'s own filtering, since expressing "the pump never leases a job
 * whose stage_ordinal exceeds min(stage_ordinal) of unfinished jobs in the same
 * generation FOR COLLECTION-WIDE STAGES" as one SQL predicate would need a
 * correlated subquery per row this simpler two-step claim-then-filter approach
 * avoids, at the cost of occasionally claiming and then re-releasing a job whose
 * dependency isn't ready — safe, since releasing back to Queued is itself
 * idempotent).
 */
export async function claimDueJobs(ctx: TenantContext, limit: number, leaseOwner: string, leaseSeconds: number): Promise<KnowledgeIngestionJobRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const candidates = await db
      .select()
      .from(schema.knowledgeIngestionJob)
      .where(
        and(
          eq(schema.knowledgeIngestionJob.tenantId, ctx.tenantId),
          eq(schema.knowledgeIngestionJob.status, "Queued"),
        ),
      )
      .orderBy(schema.knowledgeIngestionJob.stageOrdinal, schema.knowledgeIngestionJob.queuedAt)
      .limit(limit)
      .for("update", { skipLocked: true });

    const claimed: KnowledgeIngestionJobRow[] = [];
    for (const job of candidates as KnowledgeIngestionJobRow[]) {
      if (job.dependsOnJobId) {
        const [dep] = await db.select({ status: schema.knowledgeIngestionJob.status }).from(schema.knowledgeIngestionJob).where(eq(schema.knowledgeIngestionJob.id, job.dependsOnJobId));
        if (!dep || dep.status !== "Succeeded") continue; // dependency not ready — leave Queued, try again next tick
      }
      await db
        .update(schema.knowledgeIngestionJob)
        .set({ status: "Leased", leaseOwner, leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000), attempt: job.attempt + 1, startedAt: job.startedAt ?? new Date() })
        .where(eq(schema.knowledgeIngestionJob.id, job.id));
      claimed.push({ ...job, status: "Leased", leaseOwner, attempt: job.attempt + 1 });
    }
    return claimed;
  });
}

export async function completeJob(ctx: TenantContext, id: string, output?: unknown, costUsd?: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.knowledgeIngestionJob)
      .set({ status: "Succeeded", output, costUsd, finishedAt: new Date() })
      .where(and(eq(schema.knowledgeIngestionJob.id, id), eq(schema.knowledgeIngestionJob.tenantId, ctx.tenantId))),
  );
}

/** A failed attempt below `max_attempts` goes back to `Queued` for a retry; at
 *  `max_attempts` it's terminally `Failed` — matching LLD §14.4.3's per-stage
 *  failure semantics (retry N times, then the owning document/source/generation
 *  degrades per that stage's own row in the stage table, never silently ignored). */
export async function failJob(ctx: TenantContext, id: string, error: IngestionJobError): Promise<KnowledgeIngestionJobRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db.select().from(schema.knowledgeIngestionJob).where(and(eq(schema.knowledgeIngestionJob.id, id), eq(schema.knowledgeIngestionJob.tenantId, ctx.tenantId)));
    const job = row as KnowledgeIngestionJobRow | undefined;
    if (!job) throw new Error(`failJob: job ${id} not found`);
    const terminal = !error.retriable || job.attempt >= job.maxAttempts;
    await db
      .update(schema.knowledgeIngestionJob)
      .set({ status: terminal ? "Failed" : "Queued", error, finishedAt: terminal ? new Date() : null, leaseOwner: null, leaseExpiresAt: null })
      .where(eq(schema.knowledgeIngestionJob.id, id));
    const [updated] = await db.select().from(schema.knowledgeIngestionJob).where(eq(schema.knowledgeIngestionJob.id, id));
    return updated as KnowledgeIngestionJobRow;
  });
}

/** Skips a job without treating it as a failure (LLD's `Skipped` status) — e.g. a
 *  source kind this phase doesn't yet integrate against for real. */
export async function skipJob(ctx: TenantContext, id: string, reason: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.knowledgeIngestionJob)
      .set({ status: "Skipped", error: { code: "SKIPPED", message: reason, retriable: false }, finishedAt: new Date() })
      .where(and(eq(schema.knowledgeIngestionJob.id, id), eq(schema.knowledgeIngestionJob.tenantId, ctx.tenantId))),
  );
}

export async function listJobsForGeneration(ctx: TenantContext, generationId: string): Promise<KnowledgeIngestionJobRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.knowledgeIngestionJob).where(and(eq(schema.knowledgeIngestionJob.tenantId, ctx.tenantId), eq(schema.knowledgeIngestionJob.generationId, generationId))),
  ) as Promise<KnowledgeIngestionJobRow[]>;
}

/** The lease-reaper's reclaim query (`apps/worker`'s `knowledge.lease-reaper`
 *  equivalent, per LLD §14.4.3's `knowledge-lease-reaper.ts`): any `Leased` job
 *  whose lease has expired goes back to `Queued` for a future pump tick to retry —
 *  the same fail-safe reclaim idiom every lease-based design needs (a worker
 *  crashing mid-job must never strand that job forever). */
export async function reclaimExpiredLeases(ctx: TenantContext): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const expired = await db
      .select({ id: schema.knowledgeIngestionJob.id })
      .from(schema.knowledgeIngestionJob)
      .where(
        and(
          eq(schema.knowledgeIngestionJob.tenantId, ctx.tenantId),
          eq(schema.knowledgeIngestionJob.status, "Leased"),
          or(isNull(schema.knowledgeIngestionJob.leaseExpiresAt), lt(schema.knowledgeIngestionJob.leaseExpiresAt, new Date())),
        ),
      );
    for (const { id } of expired) {
      await db.update(schema.knowledgeIngestionJob).set({ status: "Queued", leaseOwner: null, leaseExpiresAt: null }).where(eq(schema.knowledgeIngestionJob.id, id));
    }
    return expired.length;
  });
}
