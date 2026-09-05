import type { TenantContext } from "@nextbot/db";
import { TeamAlreadyExistsError, TeamNotFoundError, type TeamArtifact, type UpdateTeamRequest } from "@nextbot/contracts";
import { createTeamVersion, type CreateTeamVersionResult } from "./team-version-service.js";
import { createTeam, findTeamById, findTeamByName, listTeams, updateTeamMetadata, type TeamRow } from "../infrastructure/team-repository.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.5) — team CRUD.
 *
 * Deliberately thin: everything interesting about a team lives in its immutable
 * versions, so the identity row only carries a name, a description, a status and a
 * pointer at the current Production version. Mirrors `skills`' own split for the
 * same reason.
 */

/** Creating a team always creates its version 1 in the same call — there is no
 * "empty" team with zero versions (the convention `CreateSkillRequestSchema`
 * already established). If the version fails validation, no team row is left
 * behind. */
export async function createTeamWithFirstVersion(
  ctx: TenantContext,
  input: { name: string; description?: string; artifact: TeamArtifact },
  createdByUserId: string,
): Promise<{ team: TeamRow } & CreateTeamVersionResult> {
  if (await findTeamByName(ctx, input.name)) throw new TeamAlreadyExistsError(input.name);
  const team = await createTeam(ctx, { name: input.name, description: input.description ?? null, createdByUserId });
  const created = await createTeamVersion(ctx, team.id, input.artifact, createdByUserId);
  return { team, ...created };
}

export async function listTeamsForAdmin(ctx: TenantContext): Promise<TeamRow[]> {
  return listTeams(ctx);
}

export async function getTeam(ctx: TenantContext, id: string): Promise<TeamRow> {
  const team = await findTeamById(ctx, id);
  if (!team) throw new TeamNotFoundError(id);
  return team;
}

/** Only the two mutable fields on the identity row. A team's composition can never
 * be edited in place — that is what a new version is for. */
export async function updateTeam(ctx: TenantContext, id: string, patch: UpdateTeamRequest): Promise<TeamRow> {
  const updated = await updateTeamMetadata(ctx, id, {
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  });
  if (!updated) throw new TeamNotFoundError(id);
  return updated;
}
