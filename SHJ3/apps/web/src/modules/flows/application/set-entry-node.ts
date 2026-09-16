/** Designates a version's entry node — one of the two prerequisites (`CK_FlowVersions_publishedHasEntry`) a version needs before it could ever be published. */

import type { FlowRepository } from "../ports/flow-repository.js";

export interface SetEntryNodeDeps {
  readonly flows: FlowRepository;
}

export class SetEntryNode {
  constructor(private readonly deps: SetEntryNodeDeps) {}

  async execute(input: {
    readonly flowVersionId: string;
    readonly nodeId: string;
    readonly now: Date;
  }): Promise<void> {
    await this.deps.flows.setEntryNode(input.flowVersionId, input.nodeId, input.now);
  }
}
