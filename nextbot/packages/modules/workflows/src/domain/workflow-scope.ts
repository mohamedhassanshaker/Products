import type { ScopeDescriptor, WorkflowRunLimits, WorkflowScopeSpec } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.1) — composes the
 * `ScopeDescriptor` a `workflow_version` / workflow node is stored with and handed
 * to `@nextbot/authz`'s evaluator as a chain level. Pure (`domain/`, no I/O).
 * Mirrors `teams/domain/team-scope.ts`'s `composeTeamVersionScope`/
 * `composeTeamMemberScope` exactly — same reasoning, same shape.
 *
 * **This is where the workflow's authored `runLimits` become the Phase 6
 * evaluator's own enforcement (V10, `application/graph-validator.ts`) rather than a
 * second, independently-derived check.** `maxLoopIterations` is deliberately NOT
 * projected onto the lattice's `budget` dimension: it has no lattice equivalent
 * (the evaluator has no notion of "loop iteration count"), the same disclosed
 * omission `team-scope.ts` documents for its own `thrashWindow` — it stays the
 * (future) Phase-16 executor's own guard.
 *
 * An authored dimension that is absent is left OMITTED, never defaulted to a
 * concrete value (LLD §14.2.1's E3: an omitted dimension is the lattice top).
 */

/** Copies only the dimensions the author actually declared. */
function spreadDeclared(spec: WorkflowScopeSpec | undefined): Partial<ScopeDescriptor> {
  if (!spec) return {};
  return {
    ...(spec.capabilityGroupIds !== undefined ? { capabilityGroupIds: spec.capabilityGroupIds } : {}),
    ...(spec.toolIds !== undefined ? { toolIds: spec.toolIds } : {}),
    ...(spec.deniedToolIds !== undefined ? { deniedToolIds: spec.deniedToolIds } : {}),
    ...(spec.knowledgeCollectionIds !== undefined ? { knowledgeCollectionIds: spec.knowledgeCollectionIds } : {}),
    ...(spec.rwClasses !== undefined ? { rwClasses: spec.rwClasses } : {}),
    ...(spec.autonomyCeiling !== undefined ? { autonomyCeiling: spec.autonomyCeiling } : {}),
    ...(spec.minRequiredTier !== undefined ? { minRequiredTier: spec.minRequiredTier } : {}),
    ...(spec.trustLevel !== undefined ? { trustLevel: spec.trustLevel } : {}),
  };
}

/**
 * Builds `workflow_version.scope_json` (`origin: 'WorkflowVersion'`).
 *
 * @param workflowLabel `"<workflowName>@<version>"` — appears verbatim in the
 *   evaluator's per-dimension trace and in the Approval Queue, so it must be
 *   human-readable.
 */
export function composeWorkflowVersionScope(args: {
  workflowVersionId: string;
  workflowLabel: string;
  runLimits: WorkflowRunLimits;
  spec: WorkflowScopeSpec | undefined;
}): ScopeDescriptor {
  return {
    origin: "WorkflowVersion",
    originId: args.workflowVersionId,
    originLabel: args.workflowLabel,
    ...spreadDeclared(args.spec),
    budget: {
      maxSteps: args.runLimits.maxSteps,
      usdPerTurn: args.runLimits.maxCostUsd,
      seconds: args.runLimits.maxWallClockSeconds,
      maxDepth: args.runLimits.maxSubWorkflowDepth,
      maxFanOut: args.runLimits.maxParallelBranches,
    },
  };
}

/** Builds a node's own `scope` narrowing (`origin: 'WorkflowNode'`). A node
 * declares no budget of its own — the run-level `runLimits` ceilings are already
 * the workflow-version level's own `budget` projection above; letting a node author
 * its own budget would be the same per-node accounting FR-ORC-07 (team's own
 * precedent) rules out for delegation. */
export function composeWorkflowNodeScope(args: { nodeOriginId: string; nodeLabel: string; spec: WorkflowScopeSpec | undefined }): ScopeDescriptor {
  return {
    origin: "WorkflowNode",
    originId: args.nodeOriginId,
    originLabel: args.nodeLabel,
    ...spreadDeclared(args.spec),
  };
}
