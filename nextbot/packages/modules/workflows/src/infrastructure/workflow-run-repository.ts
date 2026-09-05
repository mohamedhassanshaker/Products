import { and, asc, desc, eq, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import {
  WorkflowRunCheckpointConflictError,
  WorkflowRunNotFoundError,
  type SuspensionKindValue,
  type WorkflowCheckpoint,
  type WorkflowNodeKindValue,
  type WorkflowRunStateValue,
  type WorkflowRunTerminalOutcomeValue,
  type WorkflowStepRefKindValue,
  type WorkflowStepStatusValue,
  type WorkflowTriggerKindValue,
} from "@nextbot/contracts";
import { frontierNodeIds, isValidCheckpoint } from "../domain/checkpoint.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2) — persistence for
 * `workflow_run` and `workflow_run_step`.
 *
 * **The one load-bearing property this file exists to provide** is the resume
 * protocol's atomic persist: `{state, current_node_ids, checkpoint_json,
 * checkpoint_seq+1, cost_usd, steps_executed}` written **in one transaction with the
 * `workflow_run_step` row**, guarded by optimistic concurrency on `checkpoint_seq`.
 * That is what makes "a crash mid-node re-executes at most one node" true: the step
 * row recording a node's *intent* and the checkpoint recording the run's position can
 * never be out of step with each other, because they commit together or not at all.
 *
 * Every function here goes through `withTenant`, so RLS holds for every read and write
 * — including the raw-SQL lease claim in the sibling lease repository.
 */

export interface WorkflowRunRow {
  id: string;
  tenantId: string;
  workflowVersionId: string;
  conversationId: string | null;
  agentRunId: string | null;
  triggerKind: WorkflowTriggerKindValue;
  parentRunId: string | null;
  depth: number;
  state: WorkflowRunStateValue;
  outcome: WorkflowRunTerminalOutcomeValue | null;
  outcomeDetail: Record<string, unknown> | null;
  currentNodeIds: string[];
  checkpointJson: unknown;
  checkpointSeq: number;
  suspensionKind: SuspensionKindValue | null;
  suspensionRef: string | null;
  suspensionExpiresAt: Date | null;
  suspensionExpiryOutcome: WorkflowRunTerminalOutcomeValue | null;
  stepsExecuted: number;
  loopIterations: Record<string, number>;
  costUsd: string;
  scopeHash: string;
  otelTraceId: string;
  idempotencyKey: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface WorkflowRunStepRow {
  id: string;
  tenantId: string;
  runId: string;
  nodeId: string;
  nodeKind: WorkflowNodeKindValue;
  attempt: number;
  iteration: number;
  branchKey: string | null;
  refKind: WorkflowStepRefKindValue;
  refVersionId: string | null;
  refLabel: string | null;
  status: WorkflowStepStatusValue;
  input: unknown;
  output: unknown;
  error: { code: string; message: string; retriable: boolean } | null;
  toolCallId: string | null;
  approvalRequestId: string | null;
  escalationId: string | null;
  childRunId: string | null;
  compensationOfStepId: string | null;
  costUsd: string;
  traceSpanId: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

export interface CreateWorkflowRunInput {
  workflowVersionId: string;
  conversationId?: string | null;
  agentRunId?: string | null;
  triggerKind: WorkflowTriggerKindValue;
  parentRunId?: string | null;
  depth?: number;
  checkpoint: WorkflowCheckpoint;
  scopeHash: string;
  otelTraceId: string;
  /** Trigger-supplied. The `(tenant_id, idempotency_key)` UNIQUE is what makes a
   *  redelivered webhook resume the existing run instead of starting a second. */
  idempotencyKey: string;
}

/**
 * Creates a run in `Pending`, or returns the run that already exists for this
 * idempotency key.
 *
 * The duplicate branch is not an optimization — it IS LLD §14.6.2's stated semantics
 * ("a redelivered webhook resumes the existing run instead of starting a second"). It
 * is implemented as `ON CONFLICT DO NOTHING` + read-back rather than
 * check-then-insert so two genuinely concurrent redeliveries cannot both observe "no
 * run yet" and both create one.
 *
 * @returns the run row and whether THIS call created it (`created: false` = an
 *   idempotent replay).
 */
export async function createWorkflowRun(ctx: TenantContext, input: CreateWorkflowRunInput): Promise<{ run: WorkflowRunRow; created: boolean }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    const inserted = await db
      .insert(schema.workflowRun)
      .values({
        id,
        tenantId: ctx.tenantId,
        workflowVersionId: input.workflowVersionId,
        conversationId: input.conversationId ?? null,
        agentRunId: input.agentRunId ?? null,
        triggerKind: input.triggerKind,
        parentRunId: input.parentRunId ?? null,
        depth: input.depth ?? 0,
        state: "Pending",
        currentNodeIds: frontierNodeIds(input.checkpoint),
        checkpointJson: input.checkpoint,
        checkpointSeq: 0,
        scopeHash: input.scopeHash,
        otelTraceId: input.otelTraceId,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({ target: [schema.workflowRun.tenantId, schema.workflowRun.idempotencyKey] })
      .returning();

    if (inserted.length > 0) return { run: inserted[0] as WorkflowRunRow, created: true };

    const existing = await db
      .select()
      .from(schema.workflowRun)
      .where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), eq(schema.workflowRun.idempotencyKey, input.idempotencyKey)));
    return { run: existing[0] as WorkflowRunRow, created: false };
  });
}

export async function findWorkflowRunById(ctx: TenantContext, id: string): Promise<WorkflowRunRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.workflowRun).where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), eq(schema.workflowRun.id, id)));
    return (rows[0] as WorkflowRunRow | undefined) ?? null;
  });
}

export async function getWorkflowRun(ctx: TenantContext, id: string): Promise<WorkflowRunRow> {
  const row = await findWorkflowRunById(ctx, id);
  if (!row) throw new WorkflowRunNotFoundError(id);
  return row;
}

export interface ListWorkflowRunsFilter {
  workflowId?: string;
  workflowVersionId?: string;
  state?: WorkflowRunStateValue;
  outcome?: WorkflowRunTerminalOutcomeValue;
  from?: Date;
  to?: Date;
  /** Opaque cursor — the `started_at` of the last row of the previous page, ISO-encoded.
   *  Keyset rather than offset so a run starting mid-scroll cannot shift the page. */
  cursor?: string;
  limit?: number;
}

/** `GET /api/v1/admin/workflow-runs` (LLD §14.6.5). Newest first. */
export async function listWorkflowRuns(ctx: TenantContext, filter: ListWorkflowRunsFilter): Promise<WorkflowRunRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const conditions = [eq(schema.workflowRun.tenantId, ctx.tenantId)];
    if (filter.workflowVersionId) conditions.push(eq(schema.workflowRun.workflowVersionId, filter.workflowVersionId));
    if (filter.workflowId) {
      // Filtering by WORKFLOW (not version) means "every run of any of its versions" —
      // expressed as a subquery rather than a join so the returned row shape stays
      // exactly `workflow_run`, and RLS applies to both sides identically.
      conditions.push(
        sql`${schema.workflowRun.workflowVersionId} IN (SELECT id FROM workflow_version WHERE tenant_id = ${ctx.tenantId} AND workflow_id = ${filter.workflowId})`,
      );
    }
    if (filter.state) conditions.push(eq(schema.workflowRun.state, filter.state));
    if (filter.outcome) conditions.push(eq(schema.workflowRun.outcome, filter.outcome));
    if (filter.from) conditions.push(sql`${schema.workflowRun.startedAt} >= ${filter.from}`);
    if (filter.to) conditions.push(sql`${schema.workflowRun.startedAt} <= ${filter.to}`);
    if (filter.cursor) conditions.push(lt(schema.workflowRun.startedAt, new Date(filter.cursor)));

    const rows = await db
      .select()
      .from(schema.workflowRun)
      .where(and(...conditions))
      .orderBy(desc(schema.workflowRun.startedAt))
      .limit(Math.min(filter.limit ?? 50, 200));
    return rows as WorkflowRunRow[];
  });
}

/** Every step of a run, oldest first — the FR-WF-07 trace's row source. */
export async function listWorkflowRunSteps(ctx: TenantContext, runId: string): Promise<WorkflowRunStepRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.workflowRunStep)
      .where(and(eq(schema.workflowRunStep.tenantId, ctx.tenantId), eq(schema.workflowRunStep.runId, runId)))
      .orderBy(asc(schema.workflowRunStep.startedAt), asc(schema.workflowRunStep.id));
    return rows as WorkflowRunStepRow[];
  });
}

/** The next `attempt` ordinal for a `(run, node, iteration)` triple. Read inside the
 *  same transaction that inserts (see `persistNodeAdvance`) so two concurrent writers
 *  cannot both compute the same value — the loser hits
 *  `workflow_run_step_attempt_key` and fails loudly, which for an append-only attempt
 *  log is the correct outcome. */
async function nextAttempt(db: TenantScopedClient, tenantId: string, runId: string, nodeId: string, iteration: number): Promise<number> {
  const rows = await db
    .select({ current: sql<number | null>`max(${schema.workflowRunStep.attempt})` })
    .from(schema.workflowRunStep)
    .where(
      and(
        eq(schema.workflowRunStep.tenantId, tenantId),
        eq(schema.workflowRunStep.runId, runId),
        eq(schema.workflowRunStep.nodeId, nodeId),
        eq(schema.workflowRunStep.iteration, iteration),
      ),
    );
  return (rows[0]?.current ?? 0) + 1;
}

export interface StepRecord {
  nodeId: string;
  nodeKind: WorkflowNodeKindValue;
  iteration: number;
  branchKey: string | null;
  refKind: WorkflowStepRefKindValue;
  refVersionId?: string | null;
  refLabel?: string | null;
  status: WorkflowStepStatusValue;
  /** ALREADY PII-masked by the caller — this layer never masks, so there is exactly
   *  one masking path in the module (`@nextbot/pii`'s existing masker, applied in
   *  `application/node-executors.ts`). */
  input?: unknown;
  output?: unknown;
  error?: { code: string; message: string; retriable: boolean } | null;
  toolCallId?: string | null;
  approvalRequestId?: string | null;
  escalationId?: string | null;
  childRunId?: string | null;
  compensationOfStepId?: string | null;
  costUsd?: string;
  traceSpanId?: string | null;
  startedAt?: Date;
  endedAt?: Date | null;
}

export interface RunAdvance {
  state: WorkflowRunStateValue;
  checkpoint: WorkflowCheckpoint;
  costUsd: string;
  stepsExecuted: number;
  outcome?: WorkflowRunTerminalOutcomeValue | null;
  outcomeDetail?: Record<string, unknown> | null;
  suspensionKind?: SuspensionKindValue | null;
  suspensionRef?: string | null;
  suspensionExpiresAt?: Date | null;
  suspensionExpiryOutcome?: WorkflowRunTerminalOutcomeValue | null;
  endedAt?: Date | null;
}

/**
 * **The resume protocol's persist step** (LLD §14.6.2): the run's new position and the
 * step row that produced it, in ONE transaction, guarded by optimistic concurrency.
 *
 * The `WHERE ... AND checkpoint_seq = expectedSeq` predicate is what makes a stale
 * lease-holder harmless. If a run advanced under a different owner while this executor
 * was mid-node (its lease expired, the reaper released it, another replica claimed and
 * moved it), this UPDATE affects zero rows and the whole transaction — step row
 * included — rolls back. The executor then abandons the pass rather than retrying,
 * because retrying against a moved target is exactly how a duplicate step gets written.
 *
 * @param expectedSeq the `checkpoint_seq` this executor believes the run is at.
 * @throws {WorkflowRunCheckpointConflictError} when the run has moved on.
 */
export async function persistNodeAdvance(
  ctx: TenantContext,
  runId: string,
  expectedSeq: number,
  advance: RunAdvance,
  step: StepRecord | null,
): Promise<WorkflowRunRow> {
  // Belt-and-braces: nothing that fails `WorkflowCheckpointSchema` may ever be
  // persisted, or the next resume would have to repair it (see `parseCheckpoint`).
  if (!isValidCheckpoint(advance.checkpoint)) {
    throw new Error(`persistNodeAdvance: refusing to persist a checkpoint that does not satisfy WorkflowCheckpointSchema (run ${runId})`);
  }

  return withTenant(ctx, async (db: TenantScopedClient) => {
    const updated = await db
      .update(schema.workflowRun)
      .set({
        state: advance.state,
        currentNodeIds: frontierNodeIds(advance.checkpoint),
        checkpointJson: advance.checkpoint,
        checkpointSeq: expectedSeq + 1,
        costUsd: advance.costUsd,
        stepsExecuted: advance.stepsExecuted,
        loopIterations: advance.checkpoint.loopCounters,
        outcome: advance.outcome ?? null,
        outcomeDetail: advance.outcomeDetail ?? null,
        suspensionKind: advance.suspensionKind ?? null,
        suspensionRef: advance.suspensionRef ?? null,
        suspensionExpiresAt: advance.suspensionExpiresAt ?? null,
        suspensionExpiryOutcome: advance.suspensionExpiryOutcome ?? null,
        endedAt: advance.endedAt ?? null,
      })
      .where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), eq(schema.workflowRun.id, runId), eq(schema.workflowRun.checkpointSeq, expectedSeq)))
      .returning();

    if (updated.length === 0) throw new WorkflowRunCheckpointConflictError(runId, expectedSeq);

    if (step) {
      const attempt = await nextAttempt(db, ctx.tenantId, runId, step.nodeId, step.iteration);
      await db.insert(schema.workflowRunStep).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        runId,
        nodeId: step.nodeId,
        nodeKind: step.nodeKind,
        attempt,
        iteration: step.iteration,
        branchKey: step.branchKey,
        refKind: step.refKind,
        refVersionId: step.refVersionId ?? null,
        refLabel: step.refLabel ?? null,
        status: step.status,
        input: step.input ?? null,
        output: step.output ?? null,
        error: step.error ?? null,
        toolCallId: step.toolCallId ?? null,
        approvalRequestId: step.approvalRequestId ?? null,
        escalationId: step.escalationId ?? null,
        childRunId: step.childRunId ?? null,
        compensationOfStepId: step.compensationOfStepId ?? null,
        costUsd: step.costUsd ?? "0",
        traceSpanId: step.traceSpanId ?? null,
        startedAt: step.startedAt ?? new Date(),
        endedAt: step.endedAt ?? new Date(),
      });
    }

    return updated[0] as WorkflowRunRow;
  });
}

/**
 * The pump's claim scan: runs this tenant has that are ready to be advanced.
 *
 * `FOR UPDATE SKIP LOCKED` mirrors `knowledge`'s `claimDueJobs()` — the real,
 * QA-approved durable-work-table precedent in this codebase (Phase 7b). It is NOT the
 * exactly-one-advancer mechanism on its own: the row lock lives only for the duration
 * of this transaction, whereas advancing a run spans many. `workflow_run_lease` is
 * what holds across that span; SKIP LOCKED just stops N pump replicas from all
 * serializing on the same scan.
 */
export async function scanClaimableRuns(ctx: TenantContext, limit: number): Promise<WorkflowRunRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.workflowRun)
      .where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), inArray(schema.workflowRun.state, ["Pending", "Running", "Compensating"])))
      .orderBy(asc(schema.workflowRun.startedAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    return rows as WorkflowRunRow[];
  });
}

/** Every currently-`Suspended` run for this tenant — the reconciling sweep's input.
 *  With no queue library there is no delayed job to wake a run, so this scan IS the
 *  wake-up path and is authoritative (ADR-0013 §7.2 constraint 1). */
export async function listSuspendedRuns(ctx: TenantContext, limit = 200): Promise<WorkflowRunRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.workflowRun)
      .where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), eq(schema.workflowRun.state, "Suspended")))
      .orderBy(asc(schema.workflowRun.suspensionExpiresAt))
      .limit(limit);
    return rows as WorkflowRunRow[];
  });
}

/** `Suspended` runs whose declared deadline has passed — `workflow.suspension-expiry-
 *  sweep`'s input, served by the `workflow_run_suspension_expiry_idx` partial index. */
export async function listExpiredSuspendedRuns(ctx: TenantContext, asOf: Date, limit = 200): Promise<WorkflowRunRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.workflowRun)
      .where(
        and(
          eq(schema.workflowRun.tenantId, ctx.tenantId),
          eq(schema.workflowRun.state, "Suspended"),
          isNotNull(schema.workflowRun.suspensionExpiresAt),
          lte(schema.workflowRun.suspensionExpiresAt, asOf),
        ),
      )
      .orderBy(asc(schema.workflowRun.suspensionExpiresAt))
      .limit(limit);
    return rows as WorkflowRunRow[];
  });
}

/**
 * Terminates a run at a declared outcome, compare-and-set on its current state.
 *
 * Used by the expiry sweep, the cancel endpoint, and the executor's own budget/failure
 * paths. CAS rather than a blind write so a run that a concurrent executor already
 * finished is never re-terminated with a different outcome — the first terminal write
 * wins, and the loser learns it lost.
 *
 * @param expectedStates the states this caller believes the run may be in.
 * @returns `terminated: false` if the run had already moved out of `expectedStates`.
 */
export async function terminateRun(
  ctx: TenantContext,
  runId: string,
  expectedStates: WorkflowRunStateValue[],
  outcome: WorkflowRunTerminalOutcomeValue,
  state: WorkflowRunStateValue,
  outcomeDetail: Record<string, unknown> | null,
): Promise<{ terminated: boolean; run: WorkflowRunRow | null }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const updated = await db
      .update(schema.workflowRun)
      .set({
        state,
        outcome,
        outcomeDetail,
        endedAt: new Date(),
        // The suspension fields MUST be cleared in the same statement: the
        // `workflow_run_suspension_consistent` CHECK forbids a non-Suspended row from
        // retaining a suspension kind, so a terminate that left them would be rejected
        // by the database rather than silently producing an incoherent row.
        suspensionKind: null,
        suspensionRef: null,
        suspensionExpiresAt: null,
        suspensionExpiryOutcome: null,
        checkpointSeq: sql`${schema.workflowRun.checkpointSeq} + 1`,
      })
      .where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), eq(schema.workflowRun.id, runId), inArray(schema.workflowRun.state, expectedStates)))
      .returning();
    return { terminated: updated.length > 0, run: (updated[0] as WorkflowRunRow | undefined) ?? null };
  });
}

/**
 * Wakes a `Suspended` run back to `Running`, optionally folding the suspension's result
 * into the checkpoint in the same statement.
 *
 * CAS on `state = 'Suspended'` so two reconciling passes cannot both wake the same run
 * and produce two concurrent advancers — belt-and-braces behind the lease.
 */
export async function resumeSuspendedRun(ctx: TenantContext, runId: string, checkpoint: WorkflowCheckpoint): Promise<{ resumed: boolean; run: WorkflowRunRow | null }> {
  if (!isValidCheckpoint(checkpoint)) {
    throw new Error(`resumeSuspendedRun: refusing to persist a checkpoint that does not satisfy WorkflowCheckpointSchema (run ${runId})`);
  }
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const updated = await db
      .update(schema.workflowRun)
      .set({
        state: "Running",
        checkpointJson: checkpoint,
        currentNodeIds: frontierNodeIds(checkpoint),
        checkpointSeq: sql`${schema.workflowRun.checkpointSeq} + 1`,
        suspensionKind: null,
        suspensionRef: null,
        suspensionExpiresAt: null,
        suspensionExpiryOutcome: null,
      })
      .where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), eq(schema.workflowRun.id, runId), eq(schema.workflowRun.state, "Suspended")))
      .returning();
    return { resumed: updated.length > 0, run: (updated[0] as WorkflowRunRow | undefined) ?? null };
  });
}

/** Marks an already-written step row terminal. Used only where a step's outcome is
 *  learned strictly after the step row was written — a suspension that later resolves,
 *  and the compensation pass marking its target `Compensated`. Everything else writes
 *  its final status in the one `persistNodeAdvance` transaction. */
export async function finalizeStep(
  ctx: TenantContext,
  stepId: string,
  status: WorkflowStepStatusValue,
  patch: { output?: unknown; error?: { code: string; message: string; retriable: boolean } | null } = {},
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.workflowRunStep)
      .set({ status, endedAt: new Date(), ...(patch.output !== undefined ? { output: patch.output } : {}), ...(patch.error !== undefined ? { error: patch.error } : {}) })
      .where(and(eq(schema.workflowRunStep.tenantId, ctx.tenantId), eq(schema.workflowRunStep.id, stepId)));
  });
}

/** The most recent step for a `(run, node)` pair — how the reconciling sweep finds the
 *  suspended step row it must finalize when a suspension resolves. */
export async function findLatestStepForNode(ctx: TenantContext, runId: string, nodeId: string): Promise<WorkflowRunStepRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.workflowRunStep)
      .where(and(eq(schema.workflowRunStep.tenantId, ctx.tenantId), eq(schema.workflowRunStep.runId, runId), eq(schema.workflowRunStep.nodeId, nodeId)))
      .orderBy(desc(schema.workflowRunStep.startedAt), desc(schema.workflowRunStep.attempt))
      .limit(1);
    return (rows[0] as WorkflowRunStepRow | undefined) ?? null;
  });
}

/** Terminal child runs whose parent is still `Suspended` on them — the SubWorkflow
 *  reconciliation's input, so a parent never waits on a child that already finished. */
export async function listTerminalChildRuns(ctx: TenantContext, parentRunId: string): Promise<WorkflowRunRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.workflowRun)
      .where(
        and(
          eq(schema.workflowRun.tenantId, ctx.tenantId),
          eq(schema.workflowRun.parentRunId, parentRunId),
          inArray(schema.workflowRun.state, ["Succeeded", "Failed", "TimedOut", "Cancelled"]),
        ),
      );
    return rows as WorkflowRunRow[];
  });
}

/** Whether any run of this version exists in a given state — backs the promotion
 *  gate's sandbox-run check without loading whole rows. */
export async function findSucceededSandboxRun(ctx: TenantContext, runId: string): Promise<WorkflowRunRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.workflowRun)
      .where(and(eq(schema.workflowRun.tenantId, ctx.tenantId), eq(schema.workflowRun.id, runId), or(eq(schema.workflowRun.state, "Succeeded"))));
    return (rows[0] as WorkflowRunRow | undefined) ?? null;
  });
}
