import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  GoldenSetKind,
  RegressionResult,
  RegressionState,
  RegressionTriggerKind,
} from "../../../domain/vocabulary.js";
import type {
  FinishRegressionRunInput,
  LatestSetRunRow,
  NewRegressionCaseResultInput,
  RegressionCaseResultRow,
  RegressionRunRepository,
  RegressionRunRow,
  StartRegressionRunInput,
} from "../../../ports/regression-run-repository.js";

function toRunRow(row: {
  id: string;
  goldenSetId: string;
  agentId: string;
  agentVersionId: string;
  triggeredBy: string;
  state: string;
  accuracy: unknown;
  groundedness: unknown;
  toolAccuracy: unknown;
  localeParity: unknown;
  result: string | null;
  casesTotal: number;
  casesPassed: number;
  startedAt: Date;
  finishedAt: Date | null;
  ranByStaffUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RegressionRunRow {
  return {
    id: row.id,
    goldenSetId: row.goldenSetId,
    agentId: row.agentId,
    agentVersionId: row.agentVersionId,
    triggeredBy: row.triggeredBy as RegressionTriggerKind,
    state: row.state as RegressionState,
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    groundedness: row.groundedness === null ? null : Number(row.groundedness),
    toolAccuracy: row.toolAccuracy === null ? null : Number(row.toolAccuracy),
    localeParity: row.localeParity === null ? null : Number(row.localeParity),
    result: row.result as RegressionResult | null,
    casesTotal: row.casesTotal,
    casesPassed: row.casesPassed,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    ranByStaffUserId: row.ranByStaffUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCaseResultRow(row: {
  id: string;
  regressionRunId: string;
  goldenCaseId: string;
  passed: boolean;
  accuracyScore: unknown;
  groundednessScore: unknown;
  toolAccuracyScore: unknown;
  actualResponse: string | null;
  actualToolCallsJson: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RegressionCaseResultRow {
  return {
    id: row.id,
    regressionRunId: row.regressionRunId,
    goldenCaseId: row.goldenCaseId,
    passed: row.passed,
    accuracyScore: row.accuracyScore === null ? null : Number(row.accuracyScore),
    groundednessScore: row.groundednessScore === null ? null : Number(row.groundednessScore),
    toolAccuracyScore: row.toolAccuracyScore === null ? null : Number(row.toolAccuracyScore),
    actualResponse: row.actualResponse,
    actualToolCallsJson: row.actualToolCallsJson,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const ACTIVE_STATES = ["Queued", "Running"] as const;

export class PrismaRegressionRunRepository implements RegressionRunRepository {
  async start(input: StartRegressionRunInput): Promise<RegressionRunRow> {
    // Straight to `Running`, never lingering in `Queued` — this module runs every case
    // synchronously within the same request that starts it (no job queue exists anywhere
    // in this codebase yet, web or AI side; see `run-golden-set-now.ts`'s own doc comment).
    // `UQ_RegressionRuns_active`'s filtered index covers both states identically, so this
    // choice does not weaken the one-active-run-per-pair guarantee it exists to enforce —
    // it is a real, raw Prisma error (`P2002`) on a collision, left uncaught here exactly
    // like `GoldenCaseRepository.add()`'s identical convention.
    const row = await getTenantDb("evaluation regression run start").regressionRun.create({
      data: {
        id: newUlid(),
        goldenSetId: input.goldenSetId,
        agentId: input.agentId,
        agentVersionId: input.agentVersionId,
        triggeredBy: input.triggeredBy,
        state: "Running",
        accuracy: null,
        groundedness: null,
        toolAccuracy: null,
        localeParity: null,
        result: null,
        casesTotal: input.casesTotal,
        casesPassed: 0,
        startedAt: input.now,
        finishedAt: null,
        ranByStaffUserId: input.ranByStaffUserId,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toRunRow(row);
  }

  async finish(input: FinishRegressionRunInput): Promise<void> {
    await getTenantDb("evaluation regression run finish").regressionRun.update({
      where: { id: input.regressionRunId },
      data: {
        state: "Completed",
        result: input.result,
        accuracy: input.accuracy,
        groundedness: input.groundedness,
        toolAccuracy: input.toolAccuracy,
        localeParity: input.localeParity,
        casesPassed: input.casesPassed,
        finishedAt: input.finishedAt,
        updatedAt: input.finishedAt,
      },
    });
  }

  async markFailed(regressionRunId: string, finishedAt: Date): Promise<void> {
    // `state="Failed"`, `result` stays NULL — `CK_RegressionRuns_finishedHasResult`
    // requires exactly this pairing; `result` may only be non-null when `state="Completed"`.
    await getTenantDb("evaluation regression run mark failed").regressionRun.update({
      where: { id: regressionRunId },
      data: { state: "Failed", finishedAt, updatedAt: finishedAt },
    });
  }

  async addCaseResult(input: NewRegressionCaseResultInput): Promise<RegressionCaseResultRow> {
    const row = await getTenantDb(
      "evaluation regression case result add",
    ).regressionCaseResult.create({
      data: {
        id: newUlid(),
        regressionRunId: input.regressionRunId,
        goldenCaseId: input.goldenCaseId,
        passed: input.passed,
        accuracyScore: input.accuracyScore,
        groundednessScore: input.groundednessScore,
        toolAccuracyScore: input.toolAccuracyScore,
        actualResponse: input.actualResponse,
        actualToolCallsJson: input.actualToolCallsJson,
        failureReason: input.failureReason,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toCaseResultRow(row);
  }

  async listRecent(limit = 100): Promise<readonly RegressionRunRow[]> {
    const rows = await getTenantDb("evaluation regression run list").regressionRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    return rows.map(toRunRow);
  }

  async findById(regressionRunId: string): Promise<RegressionRunRow | null> {
    const row = await getTenantDb("evaluation regression run detail").regressionRun.findUnique({
      where: { id: regressionRunId },
    });
    return row ? toRunRow(row) : null;
  }

  async listCaseResults(regressionRunId: string): Promise<readonly RegressionCaseResultRow[]> {
    const rows = await getTenantDb(
      "evaluation regression case result list",
    ).regressionCaseResult.findMany({
      where: { regressionRunId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toCaseResultRow);
  }

  async hasAnyCompletedRunForVersion(agentVersionId: string): Promise<boolean> {
    const count = await getTenantDb(
      "evaluation regression run existence check",
    ).regressionRun.count({
      where: { agentVersionId, state: "Completed" },
    });
    return count > 0;
  }

  async listLatestCompletedRunsForVersion(
    agentVersionId: string,
  ): Promise<readonly LatestSetRunRow[]> {
    // Newest first, then keep only the first (= most recent) row seen per `goldenSetId` —
    // Prisma has no "latest per group" query, and the row volume per version (one row per
    // golden set this version has ever been scored against) is small enough that reducing
    // in application code is simpler and clearer than a raw SQL window function here.
    const rows = await getTenantDb("evaluation gate latest set runs").regressionRun.findMany({
      where: { agentVersionId, state: "Completed" },
      orderBy: { startedAt: "desc" },
      include: { goldenSet: { select: { name: true, kind: true } } },
    });
    const seen = new Set<string>();
    const result: LatestSetRunRow[] = [];
    for (const row of rows) {
      if (seen.has(row.goldenSetId)) continue;
      seen.add(row.goldenSetId);
      result.push({
        goldenSetId: row.goldenSetId,
        goldenSetName: row.goldenSet.name,
        kind: row.goldenSet.kind as GoldenSetKind,
        accuracy: row.accuracy === null ? null : Number(row.accuracy),
        groundedness: row.groundedness === null ? null : Number(row.groundedness),
      });
    }
    return result;
  }

  async findActive(goldenSetId: string, agentVersionId: string): Promise<RegressionRunRow | null> {
    const row = await getTenantDb(
      "evaluation regression run active lookup",
    ).regressionRun.findFirst({
      where: { goldenSetId, agentVersionId, state: { in: [...ACTIVE_STATES] } },
    });
    return row ? toRunRow(row) : null;
  }
}
