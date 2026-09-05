// PUBLIC API for "@nextbot/observability" (LLD §11.9). OTel bootstrap + span helpers
// as of Phase 10 (FR-AGT-09) — Pino logger/redaction config remains a later addition
// once a phase needs it (no phase through Phase 10 has introduced file-based logging
// requirements beyond what each app's own console output already provides).
export { initTracing, shutdownTracing, resetTracingForTests, startSpan, endSpanOk, endSpanError, traceIdOf } from "./tracing.js";
// Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — tenant-scoped, opt-in
// OTel trace/metric export, additive to the process-wide bootstrap above.
export { forwardSpanToTenantEndpoint, flushTenantTraceProviders, resetTenantExportersForTests, exportTenantMetricsSnapshot } from "./tenant-export.js";
