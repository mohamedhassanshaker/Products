/**
 * Replace an agent version's channel bindings — B3 step 8.
 *
 * Thin passthrough to `AgentBindingsRepository.replaceChannelBindings`, which already owns
 * the full-set-replace semantics (see `agent-bindings-repository.ts`'s own module comment).
 * Feeds B2's registry Channels column, via `AgentRepository.listForRegistry`, once this
 * version becomes current.
 */

import type {
  AgentBindingsRepository,
  ChannelBindingRow,
} from "../ports/agent-bindings-repository.js";

export interface ReplaceChannelBindingsInput {
  readonly agentVersionId: string;
  readonly bindings: readonly ChannelBindingRow[];
  readonly now: Date;
}

export interface ReplaceChannelBindingsDeps {
  readonly bindings: AgentBindingsRepository;
}

export class ReplaceChannelBindings {
  constructor(private readonly deps: ReplaceChannelBindingsDeps) {}

  async execute(input: ReplaceChannelBindingsInput): Promise<void> {
    await this.deps.bindings.replaceChannelBindings(
      input.agentVersionId,
      input.bindings,
      input.now,
    );
  }
}
