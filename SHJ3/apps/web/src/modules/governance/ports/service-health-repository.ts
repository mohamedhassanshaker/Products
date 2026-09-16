import type { ServiceHealthStatus } from "../domain/service-health.js";

export interface ServiceHealthSampleRow {
  readonly id: string;
  readonly targetKind: string;
  readonly targetId: string | null;
  readonly targetKey: string | null;
  readonly displayName: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly requestCount: number;
  readonly p95LatencyMs: number;
  readonly errorRate: number;
  readonly status: ServiceHealthStatus;
}

export interface UpsertServiceHealthSampleInput {
  readonly targetKind: string;
  readonly targetId: string | null;
  readonly targetKey: string | null;
  readonly displayName: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly requestCount: number;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number | null;
  readonly errorRate: number;
  readonly status: ServiceHealthStatus;
}

export interface ServiceHealthRepository {
  /** The most recent sample per `(targetKind, targetId, targetKey)` — B14 tab 3's table. */
  listLatest(): Promise<readonly ServiceHealthSampleRow[]>;

  /** Upserts respecting `UQ_ServiceHealthSamples_target_windowStart`. */
  upsert(input: UpsertServiceHealthSampleInput): Promise<ServiceHealthSampleRow>;
}

/** Real per-step timing this module aggregates from — `OrchestrationTraceSteps` for
 *  `kind IN ('ToolCall','Retrieval')` over a recent window, since no OTel-consuming
 *  worker exists yet to populate `ServiceHealthSamples` continuously (this module's own
 *  `RecordServiceHealthSample` doc comment names the gap plainly). */
export interface TraceStepSample {
  readonly durationMs: number;
  readonly status: string;
}

export interface OrchestrationStepSampleRepository {
  /** `kind`: `'ToolCall' | 'Retrieval'`, over `[windowStart, windowEnd)`. */
  listSteps(
    kind: "ToolCall" | "Retrieval",
    windowStart: Date,
    windowEnd: Date,
  ): Promise<readonly TraceStepSample[]>;
}
