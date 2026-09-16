/**
 * Archive an agent — B2's registry **Archive** action.
 *
 * Straight passthrough: `AgentRepository.archiveAgent` already checks the live-channel
 * binding internally (`domain/agent-lifecycle.ts`'s `canArchive` — "archiving a live
 * assistant must be a deliberate two-step", per `docs/api.md` §6.3) before writing anything,
 * so this use case does not need to call `isBoundToLiveChannel` itself first.
 */

import type { AgentRepository } from "../ports/agent-repository.js";

export interface ArchiveAgentInput {
  readonly agentId: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type ArchiveAgentResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "agent.bound_to_live_channel" };

export interface ArchiveAgentDeps {
  readonly agents: AgentRepository;
}

export class ArchiveAgent {
  constructor(private readonly deps: ArchiveAgentDeps) {}

  async execute(input: ArchiveAgentInput): Promise<ArchiveAgentResult> {
    return this.deps.agents.archiveAgent(input);
  }
}
