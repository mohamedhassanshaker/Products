import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5) — the `agent_run.trigger`
 * value that marks a run produced by shadow evaluation's replay of a candidate version.
 *
 * **Why this constant exists rather than the string being inlined:** a shadow run is a
 * real `agent_run` (real model calls, real spend, real spans) whose output **no customer
 * ever saw**. Every aggregate over `agent_run` must therefore exclude it, or an
 * experiment silently corrupts real production metrics — a failure mode that produces no
 * crash and no red test, only wrong numbers. Routing every exclusion through one named
 * constant and one named predicate ({@link excludeShadowRuns}) makes the audit greppable
 * and makes a future reader's omission visible rather than invisible.
 *
 * The full enumerated consumer audit lives in
 * `docs/plans/progressive-rollout-shadow-evaluation-plan.md`.
 */
export const SHADOW_RUN_TRIGGER = "ShadowEvaluation" as const;

/** The reusable "real traffic only" predicate. Use this in **every** query that
 *  aggregates, lists, counts or costs `agent_run` rows for reporting purposes. The two
 *  deliberate exceptions (a by-id lookup, and the Model Gateway's budget rollup) are
 *  documented at their own call sites and in the plan doc's audit table. */
export function excludeShadowRuns() {
  return ne(schema.agentRun.trigger, SHADOW_RUN_TRIGGER);
}

export interface AgentRunRow {
  id: string;
  tenantId: string;
  agentDefinitionVersionId: string;
  conversationId: string | null;
  trigger: string;
  status: string;
  pausedToolCallId: string | null;
  resumeToken: string | null;
  checkpoint: Record<string, unknown> | null;
  otelTraceId: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
  durationMs: number | null;
  startedAt: Date;
  endedAt: Date | null;
}

export async function createAgentRun(
  ctx: TenantContext,
  input: { agentDefinitionVersionId: string; conversationId?: string; trigger: string; otelTraceId: string },
): Promise<AgentRunRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.agentRun).values({
      id,
      tenantId: ctx.tenantId,
      agentDefinitionVersionId: input.agentDefinitionVersionId,
      conversationId: input.conversationId,
      trigger: input.trigger as never,
      status: "Running",
      otelTraceId: input.otelTraceId,
    });
    const [row] = await db.select().from(schema.agentRun).where(eq(schema.agentRun.id, id));
    if (!row) throw new Error("createAgentRun: insert did not return a row");
    return row as AgentRunRow;
  });
}

export async function finishAgentRun(
  ctx: TenantContext,
  id: string,
  input: { status: "Succeeded" | "Failed" | "Cancelled" | "TimedOut"; tokensIn?: number; tokensOut?: number; costUsd?: string; durationMs?: number },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.agentRun)
      .set({ ...input, endedAt: new Date() })
      .where(and(eq(schema.agentRun.tenantId, ctx.tenantId), eq(schema.agentRun.id, id))),
  );
}

export async function pauseAgentRunForApproval(
  ctx: TenantContext,
  id: string,
  input: { pausedToolCallId: string; resumeToken: string; checkpoint: Record<string, unknown> },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.agentRun)
      .set({ status: "PausedForApproval", ...input })
      .where(and(eq(schema.agentRun.tenantId, ctx.tenantId), eq(schema.agentRun.id, id))),
  );
}

/**
 * By-id lookup.
 *
 * **Shadow audit disposition: deliberately NOT filtered, and this is load-bearing.** Two
 * things call this, and only two. (1) The conversation Trace Viewer, which looks up ids
 * taken from `message.agentRunId` — a shadow run can never appear there, because the
 * shadow worker never inserts a `message` at all, so filtering would be dead code that
 * merely looked prudent. (2) The shadow report screen, which follows
 * `shadow_run.shadow_agent_run_id`; that is the ONE deliberate path by which a shadow
 * trace stays reachable (ADR-0019 §2.5's analytics row), and filtering here would break
 * it. Aggregation is where shadow exclusion belongs — see {@link excludeShadowRuns}.
 */
export async function getAgentRun(ctx: TenantContext, id: string): Promise<AgentRunRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.agentRun).where(and(eq(schema.agentRun.tenantId, ctx.tenantId), eq(schema.agentRun.id, id)));
    return (rows[0] as AgentRunRow | undefined) ?? null;
  });
}

/**
 * The Runtime Traces screen's per-version run list (FR-AGT-09).
 *
 * **Shadow audit disposition: EXCLUDED.** A shadow run listed here would look to an
 * operator exactly like a real customer turn against this version — same status, same
 * cost, same trace id — with nothing distinguishing it. That is precisely the silent
 * corruption ADR-0019 §2.5 names as the phase's highest-risk item.
 */
export async function listAgentRunsForVersion(ctx: TenantContext, agentDefinitionVersionId: string): Promise<AgentRunRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.agentRun)
      .where(and(eq(schema.agentRun.tenantId, ctx.tenantId), eq(schema.agentRun.agentDefinitionVersionId, agentDefinitionVersionId), excludeShadowRuns()))
      .orderBy(desc(schema.agentRun.startedAt)),
  ) as Promise<AgentRunRow[]>;
}

/** Per-version live metrics for one version, as rendered by the Deployments & Canary
 *  panel (LLD §15.7's `metrics` block). */
export interface VersionRunMetrics {
  agentDefinitionVersionId: string;
  runs: number;
  errorRatePct: number;
  p50Ms: number | null;
  p95Ms: number | null;
  costUsd: number;
}

/**
 * FR-AGT-09/10's per-version rollups, computed over **real customer traffic only**.
 *
 * **Shadow audit disposition: EXCLUDED.** This is the exact figure a human uses to decide
 * whether a canary is healthy enough to promote. Letting shadow runs into it would mean
 * the decision to give a version 100% of real customers was partly based on traffic no
 * customer ever saw — and, worse, on the *candidate's* own replay of the *stable* arm's
 * conversations. ADR-0019 §6 item 9 requires this figure to be byte-identical with an
 * experiment running and with it disabled.
 *
 * Percentiles are computed with Postgres's `percentile_cont` over `duration_ms` rather
 * than in JS, so a version with many runs does not pull every row across the wire.
 *
 * @param ctx tenant context.
 * @param agentDefinitionVersionIds the versions to roll up (typically one per active
 *   deployment allocation). An empty array short-circuits to `[]`.
 * @param since optional lower bound on `started_at`; omitted means "all time".
 */
export async function listVersionRunMetrics(ctx: TenantContext, agentDefinitionVersionIds: string[], since?: Date): Promise<VersionRunMetrics[]> {
  if (agentDefinitionVersionIds.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        agentDefinitionVersionId: schema.agentRun.agentDefinitionVersionId,
        runs: sql<number>`count(*)::int`,
        failures: sql<number>`count(*) FILTER (WHERE ${schema.agentRun.status} IN ('Failed', 'TimedOut', 'Cancelled'))::int`,
        p50Ms: sql<number | null>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${schema.agentRun.durationMs})`,
        p95Ms: sql<number | null>`percentile_cont(0.95) WITHIN GROUP (ORDER BY ${schema.agentRun.durationMs})`,
        costUsd: sql<string>`COALESCE(SUM(${schema.agentRun.costUsd}), 0)::text`,
      })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.tenantId, ctx.tenantId),
          inArray(schema.agentRun.agentDefinitionVersionId, agentDefinitionVersionIds),
          excludeShadowRuns(),
          ...(since ? [sql`${schema.agentRun.startedAt} >= ${since}`] : []),
        ),
      )
      .groupBy(schema.agentRun.agentDefinitionVersionId);

    return rows.map((r) => ({
      agentDefinitionVersionId: r.agentDefinitionVersionId,
      runs: r.runs,
      errorRatePct: r.runs > 0 ? Math.round((r.failures / r.runs) * 10000) / 100 : 0,
      p50Ms: r.p50Ms === null ? null : Math.round(Number(r.p50Ms)),
      p95Ms: r.p95Ms === null ? null : Math.round(Number(r.p95Ms)),
      costUsd: Number(r.costUsd),
    }));
  });
}
