/**
 * Team persistence — B9 tab 2.
 *
 * Sibling to `user-repository.ts`, following the identical port/adapter split rather
 * than collapsing team persistence into the application layer. `Team`/`TeamMember` live
 * in `prisma/tenant/schema.prisma` (per-tenant, which is what makes B9 tab 2's own
 * "+ Add team" work per government entity — `docs/data-model.md` §4.2).
 *
 * ## "Derived live", enforced by this port's own shape
 *
 * B9 tab 2's membership chips are "derived live from Tab 1" (the wireframe's own words):
 * reassigning a user's team in Tab 1 must update Tab 2 immediately. This port offers no
 * method that returns "team X with its member list baked in" — only `list()` (teams) and
 * `listMemberships()` (the raw `TeamMembers` rows), so the *application* layer
 * (`list-teams-with-live-membership.ts`) is the thing that joins them on every read.
 * There is nowhere in this port to cache a membership count, which is what makes staleness
 * structurally impossible rather than a discipline callers have to remember.
 */

export type TeamScope = "Tenant" | "AllEntities";

export interface Team {
  readonly id: string;
  readonly name: string;
  readonly scope: TeamScope;
  readonly description: string | null;
  readonly isSystem: boolean;
}

export interface NewTeam {
  readonly name: string;
  readonly scope: TeamScope;
  readonly description?: string;
  readonly createdByStaffUserId: string;
}

/**
 * One `TeamMembers` row, exactly. `staffUserId` references `platform.StaffUsers.id` —
 * not FK-enforced across the schema boundary (see the Prisma model's own header comment)
 * — so a caller joining this against `UserRepository`'s data must tolerate a dangling id
 * for a staff user removed after this row was read, the same way every other
 * cross-schema reference in this codebase already does.
 */
export interface TeamMembership {
  readonly teamId: string;
  readonly staffUserId: string;
  readonly isPrimary: boolean;
}

export interface TeamRepository {
  /** Every live team, ordered by name — B9 tab 2's own row order. */
  list(): Promise<readonly Team[]>;

  findById(teamId: string): Promise<Team | null>;

  create(team: NewTeam): Promise<Team>;

  /** Every `TeamMembers` row in this tenant. See the module comment on why this is the whole table, not a per-team or per-user slice. */
  listMemberships(): Promise<readonly TeamMembership[]>;

  /**
   * Replace a staff user's team memberships with exactly this set.
   *
   * B9 tab 1's Edit dialog offers "team pills" — plural (`docs/data-model.md` §4.2
   * ASSUMPTION 1) — while its own table renders one "Team" column from the primary.
   * `teamIds[0]` becomes the primary (`isPrimary = true`); an empty array clears every
   * membership. Hard-replace rather than a diff/patch: `TeamMembers` is hard-deleted
   * (§1.4 — "a join row nothing historical points at"), so there is no audit reason to
   * preserve a row being removed, and a caller wanting only to add or only to remove one
   * team reads `listMemberships()` first and passes the full resulting set back.
   */
  setMemberships(
    staffUserId: string,
    teamIds: readonly string[],
    actorId: string,
  ): Promise<readonly TeamMembership[]>;
}
