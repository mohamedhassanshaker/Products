import { createClient, type ClickHouseClient } from "@clickhouse/client";

/**
 * Phase 13 (BL-06) — the ClickHouse read/write path stood up for the first time
 * (LLD §3.10/§12.5, ADR-0008: `agent_run_span` + every `RP-*` reporting rollup live
 * in ClickHouse, never Postgres). Mirrors `pool.ts`/`tenant-context.ts`'s
 * `withTenant` convention as closely as ClickHouse's model allows: a lazy singleton
 * client plus a mandatory `tenant_id` predicate injected on every query, never left
 * to the caller to remember (LLD §3.10: "Tenant isolation in ClickHouse is enforced
 * by a mandatory `tenant_id` predicate... plus a row policy on the reader role").
 *
 * **Deviation from LLD §3.10, recorded deliberately (flagged to the orchestrator).**
 * The LLD's intended write path is "OTel spans emitted as OTLP to the per-cell
 * OpenTelemetry Collector, landed in ClickHouse [by the Collector]" — i.e. the
 * application never writes to ClickHouse directly, only to the Collector via OTLP.
 * No OTel Collector is stood up anywhere in this repo yet (that is genuinely
 * `nexus-deploy`'s infra, not `nexus-dev`'s application code) and Phase 10 only ever
 * wired the OTel SDK's exporter (`packages/observability/src/tracing.ts`) to a
 * `ConsoleSpanExporter`/raw OTLP-HTTP exporter — nothing lands the resulting spans
 * anywhere durable or queryable today. Standing up a real Collector is out of scope
 * for an application-code phase, but this phase's deliverable (a working trace
 * viewer, NFR-9's "every tool-call run is end-to-end traceable") cannot ship against
 * a queryable store that doesn't exist. The smallest reversible bridge: the
 * application (`packages/modules/orchestration`'s turn pipeline) writes
 * `agent_run_span` rows to ClickHouse **directly** via this module's
 * `insertAgentRunSpans`, in parallel with (not instead of) the existing OTel SDK
 * span emission. When a real Collector is stood up later, this direct-write call can
 * be deleted with no schema change — the table shape below is exactly LLD §3.10's
 * `agent_run_span` column list, so the Collector's own OTLP-to-ClickHouse ingestion
 * would land rows in the identical shape.
 */

export interface AgentRunSpanRow {
  tenantId: string;
  agentRunId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: "GraphNode" | "ModelCall" | "ToolCall" | "Guardrail" | "Retrieval" | "Hitl";
  attributes: Record<string, string>;
  status: "Ok" | "Error";
  startedAt: Date;
  durationMs: number;
}

let client: ClickHouseClient | undefined;
let schemaEnsured: Promise<void> | undefined;

function getClickHouseUrl(): string {
  const isTest = process.env.NEXTBOT_DB_ENV === "test";
  const url = isTest ? process.env.CLICKHOUSE_TEST_URL : process.env.CLICKHOUSE_URL;
  if (!url) {
    throw new ClickHouseUnavailableError("CLICKHOUSE_URL (or CLICKHOUSE_TEST_URL in test env) is not configured");
  }
  return url;
}

/** Thrown when ClickHouse is not configured or unreachable — distinct from "zero
 * spans exist yet" (an empty array) so the trace viewer can tell "the store is down"
 * apart from "this run genuinely has no spans", per the gotcha about never
 * conflating an infra failure with a legitimate empty result. */
export class ClickHouseUnavailableError extends Error {
  constructor(detail: string) {
    super(`ClickHouse is unavailable: ${detail}`);
    this.name = "ClickHouseUnavailableError";
  }
}

function getClient(): ClickHouseClient {
  if (!client) {
    client = createClient({ url: getClickHouseUrl(), request_timeout: 5000 });
  }
  return client;
}

/** Idempotent `CREATE TABLE IF NOT EXISTS` for `agent_run_span` (LLD §3.10's exact
 * column list). Runs once per process — cheap enough to call from every entry point
 * without a separate migration-runner step, matching this phase's "no OTel Collector
 * infra yet" bridge (see module doc). */
function ensureSchema(): Promise<void> {
  if (!schemaEnsured) {
    schemaEnsured = getClient().command({
      query: `
        CREATE TABLE IF NOT EXISTS agent_run_span (
          tenant_id String,
          agent_run_id String,
          trace_id String,
          span_id String,
          parent_span_id Nullable(String),
          name String,
          kind Enum('GraphNode' = 1, 'ModelCall' = 2, 'ToolCall' = 3, 'Guardrail' = 4, 'Retrieval' = 5, 'Hitl' = 6),
          attributes Map(String, String),
          status Enum('Ok' = 1, 'Error' = 2),
          started_at DateTime64(3),
          duration_ms UInt32
        )
        ENGINE = MergeTree
        ORDER BY (tenant_id, agent_run_id, started_at)
      `,
    }).then(() => undefined);
  }
  return schemaEnsured;
}

/**
 * Writes a batch of spans for one agent run. **Fails safe**: a ClickHouse outage
 * must never crash the conversation turn that produced these spans (the same
 * "logging must never throw into the triggering request" rule this project applies
 * to Pino/Serilog sinks) — errors are logged server-side and swallowed. Every row's
 * `tenantId` is forced to `ctx.tenantId` regardless of what the input carries, so a
 * caller can never smuggle a cross-tenant write even by accident.
 */
export async function insertAgentRunSpans(
  ctx: { tenantId: string },
  spans: Omit<AgentRunSpanRow, "tenantId">[],
): Promise<void> {
  if (spans.length === 0) return;
  try {
    await ensureSchema();
    await getClient().insert({
      table: "agent_run_span",
      values: spans.map((s) => ({
        tenant_id: ctx.tenantId,
        agent_run_id: s.agentRunId,
        trace_id: s.traceId,
        span_id: s.spanId,
        parent_span_id: s.parentSpanId,
        name: s.name,
        kind: s.kind,
        attributes: s.attributes,
        status: s.status,
        started_at: s.startedAt.toISOString().replace("T", " ").replace("Z", ""),
        duration_ms: s.durationMs,
      })),
      format: "JSONEachRow",
    });
  } catch (err) {
    console.error("NextBot: failed to write agent_run_span rows to ClickHouse (telemetry-only, non-fatal)", err);
  }
}

/**
 * Tenant-scoped reader for one run's spans, ordered oldest-first (the trace
 * viewer's timeline order). Unlike the writer, a read failure is **not** swallowed —
 * it throws `ClickHouseUnavailableError` so the caller (the trace-viewer API route)
 * can return a distinct "trace temporarily unavailable" state rather than silently
 * rendering "no spans recorded" for what might just be an outage.
 *
 * @throws {ClickHouseUnavailableError} ClickHouse is not configured or unreachable.
 */
export async function queryAgentRunSpans(ctx: { tenantId: string }, agentRunId: string): Promise<AgentRunSpanRow[]> {
  try {
    await ensureSchema();
    const result = await getClient().query({
      query: `
        SELECT tenant_id, agent_run_id, trace_id, span_id, parent_span_id, name, kind, attributes, status, started_at, duration_ms
        FROM agent_run_span
        WHERE tenant_id = {tenantId:String} AND agent_run_id = {agentRunId:String}
        ORDER BY started_at ASC
      `,
      query_params: { tenantId: ctx.tenantId, agentRunId },
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      tenant_id: string;
      agent_run_id: string;
      trace_id: string;
      span_id: string;
      parent_span_id: string | null;
      name: string;
      kind: AgentRunSpanRow["kind"];
      attributes: Record<string, string>;
      status: AgentRunSpanRow["status"];
      started_at: string;
      duration_ms: number;
    }>();
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      agentRunId: r.agent_run_id,
      traceId: r.trace_id,
      spanId: r.span_id,
      parentSpanId: r.parent_span_id,
      name: r.name,
      kind: r.kind,
      attributes: r.attributes,
      status: r.status,
      startedAt: new Date(`${r.started_at.replace(" ", "T")}Z`),
      durationMs: r.duration_ms,
    }));
  } catch (err) {
    if (err instanceof ClickHouseUnavailableError) throw err;
    throw new ClickHouseUnavailableError(err instanceof Error ? err.message : String(err));
  }
}

/** Test-only: closes the module-level client and clears the schema-ensured cache so
 * a test can reconnect cleanly against a fresh container. */
export async function _resetClickHouseForTests(): Promise<void> {
  if (client) await client.close().catch(() => {});
  client = undefined;
  schemaEnsured = undefined;
}
