import { and, eq, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2, **ADR-0013 §7.2
 * constraint 3**) — `workflow_run_lease`: the exactly-one-advancer primitive.
 *
 * **Why this is load-bearing rather than an optimization.** `apps/worker`'s scheduler
 * has no distributed lock, and its own doc comment explains why that was safe: "every
 * job this scheduler runs is idempotent and already safe to run concurrently across
 * replicas … a job overlapping its own previous run, or running on N worker replicas
 * simultaneously, does at most duplicate work, never corrupts state." The workflow
 * executor is the **first** job in that process for which that is false — it advances a
 * state machine with real side effects (a write-classified tool call, an escalation, a
 * child run). Two claimers advancing one run would not duplicate work harmlessly; they
 * would double-apply it.
 *
 * So the claim below is the mechanism that restores the scheduler's safety assumption,
 * and ADR-0013 §7.2 requires it be "tested against genuinely concurrent claimers, not
 * asserted" — see `workflow-lease-concurrency.int.test.ts`.
 *
 * **Why a lease rather than `FOR UPDATE`.** A row lock lives only for its transaction.
 * Advancing a run spans many transactions (execute node, persist, execute next node),
 * and a node may take seconds. A lease is a *durable* claim with a TTL, so a holder
 * that dies mid-step releases its claim by simply failing to renew — which is exactly
 * the `knowledge_ingestion_job` lease pattern (Phase 7b's `claimDueJobs()` /
 * `reclaimExpiredLeases()`), applied to a run instead of a job.
 */

/** LLD §14.6.2: "60s, renewed every 20s while a step runs." */
export const LEASE_TTL_SECONDS = 60;
export const LEASE_RENEW_INTERVAL_SECONDS = 20;

export interface WorkflowRunLeaseRow {
  runId: string;
  tenantId: string;
  owner: string;
  acquiredAt: Date;
  expiresAt: Date;
  checkpointSeqAtAcquire: number;
}

/**
 * **The claim.** One statement, exactly as LLD §14.6.2 specifies:
 *
 * ```sql
 * INSERT INTO workflow_run_lease (...) VALUES (...)
 *   ON CONFLICT (run_id) DO UPDATE SET owner = EXCLUDED.owner, ...
 *   WHERE workflow_run_lease.expires_at < now()
 * ```
 *
 * Three outcomes, all decided by Postgres in one atomic statement rather than by any
 * read-then-write sequence this process could lose a race in:
 *
 *  - **No lease row exists** — the INSERT succeeds; this caller is the holder.
 *  - **A lease exists and is still live** — the `ON CONFLICT` fires, its `WHERE
 *    expires_at < now()` predicate is false, zero rows are returned, and this caller
 *    correctly loses. It must not touch the run.
 *  - **A lease exists but has expired** (its holder crashed) — the `DO UPDATE` fires
 *    and transfers ownership. This is the crash-recovery path, and it needs no reaper
 *    to have run first: the reaper (below) exists to make expiry *observable*, not to
 *    make it *effective*.
 *
 * Deliberately raw SQL: Drizzle's `onConflictDoUpdate` supports a `where`, but writing
 * the statement out is the only way this file can be read side-by-side with the LLD's
 * own text and verified to be the same statement. This is the single most
 * correctness-critical query in the module.
 *
 * @param ctx tenant context (RLS applies — the lease table carries its own `tenant_id`
 *   precisely so it can be protected by the same single-clause policy).
 * @param runId the run to claim.
 * @param owner this worker instance's id.
 * @param checkpointSeq the run's `checkpoint_seq` at claim time, recorded so a holder
 *   can later detect that the run advanced under someone else.
 * @param ttlSeconds lease lifetime; defaults to LLD's 60s.
 * @returns `true` iff THIS caller now holds the lease.
 */
export async function acquireRunLease(ctx: TenantContext, runId: string, owner: string, checkpointSeq: number, ttlSeconds = LEASE_TTL_SECONDS): Promise<boolean> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const result = await db.execute(sql`
      INSERT INTO workflow_run_lease (run_id, tenant_id, owner, acquired_at, expires_at, checkpoint_seq_at_acquire)
      VALUES (${runId}, ${ctx.tenantId}, ${owner}, now(), now() + make_interval(secs => ${ttlSeconds}), ${checkpointSeq})
      ON CONFLICT (run_id) DO UPDATE
         SET owner = EXCLUDED.owner,
             acquired_at = now(),
             expires_at = EXCLUDED.expires_at,
             checkpoint_seq_at_acquire = EXCLUDED.checkpoint_seq_at_acquire
       WHERE workflow_run_lease.expires_at < now()
      RETURNING run_id
    `);
    return ((result as unknown as { rowCount: number | null }).rowCount ?? 0) > 0;
  });
}

/**
 * Extends a lease this caller already holds (LLD's "renewed every 20s while a step
 * runs").
 *
 * The `AND owner = $owner` predicate is essential and is why this is not just another
 * `acquireRunLease` call: a holder whose lease already expired and was taken over by
 * another replica must NOT be able to steal it back mid-step. Renewal fails, this
 * executor learns it is no longer the holder, and abandons the pass — which is the
 * same signal `WorkflowRunCheckpointConflictError` gives on the persist side.
 *
 * @returns `true` iff the lease was still this owner's and has been extended.
 */
export async function renewRunLease(ctx: TenantContext, runId: string, owner: string, ttlSeconds = LEASE_TTL_SECONDS): Promise<boolean> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const result = await db.execute(sql`
      UPDATE workflow_run_lease
         SET expires_at = now() + make_interval(secs => ${ttlSeconds})
       WHERE run_id = ${runId} AND tenant_id = ${ctx.tenantId} AND owner = ${owner}
      RETURNING run_id
    `);
    return ((result as unknown as { rowCount: number | null }).rowCount ?? 0) > 0;
  });
}

/**
 * Releases a lease at the end of a clean pass, so the next tick can pick the run up
 * immediately instead of waiting out the TTL.
 *
 * Owner-scoped for the same reason renewal is: releasing a lease that has already been
 * taken over would hand a live holder's run to a third claimer.
 */
export async function releaseRunLease(ctx: TenantContext, runId: string, owner: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.delete(schema.workflowRunLease).where(and(eq(schema.workflowRunLease.tenantId, ctx.tenantId), eq(schema.workflowRunLease.runId, runId), eq(schema.workflowRunLease.owner, owner)));
  });
}

/**
 * `workflow.lease-reaper`'s per-tenant body — deletes leases whose holder never
 * renewed (LLD §14.6.2's "a crashed executor's run is reclaimable after the lease TTL",
 * modelled verbatim on `knowledge.lease-reaper` / `reclaimExpiredLeases()`).
 *
 * **This job is not what makes reclaim correct** — `acquireRunLease`'s own
 * `WHERE expires_at < now()` already lets a new claimer take over an expired lease
 * without any reaper having run, which is what keeps reclaim working even if this job
 * is stopped. The reaper exists so an abandoned lease does not linger as a misleading
 * row an operator would read as "someone is working on this", and so the table does not
 * accumulate dead rows for runs that finished under a different owner.
 *
 * @returns how many expired leases were removed.
 */
export async function reclaimExpiredRunLeases(ctx: TenantContext, asOf: Date = new Date()): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const deleted = await db
      .delete(schema.workflowRunLease)
      .where(and(eq(schema.workflowRunLease.tenantId, ctx.tenantId), lt(schema.workflowRunLease.expiresAt, asOf)))
      .returning({ runId: schema.workflowRunLease.runId });
    return deleted.length;
  });
}

/** Reads a run's current lease, if any. Diagnostics and tests only — the executor
 *  never branches on a read, only on the atomic claim's own return value, because a
 *  read-then-decide sequence is precisely the race the claim exists to eliminate. */
export async function findRunLease(ctx: TenantContext, runId: string): Promise<WorkflowRunLeaseRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.workflowRunLease).where(and(eq(schema.workflowRunLease.tenantId, ctx.tenantId), eq(schema.workflowRunLease.runId, runId)));
    return (rows[0] as WorkflowRunLeaseRow | undefined) ?? null;
  });
}

/** **TEST/RECOVERY ONLY** — forcibly expires a lease so a crash can be simulated
 *  without sleeping out the 60s TTL. Kept in the repository (rather than duplicated as
 *  raw SQL inside a test file) so the crash-resume suite exercises the very same
 *  `expires_at` column the production claim reads, and so this is one greppable place
 *  rather than an ad-hoc UPDATE scattered through tests. */
export async function expireRunLeaseNow(ctx: TenantContext, runId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.workflowRunLease)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(schema.workflowRunLease.tenantId, ctx.tenantId), eq(schema.workflowRunLease.runId, runId)));
  });
}
