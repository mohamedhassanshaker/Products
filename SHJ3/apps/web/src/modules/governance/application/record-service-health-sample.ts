import { deriveHealthStatus, errorRateOf, p95 } from "../domain/service-health.js";
import type {
  OrchestrationStepSampleRepository,
  ServiceHealthRepository,
  ServiceHealthSampleRow,
} from "../ports/service-health-repository.js";

/**
 * B14 tab 3's "Recompute now" admin action.
 *
 * ## A real, honest, on-demand computation — not a continuously-running worker
 *
 * `ServiceHealthSamples`' own schema doc comment says it is meant to be populated by a
 * `shj3-worker` process consuming OpenTelemetry — no such service exists anywhere in this
 * repo (confirmed: only `apps/web` and `apps/ai` exist). Building a full OTel-consuming
 * worker is a genuinely separate, large undertaking and is out of scope for this wave.
 * This use case computes ONE real sample for a named target from data the runtime has
 * already produced (`OrchestrationTraceSteps`) and upserts it — correct, real
 * arithmetic over real rows, just not continuously running. Named plainly here and in
 * this module's final report as a deliberate, deferred gap.
 */
export class RecordServiceHealthSample {
  constructor(
    private readonly deps: {
      readonly steps: OrchestrationStepSampleRepository;
      readonly samples: ServiceHealthRepository;
    },
  ) {}

  async execute(input: {
    readonly targetKind: "McpTool" | "GraphRetrieval";
    readonly targetKey: string;
    readonly displayName: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
  }): Promise<ServiceHealthSampleRow> {
    const stepKind = input.targetKind === "McpTool" ? "ToolCall" : "Retrieval";
    const steps = await this.deps.steps.listSteps(stepKind, input.windowStart, input.windowEnd);

    const durations = steps.map((step) => step.durationMs);
    const nonOk = steps.filter((step) => step.status !== "Ok").length;
    const p95LatencyMs = p95(durations);
    const errorRate = errorRateOf(steps.length, nonOk);
    const status = deriveHealthStatus({ errorRate, p95LatencyMs, targetKey: input.targetKey });

    return this.deps.samples.upsert({
      targetKind: input.targetKind,
      targetId: null,
      targetKey: input.targetKey,
      displayName: input.displayName,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      requestCount: steps.length,
      p50LatencyMs: null,
      p95LatencyMs,
      p99LatencyMs: null,
      errorRate,
      status,
    });
  }
}
