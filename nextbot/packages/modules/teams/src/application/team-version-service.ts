import type { TenantContext } from "@nextbot/db";
import {
  TeamNotFoundError,
  TeamSandboxTopologyIncompleteError,
  TeamSupervisorRouteExpensiveError,
  TeamValidationError,
  TeamVersionNotFoundError,
  IllegalTeamVersionTransition,
  TeamPromotionBlockedError,
  type ScopeDescriptor,
  type TeamArtifact,
  type TeamValidationResponse,
  type TeamValidationWarning,
  type TeamVersionStatusValue,
} from "@nextbot/contracts";
import { findAgentDefinitionVersionByPin } from "@nextbot/agent-platform";
import { getRouteByName, isRouterClassRoute } from "@nextbot/model-gateway";
import { assertNoFallbackCycle } from "../domain/fallback-cycle.js";
import { hashTeamArtifact, parseAgentPin, serializeTeamArtifact } from "../domain/team-artifact.js";
import { composeTeamMemberScope, composeTeamVersionScope } from "../domain/team-scope.js";
import { allowedTeamVersionTransitions, canPromoteTeamVersion } from "../domain/team-promotion-policy.js";
import { registerAgentAsTool } from "./agent-tool-registrar.js";
import {
  bindTeamVersionSandboxRun,
  findTeamById,
  findTeamVersionById,
  insertTeamVersion,
  listTeamMembers,
  listTeamVersions,
  setTeamCurrentVersion,
  setTeamVersionStatus,
  type NewTeamMemberInput,
  type TeamMemberRow,
  type TeamVersionRow,
} from "../infrastructure/team-repository.js";
import { listMemberIdsDelegatedInRun } from "../infrastructure/delegation-event-repository.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01/03/11, LLD §14.7.2) —
 * team version authoring: validation, creation (which mints each member's
 * `AgentAsTool` catalog row), and the promotion ladder.
 */

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ResolvedArtifact {
  supervisorDefinitionVersionId: string;
  supervisorRouteVersionId: string;
  members: Array<{ spec: TeamArtifact["members"][number]; definitionVersionId: string; definitionName: string }>;
  warnings: TeamValidationWarning[];
}

/**
 * Resolves every reference an artifact makes against the real database and reports
 * anything unresolvable.
 *
 * @param strict `true` for a real save (a router-class violation is a 422), `false`
 *   for `POST .../validate` (the same violation comes back as a warning with a 200).
 *   LLD §14.7.2 specifies exactly this split for `TEAM_SUPERVISOR_ROUTE_EXPENSIVE`.
 */
async function resolveArtifact(ctx: TenantContext, artifact: TeamArtifact, strict: boolean): Promise<ResolvedArtifact> {
  const warnings: TeamValidationWarning[] = [];

  // --- supervisor agent pin -------------------------------------------------
  const supervisorPin = parseAgentPin(artifact.supervisor.agent);
  if (!supervisorPin) {
    throw new TeamValidationError(`supervisor.agent must be '<definitionName>@<version>' (got '${artifact.supervisor.agent}').`, [
      { path: "supervisor.agent", code: "TEAM_PIN_MALFORMED", message: "expected '<definitionName>@<version>'" },
    ]);
  }
  const supervisorVersion = await findAgentDefinitionVersionByPin(ctx, supervisorPin.name, supervisorPin.version);
  if (!supervisorVersion) {
    throw new TeamValidationError(`supervisor.agent '${artifact.supervisor.agent}' does not resolve to an existing agent version.`, [
      { path: "supervisor.agent", code: "TEAM_PIN_UNRESOLVED", message: "no such agent definition version" },
    ]);
  }

  // --- supervisor route (FR-ORC-03) ----------------------------------------
  const route = await getRouteByName(ctx, artifact.supervisor.route);
  if (!route) {
    throw new TeamValidationError(`supervisor.route '${artifact.supervisor.route}' does not resolve to an existing model route.`, [
      { path: "supervisor.route", code: "TEAM_ROUTE_UNRESOLVED", message: "no such model route" },
    ]);
  }
  if (!route.currentVersionId) {
    throw new TeamValidationError(`supervisor.route '${artifact.supervisor.route}' has no published version to pin.`, [
      { path: "supervisor.route", code: "TEAM_ROUTE_UNPUBLISHED", message: "route has no current published version" },
    ]);
  }
  // "validated AT SAVE to resolve to a route named `chat.router` or flagged
  // `role='router'`" — either satisfies it. Anything else is treated as
  // potentially frontier-class: FR-ORC-03 is explicit that a supervisor must be a
  // designated cheap router, so the safe default for an UNCLASSIFIED route is to
  // refuse it, not to assume it is cheap. Phase 15 (BL-47a) extracted this check
  // into `@nextbot/model-gateway`'s `isRouterClassRoute` so a workflow `Router`
  // node's `Classifier` mode can reuse the exact same decision.
  const isRouterClass = isRouterClassRoute(route);
  if (!isRouterClass) {
    const detail = `its model_route.role is '${route.role}' and its name is '${route.name}' — neither identifies it as router-class`;
    if (strict) throw new TeamSupervisorRouteExpensiveError(artifact.supervisor.route, detail);
    warnings.push({ code: "TEAM_SUPERVISOR_ROUTE_EXPENSIVE", message: detail, path: "supervisor.route" });
  }

  // --- members --------------------------------------------------------------
  const seenKeys = new Set<string>();
  const members: ResolvedArtifact["members"] = [];
  for (const [index, spec] of artifact.members.entries()) {
    if (seenKeys.has(spec.key)) {
      throw new TeamValidationError(`Duplicate member key '${spec.key}'.`, [
        { path: `members.${index}.key`, code: "TEAM_MEMBER_KEY_DUPLICATE", message: "member keys must be unique within a team version" },
      ]);
    }
    seenKeys.add(spec.key);

    const pin = parseAgentPin(spec.agent);
    if (!pin) {
      throw new TeamValidationError(`members.${index}.agent must be '<definitionName>@<version>' (got '${spec.agent}').`, [
        { path: `members.${index}.agent`, code: "TEAM_PIN_MALFORMED", message: "expected '<definitionName>@<version>'" },
      ]);
    }
    const version = await findAgentDefinitionVersionByPin(ctx, pin.name, pin.version);
    if (!version) {
      throw new TeamValidationError(`members.${index}.agent '${spec.agent}' does not resolve to an existing agent version.`, [
        { path: `members.${index}.agent`, code: "TEAM_PIN_UNRESOLVED", message: "no such agent definition version" },
      ]);
    }
    if (spec.fallbackAction === "Member" && !spec.fallbackMemberKey) {
      throw new TeamValidationError(`members.${index} declares fallbackAction 'Member' but no fallbackMemberKey.`, [
        { path: `members.${index}.fallbackMemberKey`, code: "TEAM_FALLBACK_INCOMPLETE", message: "required when fallbackAction is 'Member'" },
      ]);
    }
    members.push({ spec, definitionVersionId: version.id, definitionName: pin.name });
  }

  // Every `fallbackMemberKey` must name a real member of THIS artifact — checked
  // before the cycle walk, which cannot distinguish "dangling" from "terminates".
  for (const [index, { spec }] of members.entries()) {
    if (spec.fallbackMemberKey && !seenKeys.has(spec.fallbackMemberKey)) {
      throw new TeamValidationError(`members.${index}.fallbackMemberKey '${spec.fallbackMemberKey}' is not a member of this team.`, [
        { path: `members.${index}.fallbackMemberKey`, code: "TEAM_FALLBACK_UNRESOLVED", message: "no member with that key" },
      ]);
    }
  }
  // FR-ORC-10 — throws `TeamFallbackCycleError` (`TEAM_FALLBACK_CYCLE`).
  assertNoFallbackCycle(artifact.members);

  return {
    supervisorDefinitionVersionId: supervisorVersion.id,
    supervisorRouteVersionId: route.currentVersionId,
    members,
    warnings,
  };
}

/**
 * `POST /api/v1/admin/teams/{id}/versions/{versionId}/validate` — non-strict
 * validation: structural errors are still errors, but a router-class violation is
 * reported as a warning with a 200 rather than a 422 (LLD §14.7.2's own
 * strict/non-strict split).
 */
export async function validateTeamArtifact(ctx: TenantContext, artifact: TeamArtifact): Promise<TeamValidationResponse> {
  try {
    const resolved = await resolveArtifact(ctx, artifact, /* strict */ false);
    return {
      valid: true,
      warnings: resolved.warnings,
      errors: [],
      scope: composeTeamVersionScope({
        // The id is not known before a save; the preview uses the artifact's own
        // label so the console shows the same descriptor shape it will really get.
        teamVersionId: `${artifact.name}@${artifact.version}`,
        teamLabel: `${artifact.name}@${artifact.version}`,
        limits: artifact.limits,
        spec: artifact.scope,
      }),
    };
  } catch (err) {
    if (err instanceof TeamValidationError || err instanceof TeamSupervisorRouteExpensiveError) {
      return {
        valid: false,
        warnings: [],
        errors: (err.fields ?? [{ path: "(root)", code: err.code, message: err.message }]).map((f) => ({
          code: f.code,
          message: f.message,
          path: f.path,
        })),
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateTeamVersionResult {
  version: TeamVersionRow;
  members: TeamMemberRow[];
  warnings: TeamValidationWarning[];
}

/**
 * Creates the next immutable `team_version` for a team, minting each member's
 * `AgentAsTool` catalog row on the way (FR-ORC-01).
 *
 * Order matters and is deliberate: the artifact is fully resolved and validated
 * FIRST (so a bad artifact never leaves half-created catalog rows behind), then each
 * member's tool row is registered, then the version + members are written in one
 * transaction.
 */
export async function createTeamVersion(
  ctx: TenantContext,
  teamId: string,
  artifact: TeamArtifact,
  createdByUserId: string,
): Promise<CreateTeamVersionResult> {
  const team = await findTeamById(ctx, teamId);
  if (!team) throw new TeamNotFoundError(teamId);
  if (artifact.name !== team.name) {
    throw new TeamValidationError(`Artifact name '${artifact.name}' does not match team '${team.name}'.`, [
      { path: "name", code: "TEAM_NAME_MISMATCH", message: `expected '${team.name}'` },
    ]);
  }

  const resolved = await resolveArtifact(ctx, artifact, /* strict */ true);

  const memberInputs: NewTeamMemberInput[] = [];
  for (const [index, member] of resolved.members.entries()) {
    const registration = await registerAgentAsTool(ctx, {
      definitionVersionId: member.definitionVersionId,
      definitionName: member.definitionName,
      authoredDelegationTier: member.spec.delegationTier,
      description: `Delegate to the '${member.spec.key}' specialist. Invoke when ${member.spec.invokeWhen}`,
    });
    if (registration.effectiveTier !== member.spec.delegationTier) {
      // Never a silent override — the author is told their declared tier was raised
      // to the specialist's own reachable floor, and why.
      resolved.warnings.push({
        code: "TEAM_MEMBER_TIER_RAISED",
        message: `Member '${member.spec.key}' declared delegationTier '${member.spec.delegationTier}', but its specialist can reach a '${registration.derivedFloor}' tool, so the delegation is registered at '${registration.effectiveTier}'. A delegation is never cheaper to authorise than what it enables.`,
        path: `members.${index}.delegationTier`,
      });
    }
    memberInputs.push({
      memberKey: member.spec.key,
      definitionVersionId: member.definitionVersionId,
      toolId: registration.tool.id,
      delegationTier: registration.effectiveTier,
      invokeWhen: member.spec.invokeWhen,
      // Replaced below by `finalizeScopes`, once the real member ids exist.
      scopeJson: {},
      fallbackAction: member.spec.fallbackAction ?? "Escalate",
      fallbackMemberKey: member.spec.fallbackMemberKey ?? null,
      ordinal: index,
    });
  }

  const yamlText = serializeTeamArtifact(artifact);
  const { version, members } = await insertTeamVersion(ctx, {
    teamId,
    yaml: yamlText,
    yamlHash: hashTeamArtifact(artifact),
    supervisorDefinitionVersionId: resolved.supervisorDefinitionVersionId,
    supervisorRouteVersionId: resolved.supervisorRouteVersionId,
    limitsJson: artifact.limits,
    scopeJson: {},
    createdByUserId,
    members: memberInputs,
    // Scopes must carry the REAL row ids as `originId`, because that is what the
    // evaluator's per-dimension trace attributes a narrowing to, and what
    // `/authz/simulate`'s `teamVersion`/`teamMember` chain refs resolve against.
    finalizeScopes: (teamVersionId, memberIdsByKey) => ({
      versionScope: composeTeamVersionScope({
        teamVersionId,
        teamLabel: `${artifact.name}@${artifact.version}`,
        limits: artifact.limits,
        spec: artifact.scope,
      }),
      memberScopes: new Map(
        resolved.members.map((m) => [
          m.spec.key,
          composeTeamMemberScope({
            memberId: memberIdsByKey.get(m.spec.key)!,
            memberLabel: `${artifact.name}@${artifact.version}/${m.spec.key}`,
            spec: m.spec.scope,
          }) as unknown as ScopeDescriptor,
        ]),
      ),
    }),
  });

  return { version, members, warnings: resolved.warnings };
}

// ---------------------------------------------------------------------------
// Promotion ladder
// ---------------------------------------------------------------------------

/**
 * FR-ORC-11 — resolves the sandbox coverage the promotion gate checks: which of this
 * version's members the recorded sandbox run never delegated to. Real evidence read
 * from `delegation_event`, never a boolean someone set.
 */
export async function getSandboxCoverage(
  ctx: TenantContext,
  version: TeamVersionRow,
): Promise<{ runId: string; missingMemberKeys: string[] } | null> {
  if (!version.sandboxRunId) return null;
  const members = await listTeamMembers(ctx, version.id);
  const delegated = await listMemberIdsDelegatedInRun(ctx, version.sandboxRunId);
  return {
    runId: version.sandboxRunId,
    missingMemberKeys: members.filter((m) => !delegated.has(m.id)).map((m) => m.memberKey),
  };
}

/** The transitions the console should render as available for a version. */
export async function getAllowedTransitions(ctx: TenantContext, versionId: string): Promise<TeamVersionStatusValue[]> {
  const version = await findTeamVersionById(ctx, versionId);
  if (!version) throw new TeamVersionNotFoundError(versionId);
  return allowedTeamVersionTransitions({
    currentStatus: version.status,
    createdByUserId: version.createdByUserId,
    actingUserId: null,
    sandboxCoverage: await getSandboxCoverage(ctx, version),
    hasActiveTraffic: false,
  });
}

/**
 * `POST /api/v1/admin/teams/{id}/versions/{versionId}/transition`.
 *
 * The FSM decision is `domain/team-promotion-policy.ts`'s — the same function that
 * produced the console's `allowedTransitions` hint — so the UI and the enforcement
 * can never disagree, and the client's opinion is never trusted.
 */
export async function transitionTeamVersion(
  ctx: TenantContext,
  versionId: string,
  to: TeamVersionStatusValue,
  actingUserId: string,
): Promise<TeamVersionRow> {
  const version = await findTeamVersionById(ctx, versionId);
  if (!version) throw new TeamVersionNotFoundError(versionId);

  const sandboxCoverage = await getSandboxCoverage(ctx, version);
  const check = canPromoteTeamVersion({
    currentStatus: version.status,
    targetStatus: to,
    createdByUserId: version.createdByUserId,
    actingUserId,
    sandboxCoverage,
    hasActiveTraffic: false,
  });

  if (!check.allowed) {
    // FR-ORC-11's specific failure gets its own named error, so the console can point
    // at the exact members that were never exercised rather than showing prose.
    if (to === "Approved" && sandboxCoverage && sandboxCoverage.missingMemberKeys.length > 0) {
      throw new TeamSandboxTopologyIncompleteError(sandboxCoverage.missingMemberKeys);
    }
    // An illegal FSM edge and a blocked-but-legal promotion are genuinely different
    // conditions (409 vs 422), so they stay distinct errors.
    const isIllegalEdge = check.reason.startsWith("Cannot promote to") || check.reason.includes("already");
    if (isIllegalEdge) throw new IllegalTeamVersionTransition(version.status, to);
    throw new TeamPromotionBlockedError(check.reason);
  }

  const updated = await setTeamVersionStatus(ctx, versionId, to, to === "Approved" ? actingUserId : undefined);
  if (!updated) throw new TeamVersionNotFoundError(versionId);
  if (to === "Production") await setTeamCurrentVersion(ctx, version.teamId, versionId);
  return updated;
}

export { bindTeamVersionSandboxRun, findTeamVersionById, listTeamMembers, listTeamVersions };
