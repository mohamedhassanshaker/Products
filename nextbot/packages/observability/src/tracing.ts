import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter, type SpanExporter } from "@opentelemetry/sdk-trace-node";
import { trace, SpanStatusCode, type Span, type Attributes } from "@opentelemetry/api";

/**
 * Phase 10 (FR-AGT-09) — OTel SDK/exporter bootstrap. LLD §3.10 names `agent_run_span`
 * as a **ClickHouse** table fed by "OTLP to the per-cell OpenTelemetry Collector"; this
 * phase deliberately stands up the SDK/exporter plumbing (span emission with the
 * shape LLD §3.10 specifies) without also standing up the ClickHouse read path — that
 * lands in Phase 12/13, the phases that actually populate it with real per-tool-call
 * trace data and build the Trace Viewer's read side (see the dispatch report for the
 * full rationale: "ClickHouse wiring can remain deferred... at minimum the OTel
 * SDK/exporter plumbing should exist, not be entirely absent").
 *
 * Fails safe: if no `OTEL_EXPORTER_OTLP_ENDPOINT` is configured (true for this
 * sandboxed dev environment, which has no live Collector), spans are still emitted —
 * to a `ConsoleSpanExporter` — rather than tracing silently doing nothing. Pointing
 * `OTEL_EXPORTER_OTLP_ENDPOINT` at a real Collector is the only change needed to go
 * live with the OTLP path this LLD describes.
 */
let sdk: NodeSDK | undefined;

export function initTracing(serviceName: string): void {
  if (sdk) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const exporter: SpanExporter = endpoint ? new OTLPTraceExporter({ url: endpoint }) : new ConsoleSpanExporter();
  sdk = new NodeSDK({ serviceName, traceExporter: exporter });
  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}

/** Test-only: lets a test reset the module-level SDK singleton between runs. Not part
 * of the package's public entry point. */
export function resetTracingForTests(): void {
  sdk = undefined;
}

const tracer = trace.getTracer("nextbot");

/** Starts a span carrying the `agent_run` attributes LLD §3.10's `agent_run_span`
 * table names (`tenant_id`, `agent_run_id`, `kind`, etc., as span attributes here —
 * the ClickHouse projection of these attributes into named columns is Phase 12/13's
 * job once real per-tool-call spans exist to project). */
export function startSpan(name: string, attributes: Attributes): Span {
  return tracer.startSpan(name, { attributes });
}

export function endSpanOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

export function endSpanError(span: Span, message: string): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.end();
}

/** The 32-hex-char OTel trace id for the span's trace — this is what
 * `agent_run.otel_trace_id` stores (LLD §3.10), the join key back to
 * `agent_run_span` once the ClickHouse read side exists. */
export function traceIdOf(span: Span): string {
  return span.spanContext().traceId;
}
