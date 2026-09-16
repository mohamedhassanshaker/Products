/**
 * Clone an agent — B2's registry **Clone** action.
 *
 * Thin by design: `AgentRepository.cloneAgent` already owns the entire deep-copy
 * transaction (scalar config, the four per-version binding tables, and — the one
 * documented cross-module exception — `ToolBindings`; see that port method's and its real
 * adapter's own doc comments for exactly how). This use case does not need to know any of
 * that to call it.
 */

import type { AgentRepository } from "../ports/agent-repository.js";

export interface CloneAgentInput {
  readonly sourceAgentId: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export interface CloneAgentResult {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly sourceLabel: string;
}

export interface CloneAgentDeps {
  readonly agents: AgentRepository;
}

export class CloneAgent {
  constructor(private readonly deps: CloneAgentDeps) {}

  async execute(input: CloneAgentInput): Promise<CloneAgentResult> {
    return this.deps.agents.cloneAgent(input);
  }
}
