/**
 * B9 tab 1's roster — Name / Email / Team / Role / Status — joined in the
 * application layer from three ports that each own one slice of the row.
 *
 * ## Why the join lives here, not in a port
 *
 * `UserRepository`, `TeamRepository` and `RoleRepository` are three different
 * tables, none of which knows about the other two (`team-repository.ts`'s own
 * module comment makes the identical point about "derived live" team
 * rosters). A fourth port method that pre-joined them would either duplicate
 * what these three already expose, or become the one place a caller could get
 * a stale join if any of the three tables changed independently. Joining here
 * keeps every input reading straight from its own port on every call.
 *
 * ## The N+1, acknowledged rather than hidden
 *
 * `rolesFor` is called once per roster row because `UserRepository` has no
 * bulk "roles for these N users" method, and B9's own roster scale (a
 * government entity's staff, not a citizen-facing list) does not justify
 * adding one speculatively. The calls run concurrently (`Promise.all`) rather
 * than in a serial loop, which is the cheap half of "acceptable" — do not
 * "fix" this by adding a bulk method to `UserRepository`; that port is frozen
 * for this wave.
 *
 * ## Ordering
 *
 * `UserRepository.listForTenant`'s own doc comment already promises "ordered
 * by display name" — a port *contract*, not an adapter's incidental query
 * order — so this use case trusts it rather than re-sorting a second time.
 *
 * ## Unmapped role keys
 *
 * A role key assigned to a user whose `Role` row no longer exists (deleted
 * after assignment) is dropped from `roleDisplayNames` rather than surfaced
 * as `undefined` or thrown — the same "absence reduces access, never
 * escalates or crashes" reasoning `domain/permissions.ts`'s
 * `resolvePermissions` already applies to the identical situation.
 */

import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { RoleRepository } from "../ports/role-repository.js";
import type { TeamRepository } from "../ports/team-repository.js";
import type { StaffUserStatus, UserRepository } from "../ports/user-repository.js";

export interface UserRosterRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: StaffUserStatus;
  /** `null` when the user holds no team membership at all — not an error state, just an unassigned roster row. */
  readonly primaryTeamName: string | null;
  /** Empty when the user holds no role in this tenant. Never includes a role key with no live `Role` row (see the module comment). */
  readonly roleDisplayNames: readonly string[];
}

export interface ListUsersInput {
  readonly tenant: TenantSlug;
}

export interface ListUsersResult {
  readonly rows: readonly UserRosterRow[];
}

export interface ListUsersDeps {
  readonly users: UserRepository;
  readonly teams: TeamRepository;
  readonly roles: RoleRepository;
}

export class ListUsers {
  constructor(private readonly deps: ListUsersDeps) {}

  async execute(input: ListUsersInput): Promise<ListUsersResult> {
    const { users, teams, roles } = this.deps;

    const [staffUsers, teamList, memberships, roleList] = await Promise.all([
      users.listForTenant(input.tenant),
      teams.list(),
      teams.listMemberships(),
      roles.list(),
    ]);

    const teamNameById = new Map(teamList.map((team) => [team.id, team.name]));
    const roleDisplayNameByKey = new Map(roleList.map((role) => [role.key, role.displayName]));

    const rows = await Promise.all(
      staffUsers.map(async (user): Promise<UserRosterRow> => {
        const roleKeys = await users.rolesFor(user.id, input.tenant);
        const primaryMembership = memberships.find(
          (membership) => membership.staffUserId === user.id && membership.isPrimary,
        );
        const primaryTeamName =
          primaryMembership === undefined
            ? null
            : (teamNameById.get(primaryMembership.teamId) ?? null);
        const roleDisplayNames = roleKeys
          .map((key) => roleDisplayNameByKey.get(key))
          .filter((name): name is string => name !== undefined);

        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          status: user.status,
          primaryTeamName,
          roleDisplayNames,
        };
      }),
    );

    return { rows };
  }
}
