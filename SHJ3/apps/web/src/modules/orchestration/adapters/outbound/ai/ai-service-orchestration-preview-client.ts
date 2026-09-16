/**
 * The real `OrchestrationPreviewClient` adapter — calls `apps/ai`'s
 * `POST /v1/orchestration/trace-preview` via `createTenantScopedAiClient()`, following the
 * same "web holds no vendor driver" rule as `ai-service-flow-sandbox-client.ts`. The
 * response is shape-checked here rather than blind-cast, matching that adapter's own
 * precedent — the near-identical parsing logic below is a deliberate structural copy of
 * `ai-service-flow-sandbox-client.ts`'s own (same underlying Python `TurnEnvelopeOut`
 * shape, minus the `flowState` field this feature has no use for), not imported across
 * the `flows`/`orchestration` module boundary.
 */

import { createTenantScopedAiClient } from "../../../../platform/adapters/outbound/ai-client.js";
import type {
  OrchestrationPreviewClient,
  PreviewMessage,
  PreviewTrace,
  PreviewTraceInput,
  PreviewTraceResult,
  PreviewTraceStep,
  PreviewUsage,
} from "../../../ports/orchestration-preview-client.js";

function stringOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : undefined;
}

function numberOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : undefined;
}

function parseMessage(raw: unknown): PreviewMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { role?: unknown; content?: unknown; suggestions?: unknown };
  if (typeof r.role !== "string" || typeof r.content !== "string" || !Array.isArray(r.suggestions)) {
    return null;
  }
  const suggestions: string[] = [];
  for (const s of r.suggestions) {
    if (typeof s !== "string") return null;
    suggestions.push(s);
  }
  return { role: r.role, content: r.content, suggestions };
}

function parseTraceStep(raw: unknown): PreviewTraceStep | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as {
    ordinal?: unknown;
    kind?: unknown;
    label?: unknown;
    status?: unknown;
    durationMs?: unknown;
    agentId?: unknown;
    toolBindingId?: unknown;
    confidence?: unknown;
    errorCode?: unknown;
    isSecondaryAgent?: unknown;
    pipelineNodeKey?: unknown;
    fromNodeKey?: unknown;
    edgeKind?: unknown;
    branchId?: unknown;
    loopIteration?: unknown;
    depth?: unknown;
  };
  const agentId = stringOrNull(r.agentId);
  const toolBindingId = stringOrNull(r.toolBindingId);
  const errorCode = stringOrNull(r.errorCode);
  const confidence = numberOrNull(r.confidence);
  const pipelineNodeKey = stringOrNull(r.pipelineNodeKey);
  const fromNodeKey = stringOrNull(r.fromNodeKey);
  const edgeKind = stringOrNull(r.edgeKind);
  const branchId = stringOrNull(r.branchId);
  const loopIteration = numberOrNull(r.loopIteration);
  const depth = numberOrNull(r.depth);
  if (
    typeof r.ordinal !== "number" ||
    typeof r.kind !== "string" ||
    typeof r.label !== "string" ||
    typeof r.status !== "string" ||
    typeof r.durationMs !== "number" ||
    typeof r.isSecondaryAgent !== "boolean" ||
    agentId === undefined ||
    toolBindingId === undefined ||
    errorCode === undefined ||
    confidence === undefined ||
    pipelineNodeKey === undefined ||
    fromNodeKey === undefined ||
    edgeKind === undefined ||
    branchId === undefined ||
    loopIteration === undefined ||
    depth === undefined
  ) {
    return null;
  }
  return {
    ordinal: r.ordinal,
    kind: r.kind,
    label: r.label,
    status: r.status,
    durationMs: r.durationMs,
    agentId,
    toolBindingId,
    confidence,
    errorCode,
    isSecondaryAgent: r.isSecondaryAgent,
    pipelineNodeKey,
    fromNodeKey,
    edgeKind,
    branchId,
    loopIteration,
    depth,
  };
}

function parseTrace(raw: unknown): PreviewTrace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as {
    traceId?: unknown;
    mode?: unknown;
    hops?: unknown;
    degraded?: unknown;
    escapeTriggered?: unknown;
    usedFallbackModel?: unknown;
    pipelineVersionId?: unknown;
    pipelineLabel?: unknown;
    terminalNodeKey?: unknown;
  };
  const pipelineVersionId = stringOrNull(r.pipelineVersionId);
  const pipelineLabel = stringOrNull(r.pipelineLabel);
  const terminalNodeKey = stringOrNull(r.terminalNodeKey);
  if (
    typeof r.traceId !== "string" ||
    typeof r.mode !== "string" ||
    !Array.isArray(r.hops) ||
    !Array.isArray(r.degraded) ||
    typeof r.escapeTriggered !== "boolean" ||
    typeof r.usedFallbackModel !== "boolean" ||
    pipelineVersionId === undefined ||
    pipelineLabel === undefined ||
    terminalNodeKey === undefined
  ) {
    return null;
  }
  const hops: PreviewTraceStep[] = [];
  for (const rawHop of r.hops) {
    const hop = parseTraceStep(rawHop);
    if (hop === null) return null;
    hops.push(hop);
  }
  const degraded: string[] = [];
  for (const d of r.degraded) {
    if (typeof d !== "string") return null;
    degraded.push(d);
  }
  return {
    traceId: r.traceId,
    mode: r.mode,
    hops,
    degraded,
    escapeTriggered: r.escapeTriggered,
    usedFallbackModel: r.usedFallbackModel,
    pipelineVersionId,
    pipelineLabel,
    terminalNodeKey,
  };
}

function parseUsage(raw: unknown): PreviewUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as {
    tokensIn?: unknown;
    tokensOut?: unknown;
    costAed?: unknown;
    modelCalls?: unknown;
    toolCalls?: unknown;
  };
  if (
    typeof r.tokensIn !== "number" ||
    typeof r.tokensOut !== "number" ||
    typeof r.costAed !== "number" ||
    typeof r.modelCalls !== "number" ||
    typeof r.toolCalls !== "number"
  ) {
    return null;
  }
  return {
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costAed: r.costAed,
    modelCalls: r.modelCalls,
    toolCalls: r.toolCalls,
  };
}

function parseResponse(body: unknown): PreviewTraceResult | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as {
    turnId?: unknown;
    conversationId?: unknown;
    status?: unknown;
    message?: unknown;
    trace?: unknown;
    usage?: unknown;
    groundingConfidence?: unknown;
  };

  const groundingConfidence = numberOrNull(r.groundingConfidence);
  if (
    typeof r.turnId !== "string" ||
    typeof r.conversationId !== "string" ||
    typeof r.status !== "string" ||
    groundingConfidence === undefined
  ) {
    return null;
  }

  const message = parseMessage(r.message);
  const trace = parseTrace(r.trace);
  const usage = parseUsage(r.usage);
  if (message === null || trace === null || usage === null) {
    return null;
  }

  return {
    turnId: r.turnId,
    conversationId: r.conversationId,
    status: r.status,
    message,
    trace,
    usage,
    groundingConfidence,
  };
}

export class AiServiceOrchestrationPreviewClient implements OrchestrationPreviewClient {
  async previewTrace(input: PreviewTraceInput): Promise<PreviewTraceResult> {
    const client = createTenantScopedAiClient();
    const response = await client.post<unknown>("/orchestration/trace-preview", { ...input });
    const parsed = parseResponse(response);
    if (parsed === null) {
      throw new Error(
        "The AI service responded, but not with the documented trace-preview response shape.",
      );
    }
    return parsed;
  }
}
