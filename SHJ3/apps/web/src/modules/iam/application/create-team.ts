/**
 * Create a team — B9 tab 2's **+ Add team**.
 *
 * Thin by design: `TeamRepository.create` owns the actual write, and the one
 * business rule that could apply to a new team — restricting `AllEntities`
 * scope — is enforced by `TR_Teams_crossEntityScope` at the database layer
 * (per that trigger's own name), not duplicated here. A second,
 * application-layer copy of a database trigger's rule would be a second place
 * that rule could drift out of sync with the one the database actually
 * enforces.
 */

import type { NewTeam, Team, TeamRepository, TeamScope } from "../ports/team-repository.js";

export interface CreateTeamInput {
  readonly name: string;
  readonly scope: TeamScope;
  readonly description?: string;
  readonly createdByStaffUserId: string;
}

export interface CreateTeamResult {
  readonly team: Team;
}

export interface CreateTeamDeps {
  readonly teams: TeamRepository;
}

export class CreateTeam {
  constructor(private readonly deps: CreateTeamDeps) {}

  async execute(input: CreateTeamInput): Promise<CreateTeamResult> {
    const newTeam: NewTeam = {
      name: input.name,
      scope: input.scope,
      createdByStaffUserId: input.createdByStaffUserId,
      ...(input.description === undefined ? {} : { description: input.description }),
    };
    const team = await this.deps.teams.create(newTeam);
    return { team };
  }
}
