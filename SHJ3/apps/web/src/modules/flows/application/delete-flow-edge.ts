import type { FlowRepository } from "../ports/flow-repository.js";

export interface DeleteFlowEdgeDeps {
  readonly flows: FlowRepository;
}

export class DeleteFlowEdge {
  constructor(private readonly deps: DeleteFlowEdgeDeps) {}

  async execute(input: { readonly id: string; readonly flowVersionId: string }): Promise<void> {
    await this.deps.flows.deleteEdge(input.id, input.flowVersionId);
  }
}
