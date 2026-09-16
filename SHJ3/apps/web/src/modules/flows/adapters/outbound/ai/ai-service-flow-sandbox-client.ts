/**
 * The real `FlowSandboxClient` adapter — calls `apps/ai`'s `POST /v1/sandbox/turns`
 * (`sandbox_router.py`) via `createTenantScopedAiClient()`, following the same "web holds no
 * vendor driver" rule as `ai-service-flow-edit-client.ts`/`ai-service-mcp-discovery-
 * client.ts`. The response is shape-checked here rather than blind-cast, matching
 * `ai-service-flow-edit-client.ts`'s own precedent for a boundary this codebase actually
 * trusts, not a second copy of whatever validation `apps/ai`'s own Pydantic model already did.
 */

import { createTenantScopedAiClient } from "../../../../platform/adapters/outbound/ai-client.js";
import type {
  FlowSandboxClient,
  SandboxFlowState,
  SandboxMessage,
  SandboxTrace,
  SandboxTraceStep,
  SandboxUsage,
  SendSandboxTurnInput,
  SendSandboxTurnResult,
} from "../../../ports/flow-sandbox-client.js";

function stringOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : undefined;
}

function numberOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : undefined;
}

function parseMessage(raw: unknown): SandboxMessage | null {
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

function parseFlowState(raw: unknown): SandboxFlowState | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return undefined;
  const r = raw as {
    flowVersionId?: unknown;
    nodeKey?: unknown;
    slots?: unknown;
    awaitingSlot?: unknown;
  };
  const flowVersionId = stringOrNull(r.flowVersionId);
  const nodeKey = stringOrNull(r.nodeKey);
  const awaitingSlot = stringOrNull(r.awaitingSlot);
  if (
    flowVersionId === undefined ||
    nodeKey === undefined ||
    awaitingSlot === undefined ||
    typeof r.slots !== "object" ||
    r.slots === null
  ) {
    return undefined;
  }
  const slots: Record<string, string> = {};
  for (const [key, value] of Object.entries(r.slots as Record<string, unknown>)) {
    if (typeof value !== "string") return undefined;
    slots[key] = value;
  }
  return { flowVersionId, nodeKey, slots, awaitingSlot };
}

function parseTraceStep(raw: unknown): SandboxTraceStep | null {
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
  };
  const agentId = stringOrNull(r.agentId);
  const toolBindingId = stringOrNull(r.toolBindingId);
  const errorCode = stringOrNull(r.errorCode);
  const confidence = numberOrNull(r.confidence);
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
    confidence === undefined
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
  };
}

function parseTrace(raw: unknown): SandboxTrace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as {
    traceId?: unknown;
    mode?: unknown;
    hops?: unknown;
    degraded?: unknown;
    escapeTriggered?: unknown;
    usedFallbackModel?: unknown;
  };
  if (
    typeof r.traceId !== "string" ||
    typeof r.mode !== "string" ||
    !Array.isArray(r.hops) ||
    !Array.isArray(r.degraded) ||
    typeof r.escapeTriggered !== "boolean" ||
    typeof r.usedFallbackModel !== "boolean"
  ) {
    return null;
  }
  const hops: SandboxTraceStep[] = [];
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
  };
}

function parseUsage(raw: unknown): SandboxUsage | null {
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

function parseResponse(body: unknown): SendSandboxTurnResult | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as {
    turnId?: unknown;
    conversationId?: unknown;
    status?: unknown;
    message?: unknown;
    flowState?: unknown;
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
  const flowState = parseFlowState(r.flowState);
  const trace = parseTrace(r.trace);
  const usage = parseUsage(r.usage);
  if (message === null || flowState === undefined || trace === null || usage === null) {
    return null;
  }

  return {
    turnId: r.turnId,
    conversationId: r.conversationId,
    status: r.status,
    message,
    flowState,
    trace,
    usage,
    groundingConfidence,
  };
}

export class AiServiceFlowSandboxClient implements FlowSandboxClient {
  async sendSandboxTurn(input: SendSandboxTurnInput): Promise<SendSandboxTurnResult> {
    const client = createTenantScopedAiClient();
    const response = await client.post<unknown>("/sandbox/turns", { ...input });
    const parsed = parseResponse(response);
    if (parsed === null) {
      throw new Error(
        "The AI service responded, but not with the documented sandbox-turn response shape.",
      );
    }
    return parsed;
  }
}
