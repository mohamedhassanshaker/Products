/**
 * Create a brand-new agent — B2's registry **+ New agent** action.
 *
 * Thin by design, mirroring `iam`'s `create-custom-role.ts`: `AgentRepository.createAgent`
 * already owns the entire transaction (the `Agents` row, its v0.1 Draft `AgentVersions` row,
 * wiring `currentVersionId`, and the `'Created'` history entry — see that port method's own
 * doc comment). Reimplementing any part of that here would create a second place that has to
 * agree with the adapter's own transaction shape.
 */

import type { AgentRepository } from "../ports/agent-repository.js";

export interface CreateAgentInput {
  readonly name: string;
  readonly description: string | null;
  readonly ownerTenantId: string;
  readonly createdByStaffUserId: string;
  readonly now: Date;
}

export interface CreateAgentResult {
  readonly agentId: string;
  readonly agentVersionId: string;
}

export interface CreateAgentDeps {
  readonly agents: AgentRepository;
}

export class CreateAgent {
  constructor(private readonly deps: CreateAgentDeps) {}

  async execute(input: CreateAgentInput): Promise<CreateAgentResult> {
    return this.deps.agents.createAgent(input);
  }
}
