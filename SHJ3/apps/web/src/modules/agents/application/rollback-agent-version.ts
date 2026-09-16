/**
 * Roll back to a prior version — B2's registry **Roll back** action.
 *
 * Straight passthrough: `AgentRepository.rollbackToVersion` owns the whole rule (refused
 * only when the target is already current — `domain/agent-lifecycle.ts`'s `canRollback`).
 * Distinct from environment promotion (B14): this changes *which version is current*, and
 * never moves a version between environments (`docs/SHJ3-wireframes-guide.md`'s B2 tab 2
 * rule).
 */

import type { AgentRepository } from "../ports/agent-repository.js";

export interface RollbackAgentVersionInput {
  readonly agentId: string;
  readonly targetVersionId: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type RollbackAgentVersionResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "agent.version_is_current" };

export interface RollbackAgentVersionDeps {
  readonly agents: AgentRepository;
}

export class RollbackAgentVersion {
  constructor(private readonly deps: RollbackAgentVersionDeps) {}

  async execute(input: RollbackAgentVersionInput): Promise<RollbackAgentVersionResult> {
    return this.deps.agents.rollbackToVersion(input);
  }
}
