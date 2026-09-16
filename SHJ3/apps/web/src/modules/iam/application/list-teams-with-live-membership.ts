/**
 * B9 tab 2's roster, with membership computed live on every call — never
 * cached, never duplicated.
 *
 * ## "Derived live", read straight from `team-repository.ts`'s own module comment
 *
 * B9 tab 2's wireframe: "Membership chips are derived live from the Users
 * tab — reassigning a user's team updates both tabs immediately." The port
 * this use case depends on offers no method that returns "team X with its
 * members baked in", by design (`TeamRepository`'s own module comment) — only
 * the raw `list()` and `listMemberships()`. This use case is the join, and it
 * is required to recompute `memberCount` / `memberDisplayNames` from
 * `listMemberships()`'s *current* return value on every call. There is no
 * cached or passed-through membership state anywhere below — that omission is
 * what makes staleness structurally impossible rather than a discipline this
 * file has to remember to uphold.
 *
 * ## Dangling `staffUserId`s are skipped, not thrown
 *
 * `TeamMembership.staffUserId` is not FK-enforced across the schema boundary
 * (that interface's own doc comment). A membership row whose staff user has
 * since been removed globally is a dangling cross-schema reference this use
 * case tolerates by omission, matching every other consumer of the identical
 * fact in this codebase. `memberCount` is derived from the same filtered list
 * as `memberDisplayNames` (i.e. a dangling row reduces both together) rather
 * than counting raw membership rows independently — the two numbers stay
 * consistent with what the roster actually renders.
 */

import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { Team, TeamRepository } from "../ports/team-repository.js";
import type { UserRepository } from "../ports/user-repository.js";

export interface TeamRosterRow {
  readonly team: Team;
  /** Recomputed from `TeamRepository.listMemberships()` on every call — never cached (see the module comment). */
  readonly memberCount: number;
  readonly memberDisplayNames: readonly string[];
}

export interface ListTeamsWithLiveMembershipInput {
  readonly tenant: TenantSlug;
}

export interface ListTeamsWithLiveMembershipResult {
  readonly rows: readonly TeamRosterRow[];
}

export interface ListTeamsWithLiveMembershipDeps {
  readonly teams: TeamRepository;
  readonly users: UserRepository;
}

export class ListTeamsWithLiveMembership {
  constructor(private readonly deps: ListTeamsWithLiveMembershipDeps) {}

  async execute(
    input: ListTeamsWithLiveMembershipInput,
  ): Promise<ListTeamsWithLiveMembershipResult> {
    const { teams, users } = this.deps;

    const [teamList, memberships, staffUsers] = await Promise.all([
      teams.list(),
      teams.listMemberships(),
      users.listForTenant(input.tenant),
    ]);

    const displayNameById = new Map(staffUsers.map((user) => [user.id, user.displayName]));

    const rows = teamList.map((team): TeamRosterRow => {
      const memberDisplayNames = memberships
        .filter((membership) => membership.teamId === team.id)
        .map((membership) => displayNameById.get(membership.staffUserId))
        .filter((name): name is string => name !== undefined);

      return { team, memberCount: memberDisplayNames.length, memberDisplayNames };
    });

    return { rows };
  }
}
