import { and, desc, eq, inArray } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { EvalCaseSourceValue, EvalGateModeValue, EvalRubric, EvalRunKindValue, EvalRunStatusValue } from "@nextbot/contracts";
import { EvalSuiteNotFoundError } from "@nextbot/contracts";

export interface EvalSuiteRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  costBudgetUsd: string | null;
  latencyBudgetMs: number | null;
  passThresholdPct: string;
  gateMode: EvalGateModeValue;
  regressionBaselineVersionId: string | null;
  createdAt: Date;
}

export interface EvalCaseRow {
  id: string;
  tenantId: string;
  evalSuiteId: string;
  name: string;
  inputTranscript: Array<{ sender: string; text: string }>;
  expectedToolCalls: Array<{ toolName: string; argMatchers?: Record<string, unknown> }> | null;
  expectedResponsePattern: string | null;
  weight: number;
  rubric: EvalRubric | null;
  judgeRouteVersionId: string | null;
  source: EvalCaseSourceValue;
  sourceRef: string | null;
  skillVersionId: string | null;
}

export interface EvalRunRow {
  id: string;
  tenantId: string;
  evalSuiteId: string;
  agentDefinitionVersionId: string;
  definitionHash: string;
  status: EvalRunStatusValue;
  passRatePct: string | null;
  totalCostUsd: string | null;
  p95LatencyMs: number | null;
  triggeredBy: "VersionSubmitted" | "Manual" | "Scheduled";
  runKind: EvalRunKindValue;
  baselineRunId: string | null;
  regressed: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export async function createEvalSuite(
  ctx: TenantContext,
  input: {
    name: string;
    description?: string;
    costBudgetUsd?: string;
    latencyBudgetMs?: number;
    passThresholdPct?: number;
    gateMode?: EvalGateModeValue;
    regressionBaselineVersionId?: string;
  },
): Promise<EvalSuiteRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.evalSuite).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      description: input.description,
      costBudgetUsd: input.costBudgetUsd,
      latencyBudgetMs: input.latencyBudgetMs,
      passThresholdPct: input.passThresholdPct !== undefined ? String(input.passThresholdPct) : undefined,
      gateMode: input.gateMode,
      regressionBaselineVersionId: input.regressionBaselineVersionId,
    });
    const [row] = await db.select().from(schema.evalSuite).where(eq(schema.evalSuite.id, id));
    if (!row) throw new Error("createEvalSuite: insert did not return a row");
    return row;
  });
}

export async function listEvalSuites(ctx: TenantContext): Promise<EvalSuiteRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.evalSuite).where(eq(schema.evalSuite.tenantId, ctx.tenantId)));
}

export async function getEvalSuite(ctx: TenantContext, id: string): Promise<EvalSuiteRow> {
  const row = await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.evalSuite).where(and(eq(schema.evalSuite.tenantId, ctx.tenantId), eq(schema.evalSuite.id, id)));
    return rows[0];
  });
  if (!row) throw new EvalSuiteNotFoundError(id);
  return row;
}

export async function createEvalCase(
  ctx: TenantContext,
  input: {
    evalSuiteId: string;
    name: string;
    inputTranscript: Array<{ sender: string; text: string }>;
    expectedToolCalls?: Array<{ toolName: string; argMatchers?: Record<string, unknown> }>;
    expectedResponsePattern?: string;
    weight?: number;
    rubric?: EvalRubric;
    judgeRouteVersionId?: string;
    source?: EvalCaseSourceValue;
    sourceRef?: string;
    skillVersionId?: string;
  },
): Promise<EvalCaseRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.evalCase).values({
      id,
      tenantId: ctx.tenantId,
      evalSuiteId: input.evalSuiteId,
      name: input.name,
      inputTranscript: input.inputTranscript,
      expectedToolCalls: input.expectedToolCalls,
      expectedResponsePattern: input.expectedResponsePattern,
      weight: input.weight ?? 1,
      rubric: input.rubric,
      judgeRouteVersionId: input.judgeRouteVersionId,
      source: input.source,
      sourceRef: input.sourceRef,
      skillVersionId: input.skillVersionId,
    });
    const [row] = await db.select().from(schema.evalCase).where(eq(schema.evalCase.id, id));
    if (!row) throw new Error("createEvalCase: insert did not return a row");
    return row;
  });
}

export async function listEvalCases(ctx: TenantContext, evalSuiteId: string): Promise<EvalCaseRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.evalCase).where(and(eq(schema.evalCase.tenantId, ctx.tenantId), eq(schema.evalCase.evalSuiteId, evalSuiteId))),
  );
}

/** Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13) — cross-suite lookup
 * by id, used by the Studio's Evals step to read a composed skill's own
 * `skill_version.eval_case_ids` before copying their content into a version's
 * auto-generated suite (`studio-service.ts`). Returns only ids that resolve
 * within the caller's own tenant (RLS) — a stale/cross-tenant id is silently
 * skipped by the caller, never dereferenced. */
export async function getEvalCasesByIds(ctx: TenantContext, ids: string[]): Promise<EvalCaseRow[]> {
  if (ids.length === 0) return [];
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.evalCase).where(and(eq(schema.evalCase.tenantId, ctx.tenantId), inArray(schema.evalCase.id, ids))),
  );
}

export async function createEvalRun(
  ctx: TenantContext,
  input: {
    evalSuiteId: string;
    agentDefinitionVersionId: string;
    definitionHash: string;
    triggeredBy: "VersionSubmitted" | "Manual" | "Scheduled";
    runKind?: EvalRunKindValue;
  },
): Promise<EvalRunRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.evalRun).values({
      id,
      tenantId: ctx.tenantId,
      evalSuiteId: input.evalSuiteId,
      agentDefinitionVersionId: input.agentDefinitionVersionId,
      definitionHash: input.definitionHash,
      status: "Running",
      triggeredBy: input.triggeredBy,
      runKind: input.runKind,
      startedAt: new Date(),
    });
    const [row] = await db.select().from(schema.evalRun).where(eq(schema.evalRun.id, id));
    if (!row) throw new Error("createEvalRun: insert did not return a row");
    return row;
  });
}

export async function finishEvalRun(
  ctx: TenantContext,
  id: string,
  input: { status: "Passed" | "Failed" | "Error"; passRatePct: number; totalCostUsd?: string; p95LatencyMs?: number; baselineRunId?: string; regressed?: boolean },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.evalRun)
      .set({
        status: input.status,
        passRatePct: String(input.passRatePct),
        totalCostUsd: input.totalCostUsd,
        p95LatencyMs: input.p95LatencyMs,
        baselineRunId: input.baselineRunId,
        regressed: input.regressed ?? false,
        finishedAt: new Date(),
      })
      .where(and(eq(schema.evalRun.tenantId, ctx.tenantId), eq(schema.evalRun.id, id))),
  );
}

export async function getEvalRun(ctx: TenantContext, id: string): Promise<EvalRunRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.evalRun).where(and(eq(schema.evalRun.tenantId, ctx.tenantId), eq(schema.evalRun.id, id)));
    return rows[0] ?? null;
  });
}

export async function listEvalRunsForVersion(ctx: TenantContext, agentDefinitionVersionId: string): Promise<EvalRunRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.evalRun).where(and(eq(schema.evalRun.tenantId, ctx.tenantId), eq(schema.evalRun.agentDefinitionVersionId, agentDefinitionVersionId))),
  );
}

/** Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17) — the most recent
 * PRIOR `Continuous` run for the same (suite, version) pair, ordered by
 * `createdAt DESC`, excluding the run currently being finished (callers pass
 * their own new run's id so a run is never compared against itself). `null` for
 * the first-ever continuous run of a given pair — which can never regress by
 * definition (`eval-service.ts#runEvalSuite`'s own doc comment). */
export async function findPriorContinuousRun(ctx: TenantContext, evalSuiteId: string, agentDefinitionVersionId: string, excludeRunId: string): Promise<EvalRunRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.evalRun)
      .where(
        and(
          eq(schema.evalRun.tenantId, ctx.tenantId),
          eq(schema.evalRun.evalSuiteId, evalSuiteId),
          eq(schema.evalRun.agentDefinitionVersionId, agentDefinitionVersionId),
          eq(schema.evalRun.runKind, "Continuous"),
        ),
      )
      .orderBy(desc(schema.evalRun.createdAt));
    return rows.find((r) => r.id !== excludeRunId && r.status !== "Running") ?? null;
  });
}

export async function insertEvalCaseResult(
  ctx: TenantContext,
  input: {
    evalRunId: string;
    evalCaseId: string;
    passed: boolean;
    actualResponse?: string;
    diff?: unknown;
    failureReason?: string;
    latencyMs?: number;
    rubricScores?: Record<string, { score: number; rationale: string }>;
    groundednessScore?: number;
    citationPrecision?: number;
  },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.insert(schema.evalCaseResult).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      evalRunId: input.evalRunId,
      evalCaseId: input.evalCaseId,
      passed: input.passed,
      actualResponse: input.actualResponse,
      diff: input.diff,
      failureReason: input.failureReason,
      latencyMs: input.latencyMs,
      rubricScores: input.rubricScores,
      groundednessScore: input.groundednessScore,
      citationPrecision: input.citationPrecision,
    }),
  );
}

export interface EvalCaseResultView {
  id: string;
  evalCaseId: string;
  /** U2 fix (QA 2026-08-15 UI pass, high) — the case's own name, joined in here so the
   * console's per-case results table (`GET /eval-runs/:id/results`) doesn't need a
   * second round trip per row just to show which case a result belongs to. */
  caseName: string;
  passed: boolean;
  actualToolCalls: unknown;
  actualResponse: string | null;
  failureReason: string | null;
  costUsd: string | null;
  latencyMs: number | null;
}

export async function listEvalCaseResults(ctx: TenantContext, evalRunId: string): Promise<EvalCaseResultView[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select({
        id: schema.evalCaseResult.id,
        evalCaseId: schema.evalCaseResult.evalCaseId,
        caseName: schema.evalCase.name,
        passed: schema.evalCaseResult.passed,
        actualToolCalls: schema.evalCaseResult.actualToolCalls,
        actualResponse: schema.evalCaseResult.actualResponse,
        failureReason: schema.evalCaseResult.failureReason,
        costUsd: schema.evalCaseResult.costUsd,
        latencyMs: schema.evalCaseResult.latencyMs,
      })
      .from(schema.evalCaseResult)
      .innerJoin(schema.evalCase, eq(schema.evalCaseResult.evalCaseId, schema.evalCase.id))
      .where(and(eq(schema.evalCaseResult.tenantId, ctx.tenantId), eq(schema.evalCaseResult.evalRunId, evalRunId))),
  ) as Promise<EvalCaseResultView[]>;
}
