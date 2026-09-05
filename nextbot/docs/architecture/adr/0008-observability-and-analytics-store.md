# ADR-0008 — OpenTelemetry + ClickHouse for observability and analytics

**Status:** Accepted · 2026-08-15
**Context refs:** NFR-9, NFR-3, NFR-2, NFR-6, FR-RP-01…08, FR-AGT-09/10, FR-MCP-03/06/08, FR-AI-12

## 1. Context

Two workloads that look like one:

- **Tracing (NFR-9, FR-RP-08, FR-AGT-09).** Every agent run emits an OpenTelemetry trace with one
  span per graph node and per tool call, correlatable from a customer message through to a backend
  mutation and back, exportable to the tenant's or the platform's APM.
- **Analytics (FR-RP-01…07, FR-MCP-03).** Volume, resolution rate, latency **p50/p95/p99 per tool**,
  error breakdown, per-tool latency histograms, goals × channels heatmaps, cost by
  channel/backend/goal/tool, 7-day rolling per-tool call counts in the Tool Catalog.

Volume ceiling from NFR-3: 500 tool calls/s **per large tenant**, plus model calls, plus channel
events, plus one span per graph node. That is a high-cardinality, append-only, time-ordered,
aggregate-read workload — the opposite of the OLTP workload Postgres is carrying.

## 2. Decision

**OpenTelemetry everywhere for instrumentation; an OTel Collector per cell; ClickHouse as the
analytical store. Postgres stays OLTP-only.**

- All four deployables instrument with the OpenTelemetry JS SDK. Trace context is created at channel
  ingress and propagated through Redis Streams (as message headers), into the run, through the graph
  runtime adapter's `RunEvent` stream, into MCP egress, and back — so `traceId` is a single thread
  from customer message to backend mutation. The same `traceId` is surfaced in every
  `application/problem+json` error and in the Trace Viewer, making "I've logged this" (FR-AI-05)
  verifiable by a support engineer in one lookup.
- The Collector runs **inside each regional cell**, tenant-tags spans, applies sampling, and fans out
  to (a) cell-local ClickHouse and (b) optionally a tenant-configured OTLP endpoint. No telemetry
  crosses a cell boundary, so NFR-6 holds for observability data too — a detail that is easy to get
  wrong by exporting everything to one global APM.
- ClickHouse holds: raw spans (short TTL), plus **derived fact tables** written from the span stream
  — `tool_call_fact`, `model_call_fact`, `conversation_fact`, `escalation_fact`, `approval_fact` —
  and materialised-view rollups per hour/day and per tenant/channel/goal/tool/backend. Every RP-*
  report and the FR-AGT-10 per-tenant quota dashboard reads these, never Postgres.
- **Sampling policy:** traces are *tail*-sampled — 100% of runs that error, escalate, trip a
  breaker, involve a Tier-2/3 approval, or exceed a latency threshold; a configurable percentage of
  clean runs. Fact rows are **never** sampled: cost, tool-call counts, and success rates must be
  exact because they drive billing-adjacent reporting (FR-RP-07) and the "zero unauthorized
  executions" audit. Sampling loses detail, never counts.
- **Postgres remains the system of record** for `ToolCall`, `AuditLogEntry`, conversations and
  messages — the immutable, legally-relevant records (NFR-10). ClickHouse is a derived, rebuildable
  analytical projection. If ClickHouse is lost, nothing authoritative is lost; it is rebuilt from
  Postgres plus retained spans. This division is deliberate: analytics must never be the source of
  truth for an audit claim.
- Retention is per-tenant and per-data-class (FR-ADM-06), implemented as ClickHouse TTLs plus the
  Postgres retention sweeper, so a tenant's configured retention is honoured in both stores rather
  than only in the one that is easy to purge.

## 3. Alternatives considered

**Postgres only (or Postgres + TimescaleDB).** Rejected. At the NFR-3 ceiling the analytical load
would sit on the same instance that conversational writes and the RLS-scoped OLTP reads depend on,
directly threatening NFR-2's latency budget. TimescaleDB narrows the gap but adds an extension whose
licensing tiers (Apache vs. TSL for the compression/continuous-aggregate features we would actually
need) complicate the same question ClickHouse answers cleanly under Apache-2.0.

**A hosted APM (Datadog / Honeycomb / Grafana Cloud) as the only store.** Rejected as primary: it
must be deployed or contracted per residency region (NFR-6), per-seat/per-GB cost scales with the
exact metric we most want to grow, and product reports (FR-RP-01…07 are tenant-facing product
surfaces, not ops dashboards) would be built on a third-party query API. Exporting **to** a tenant's
APM remains supported and is an NFR-9 requirement.

**Elasticsearch / OpenSearch.** Rejected: strong for log search, materially worse per-cost for
high-cardinality numeric aggregation, and heavier to operate per cell.

**Build reports off the Postgres OLTP tables with nightly rollups.** Rejected: FR-MCP-03's Tool
Catalog and FR-AGT-10's quota view are near-real-time surfaces, and nightly rollups cannot serve
p95/p99 histograms without retaining the raw rows anyway.

## 4. Consequences

- One more stateful component per cell. Accepted; single-node ClickHouse is sufficient through
  Phase 1–2 and is in the docker-compose dev stack, so the operational step-up is gradual.
- Dual-write risk between Postgres facts and ClickHouse facts. Avoided by construction: ClickHouse is
  fed **only** from the telemetry stream, never by application code writing to two places. Any
  discrepancy is a projection bug, fixable by replay.
- Reporting queries are SQL against ClickHouse, written by hand — the ORM (Drizzle, ADR-0002) covers
  Postgres only. That is intended; report SQL wants to be readable SQL.
- FR-MCP-03's "show `—`, not `0%`, for a never-called tool" is a projection concern: absence of a
  fact row must render as no-data, never as zero. Recorded here because it is exactly the detail a
  naive `COALESCE(x, 0)` gets wrong.
- The eval runner (FR-AGT-06) and canary promotion (FR-AGT-04/05) read per-version rollups from
  ClickHouse, so promotion decisions and product reporting share one number rather than two
  definitions of "success rate".
