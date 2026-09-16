/**
 * Designates a version's escape node — B7's core guarantee made unrepresentable-to-violate
 * (`CK_FlowVersions_publishedHasEscape`): a version cannot be published without one. This use
 * case only sets the pointer; the constraint itself is what actually blocks an incomplete
 * publish, exactly the way the schema's own doc comment describes ("a guarantee enforced by
 * UI validation is a guarantee that survives until someone writes a flow through an API or a
 * seed script").
 */

import type { FlowRepository } from "../ports/flow-repository.js";

export interface SetEscapeNodeDeps {
  readonly flows: FlowRepository;
}

export class SetEscapeNode {
  constructor(private readonly deps: SetEscapeNodeDeps) {}

  async execute(input: {
    readonly flowVersionId: string;
    readonly nodeId: string;
    readonly now: Date;
  }): Promise<void> {
    await this.deps.flows.setEscapeNode(input.flowVersionId, input.nodeId, input.now);
  }
}
