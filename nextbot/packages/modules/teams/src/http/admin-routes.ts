import type { TenantContext } from "@nextbot/db";
import type {
  CreateTeamRequest,
  CreateTeamVersionRequest,
  DelegationTreeResponse,
  TeamValidationResponse,
  TeamVersionStatusValue,
  UpdateTeamRequest,
} from "@nextbot/contracts";
import { TeamVersionNotFoundError } from "@nextbot/contracts";
import { getDelegationTree } from "../application/delegation-tree-service.js";
import { createTeamWithFirstVersion, getTeam, listTeamsForAdmin, updateTeam } from "../application/team-service.js";
import {
  createTeamVersion,
  getAllowedTransitions,
  getSandboxCoverage,
  transitionTeamVersion,
  validateTeamArtifact,
} from "../application/team-version-service.js";
import { runTeamSandbox } from "../application/team-run-service.js";
import { findTeamVersionById, listTeamMembers, listTeamVersions, type TeamMemberRow, type TeamVersionRow } from "../infrastructure/team-repository.js";
import { parseTeamArtifact } from "../domain/team-artifact.js";
import type { DelegationExecutorDeps } from "../application/delegation-executor.js";

/**
 * `http/` layer (LLD §2.2) — plain functions, no framework types. RBAC is applied by
 * the composition root (`apps/web`), which gates every route below on
 * `agent_platform:Read`/`agent_platform:Write` — the same module the delegation-tree
 * endpoint and the Skills Library already use, per this project's established
 * "teams/skills are part of the Agent Platform surface, not a new RBAC module"
 * precedent (spec §5.2).
 *
 * LLD §14.7.5's endpoint list, in order.
 */

/** `GET /api/v1/admin/agent-runs/{runId}/delegation-tree` (Phase 6, unchanged —
 * Phase 14 is what makes it return real rows). */
export async function handleGetDelegationTree(ctx: TenantContext, agentRunId: string): Promise<DelegationTreeResponse> {
  return getDelegationTree(ctx, agentRunId);
}

/** `GET /api/v1/admin/teams` */
export async function handleListTeams(ctx: TenantContext) {
  return listTeamsForAdmin(ctx);
}

/** `POST /api/v1/admin/teams` — creates the team AND its version 1. */
export async function handleCreateTeam(ctx: TenantContext, body: CreateTeamRequest, actingUserId: string) {
  const result = await createTeamWithFirstVersion(ctx, body, actingUserId);
  return { team: result.team, version: toVersionView(result.version, result.members), warnings: result.warnings };
}

/** `GET /api/v1/admin/teams/{id}` */
export async function handleGetTeam(ctx: TenantContext, id: string) {
  const team = await getTeam(ctx, id);
  return { team, versions: await listTeamVersions(ctx, id) };
}

/** `PATCH /api/v1/admin/teams/{id}` */
export async function handleUpdateTeam(ctx: TenantContext, id: string, body: UpdateTeamRequest) {
  return { team: await updateTeam(ctx, id, body) };
}

/** `GET /api/v1/admin/teams/{id}/versions` */
export async function handleListTeamVersions(ctx: TenantContext, teamId: string) {
  return { versions: await listTeamVersions(ctx, teamId) };
}

/** `POST /api/v1/admin/teams/{id}/versions` */
export async function handleCreateTeamVersion(ctx: TenantContext, teamId: string, body: CreateTeamVersionRequest, actingUserId: string) {
  const result = await createTeamVersion(ctx, teamId, body.artifact, actingUserId);
  return { version: toVersionView(result.version, result.members), warnings: result.warnings };
}

/** `GET /api/v1/admin/teams/{id}/versions/{versionId}` */
export async function handleGetTeamVersion(ctx: TenantContext, versionId: string) {
  const version = await findTeamVersionById(ctx, versionId);
  if (!version) throw new TeamVersionNotFoundError(versionId);
  const members = await listTeamMembers(ctx, versionId);
  return {
    version: toVersionView(version, members),
    allowedTransitions: await getAllowedTransitions(ctx, versionId),
    // FR-ORC-11 — surfaced so the console can show WHICH members a sandbox run is
    // still missing, instead of only refusing the promotion after the fact.
    sandboxCoverage: await getSandboxCoverage(ctx, version),
  };
}

/** `POST /api/v1/admin/teams/{id}/versions/{versionId}/validate` — non-strict: a
 * router-class violation comes back as a warning with a 200, per LLD §14.7.2. */
export async function handleValidateTeamVersion(ctx: TenantContext, yamlText: string): Promise<TeamValidationResponse> {
  return validateTeamArtifact(ctx, parseTeamArtifact(yamlText));
}

/**
 * `GET /api/v1/admin/teams/{id}/versions/diff?from&to` — a plain line diff of the two
 * versions' stored YAML.
 *
 * Deliberately the Git-independent structural form (Phase 0/BL-31's own precedent):
 * team versions have no Git backing at all, so a Git-diff path would have nothing to
 * diff against.
 */
export async function handleDiffTeamVersions(ctx: TenantContext, fromVersionId: string, toVersionId: string) {
  const [from, to] = await Promise.all([findTeamVersionById(ctx, fromVersionId), findTeamVersionById(ctx, toVersionId)]);
  if (!from) throw new TeamVersionNotFoundError(fromVersionId);
  if (!to) throw new TeamVersionNotFoundError(toVersionId);
  return {
    from: { id: from.id, version: from.version, yaml: from.yaml },
    to: { id: to.id, version: to.version, yaml: to.yaml },
    identical: from.yamlHash === to.yamlHash,
  };
}

/** `POST /api/v1/admin/teams/{id}/versions/{versionId}/transition` */
export async function handleTransitionTeamVersion(
  ctx: TenantContext,
  versionId: string,
  to: TeamVersionStatusValue,
  actingUserId: string,
) {
  return { version: await transitionTeamVersion(ctx, versionId, to, actingUserId) };
}

/**
 * `POST /api/v1/admin/teams/{id}/versions/{versionId}/sandbox-run` — exercises the
 * WHOLE topology (FR-ORC-11), not just the supervisor.
 *
 * `deps` is supplied by the composition root: the real turn-pipeline specialist
 * runner plus (optionally) the escalation sink. Passing them in rather than
 * constructing them here is what keeps `teams` free of an `escalations` dependency
 * and of a hard-wired egress implementation.
 */
export async function handleTeamSandboxRun(
  ctx: TenantContext,
  deps: DelegationExecutorDeps,
  versionId: string,
  body: { task: string; conversationId?: string },
) {
  const result = await runTeamSandbox(ctx, deps, {
    teamVersionId: versionId,
    task: body.task,
    conversationId: body.conversationId ?? null,
  });
  return {
    agentRunId: result.agentRunId,
    outcome: result.outcome,
    chain: result.chain,
    // The delegation tree the gate (and the console) actually reads back.
    tree: await getDelegationTree(ctx, result.agentRunId),
  };
}

/** Presentation shape shared by every version-returning handler — members inlined,
 * since a version is meaningless without them. */
function toVersionView(version: TeamVersionRow, members: TeamMemberRow[]) {
  return { ...version, members };
}
