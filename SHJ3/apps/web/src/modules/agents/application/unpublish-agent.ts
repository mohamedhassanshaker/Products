/**
 * Unpublish an agent — B2's registry **Unpublish** action.
 *
 * Straight passthrough: `AgentRepository.unpublishAgent` owns the whole rule (`Agent.status`
 * only, never the version row — `domain/version.ts`'s module comment explains why a
 * Published `AgentVersion` never leaves that status even when its agent is unpublished).
 */

import type { AgentRepository } from "../ports/agent-repository.js";

export interface UnpublishAgentInput {
  readonly agentId: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type UnpublishAgentResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "agent.not_published" };

export interface UnpublishAgentDeps {
  readonly agents: AgentRepository;
}

export class UnpublishAgent {
  constructor(private readonly deps: UnpublishAgentDeps) {}

  async execute(input: UnpublishAgentInput): Promise<UnpublishAgentResult> {
    return this.deps.agents.unpublishAgent(input);
  }
}
