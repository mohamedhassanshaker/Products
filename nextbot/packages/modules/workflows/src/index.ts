// PUBLIC API for "@nextbot/workflows" (Target Architecture Blueprint Phases 15 and 16,
// BL-47a/BL-47b, FR-WF-01..07, LLD §14.6). Everything else in this module is private.
//
// Two halves, both now built:
//
//  - **Authoring (Phase 15, BL-47a)** — the static workflow graph: schema, cross-field
//    validation V1-V12, the promotion ladder, and the CRUD/validate/diff/transition API.
//  - **Durable execution (Phase 16, BL-47b)** — `workflow_run`/`workflow_run_lease`/
//    `workflow_run_step`, the store-and-lease executor and its resume protocol, run-level
//    budgets (FR-WF-06), FR-WF-04 compensation, suspension + expiry (FR-WF-05), the
//    FR-WF-07 graph trace, and the sandbox-run/runs/cancel/resume/webhook-trigger API.
//
// **Where the executor runs (ADR-0013 §7, 2026-08-30):** `packages/modules/workflows`,
// hosted in-process by `apps/worker`'s `workflow.run-pump` / `workflow.lease-reaper` /
// `workflow.suspension-expiry-sweep` jobs. `apps/runtime` stays an empty Phase-0
// scaffold and is NOT populated; there is no `run-orchestrator` and no queue library.
// Net new deployables for this phase: zero.
//
// Phase 15's own scope note read: "It does NOT build any executor … That is Phase 16
// (LLD §14.6.2/§14.6.4), a separate, later dispatch." This is that dispatch, and
// `domain/promotion-policy.ts`'s `Approved` gate — which Phase 15 correctly left
// unsatisfiable — is now complete and genuinely reachable.

export {
  createWorkflow,
  createWorkflowVersion,
  listWorkflowsForAdmin,
  getWorkflowById,
  listVersions,
  getVersion,
  updateWorkflow,
  validateWorkflowVersionYaml,
  structuralDiffVersions,
  getAllowedTransitions,
  transitionWorkflowVersion,
  type WorkflowValidationOutcome,
} from "./application/workflow-service.js";

export { validateWorkflowGraph } from "./application/graph-validator.js";

export { canPromoteWorkflowVersion, allowedWorkflowVersionTransitions, type WorkflowPromotionCheckInput, type WorkflowPromotionCheckResult } from "./domain/promotion-policy.js";

export { parseWorkflowArtifact, assertWorkflowGraph, serializeWorkflowArtifact, hashWorkflowArtifact } from "./domain/workflow-artifact.js";

export { composeWorkflowVersionScope, composeWorkflowNodeScope } from "./domain/workflow-scope.js";

export {
  findWorkflowById,
  findWorkflowByName,
  findWorkflowVersionById,
  getWorkflow,
  getWorkflowVersion,
  listWorkflowVersions,
  type WorkflowRow,
  type WorkflowVersionRow,
} from "./infrastructure/workflow-repository.js";

export {
  handleListWorkflows,
  handleCreateWorkflow,
  handleGetWorkflow,
  handleUpdateWorkflow,
  handleListWorkflowVersions,
  handleCreateWorkflowVersion,
  handleGetWorkflowVersion,
  handleValidateWorkflowVersion,
  handleDiffWorkflowVersions,
  handleTransitionWorkflowVersion,
} from "./http/admin-routes.js";

// ---------------------------------------------------------------------------
// Durable execution (Phase 16, BL-47b, LLD §14.6.2/§14.6.5)
// ---------------------------------------------------------------------------

// The three `apps/worker` job bodies. `apps/worker` gets thin three-line shims around
// these, matching `escalation-sla-sweep.ts`'s established style — no orchestration logic
// lives in the app itself.
export {
  pumpWorkflowRuns,
  reapWorkflowRunLeases,
  sweepWorkflowSuspensionExpiry,
  reconcileSuspendedRuns,
  type WorkflowPumpDeps,
  type WorkflowPumpResult,
  type WorkflowLeaseReaperResult,
  type WorkflowSuspensionExpiryResult,
} from "./application/run-pump.js";

export { executeRun, newWorkerInstanceId, terminateRunWithOutcome, type ExecuteRunDeps, type ExecuteRunResult } from "./application/run-executor.js";

export {
  startWorkflowRun,
  startSandboxRun,
  listRuns,
  getRunWithTrace,
  cancelRun,
  resumeRun,
  handleWebhookTrigger,
  computeTriggerSignature,
  toRunDto,
  toStepDto,
  type StartRunInput,
  type WebhookTriggerInput,
  type TriggerSecretResolver,
} from "./application/run-service.js";

export {
  handleStartSandboxRun,
  handleListWorkflowRuns,
  handleGetWorkflowRun,
  handleCancelWorkflowRun,
  handleResumeWorkflowRun,
  handleWorkflowWebhookTrigger,
  type ListWorkflowRunsQuery,
} from "./http/run-routes.js";

// The PRODUCTION node runtime. `apps/worker` builds one per tenant per tick, supplying
// the composition root's `EgressPort` — this module has no outbound network access of
// its own (ADR-0004) and, by the `no-mcp-client-inside-workflows` dependency-cruiser
// rule, no way to acquire one.
export { createOrchestrationNodeRuntime } from "./infrastructure/orchestration-node-runtime.js";
export type { WorkflowNodeRuntime, ToolDispatcher, AgentInvoker, SkillInvoker, RouterClassifier, EscalationRaiser, StepMasker } from "./ports/node-runtime.js";

export {
  findWorkflowRunById,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflowRunSteps,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
  type ListWorkflowRunsFilter,
} from "./infrastructure/workflow-run-repository.js";

export { findRunLease, LEASE_TTL_SECONDS, LEASE_RENEW_INTERVAL_SECONDS } from "./infrastructure/workflow-run-lease-repository.js";

// Pure domain helpers other phases (and this module's own tests) legitimately need.
export { emptyCheckpoint, parseCheckpoint, isValidCheckpoint } from "./domain/checkpoint.js";
export { computeIdempotencyKey, compensationIdempotencyKey, type IdempotencyStrategy } from "./domain/idempotency.js";
export { isTerminalRunState, TERMINAL_RUN_STATES, stateForOutcome } from "./domain/run-fsm.js";
export { reachableNodesFromTrigger } from "./application/workflow-service.js";
