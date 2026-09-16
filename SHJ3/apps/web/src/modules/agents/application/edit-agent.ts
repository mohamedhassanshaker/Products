/**
 * Edit an agent's registry-level fields — B2's registry edit affordance for name/description.
 *
 * Straight passthrough to `AgentRepository.editAgent`. Deliberately has no `ownerTenantId`
 * field: which tenant owns an agent is fixed at creation and never editable afterward
 * (schema-per-tenant multi-tenancy means an agent's rows physically live in its owning
 * tenant's schema — "moving" one would mean copying every row across a schema boundary, not
 * an ordinary field edit), so the port this calls through does not expose one either.
 */

import type { AgentRepository } from "../ports/agent-repository.js";

export interface EditAgentInput {
  readonly agentId: string;
  readonly name?: string;
  readonly description?: string | null;
}

export interface EditAgentDeps {
  readonly agents: AgentRepository;
}

export class EditAgent {
  constructor(private readonly deps: EditAgentDeps) {}

  async execute(input: EditAgentInput): Promise<void> {
    await this.deps.agents.editAgent({
      agentId: input.agentId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
  }
}
