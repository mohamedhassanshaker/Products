// PUBLIC API for "@nextbot/teams" — Module E, multi-agent orchestration
// (ADR-0012, LLD §14.7).
//
// Phase 6 (BL-37) shipped the delegation trace-tree's data model + read path only.
// **Phase 14 (BL-46, FR-ORC-01/03-11)** completes the module: team composition
// (`team`/`team_version`/`team_member`), the agent-as-tool registrar, and the live
// delegation executor that writes real `delegation_event` rows.
//
// Everything else in this module is private.

// --- domain ---------------------------------------------------------------
export { buildDelegationTree, type FlatDelegationEvent } from "./domain/tree-builder.js";
export { parseTeamArtifact, serializeTeamArtifact, hashTeamArtifact, assertTeamArtifact, parseAgentPin } from "./domain/team-artifact.js";
export { assertNoFallbackCycle } from "./domain/fallback-cycle.js";
export { detectThrash, similarityOf, type ThrashVerdict, type ThrashWindow } from "./domain/thrash-detector.js";
export { composeTeamVersionScope, composeTeamMemberScope } from "./domain/team-scope.js";
export {
  canPromoteTeamVersion,
  allowedTeamVersionTransitions,
  type TeamPromotionCheckInput,
  type TeamPromotionCheckResult,
} from "./domain/team-promotion-policy.js";

// --- ports (implemented by the composition root) --------------------------
export type { EscalationSink, DelegationEscalationRequest, DelegationEscalationResult } from "./ports/escalation-sink.js";
export type { SpecialistRunner, SpecialistRunInput, SpecialistRunResult } from "./ports/specialist-runner.js";

// --- application ----------------------------------------------------------
export { getDelegationTree } from "./application/delegation-tree-service.js";
export { createTeamWithFirstVersion, getTeam, listTeamsForAdmin, updateTeam } from "./application/team-service.js";
export {
  createTeamVersion,
  validateTeamArtifact,
  transitionTeamVersion,
  getAllowedTransitions,
  getSandboxCoverage,
  type CreateTeamVersionResult,
} from "./application/team-version-service.js";
export { runTeamTurn, runTeamSandbox, type TeamRunInput, type TeamRunResult } from "./application/team-run-service.js";
export {
  delegate,
  type DelegationExecutorDeps,
  type DelegationRunState,
  type DelegationResult,
  type HopContext,
} from "./application/delegation-executor.js";
export { registerAgentAsTool, retireAgentTool, deriveDelegationTierFloor, agentToolName } from "./application/agent-tool-registrar.js";

// --- infrastructure -------------------------------------------------------
export {
  listDelegationEventsForRun,
  insertDelegationEvent,
  buildDelegationChainForRun,
  listMemberIdsDelegatedInRun,
  getAgentVersionLabel,
  type NewDelegationEventInput,
  type DelegationEventRow,
} from "./infrastructure/delegation-event-repository.js";
export {
  listTeams,
  findTeamById,
  // Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — config export/
  // restore's "reuse an existing identity vs. create a new one" lookup.
  findTeamByName,
  findTeamVersionById,
  listTeamVersions,
  listTeamMembers,
  type TeamRow,
  type TeamVersionRow,
  type TeamMemberRow,
} from "./infrastructure/team-repository.js";
export { createTurnPipelineSpecialistRunner } from "./infrastructure/turn-pipeline-specialist-runner.js";

// --- http -----------------------------------------------------------------
export {
  handleGetDelegationTree,
  handleListTeams,
  handleCreateTeam,
  handleGetTeam,
  handleUpdateTeam,
  handleListTeamVersions,
  handleCreateTeamVersion,
  handleGetTeamVersion,
  handleValidateTeamVersion,
  handleDiffTeamVersions,
  handleTransitionTeamVersion,
  handleTeamSandboxRun,
} from "./http/admin-routes.js";
