import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { SpanStatusCode, type Attributes } from "@opentelemetry/api";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — tenant-scoped,
 * opt-in trace/metric export, ADDITIVE to (never a replacement for) the process-wide
 * exporter `tracing.ts` already bootstraps for this codebase's own internal
 * ClickHouse/OTel pipeline (`initTracing()`, Phase 10).
 *
 * A tenant's OTel collector endpoint is fundamentally a DIFFERENT destination than
 * the process-wide one, so this is a genuinely separate `TracerProvider`/
 * `MeterProvider` instance per endpoint, each with its own real `OTLPTraceExporter`/
 * `OTLPMetricExporter` (the same OTel JS SDK exporter classes `tracing.ts` already
 * uses, never a hand-rolled OTLP client) — cached by endpoint so repeated calls for
 * the same tenant reuse one provider rather than opening a new one per span.
 *
 * **Disclosed design choice**: a forwarded span is a faithful MIRROR of the
 * originating operation (same name/attributes/status/timing) under its own
 * independently-generated trace/span id, not a byte-identical re-export of the
 * primary ClickHouse-bound span object. OTel's API-level `Span` (from
 * `packages/observability/src/tracing.ts`'s own process-wide tracer) is not
 * guaranteed to be a real `ReadableSpan` unless that process-wide SDK was actually
 * initialized (`initTracing()`), so re-exporting IT through a second exporter would
 * either double-count against a no-op span or require hand-constructing a
 * `ReadableSpan`-shaped object — a materially less honest simulation than genuinely
 * creating and ending a second, real span through a dedicated per-tenant provider.
 * The tenant's own dashboard still correlates every mirrored span via the shared
 * `nextbot.agent_run_id` attribute, which is the join key that matters for their use
 * case (their own APM tool has no knowledge of this codebase's internal ClickHouse
 * trace id anyway).
 */

interface TenantTraceProviderEntry {
  provider: BasicTracerProvider;
}

const traceProvidersByEndpoint = new Map<string, TenantTraceProviderEntry>();

function getOrCreateTenantTraceProvider(endpoint: string): BasicTracerProvider {
  const existing = traceProvidersByEndpoint.get(endpoint);
  if (existing) return existing.provider;
  const exporter = new OTLPTraceExporter({ url: endpoint });
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  traceProvidersByEndpoint.set(endpoint, { provider });
  return provider;
}

/**
 * Mirrors one already-completed operation as a real, ended OTel span sent to the
 * tenant's configured OTLP endpoint. `startedAt`/`durationMs` reproduce the
 * original timing (rather than "now"), so the tenant's own trace timeline reflects
 * when the operation actually happened, not when it happened to be forwarded.
 * Fails safe: forwarding must never throw into the caller's own request/turn.
 */
export function forwardSpanToTenantEndpoint(
  endpoint: string,
  input: { name: string; attributes: Attributes; startedAt: Date; durationMs: number; status: "Ok" | "Error" },
): void {
  try {
    const provider = getOrCreateTenantTraceProvider(endpoint);
    const tracer = provider.getTracer("nextbot-tenant-export");
    const span = tracer.startSpan(input.name, { attributes: input.attributes, startTime: input.startedAt });
    span.setStatus({ code: input.status === "Ok" ? SpanStatusCode.OK : SpanStatusCode.ERROR });
    span.end(new Date(input.startedAt.getTime() + input.durationMs));
  } catch (err) {
    console.error("NextBot: tenant OTel span export failed (non-fatal)", err);
  }
}

/** Flushes every open tenant trace provider — test-only / graceful-shutdown use, so
 * a test can assert a span actually reached the (mock) collector before asserting. */
export async function flushTenantTraceProviders(): Promise<void> {
  await Promise.all(Array.from(traceProvidersByEndpoint.values()).map((entry) => entry.provider.forceFlush()));
}

export function resetTenantExportersForTests(): void {
  traceProvidersByEndpoint.clear();
}

/**
 * The periodic metric-snapshot push (`apps/worker`'s `telemetry.otel-metrics-export`
 * job computes the real aggregate; this function only performs the real OTLP metric
 * export of whatever numbers it's given). Uses `@opentelemetry/sdk-metrics`'s real
 * `MeterProvider` + `OTLPMetricExporter`, an observable-gauge callback per metric —
 * `forceFlush()` triggers an immediate export rather than waiting for a periodic
 * reader interval, since the worker job's own cadence IS the export cadence.
 */
export async function exportTenantMetricsSnapshot(endpoint: string, metrics: Array<{ name: string; value: number; unit?: string }>): Promise<void> {
  const exporter = new OTLPMetricExporter({ url: endpoint });
  // A MeterProvider only ever exports through a registered `MetricReader`. This
  // short-lived worker-job call needs exactly ONE real, immediate export (never a
  // background timer outliving this function call) — `PeriodicExportingMetricReader`
  // is the SDK's own supported reader, given an effectively-unreachable interval
  // (collection is instead driven explicitly by `forceFlush()` below), then shut down
  // immediately after, so no timer survives past this call.
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 2_147_483_647 });
  const provider = new MeterProvider({ readers: [reader] });
  const meter = provider.getMeter("nextbot-tenant-export");
  for (const metric of metrics) {
    const gauge = meter.createObservableGauge(metric.name, { unit: metric.unit });
    gauge.addCallback((result) => result.observe(metric.value));
  }
  try {
    await provider.forceFlush();
  } finally {
    await provider.shutdown().catch(() => undefined);
  }
}
