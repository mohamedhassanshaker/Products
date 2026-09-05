import type { TenantContext } from "@nextbot/db";
import type {
  AgentVersionStatusValue,
  ConnectGitRequest,
  CreateAgentBlueprintRequest,
  CreateAgentDefinitionRequest,
  CreateAgentDefinitionVersionRequest,
  CreateEvalCaseRequest,
  CreateEvalSuiteRequest,
  HarvestEvalCaseRequest,
  RegisterModelProviderRequest,
  StudioAudienceStepRequest,
  StudioEvalsStepRequest,
  StudioGuardrailsStepRequest,
  StudioKnowledgeStepRequest,
  StudioMemoryStepRequest,
  StudioModelBudgetsStepRequest,
  StudioPurposeStepRequest,
  StudioSkillsStepRequest,
  StudioToolsStepRequest,
  SubmitStudioDraftRequest,
  UpgradeConsumersRequest,
  // Target Architecture Blueprint Phase 17 (BL-48/BL-13, ADR-0019, LLD §15.7).
  DeployEnvironmentValue,
  PromoteCanaryRequest,
  SetTrafficSplitRequest,
  StartShadowEvaluationRequest,
  StopShadowEvaluationRequest,
} from "@nextbot/contracts";
import * as definitions from "../application/agent-definition-service.js";
import * as git from "../application/git-connection-service.js";
import * as evals from "../application/eval-service.js";
import * as modelGateway from "../application/model-gateway-service.js";
import * as studio from "../application/studio-service.js";
import * as blueprints from "../application/blueprint-service.js";
import { harvestEvalCase } from "../application/harvesting-service.js";
import { promoteAgentVersion, checkPromotionTarget } from "../application/promote-version-service.js";
import { listAgentRunsForVersion } from "../application/agent-run-service.js";
import { emergencyRollback } from "../application/emergency-rollback-service.js";
import { getSkillWhereUsed, upgradeConsumers } from "../application/skill-upgrade-service.js";
import * as trafficSplit from "../application/traffic-split-service.js";
import * as shadow from "../application/shadow-evaluation-service.js";
import { listVersionRunMetrics } from "../infrastructure/agent-run-repository.js";

/** `http/` layer (LLD §2.2) — plain functions; RBAC checks (`agent_platform` module)
 * are applied by the composition root (`apps/web`), same pattern as every other
 * module's `http/admin-routes.ts`. */

export async function handleCreateDefinition(ctx: TenantContext, input: CreateAgentDefinitionRequest) {
  return definitions.createAgentDefinition(ctx, input);
}

export async function handleListDefinitions(ctx: TenantContext) {
  return definitions.listDefinitions(ctx);
}

export async function handleGetDefinition(ctx: TenantContext, id: string) {
  return definitions.getDefinition(ctx, id);
}

export async function handleCreateVersion(ctx: TenantContext, agentDefinitionId: string, input: CreateAgentDefinitionVersionRequest, createdByUserId: string) {
  return definitions.createAgentDefinitionVersion(ctx, agentDefinitionId, input, createdByUserId);
}

export async function handleListVersions(ctx: TenantContext, agentDefinitionId: string, callingUserId: string) {
  return definitions.listVersions(ctx, agentDefinitionId, callingUserId);
}

export async function handleGetVersion(ctx: TenantContext, versionId: string, callingUserId: string) {
  return definitions.getVersion(ctx, versionId, callingUserId);
}

export async function handleDiffVersions(ctx: TenantContext, versionAId: string, versionBId: string) {
  return definitions.diffVersions(ctx, versionAId, versionBId);
}

/** ADR-0016 (FR-AGT-19, BL-31) — the Git-independent structural diff, a genuinely
 * separate endpoint from `handleDiffVersions` above. */
export async function handleStructuralDiffVersions(ctx: TenantContext, versionAId: string, versionBId: string) {
  return definitions.structuralDiffVersions(ctx, versionAId, versionBId);
}

export async function handleSubmitForReview(ctx: TenantContext, versionId: string) {
  return definitions.submitVersionForReview(ctx, versionId);
}

export async function handleBindEvalSuite(ctx: TenantContext, versionId: string, evalSuiteId: string) {
  return definitions.bindEvalSuite(ctx, versionId, evalSuiteId);
}

export async function handlePromoteVersion(ctx: TenantContext, versionId: string, targetStatus: Parameters<typeof promoteAgentVersion>[2], actingUserId: string) {
  return promoteAgentVersion(ctx, versionId, targetStatus, actingUserId);
}

/** UX_GUIDELINES.md §6.4's "(?) why can't I promote this further?" affordance. */
export async function handleCheckPromotionTarget(ctx: TenantContext, versionId: string, targetStatus: AgentVersionStatusValue, callingUserId: string) {
  return checkPromotionTarget(ctx, versionId, targetStatus, callingUserId);
}

// --- Git connection (ADR-0009) ---

export async function handleConnectGit(ctx: TenantContext, input: ConnectGitRequest, createdByUserId: string) {
  return git.connectGit(ctx, { ...input, createdByUserId });
}

export async function handleDisconnectGit(ctx: TenantContext) {
  return git.disconnectGit(ctx);
}

export async function handleGetGitConnection(ctx: TenantContext) {
  return git.getGitConnectionView(ctx);
}

export async function handleGitWebhook(ctx: TenantContext, input: Parameters<typeof git.handleGitWebhook>[1]) {
  return git.handleGitWebhook(ctx, input);
}

// --- Eval suites (FR-AGT-06) ---

export async function handleCreateEvalSuite(ctx: TenantContext, input: CreateEvalSuiteRequest) {
  return evals.createEvalSuite(ctx, input);
}

export async function handleListEvalSuites(ctx: TenantContext) {
  return evals.listEvalSuites(ctx);
}

export async function handleAddEvalCase(ctx: TenantContext, evalSuiteId: string, input: CreateEvalCaseRequest) {
  return evals.addEvalCase(ctx, evalSuiteId, input);
}

export async function handleListEvalCases(ctx: TenantContext, evalSuiteId: string) {
  return evals.listCases(ctx, evalSuiteId);
}

export async function handleRunEvalSuite(ctx: TenantContext, agentDefinitionVersionId: string, triggeredBy: "Manual" | "VersionSubmitted" | "Scheduled" = "Manual") {
  return evals.runEvalSuite(ctx, { agentDefinitionVersionId, triggeredBy });
}

// --- Eval harvesting (FR-AGT-16) ---

export async function handleHarvestEvalCase(ctx: TenantContext, input: HarvestEvalCaseRequest) {
  return harvestEvalCase(ctx, input);
}

export async function handleListEvalRuns(ctx: TenantContext, agentDefinitionVersionId: string) {
  return evals.listEvalRunsForVersion(ctx, agentDefinitionVersionId);
}

export async function handleListEvalCaseResults(ctx: TenantContext, evalRunId: string) {
  return evals.listEvalCaseResults(ctx, evalRunId);
}

// --- Model Gateway configuration (FR-AGT-07/08) ---
// Target Architecture Blueprint Phase 2 (BL-33, LLD §14.9.6) — `handleUpsertModelRoute`/
// `handleListModelRoutes` (the v1 free-text-chain route CRUD) are REMOVED, not kept:
// `model_route` no longer has the columns they wrote to (Route v2's
// `model_route`/`model_route_version` schema, migration `0044`) — the legacy
// `/api/v1/admin/agent-platform/model-routes` console screen/endpoint is retired in
// favor of the new Routes tab on `/model-gateway` (`@nextbot/model-gateway`'s
// `handleCreateRoute`/`handleCreateRouteVersion`/etc., LLD §14.8.5).

export async function handleRegisterModelProvider(ctx: TenantContext, input: RegisterModelProviderRequest, credentialId?: string) {
  return modelGateway.registerModelProvider(ctx, { key: input.key, label: input.label, baseUrl: input.baseUrl, credentialId, regions: input.regions, enabled: input.enabled });
}

export async function handleListModelProviders(ctx: TenantContext) {
  return modelGateway.listModelProviders(ctx);
}

// --- Emergency rollback (FR-AGT-30, BL-27, ADR-0017) ---

export async function handleEmergencyRollback(
  ctx: TenantContext,
  agentDefinitionId: string,
  input: { targetVersionId: string; reason: string },
  actorUserId: string,
) {
  return emergencyRollback(ctx, agentDefinitionId, input, actorUserId);
}

// --- Skills library where-used / upgrade-consumers (BL-35, ADR-0015, LLD §14.5.4) ---
// Owned here (not `@nextbot/skills`) per that module's own allow-list comment: both
// read/write `agent_definition_version`/`agent_version_skill`, which this module owns.

export async function handleGetSkillWhereUsed(ctx: TenantContext, skillId: string) {
  return getSkillWhereUsed(ctx, skillId);
}

export async function handleUpgradeConsumers(ctx: TenantContext, skillId: string, input: UpgradeConsumersRequest, actingUserId: string | null) {
  return upgradeConsumers(ctx, skillId, input, actingUserId);
}

// --- Runtime Observability (FR-AGT-09) ---

export async function handleListAgentRuns(ctx: TenantContext, agentDefinitionVersionId: string) {
  return listAgentRunsForVersion(ctx, agentDefinitionVersionId);
}

// --- Agent Design Studio (FR-AGT-13, LLD §14.5.5) ---

export async function handleCreateStudioDraft(ctx: TenantContext, agentDefinitionId: string, createdByUserId: string) {
  return studio.createDraft(ctx, agentDefinitionId, createdByUserId);
}

export async function handleGetStudioDraft(ctx: TenantContext, id: string) {
  return studio.getDraft(ctx, id);
}

export async function handleDeleteStudioDraft(ctx: TenantContext, id: string) {
  return studio.deleteDraft(ctx, id);
}

export async function handleSubmitStudioPurposeStep(ctx: TenantContext, id: string, input: StudioPurposeStepRequest) {
  return studio.submitPurposeStep(ctx, id, input);
}

export async function handleSubmitStudioAudienceStep(ctx: TenantContext, id: string, input: StudioAudienceStepRequest) {
  return studio.submitAudienceStep(ctx, id, input);
}

export async function handleSubmitStudioSkillsStep(ctx: TenantContext, id: string, input: StudioSkillsStepRequest) {
  return studio.submitSkillsStep(ctx, id, input);
}

export async function handleSubmitStudioToolsStep(ctx: TenantContext, id: string, input: StudioToolsStepRequest) {
  return studio.submitToolsStep(ctx, id, input);
}

export async function handleSubmitStudioKnowledgeStep(ctx: TenantContext, id: string, input: StudioKnowledgeStepRequest) {
  return studio.submitKnowledgeStep(ctx, id, input);
}

export async function handleSubmitStudioGuardrailsStep(ctx: TenantContext, id: string, input: StudioGuardrailsStepRequest) {
  return studio.submitGuardrailsStep(ctx, id, input);
}

export async function handleSubmitStudioModelBudgetsStep(ctx: TenantContext, id: string, input: StudioModelBudgetsStepRequest) {
  return studio.submitModelBudgetsStep(ctx, id, input);
}

export async function handleSubmitStudioMemoryStep(ctx: TenantContext, id: string, input: StudioMemoryStepRequest) {
  return studio.submitMemoryStep(ctx, id, input);
}

export async function handleSubmitStudioEvalsStep(ctx: TenantContext, id: string, input: StudioEvalsStepRequest) {
  return studio.submitEvalsStep(ctx, id, input);
}

export async function handleListAvailableSkillEvalCases(ctx: TenantContext, skillPins: string[]) {
  return studio.listAvailableSkillEvalCases(ctx, skillPins);
}

export async function handleSubmitStudioDraft(ctx: TenantContext, id: string, input: SubmitStudioDraftRequest, createdByUserId: string) {
  return studio.submitDraft(ctx, id, input, createdByUserId);
}

export async function handlePreviewStudioDraft(ctx: TenantContext, id: string, version: string, graphType?: string) {
  return studio.previewDraft(ctx, id, version, graphType);
}

// --- Blueprints Gallery (FR-AGT-15, tenant-local starter templates only) ---

export async function handleCreateAgentBlueprint(ctx: TenantContext, input: CreateAgentBlueprintRequest, createdByUserId: string | null) {
  return blueprints.createBlueprint(ctx, input, createdByUserId);
}

export async function handleListAgentBlueprints(ctx: TenantContext) {
  return blueprints.listBlueprints(ctx);
}

export async function handleGetAgentBlueprint(ctx: TenantContext, id: string) {
  return blueprints.getBlueprint(ctx, id);
}

export async function handleInstantiateBlueprintAsDraft(ctx: TenantContext, blueprintId: string, agentDefinitionId: string, createdByUserId: string) {
  return blueprints.instantiateBlueprintAsDraft(ctx, blueprintId, agentDefinitionId, createdByUserId);
}

// ---------------------------------------------------------------------------
// Progressive rollout — Deployments & Canary + shadow evaluation
// (Target Architecture Blueprint Phase 17, BL-48/BL-13, ADR-0019, LLD §15.7)
// ---------------------------------------------------------------------------
//
// RBAC for every handler below is `agent_platform=Write` for the mutations and
// `agent_platform=Read` for the reads, applied at the composition root exactly like
// every other handler in this file. That is the SAME level ordinary promotion already
// requires — no new role and no new privilege ladder, per ADR-0017 §2.2's reasoning,
// which ADR-0019 §2.6 adopts unchanged for both deployment and shadow endpoints.
//
// Route paths follow this codebase's existing `/api/v1/admin/agent-platform/definitions/
// {id}/...` shape rather than LLD §15.7's shorter `/api/v1/admin/agent-definitions/
// {id}/...` sketch — the console, every existing definition-scoped route, and the
// emergency-rollback endpoint this panel sits beside all live under the former.
// Disclosed as a deliberate, consistency-preserving deviation rather than silently
// introducing a second definition-scoped URL family.

/** Current allocations + per-version live metrics (FR-AGT-09/10). The metrics EXCLUDE
 *  `trigger = 'ShadowEvaluation'` runs — see `listVersionRunMetrics`' own doc. */
export async function handleGetDeployments(ctx: TenantContext, agentDefinitionId: string, environment: DeployEnvironmentValue) {
  const allocations = await trafficSplit.listActiveDeploymentsForAgentEnvironment(ctx, agentDefinitionId, environment);
  const metrics = await listVersionRunMetrics(
    ctx,
    allocations.map((a) => a.agentDefinitionVersionId),
  );
  return { allocations, metrics };
}

export async function handleSetTrafficSplit(ctx: TenantContext, agentDefinitionId: string, input: SetTrafficSplitRequest, actorUserId: string | null) {
  const allocations = await trafficSplit.setTrafficSplit(
    ctx,
    agentDefinitionId,
    {
      environment: input.environment,
      allocations: input.allocations.map((a) => ({ agentDefinitionVersionId: a.versionId, trafficSplitPct: a.trafficSplitPct })),
      reason: input.reason,
    },
    actorUserId,
  );
  return { allocations };
}

export async function handlePromoteCanary(ctx: TenantContext, agentDefinitionId: string, input: PromoteCanaryRequest, actorUserId: string | null) {
  const allocations = await trafficSplit.promoteCanary(
    ctx,
    agentDefinitionId,
    { environment: input.environment, agentDefinitionVersionId: input.versionId, reason: input.reason },
    actorUserId,
  );
  return { allocations };
}

/** The rollout timeline, including the `EmergencyRollback` rows Phase 0 already writes —
 *  an emergency action appears in the same timeline as ordinary ones and is labelled
 *  distinctly (ADR-0017 §2.5's "visibility as the compensating control"). */
export async function handleGetDeploymentHistory(ctx: TenantContext, agentDefinitionId: string, environment: DeployEnvironmentValue) {
  return { history: await trafficSplit.listDeploymentHistory(ctx, agentDefinitionId, environment) };
}

export async function handleStartShadowEvaluation(
  ctx: TenantContext,
  agentDefinitionId: string,
  input: StartShadowEvaluationRequest,
  actorUserId: string | null,
) {
  return { evaluation: await shadow.startShadowEvaluation(ctx, agentDefinitionId, input, actorUserId) };
}

export async function handleListShadowEvaluations(ctx: TenantContext, agentDefinitionId: string) {
  return { evaluations: await shadow.listShadowEvaluations(ctx, agentDefinitionId) };
}

export async function handleGetShadowEvaluationReport(ctx: TenantContext, shadowEvaluationId: string) {
  return shadow.getShadowEvaluationReport(ctx, shadowEvaluationId);
}

export async function handleListShadowRuns(ctx: TenantContext, shadowEvaluationId: string) {
  return { runs: await shadow.listShadowRuns(ctx, shadowEvaluationId) };
}

export async function handleStopShadowEvaluation(ctx: TenantContext, shadowEvaluationId: string, input: StopShadowEvaluationRequest, actorUserId: string | null) {
  await shadow.stopShadowEvaluationById(ctx, shadowEvaluationId, input.reason, actorUserId);
  return { stopped: true };
}
