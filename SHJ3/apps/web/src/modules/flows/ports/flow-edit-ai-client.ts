/**
 * The AI flow-editing sidebar's propose call — `POST /v1/flows/edit-proposals`
 * (`apps/ai`'s `flow_authoring_router.py`), mirroring `mcp-discovery-client.ts`'s "web
 * holds no vendor driver, calls the AI service's HTTP API" pattern exactly.
 *
 * `apps/ai` has no write access to `FlowNodes`/`FlowEdges` (`docs/data-model.md` §5's grant
 * table) and no authoring-shaped read of them either, so the caller sends the current
 * flow's own node/edge snapshot in the request body — it already holds this in memory from
 * the Flow Designer screen's own loaded state (`GetFlowCanvas`'s result). Nothing about this
 * call writes anything: it returns a proposed plan for a human to review, matching this
 * feature's one hard requirement (product owner, plan-mode clarification) — no operation
 * from this response is ever applied without an explicit staff approval, which happens
 * through the existing flow CRUD Server Actions, never through this port.
 *
 * `FlowEditOperation` is one flattened shape for all 8 kinds (`docs/api.md`'s equivalent for
 * this endpoint would document the same union) — only the fields a given `kind` actually
 * uses are ever non-null, matching `apps/ai`'s own `FlowEditOperationOut` wire shape field
 * for field so the two sides cannot silently drift.
 */

import type {
  FlowNodeHandoverReason,
  FlowNodeType,
  FlowRequiredAssuranceLevel,
  OptionSourceKind,
} from "../domain/flow-node.js";

export const FLOW_EDIT_OPERATION_KINDS = [
  "CreateNode",
  "UpdateNode",
  "DeleteNode",
  "CreateEdge",
  "UpdateEdge",
  "DeleteEdge",
  "SetEntryNode",
  "SetEscapeNode",
] as const;
export type FlowEditOperationKind = (typeof FLOW_EDIT_OPERATION_KINDS)[number];

/**
 * One flattened operation. `placeholderId` is set only on `CreateNode` (a locally-scoped id
 * `apps/ai` assigned, never trusted verbatim from the model — its own `_RefResolver`'s job);
 * every `*NodeId`/`*EdgeId` field the apply step consumes may itself be either a real id or
 * one of this same plan's own `placeholderId`s, resolved by `applyFlowEditPlanAction`'s
 * remap pass before anything is written.
 */
export interface FlowEditOperation {
  readonly kind: FlowEditOperationKind;
  readonly summary: string;
  readonly placeholderId: string | null;
  readonly nodeId: string | null;
  readonly edgeId: string | null;
  readonly fromNodeId: string | null;
  readonly toNodeId: string | null;
  readonly nodeType: FlowNodeType | null;
  readonly title: string | null;
  readonly messageText: string | null;
  readonly quickActionSetKey: string | null;
  readonly slotName: string | null;
  readonly optionSourceKind: OptionSourceKind | null;
  readonly optionSourceRef: string | null;
  readonly staticOptionsJson: string | null;
  readonly toolBindingId: string | null;
  readonly retryCount: number | null;
  readonly retryOnTimeout: boolean | null;
  readonly timeoutMs: number | null;
  readonly onFailureNodeId: string | null;
  readonly handoverReason: FlowNodeHandoverReason | null;
  readonly conditionExpression: string | null;
  readonly requiredAssurance: FlowRequiredAssuranceLevel | null;
  readonly label: string | null;
  readonly isDefaultBranch: boolean | null;
}

export interface FlowEditNodeSnapshot {
  readonly id: string;
  readonly type: FlowNodeType;
  readonly title: string;
  readonly messageText: string | null;
  readonly slotName: string | null;
  readonly optionSourceKind: OptionSourceKind | null;
  readonly toolBindingId: string | null;
  readonly handoverReason: FlowNodeHandoverReason | null;
  readonly conditionExpression: string | null;
}

export interface FlowEditEdgeSnapshot {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly label: string | null;
  readonly isDefaultBranch: boolean;
}

export interface FlowEditConversationTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface ProposeFlowEditInput {
  readonly instruction: string;
  readonly conversationHistory: readonly FlowEditConversationTurn[];
  readonly nodes: readonly FlowEditNodeSnapshot[];
  readonly edges: readonly FlowEditEdgeSnapshot[];
  /**
   * The tenant's `FlowAssistantConfig` (AI settings screen), resolved by the caller —
   * overrides `apps/ai`'s own `SHJ3_FLOW_EDIT_MODEL`/`_FALLBACK_MODEL_ENV_VAR` when
   * present. Optional so a caller with no configured tenant row still gets that env-var/
   * default behavior unchanged.
   */
  readonly model?: string;
  readonly fallbackModel?: string | null;
}

export interface ProposeFlowEditResult {
  readonly planSummary: string;
  readonly operations: readonly FlowEditOperation[];
  readonly warnings: readonly string[];
  readonly usedFallbackModel: boolean;
}

export interface FlowEditAiClient {
  proposeEdit(input: ProposeFlowEditInput): Promise<ProposeFlowEditResult>;
}
