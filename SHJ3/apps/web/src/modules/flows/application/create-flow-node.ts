/**
 * Creates a `FlowNode`. Validates every `CK_FlowNodes_*` completeness rule
 * (`domain/flow-node.ts`) BEFORE issuing the insert, so an incomplete node (e.g. a ToolCall
 * with no failure path) comes back as a clean, field-attributed `{ok:false}` rather than a
 * raw SQL Server constraint-violation message — the real constraint remains the backstop for
 * anything this pre-check does not catch (`tasks/lessons.md`: never trust only the
 * application-layer check).
 */

import { validateFlowNodeFields, type FlowNodeFields } from "../domain/flow-node.js";
import type { FlowNodeRow, FlowRepository } from "../ports/flow-repository.js";

export interface CreateFlowNodeInput extends FlowNodeFields {
  readonly flowVersionId: string;
  readonly now: Date;
}

export interface CreateFlowNodeDeps {
  readonly flows: FlowRepository;
}

export type CreateFlowNodeResult =
  | { readonly ok: true; readonly node: FlowNodeRow }
  | {
      readonly ok: false;
      readonly reason: "flows.invalid_node";
      readonly errors: readonly string[];
    };

export class CreateFlowNode {
  constructor(private readonly deps: CreateFlowNodeDeps) {}

  async execute(input: CreateFlowNodeInput): Promise<CreateFlowNodeResult> {
    const errors = validateFlowNodeFields(input);
    if (errors.length > 0) {
      return { ok: false, reason: "flows.invalid_node", errors };
    }
    const node = await this.deps.flows.createNode(input);
    return { ok: true, node };
  }
}
