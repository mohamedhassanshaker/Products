/**
 * The real `TeamRepository` — B9 tab 2, per-tenant (`prisma/tenant/schema.prisma`).
 *
 * Every method reaches `getTenantDb()` only — `Team`/`TeamMember` are tenant-schema
 * tables, and every real caller (the `/iam` route's Server Actions, run through
 * `AuthMiddleware.handle()`) already has the right tenant ambiently bound before this
 * adapter is ever constructed, exactly like `PrismaUserRepository`'s tenant-schema methods.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  NewTeam,
  Team,
  TeamMembership,
  TeamRepository,
} from "../../../ports/team-repository.js";

const OPERATION = "iam team repository";

interface TeamRow {
  readonly id: string;
  readonly name: string;
  readonly scope: string;
  readonly description: string | null;
  readonly isSystem: boolean;
}

function toDomainTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    // `CK_Teams_scope` is the real guarantee behind this cast (§4.2).
    scope: row.scope as Team["scope"],
    description: row.description,
    isSystem: row.isSystem,
  };
}

const TEAM_SELECT = {
  id: true,
  name: true,
  scope: true,
  description: true,
  isSystem: true,
} as const;

export class PrismaTeamRepository implements TeamRepository {
  async list(): Promise<readonly Team[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.team.findMany({
      where: { deletedAt: null },
      select: TEAM_SELECT,
      orderBy: { name: "asc" },
    });
    return rows.map(toDomainTeam);
  }

  async findById(teamId: string): Promise<Team | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.team.findFirst({
      where: { id: teamId, deletedAt: null },
      select: TEAM_SELECT,
    });
    return row ? toDomainTeam(row) : null;
  }

  async create(team: NewTeam): Promise<Team> {
    const db = getTenantDb(OPERATION);
    const now = new Date();
    const row = await db.team.create({
      data: {
        id: newUlid(now),
        name: team.name,
        scope: team.scope,
        description: team.description ?? null,
        // "+ Add team" (B9 tab 2) always creates an ordinary, deletable team — the 7
        // seeded roles' `isSystem` counterpart is the seed script's job, not a runtime
        // creation path anyone can reach.
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      },
      select: TEAM_SELECT,
    });
    return toDomainTeam(row);
  }

  async listMemberships(): Promise<readonly TeamMembership[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.teamMember.findMany({
      select: { teamId: true, staffUserId: true, isPrimary: true },
    });
    return rows;
  }

  /**
   * Replace, not patch — see the port's own doc comment. `teamIds` is de-duplicated
   * defensively before the write: `UQ_TeamMembers_teamId_staffUserId` would otherwise
   * reject a caller-supplied duplicate mid-transaction, and a duplicate is never a
   * meaningful "team pill" selection to begin with.
   */
  async setMemberships(
    staffUserId: string,
    teamIds: readonly string[],
    actorId: string,
  ): Promise<readonly TeamMembership[]> {
    const db = getTenantDb(OPERATION);
    const now = new Date();
    const uniqueTeamIds = [...new Set(teamIds)];

    await db.$transaction([
      db.teamMember.deleteMany({ where: { staffUserId } }),
      ...uniqueTeamIds.map((teamId, index) =>
        db.teamMember.create({
          data: {
            id: newUlid(new Date(now.getTime() + index)),
            teamId,
            staffUserId,
            // The first pill is the primary — B9 tab 1's single "Team" column renders it
            // (`UQ_TeamMembers_primary`, filtered on exactly one `isPrimary = true` row
            // per staff user).
            isPrimary: index === 0,
            addedByStaffUserId: actorId,
            addedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    ]);

    return uniqueTeamIds.map((teamId, index) => ({ teamId, staffUserId, isPrimary: index === 0 }));
  }
}
