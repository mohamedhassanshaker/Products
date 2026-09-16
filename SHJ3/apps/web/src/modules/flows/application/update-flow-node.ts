/**
 * Updates a `FlowNode`'s fields. Re-validates the *merged* (existing + patch) field set
 * against every `CK_FlowNodes_*` rule before writing — a patch that looks fine in isolation
 * (e.g. clearing `onFailureNodeId`) can still leave the merged row incomplete for its type.
 */

import { validateFlowNodeFields, type FlowNodeFields } from "../domain/flow-node.js";
import type {
  FlowNodeRow,
  FlowRepository,
  UpdateFlowNodeInput as RepoUpdateFlowNodeInput,
} from "../ports/flow-repository.js";

export type UpdateFlowNodeInput = RepoUpdateFlowNodeInput;

export interface UpdateFlowNodeDeps {
  readonly flows: FlowRepository;
}

export type UpdateFlowNodeResult =
  | { readonly ok: true; readonly node: FlowNodeRow }
  | { readonly ok: false; readonly reason: "flows.node_not_found" }
  | {
      readonly ok: false;
      readonly reason: "flows.invalid_node";
      readonly errors: readonly string[];
    };

export class UpdateFlowNode {
  constructor(private readonly deps: UpdateFlowNodeDeps) {}

  async execute(input: UpdateFlowNodeInput): Promise<UpdateFlowNodeResult> {
    const existing = await this.deps.flows.getNode(input.id);
    if (!existing) return { ok: false, reason: "flows.node_not_found" };

    const merged: FlowNodeFields = {
      type: existing.type,
      title: input.title ?? existing.title,
      canvasX: input.canvasX ?? existing.canvasX,
      canvasY: input.canvasY ?? existing.canvasY,
      messageText: input.messageText !== undefined ? input.messageText : existing.messageText,
      quickActionSetKey:
        input.quickActionSetKey !== undefined
          ? input.quickActionSetKey
          : existing.quickActionSetKey,
      slotName: input.slotName !== undefined ? input.slotName : existing.slotName,
      optionSourceKind:
        input.optionSourceKind !== undefined ? input.optionSourceKind : existing.optionSourceKind,
      optionSourceRef:
        input.optionSourceRef !== undefined ? input.optionSourceRef : existing.optionSourceRef,
      staticOptionsJson:
        input.staticOptionsJson !== undefined
          ? input.staticOptionsJson
          : existing.staticOptionsJson,
      toolBindingId:
        input.toolBindingId !== undefined ? input.toolBindingId : existing.toolBindingId,
      retryCount: input.retryCount !== undefined ? input.retryCount : existing.retryCount,
      retryOnTimeout:
        input.retryOnTimeout !== undefined ? input.retryOnTimeout : existing.retryOnTimeout,
      timeoutMs: input.timeoutMs !== undefined ? input.timeoutMs : existing.timeoutMs,
      onFailureNodeId:
        input.onFailureNodeId !== undefined ? input.onFailureNodeId : existing.onFailureNodeId,
      handoverReason:
        input.handoverReason !== undefined ? input.handoverReason : existing.handoverReason,
      confidenceThreshold:
        input.confidenceThreshold !== undefined
          ? input.confidenceThreshold
          : existing.confidenceThreshold,
      conditionExpression:
        input.conditionExpression !== undefined
          ? input.conditionExpression
          : existing.conditionExpression,
      requiredAssurance:
        input.requiredAssurance !== undefined
          ? input.requiredAssurance
          : existing.requiredAssurance,
    };

    const errors = validateFlowNodeFields(merged);
    if (errors.length > 0) {
      return { ok: false, reason: "flows.invalid_node", errors };
    }

    const node = await this.deps.flows.updateNode(input);
    return { ok: true, node };
  }
}
