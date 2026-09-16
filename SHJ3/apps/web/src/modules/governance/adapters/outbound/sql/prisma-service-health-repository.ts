import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type { ServiceHealthStatus } from "../../../domain/service-health.js";
import type {
  OrchestrationStepSampleRepository,
  ServiceHealthRepository,
  ServiceHealthSampleRow,
  TraceStepSample,
  UpsertServiceHealthSampleInput,
} from "../../../ports/service-health-repository.js";

const OPERATION = "governance observability";

export class PrismaServiceHealthRepository implements ServiceHealthRepository {
  /** The most recent sample per `(targetKind, targetId, targetKey)` — grouped in
   *  application code (SQL Server has no `DISTINCT ON`; a window function would work but
   *  this table is small and this keeps the query portable and simple). */
  async listLatest(): Promise<readonly ServiceHealthSampleRow[]> {
    const rows = await getTenantDb(OPERATION).serviceHealthSample.findMany({
      orderBy: { windowStart: "desc" },
    });
    const seen = new Set<string>();
    const latest: ServiceHealthSampleRow[] = [];
    for (const row of rows) {
      const key = `${row.targetKind}:${row.targetId ?? ""}:${row.targetKey ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(toRow(row));
    }
    return latest;
  }

  /**
   * `UQ_ServiceHealthSamples_target_windowStart` covers `targetId`/`targetKey`, both
   * nullable — Prisma's generated compound-unique `where` input does not accept `null`
   * in that position (SQL Server unique-index NULL semantics), so this is a real
   * `findFirst` + `create`/`update` rather than a single `upsert` call.
   */
  async upsert(input: UpsertServiceHealthSampleInput): Promise<ServiceHealthSampleRow> {
    const db = getTenantDb(OPERATION);
    const existing = await db.serviceHealthSample.findFirst({
      where: {
        targetKind: input.targetKind,
        targetId: input.targetId,
        targetKey: input.targetKey,
        windowStart: input.windowStart,
      },
    });

    const row = existing
      ? await db.serviceHealthSample.update({
          where: { id: existing.id },
          data: {
            displayName: input.displayName,
            windowEnd: input.windowEnd,
            requestCount: input.requestCount,
            p50LatencyMs: input.p50LatencyMs,
            p95LatencyMs: input.p95LatencyMs,
            p99LatencyMs: input.p99LatencyMs,
            errorRate: input.errorRate,
            status: input.status,
            updatedAt: input.windowEnd,
          },
        })
      : await db.serviceHealthSample.create({
          data: {
            id: newUlid(),
            targetKind: input.targetKind,
            targetId: input.targetId,
            targetKey: input.targetKey,
            displayName: input.displayName,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            requestCount: input.requestCount,
            p50LatencyMs: input.p50LatencyMs,
            p95LatencyMs: input.p95LatencyMs,
            p99LatencyMs: input.p99LatencyMs,
            errorRate: input.errorRate,
            status: input.status,
            createdAt: input.windowEnd,
            updatedAt: input.windowEnd,
          },
        });
    return toRow(row);
  }
}

type ServiceHealthSamplePrismaRow = {
  id: string;
  targetKind: string;
  targetId: string | null;
  targetKey: string | null;
  displayName: string;
  windowStart: Date;
  windowEnd: Date;
  requestCount: number;
  p95LatencyMs: number;
  errorRate: unknown;
  status: string;
};

function toRow(row: ServiceHealthSamplePrismaRow): ServiceHealthSampleRow {
  return {
    id: row.id,
    targetKind: row.targetKind,
    targetId: row.targetId,
    targetKey: row.targetKey,
    displayName: row.displayName,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    requestCount: row.requestCount,
    p95LatencyMs: row.p95LatencyMs,
    errorRate: Number(row.errorRate),
    status: row.status as ServiceHealthStatus,
  };
}

/** Aggregates real `OrchestrationTraceSteps` — `kind IN ('ToolCall','Retrieval')` — over a
 *  window, since no OTel-consuming worker exists yet to populate `ServiceHealthSamples`
 *  continuously (see `application/RecordServiceHealthSample.ts`'s own doc comment). */
export class PrismaOrchestrationStepSampleRepository implements OrchestrationStepSampleRepository {
  async listSteps(
    kind: "ToolCall" | "Retrieval",
    windowStart: Date,
    windowEnd: Date,
  ): Promise<readonly TraceStepSample[]> {
    const rows = await getTenantDb(OPERATION).orchestrationTraceStep.findMany({
      where: { kind, startedAt: { gte: windowStart, lt: windowEnd } },
      select: { durationMs: true, status: true },
    });
    return rows;
  }
}
