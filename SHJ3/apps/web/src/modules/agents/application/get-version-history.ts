/**
 * B2 tab 2's two version-facing reads: the append-only history log, and the plain list of
 * versions with their own `changeSummary` (the "v1.4 Added du/Etisalat lookup tool · v1.3
 * ..." row that `docs/SHJ3-wireframes-guide.md`'s B2 tab 2 actually renders). Two small
 * classes in one file rather than two files: both are one-line passthroughs to the same
 * `AgentRepository`, and neither has enough of its own reasoning to justify a doc comment
 * bigger than the code.
 */

import type {
  AgentRepository,
  AgentVersionHistoryEntryRow,
  AgentVersionSummary,
} from "../ports/agent-repository.js";

export interface GetVersionHistoryInput {
  readonly agentId: string;
}

export interface GetVersionHistoryResult {
  readonly entries: readonly AgentVersionHistoryEntryRow[];
}

export interface GetVersionHistoryDeps {
  readonly agents: AgentRepository;
}

/** The append-only, kind-tagged history log (`Created`/`Cloned`/`Published`/`Unpublished`/`RolledBack`/`Promoted`/`Archived`). */
export class GetVersionHistory {
  constructor(private readonly deps: GetVersionHistoryDeps) {}

  async execute(input: GetVersionHistoryInput): Promise<GetVersionHistoryResult> {
    const entries = await this.deps.agents.listVersionHistory(input.agentId);
    return { entries };
  }
}

export interface ListAgentVersionsInput {
  readonly agentId: string;
}

export interface ListAgentVersionsResult {
  readonly versions: readonly AgentVersionSummary[];
}

export interface ListAgentVersionsDeps {
  readonly agents: AgentRepository;
}

/** Every version of one agent, each with its own `changeSummary` — newest first. */
export class ListAgentVersions {
  constructor(private readonly deps: ListAgentVersionsDeps) {}

  async execute(input: ListAgentVersionsInput): Promise<ListAgentVersionsResult> {
    const versions = await this.deps.agents.listVersions(input.agentId);
    return { versions };
  }
}
