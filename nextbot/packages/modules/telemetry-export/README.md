# @nextbot/telemetry-export

Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — tenant-scoped, opt-in
OpenTelemetry trace/metric export and audit-log SIEM streaming. Both are ADDITIVE to
the existing in-console Runtime Traces (FR-RP-08) and Audit Log Viewer (FR-ADM-03)
experiences, never a replacement.

- Trace export reuses `@nextbot/observability#forwardSpanToTenantEndpoint`, wired into
  `@nextbot/orchestration`'s existing span-emission call sites
  (`agent-run-tracing.ts`), a real per-tenant `OTLPTraceExporter` instance.
- Metric export is a periodic (5 min) aggregate push over `agent_run`
  (`@nextbot/observability#exportTenantMetricsSnapshot`, a real `OTLPMetricExporter`)
  — OTel metrics are interval-aggregated by nature, so this is the correct shape, not
  a narrowed one.
- SIEM export batches `audit_log_entry` rows via its OWN cursor
  (`siem_export_config.last_exported_audit_log_id`) — never `domain_event.processed`/
  `processed_at`, which is `@nextbot/audit`'s own private cursor for a different table
  entirely.

See `docs/plans/public-api-webhooks-otel-siem-plan.md` for the full design record.
