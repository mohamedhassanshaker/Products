/**
 * Get one agent plus its current version — B2's registry row detail / B3 wizard entry
 * point.
 *
 * `AgentDetail.currentVersionId` is `string | null` in the port only because a
 * freshly-inserted row is briefly null mid-transaction (`AgentRepository.createAgent`'s own
 * doc comment: the FK cycle between `Agent` and `AgentVersion` forces a two-step insert) —
 * by the time any caller can observe the row, it is always set. A `null` here is therefore
 * data corruption, not a legitimate state to return quietly, hence the throw rather than a
 * partial result.
 */

import type {
  AgentDetail,
  AgentRepository,
  AgentVersionDetail,
} from "../ports/agent-repository.js";

export interface GetAgentInput {
  readonly agentId: string;
}

export interface GetAgentResult {
  readonly agent: AgentDetail;
  readonly currentVersion: AgentVersionDetail;
}

export interface GetAgentDeps {
  readonly agents: AgentRepository;
}

export class GetAgent {
  constructor(private readonly deps: GetAgentDeps) {}

  async execute(input: GetAgentInput): Promise<GetAgentResult | null> {
    const agent = await this.deps.agents.getAgentDetail(input.agentId);
    if (!agent) return null;

    if (!agent.currentVersionId) {
      throw new Error(
        `Agent "${agent.id}" has no current version — a well-formed Agent row always has one.`,
      );
    }
    const currentVersion = await this.deps.agents.getVersion(agent.currentVersionId);
    if (!currentVersion) {
      throw new Error(
        `Agent "${agent.id}" points at current version "${agent.currentVersionId}", which does not exist.`,
      );
    }

    return { agent, currentVersion };
  }
}
