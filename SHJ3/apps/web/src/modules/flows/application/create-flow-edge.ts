import { validateFlowEdgeFields, type FlowEdgeFields } from "../domain/flow-edge.js";
import type { FlowEdgeRow, FlowRepository } from "../ports/flow-repository.js";

export interface CreateFlowEdgeInput extends FlowEdgeFields {
  readonly flowVersionId: string;
  readonly now: Date;
}

export interface CreateFlowEdgeDeps {
  readonly flows: FlowRepository;
}

export type CreateFlowEdgeResult =
  | { readonly ok: true; readonly edge: FlowEdgeRow }
  | {
      readonly ok: false;
      readonly reason: "flows.invalid_edge";
      readonly errors: readonly string[];
    }
  | { readonly ok: false; readonly reason: "flows.endpoint_wrong_version" };

export class CreateFlowEdge {
  constructor(private readonly deps: CreateFlowEdgeDeps) {}

  async execute(input: CreateFlowEdgeInput): Promise<CreateFlowEdgeResult> {
    const errors = validateFlowEdgeFields(input);
    if (errors.length > 0) {
      return { ok: false, reason: "flows.invalid_edge", errors };
    }
    const result = await this.deps.flows.createEdge(input);
    if (!result.ok) return result;
    return { ok: true, edge: result.edge };
  }
}
