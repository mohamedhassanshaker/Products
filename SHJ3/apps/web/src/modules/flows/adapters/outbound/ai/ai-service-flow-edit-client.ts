/**
 * The real `FlowEditAiClient` adapter — calls `apps/ai`'s `POST /v1/flows/edit-proposals`
 * (`flow_authoring_router.py`) via `createTenantScopedAiClient()`, following the same
 * "web holds no vendor driver" rule as `ai-service-mcp-discovery-client.ts`.
 *
 * The response is AI-generated JSON crossing a service boundary, so it is shape-checked
 * here rather than blind-cast — mirroring `ai-service-mcp-discovery-client.ts`'s own
 * `parseDescriptors` precedent — even though `apps/ai`'s own `parse_flow_edit_plan` already
 * validated it once; a second, independent check at the boundary this codebase actually
 * trusts is cheap and catches a contract drift between the two sides, not just a malformed
 * model reply.
 */

import { createTenantScopedAiClient } from "../../../../platform/adapters/outbound/ai-client.js";
import { FLOW_EDIT_OPERATION_KINDS } from "../../../ports/flow-edit-ai-client.js";
import type {
  FlowEditAiClient,
  FlowEditOperation,
  ProposeFlowEditInput,
  ProposeFlowEditResult,
} from "../../../ports/flow-edit-ai-client.js";

interface RawOperation {
  readonly kind?: unknown;
  readonly summary?: unknown;
  readonly placeholderId?: unknown;
  readonly nodeId?: unknown;
  readonly edgeId?: unknown;
  readonly fromNodeId?: unknown;
  readonly toNodeId?: unknown;
  readonly nodeType?: unknown;
  readonly title?: unknown;
  readonly messageText?: unknown;
  readonly quickActionSetKey?: unknown;
  readonly slotName?: unknown;
  readonly optionSourceKind?: unknown;
  readonly optionSourceRef?: unknown;
  readonly staticOptionsJson?: unknown;
  readonly toolBindingId?: unknown;
  readonly retryCount?: unknown;
  readonly retryOnTimeout?: unknown;
  readonly timeoutMs?: unknown;
  readonly onFailureNodeId?: unknown;
  readonly handoverReason?: unknown;
  readonly conditionExpression?: unknown;
  readonly requiredAssurance?: unknown;
  readonly label?: unknown;
  readonly isDefaultBranch?: unknown;
}

interface RawResponse {
  readonly planSummary?: unknown;
  readonly operations?: unknown;
  readonly warnings?: unknown;
  readonly usedFallbackModel?: unknown;
}

function stringOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : undefined;
}

function numberOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : undefined;
}

function booleanOrNull(value: unknown): boolean | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "boolean" ? value : undefined;
}

/** Returns `null` on any shape violation — this adapter drops a malformed plan to an empty one rather than let a bad boundary shape reach the sidebar UI as a crash. */
function parseOperation(raw: RawOperation): FlowEditOperation | null {
  if (
    typeof raw.kind !== "string" ||
    !(FLOW_EDIT_OPERATION_KINDS as readonly string[]).includes(raw.kind) ||
    typeof raw.summary !== "string"
  ) {
    return null;
  }

  const title = stringOrNull(raw.title);
  const messageText = stringOrNull(raw.messageText);
  const quickActionSetKey = stringOrNull(raw.quickActionSetKey);
  const slotName = stringOrNull(raw.slotName);
  const optionSourceRef = stringOrNull(raw.optionSourceRef);
  const staticOptionsJson = stringOrNull(raw.staticOptionsJson);
  const toolBindingId = stringOrNull(raw.toolBindingId);
  const onFailureNodeId = stringOrNull(raw.onFailureNodeId);
  const conditionExpression = stringOrNull(raw.conditionExpression);
  const label = stringOrNull(raw.label);
  const placeholderId = stringOrNull(raw.placeholderId);
  const nodeId = stringOrNull(raw.nodeId);
  const edgeId = stringOrNull(raw.edgeId);
  const fromNodeId = stringOrNull(raw.fromNodeId);
  const toNodeId = stringOrNull(raw.toNodeId);
  const nodeType = stringOrNull(raw.nodeType);
  const optionSourceKind = stringOrNull(raw.optionSourceKind);
  const handoverReason = stringOrNull(raw.handoverReason);
  const requiredAssurance = stringOrNull(raw.requiredAssurance);
  const retryCount = numberOrNull(raw.retryCount);
  const timeoutMs = numberOrNull(raw.timeoutMs);
  const retryOnTimeout = booleanOrNull(raw.retryOnTimeout);
  const isDefaultBranch = booleanOrNull(raw.isDefaultBranch);

  if (
    title === undefined ||
    messageText === undefined ||
    quickActionSetKey === undefined ||
    slotName === undefined ||
    optionSourceRef === undefined ||
    staticOptionsJson === undefined ||
    toolBindingId === undefined ||
    onFailureNodeId === undefined ||
    conditionExpression === undefined ||
    label === undefined ||
    placeholderId === undefined ||
    nodeId === undefined ||
    edgeId === undefined ||
    fromNodeId === undefined ||
    toNodeId === undefined ||
    nodeType === undefined ||
    optionSourceKind === undefined ||
    handoverReason === undefined ||
    requiredAssurance === undefined ||
    retryCount === undefined ||
    timeoutMs === undefined ||
    retryOnTimeout === undefined ||
    isDefaultBranch === undefined
  ) {
    return null;
  }

  return {
    kind: raw.kind as FlowEditOperation["kind"],
    summary: raw.summary,
    placeholderId,
    nodeId,
    edgeId,
    fromNodeId,
    toNodeId,
    nodeType: nodeType as FlowEditOperation["nodeType"],
    title,
    messageText,
    quickActionSetKey,
    slotName,
    optionSourceKind: optionSourceKind as FlowEditOperation["optionSourceKind"],
    optionSourceRef,
    staticOptionsJson,
    toolBindingId,
    retryCount,
    retryOnTimeout,
    timeoutMs,
    onFailureNodeId,
    handoverReason: handoverReason as FlowEditOperation["handoverReason"],
    conditionExpression,
    requiredAssurance: requiredAssurance as FlowEditOperation["requiredAssurance"],
    label,
    isDefaultBranch,
  };
}

function parseResponse(body: unknown): ProposeFlowEditResult | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as RawResponse;
  if (
    typeof raw.planSummary !== "string" ||
    !Array.isArray(raw.operations) ||
    !Array.isArray(raw.warnings) ||
    typeof raw.usedFallbackModel !== "boolean"
  ) {
    return null;
  }

  const operations: FlowEditOperation[] = [];
  for (const rawOp of raw.operations as readonly RawOperation[]) {
    const op = parseOperation(rawOp);
    // A single malformed operation invalidates the whole boundary contract — this is not
    // the same as `apps/ai`'s own per-operation "drop with a warning" (that already
    // happened server-side, inside `parse_flow_edit_plan`); a shape violation reaching
    // here means the two sides' wire contracts have drifted, which the caller should treat
    // as an unusable response, not silently truncate.
    if (op === null) return null;
    operations.push(op);
  }

  const warnings: string[] = [];
  for (const warning of raw.warnings) {
    if (typeof warning !== "string") return null;
    warnings.push(warning);
  }

  return {
    planSummary: raw.planSummary,
    operations,
    warnings,
    usedFallbackModel: raw.usedFallbackModel,
  };
}

export class AiServiceFlowEditClient implements FlowEditAiClient {
  async proposeEdit(input: ProposeFlowEditInput): Promise<ProposeFlowEditResult> {
    const client = createTenantScopedAiClient();
    const response = await client.post<unknown>("/flows/edit-proposals", { ...input });
    const parsed = parseResponse(response);
    if (parsed === null) {
      throw new Error(
        "The AI service responded, but not with the documented flow-edit-proposal shape.",
      );
    }
    return parsed;
  }
}
