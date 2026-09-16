/**
 * Replace an agent version's bound flows — B3 step 6.
 *
 * Thin passthrough to `AgentBindingsRepository.replaceFlowBindings`, which already owns the
 * full-set-replace semantics (see `agent-bindings-repository.ts`'s own module comment).
 */

import type {
  AgentBindingsRepository,
  FlowBindingRow,
} from "../ports/agent-bindings-repository.js";

export interface ReplaceFlowBindingsInput {
  readonly agentVersionId: string;
  readonly bindings: readonly FlowBindingRow[];
  readonly now: Date;
}

export interface ReplaceFlowBindingsDeps {
  readonly bindings: AgentBindingsRepository;
}

export class ReplaceFlowBindings {
  constructor(private readonly deps: ReplaceFlowBindingsDeps) {}

  async execute(input: ReplaceFlowBindingsInput): Promise<void> {
    await this.deps.bindings.replaceFlowBindings(input.agentVersionId, input.bindings, input.now);
  }
}
