import type { TenantContext } from "@nextbot/db";
import { generateId } from "@nextbot/db";
import { insertAgentRunSpans, type AgentRunSpanRow } from "@nextbot/db/clickhouse";
import { startAgentRun, completeAgentRun, type AgentRunRow } from "@nextbot/agent-platform";
import { startSpan, endSpanOk, endSpanError, forwardSpanToTenantEndpoint } from "@nextbot/observability";
import { getEffectiveOtelExportEndpoint } from "@nextbot/telemetry-export";

/**
 * Phase 13 (BL-06) bridge: wires the turn pipeline into FR-AGT-09's `agent_run` write
 * path (`@nextbot/agent-platform`'s `startAgentRun`/`completeAgentRun`, which Phase 12
 * built but never called from here — see `turn-pipeline.ts`'s `TurnPipelineInput` doc)
 * plus per-stage `agent_run_span` rows (LLD §3.10) so the trace viewer has real data
 * to render. Kept in its own file (not inlined in `turn-pipeline.ts`) so the pipeline's
 * core control flow stays readable and this tracing concern stays independently
 * testable/mockable.
 */
export interface TurnRunHandle {
  run: AgentRunRow;
  /** The OTel span backing `run` — kept open until `endTurnRun` so its final status
   * reflects the whole turn's outcome, not just the first stage. */
  rootSpan: ReturnType<typeof startSpan>;
  /**
   * Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — the tenant's
   * configured OTLP endpoint, resolved ONCE per turn (not re-queried per child span,
   * which would add a DB round trip to every tool call) and cached on the handle.
   * `null` means export is disabled/unconfigured for this tenant — `recordTurnSpan`
   * skips forwarding entirely in that case, which is the overwhelmingly common case
   * (opt-in, defaults off).
   */
  otelExportEndpoint: string | null;
}

/** Opens the `agent_run` row (+ its OTel root span) for one turn. */
export async function startTurnRun(
  ctx: TenantContext,
  input: { agentDefinitionVersionId: string; trigger: string; conversationId?: string },
): Promise<TurnRunHandle> {
  const [{ run, span }, otelExportEndpoint] = await Promise.all([
    startAgentRun(ctx, {
      agentDefinitionVersionId: input.agentDefinitionVersionId,
      trigger: input.trigger,
      conversationId: input.conversationId,
    }),
    getEffectiveOtelExportEndpoint(ctx),
  ]);
  return { run, rootSpan: span, otelExportEndpoint };
}

/** Closes out the `agent_run` row and its OTel root span with the turn's final outcome. */
export async function endTurnRun(
  ctx: TenantContext,
  handle: TurnRunHandle,
  input: { status: "Succeeded" | "Failed"; tokensIn?: number; tokensOut?: number; costUsd?: string; durationMs: number },
): Promise<void> {
  await completeAgentRun(ctx, handle.run, handle.rootSpan, input);
}

/**
 * Records one child span for a single turn stage (goal/tool-selection reasoning =
 * `ModelCall`, tool dispatch = `ToolCall`) — both to the OTel SDK (Phase 10's
 * exporter) and directly into ClickHouse (this phase's bridge, see
 * `packages/db/src/clickhouse.ts`'s module doc for why). Never throws: a tracing
 * failure must not fail the customer-facing turn it's describing (`insertAgentRunSpans`
 * itself already fails safe; this function's own OTel calls are synchronous/local and
 * cannot throw in practice, but are still wrapped for defense in depth).
 */
export async function recordTurnSpan(
  ctx: TenantContext,
  handle: TurnRunHandle,
  input: {
    kind: AgentRunSpanRow["kind"];
    name: string;
    attributes: Record<string, string>;
    startedAt: Date;
    durationMs: number;
    status: "Ok" | "Error";
  },
): Promise<void> {
  try {
    const child = startSpan(input.name, { ...input.attributes, "nextbot.agent_run_id": handle.run.id });
    if (input.status === "Ok") endSpanOk(child);
    else endSpanError(child, `${input.name} did not complete successfully`);
  } catch (err) {
    console.error("NextBot: OTel child span emission failed (non-fatal)", err);
  }

  // Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — ADDITIVE tenant OTel
  // export: mirrors this same span to the tenant's own configured collector, if one
  // is configured and enabled. Never replaces the ClickHouse write below, and never
  // throws into the turn (`forwardSpanToTenantEndpoint` itself fails safe).
  if (handle.otelExportEndpoint) {
    forwardSpanToTenantEndpoint(handle.otelExportEndpoint, {
      name: input.name,
      attributes: { ...input.attributes, "nextbot.agent_run_id": handle.run.id },
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      status: input.status === "Ok" ? "Ok" : "Error",
    });
  }

  await insertAgentRunSpans(ctx, [
    {
      agentRunId: handle.run.id,
      traceId: handle.run.otelTraceId,
      spanId: generateId(),
      parentSpanId: handle.rootSpan.spanContext().spanId,
      name: input.name,
      kind: input.kind,
      attributes: input.attributes,
      status: input.status,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
    },
  ]);
}
