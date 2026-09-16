/**
 * Replace an agent version's bound knowledge collections — B3 step 5.
 *
 * Thin passthrough to `AgentBindingsRepository.replaceKnowledgeBindings`, which already owns
 * the full-set-replace semantics ("Body is the full set... so the toggles cannot drift",
 * `docs/api.md`, quoted in that port's own module comment).
 */

import type {
  AgentBindingsRepository,
  KnowledgeBindingRow,
} from "../ports/agent-bindings-repository.js";

export interface ReplaceKnowledgeBindingsInput {
  readonly agentVersionId: string;
  readonly bindings: readonly KnowledgeBindingRow[];
  readonly boundByStaffUserId: string;
  readonly now: Date;
}

export interface ReplaceKnowledgeBindingsDeps {
  readonly bindings: AgentBindingsRepository;
}

export class ReplaceKnowledgeBindings {
  constructor(private readonly deps: ReplaceKnowledgeBindingsDeps) {}

  async execute(input: ReplaceKnowledgeBindingsInput): Promise<void> {
    await this.deps.bindings.replaceKnowledgeBindings(
      input.agentVersionId,
      input.bindings,
      input.boundByStaffUserId,
      input.now,
    );
  }
}
