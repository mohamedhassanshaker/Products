import type { FlowRepository } from "../ports/flow-repository.js";

export interface DeleteFlowNodeDeps {
  readonly flows: FlowRepository;
}

export class DeleteFlowNode {
  constructor(private readonly deps: DeleteFlowNodeDeps) {}

  async execute(input: { readonly id: string; readonly flowVersionId: string }): Promise<void> {
    await this.deps.flows.deleteNode(input.id, input.flowVersionId);
  }
}
