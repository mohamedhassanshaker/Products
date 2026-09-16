/**
 * List agents for the registry — B2's own table, with its status/search filters.
 *
 * Straight passthrough to `AgentRepository.listForRegistry`, which already owns the join
 * against the current version's label, enabled channels, and latest usage (that port
 * method's own doc comment).
 */

import type { AgentStatus } from "../domain/agent.js";
import type { AgentRegistryRow, AgentRepository } from "../ports/agent-repository.js";

export interface ListAgentsInput {
  readonly status?: AgentStatus;
  readonly q?: string;
}

export interface ListAgentsResult {
  readonly rows: readonly AgentRegistryRow[];
}

export interface ListAgentsDeps {
  readonly agents: AgentRepository;
}

export class ListAgents {
  constructor(private readonly deps: ListAgentsDeps) {}

  async execute(input: ListAgentsInput = {}): Promise<ListAgentsResult> {
    const rows = await this.deps.agents.listForRegistry({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.q !== undefined ? { q: input.q } : {}),
    });
    return { rows };
  }
}
