// PUBLIC API for "@nextbot/agent-platform" (BL-07, LLD §3.10/§3.10a/§7.1, ADR-0003/
// 0006/0009). Everything else in this module is private — `apps/web`/`apps/gateway`/
// `apps/worker` reach it only through the handlers below.

export {
  handleCreateDefinition,
  handleListDefinitions,
  handleGetDefinition,
  handleCreateVersion,
  handleListVersions,
  handleGetVersion,
  handleDiffVersions,
  handleStructuralDiffVersions,
  handleSubmitForReview,
  handleBindEvalSuite,
  handlePromoteVersion,
  handleCheckPromotionTarget,
  handleConnectGit,
  handleDisconnectGit,
  handleGetGitConnection,
  handleGitWebhook,
  handleCreateEvalSuite,
  handleListEvalSuites,
  handleAddEvalCase,
  handleListEvalCases,
  handleRunEvalSuite,
  handleListEvalRuns,
  handleListEvalCaseResults,
  handleRegisterModelProvider,
  handleListModelProviders,
  handleListAgentRuns,
  handleEmergencyRollback,
  handleGetSkillWhereUsed,
  handleUpgradeConsumers,
  handleHarvestEvalCase,
  handleCreateStudioDraft,
  handleGetStudioDraft,
  handleDeleteStudioDraft,
  handleSubmitStudioPurposeStep,
  handleSubmitStudioAudienceStep,
  handleSubmitStudioSkillsStep,
  handleSubmitStudioToolsStep,
  handleSubmitStudioKnowledgeStep,
  handleSubmitStudioGuardrailsStep,
  handleSubmitStudioModelBudgetsStep,
  handleSubmitStudioMemoryStep,
  handleSubmitStudioEvalsStep,
  handleListAvailableSkillEvalCases,
  handleSubmitStudioDraft,
  handlePreviewStudioDraft,
  handleCreateAgentBlueprint,
  handleListAgentBlueprints,
  handleGetAgentBlueprint,
  handleInstantiateBlueprintAsDraft,
  // Target Architecture Blueprint Phase 17 (BL-48/BL-13, ADR-0019, LLD §15.7) —
  // Deployments & Canary + shadow evaluation.
  handleGetDeployments,
  handleSetTrafficSplit,
  handlePromoteCanary,
  handleGetDeploymentHistory,
  handleStartShadowEvaluation,
  handleListShadowEvaluations,
  handleGetShadowEvaluationReport,
  handleListShadowRuns,
  handleStopShadowEvaluation,
} from "./http/admin-routes.js";

export { canPromote, allowedTransitions, type PromotionCheckInput, type PromotionCheckResult } from "./domain/promotion-policy.js";
export { hashDefinitionArtifact, canonicalize } from "./domain/definition-hash.js";

export { buildGitHubAuthorizeUrl, buildGitLabAuthorizeUrl, exchangeGitHubCode, exchangeGitLabCode } from "./infrastructure/git-oauth.js";
export { getGitProviderClient, type GitProviderClient } from "./infrastructure/git-provider/index.js";

export { reconcileOpenPrsForTenant, reconcileOpenPrsAcrossAllTenants } from "./application/git-connection-service.js";
// Retry-1 QA fix (Target Architecture Blueprint Phase 16, BL-47b): the shared, real
// HMAC-SHA256 primitive + constant-time comparator this module's own webhook signature
// verification already used correctly — exported so `@nextbot/workflows`' webhook
// trigger signature reuses this exact construction instead of a second, independently
// written (and, in that module's case, previously broken) implementation.
export { computeHmacSha256Hex, constantTimeEquals } from "./application/git-connection-service.js";
export { callModelGatewayText, callModelGatewayStructured, resolveModelChainForRoute } from "./application/model-gateway-service.js";
export { startAgentRun, completeAgentRun, suspendAgentRunForApproval, getAgentRun, listAgentRunsForVersion } from "./application/agent-run-service.js";
export {
  serializeArtifactToYaml,
  parseArtifactFromYaml,
  recordSandboxTest,
  getVersionToolPolicy,
  type VersionToolPolicy,
  // Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06) — the bounded
  // retrieval agent's own config accessor, mirroring `getVersionToolPolicy` above.
  getVersionKnowledgeConfig,
  // Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-05) — the RECEIVING
  // agent's declared trust level, the key the masking-context matrix is
  // re-evaluated against at every delegation hand-off boundary.
  getVersionTrustLevel,
  // Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — config export/
  // restore's composition-root orchestration (`apps/web/src/lib/config-portability-
  // service.ts`, the same "app is the only place two sibling modules can be imported
  // together" seam `dsr-service.ts` already established) calls these directly,
  // mirroring every other versioned-artifact module's own already-exported
  // create-identity/create-version/list pair.
  createAgentDefinition,
  listDefinitions,
  createAgentDefinitionVersion,
} from "./application/agent-definition-service.js";

export {
  // Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.2) — RENAMED from
  // `findActiveAgentDefinitionVersion`. It is no longer the live resolution (that is
  // `resolveTurnAgentVersion` below); it is retained, deliberately, as the fallback a
  // channel with no `agent_definition_id` binding still takes, so every pre-Phase-17
  // tenant, fixture and test behaves exactly as before.
  findActiveAgentDefinitionVersionTenantWideFallback,
  // Target Architecture Blueprint Phase 14 (BL-46) — `@nextbot/teams` resolves a
  // member's `"<definitionName>@<version>"` pin to a real, immutable
  // `agent_definition_version` row at team-version save time (the same
  // resolve-before-persist discipline `agent_version_skill` already established).
  findAgentDefinitionVersionByPin,
  findAgentDefinitionVersionById,
  // Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — config export/
  // restore's "reuse an existing identity vs. create a new one" lookup, and the
  // "current = latest version" read (already ordered newest-first).
  findAgentDefinitionByName,
  listAgentDefinitionVersions,
} from "./infrastructure/agent-definition-repository.js";
export { hasEverBeenProductionInHistory } from "./infrastructure/deployment-repository.js";
export type { AgentDefinitionRow, AgentDefinitionVersionRow } from "./infrastructure/agent-definition-repository.js";
export type { GitConnectionView } from "./application/git-connection-service.js";
export type { EvalSuiteRow, EvalCaseRow, EvalRunRow } from "./infrastructure/eval-repository.js";
export type { StudioDraftRow, StudioDraftPayload } from "./infrastructure/studio-draft-repository.js";
export type { AgentBlueprintRow } from "./application/blueprint-service.js";

// Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17) — `apps/worker`'s
// `eval.continuous-run` scheduled job calls this directly, mirroring how
// `@nextbot/knowledge` exports `sweepKnowledgeRetention` for its own worker job.
export { runContinuousEvalSweep, type ContinuousEvalSweepResult } from "./application/continuous-eval-service.js";

// Target Architecture Blueprint Phase 12 (BL-43/44) — the single artifact
// validator every authoring mode calls (Text/Design mode indirectly, via
// `createAgentDefinitionVersion`; the Studio's Review step the same way).
// Exported so `studio-single-validator.test.ts` can spy on this exact module
// export.
export { validateAgentDefinitionArtifact, deriveProposedScopeFromArtifact } from "./application/artifact-validator.js";
// Target Architecture Blueprint Phase 1+2 (BL-32/33, LLD §14.9.6) — `ModelProviderRow`/
// `ModelRouteRow`/`ModelRouteVersionRow` moved to `@nextbot/model-gateway`.
export type { ModelProviderRow, ModelRouteRow, ModelRouteVersionRow } from "@nextbot/model-gateway";
export type { AgentRunRow } from "./infrastructure/agent-run-repository.js";

// ---------------------------------------------------------------------------
// Target Architecture Blueprint Phase 17 (BL-48/BL-13, ADR-0019, LLD §15) —
// progressive rollout: the live version resolver, the multi-row split writers, and
// shadow evaluation.
// ---------------------------------------------------------------------------

// The live resolution chain's second hop. `apps/gateway` (the composition root) does the
// `channelId -> agentDefinitionId` lookup — this module may not depend on `channels` or
// `conversations` (LLD §14.1) — and passes ids down.
export { resolveTurnAgentVersion, type ResolvedTurnAgentVersion, type ResolveTurnAgentVersionInput } from "./application/turn-version-resolver.js";
// Exported for direct unit testing of the weighting rule itself, without a database.
export { trafficBucketFor, chooseTrafficAllocation, TRAFFIC_BUCKET_SPACE, type TrafficAllocationCandidate } from "./domain/traffic-bucket.js";
export { checkTrafficSplitAllocations, type TrafficAllocationInput } from "./domain/traffic-split-policy.js";

// FR-AGT-04/05 — the first multi-row-active deployment writers (BL-13's unbuilt core).
// `emergencyRollbackRepoint` is deliberately absent from this list: it is unchanged and
// already exported through `handleEmergencyRollback`.
export {
  setTrafficSplit,
  promoteCanary,
  listActiveDeploymentsForAgentEnvironment,
  listDeploymentHistory,
} from "./application/traffic-split-service.js";
export type { DeploymentRow } from "./infrastructure/deployment-repository.js";
export { listVersionRunMetrics, type VersionRunMetrics } from "./infrastructure/agent-run-repository.js";
// The shadow-exclusion predicate itself, exported so any future `agent_run` aggregate in
// another module can reuse it rather than re-deriving the filter (ADR-0019 §2.5's audit).
export { SHADOW_RUN_TRIGGER, excludeShadowRuns } from "./infrastructure/agent-run-repository.js";

// Shadow evaluation. `apps/worker`'s `deployment.shadow-run-pump`/`shadow-lease-reaper`
// drive the replay through these; `apps/gateway` enqueues via `maybeEnqueueShadowRun`.
export {
  startShadowEvaluation,
  stopShadowEvaluationById,
  maybeEnqueueShadowRun,
  shouldSampleForShadow,
  getShadowEvaluationReport,
  getShadowEvaluation,
  listShadowEvaluations,
  listShadowRuns,
  type ShadowEvaluationReport,
} from "./application/shadow-evaluation-service.js";
export {
  claimDueShadowRuns,
  completeShadowRun,
  deferShadowRun,
  failShadowRun,
  getShadowRun,
  insertShadowRun,
  reclaimExpiredShadowLeases,
  recordShadowSpendAndMaybeAutoStop,
  skipShadowRun,
  SHADOW_RUN_MAX_ATTEMPTS,
  type ShadowEvaluationRow,
  type ShadowRunRow,
} from "./infrastructure/shadow-evaluation-repository.js";
