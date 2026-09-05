import type { TenantContext } from "@nextbot/db";
import { diffArtifact, type ChangeSet } from "@nextbot/yaml-diff";
import {
  IllegalWorkflowVersionTransition,
  WorkflowGraphValidationError,
  WorkflowNotFoundError,
  WorkflowPromotionBlockedError,
  WorkflowVersionNotFoundError,
  type WorkflowGraph,
  type WorkflowGraphIssue,
  type WorkflowStatusValue,
  type WorkflowVersionStatusValue,
} from "@nextbot/contracts";
import { assertWorkflowGraph, hashWorkflowArtifact, parseWorkflowArtifact, serializeWorkflowArtifact } from "../domain/workflow-artifact.js";
import { composeWorkflowVersionScope } from "../domain/workflow-scope.js";
import { allowedWorkflowVersionTransitions, canPromoteWorkflowVersion, type WorkflowPromotionCheckInput } from "../domain/promotion-policy.js";
import { findWorkflowRunById, listWorkflowRunSteps } from "../infrastructure/workflow-run-repository.js";
import { validateWorkflowGraph } from "./graph-validator.js";
import {
  createWorkflow as insertWorkflow,
  findWorkflowById,
  findWorkflowVersionById,
  getLatestVersionNumber,
  getWorkflow,
  getWorkflowVersion,
  insertWorkflowVersion,
  listWorkflows,
  listWorkflowVersions,
  setWorkflowCurrentVersion,
  setWorkflowVersionStatus,
  updateWorkflowMetadata,
  type WorkflowRow,
  type WorkflowVersionRow,
} from "../infrastructure/workflow-repository.js";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, FR-WF-01/02/04, LLD §14.6.1/
 * §14.6.4) — workflow CRUD, save-time validation, structural diff, and the
 * promotion ladder. Mirrors `skills/application/skill-service.ts` (identity/
 * version split) and `teams/application/team-version-service.ts` (validate/
 * transition shape) — never a third, invented pattern for the same kind of
 * artifact.
 */

/** Resolves (never authors) the workflow-version-level `ScopeDescriptor` used both
 * for a pre-save `validateWorkflowGraph` call AND the persisted `scope_json`
 * column — the SAME value, computed once. `originId`/`originLabel` are the
 * human-readable `"<name>@<version>"` label (not a raw DB row id) — mirrors
 * `skills`' own convention of never needing a real row id to exist before the
 * scope can be computed, so this never has to be recomputed after insert. */
function buildWorkflowScope(name: string, version: number, artifact: WorkflowGraph) {
  const label = `${name}@${version}`;
  return composeWorkflowVersionScope({ workflowVersionId: label, workflowLabel: label, runLimits: artifact.spec.runLimits, spec: artifact.spec.scope });
}

function assertNameMatches(artifact: WorkflowGraph, workflowName: string): void {
  if (artifact.metadata.name !== workflowName) {
    throw new WorkflowGraphValidationError([
      { path: "metadata.name", code: "WORKFLOW_NAME_MISMATCH", message: `Artifact name '${artifact.metadata.name}' does not match workflow '${workflowName}'.` },
    ]);
  }
}

/** Validates the graph and throws `WorkflowGraphValidationError` (carrying EVERY
 * failing rule) if anything failed — the one gate both `createWorkflow*` and
 * `POST .../validate` funnel through, so a bad artifact is never persisted. */
async function assertGraphValid(ctx: TenantContext, artifact: WorkflowGraph, name: string, version: number): Promise<void> {
  const scope = buildWorkflowScope(name, version, artifact);
  const issues = await validateWorkflowGraph(ctx, artifact, scope);
  if (issues.length > 0) throw new WorkflowGraphValidationError(issues);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Creates a workflow with a real version 1 in the same call — there is no
 * "empty" workflow with zero versions (the same convention `skills`/`teams`
 * establish). If the version fails validation, no workflow row is left behind
 * (`insertWorkflow`'s own duplicate-name check runs BEFORE the heavier graph
 * validation, so a name collision fails fast and cheap; a validation failure
 * after that point still leaves no `workflow_version` row, since nothing about
 * `workflow`'s own row depends on the version's content). */
export async function createWorkflow(
  ctx: TenantContext,
  input: { name: string; description?: string; artifact: unknown },
  createdByUserId: string,
): Promise<{ workflow: WorkflowRow; version: WorkflowVersionRow }> {
  const artifact = assertWorkflowGraph(input.artifact);
  assertNameMatches(artifact, input.name);
  await assertGraphValid(ctx, artifact, input.name, 1);

  const workflow = await insertWorkflow(ctx, { name: input.name, description: input.description ?? null, createdByUserId });
  const scope = buildWorkflowScope(input.name, 1, artifact);
  const version = await insertWorkflowVersion(ctx, {
    workflowId: workflow.id,
    version: 1,
    yaml: serializeWorkflowArtifact(artifact),
    yamlHash: hashWorkflowArtifact(artifact),
    graphJson: artifact,
    scopeJson: scope,
    runLimits: artifact.spec.runLimits,
    createdByUserId,
  });
  return { workflow, version };
}

/** Creates the next immutable version for an existing workflow. */
export async function createWorkflowVersion(ctx: TenantContext, workflowId: string, artifactInput: unknown, createdByUserId: string): Promise<WorkflowVersionRow> {
  const workflow = await getWorkflow(ctx, workflowId);
  const artifact = assertWorkflowGraph(artifactInput);
  assertNameMatches(artifact, workflow.name);

  // The DB's monotonic counter is authoritative, never the author-declared
  // `metadata.version` — stamped here BEFORE hashing so the stored artifact's own
  // `metadata.version` always matches the real `workflow_version.version` column
  // (mirrors `skills`' `prepareVersion` discipline).
  const nextVersion = (await getLatestVersionNumber(ctx, workflowId)) + 1;
  const stamped: WorkflowGraph = { ...artifact, metadata: { ...artifact.metadata, version: nextVersion } };
  await assertGraphValid(ctx, stamped, workflow.name, nextVersion);

  const scope = buildWorkflowScope(workflow.name, nextVersion, stamped);
  return insertWorkflowVersion(ctx, {
    workflowId,
    version: nextVersion,
    yaml: serializeWorkflowArtifact(stamped),
    yamlHash: hashWorkflowArtifact(stamped),
    graphJson: stamped,
    scopeJson: scope,
    runLimits: stamped.spec.runLimits,
    createdByUserId,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listWorkflowsForAdmin(ctx: TenantContext): Promise<WorkflowRow[]> {
  return listWorkflows(ctx);
}

export async function getWorkflowById(ctx: TenantContext, id: string): Promise<WorkflowRow> {
  const row = await findWorkflowById(ctx, id);
  if (!row) throw new WorkflowNotFoundError(id);
  return row;
}

export async function listVersions(ctx: TenantContext, workflowId: string): Promise<WorkflowVersionRow[]> {
  await getWorkflow(ctx, workflowId);
  return listWorkflowVersions(ctx, workflowId);
}

export async function getVersion(ctx: TenantContext, versionId: string): Promise<WorkflowVersionRow> {
  return getWorkflowVersion(ctx, versionId);
}

export async function updateWorkflow(ctx: TenantContext, id: string, patch: { description?: string; status?: WorkflowStatusValue }): Promise<WorkflowRow> {
  const updated = await updateWorkflowMetadata(ctx, id, {
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  });
  if (!updated) throw new WorkflowNotFoundError(id);
  return updated;
}

// ---------------------------------------------------------------------------
// Validate (POST .../validate — V1-V12 without saving)
// ---------------------------------------------------------------------------

export interface WorkflowValidationOutcome {
  valid: boolean;
  errors: WorkflowGraphIssue[];
}

/** Parses raw YAML text and runs every V1-V12 rule WITHOUT persisting anything —
 * a structural (TypeBox) failure (from `parseWorkflowArtifact`, which also
 * reports a YAML syntax error through the same shape) and a semantic
 * (graph-validator) failure are both reported through the same `errors[]` shape,
 * so the console never has to special-case which kind of failure it is showing. */
export async function validateWorkflowVersionYaml(ctx: TenantContext, workflowName: string, yamlText: string): Promise<WorkflowValidationOutcome> {
  let artifact: WorkflowGraph;
  try {
    artifact = parseWorkflowArtifact(yamlText);
  } catch (err) {
    if (err instanceof WorkflowGraphValidationError) return { valid: false, errors: err.issues };
    throw err;
  }
  const scope = buildWorkflowScope(workflowName, artifact.metadata.version, artifact);
  const issues = await validateWorkflowGraph(ctx, artifact, scope);
  return { valid: issues.length === 0, errors: issues };
}

// ---------------------------------------------------------------------------
// Structural diff (ADR-0016 — reused verbatim, never a second diff mechanism)
// ---------------------------------------------------------------------------

export async function structuralDiffVersions(ctx: TenantContext, versionAId: string, versionBId: string): Promise<ChangeSet> {
  const [a, b] = await Promise.all([getWorkflowVersion(ctx, versionAId), getWorkflowVersion(ctx, versionBId)]);
  return diffArtifact("WorkflowVersion", a.yaml, b.yaml);
}

// ---------------------------------------------------------------------------
// Promotion ladder
// ---------------------------------------------------------------------------

/**
 * Target Architecture Blueprint Phase 16 (BL-47b) — resolves the version's recorded
 * sandbox run and the graph's reachable-node set, which together are the full LLD
 * §14.6.1 `Approved` gate (Phase 15 could only check `sandbox_run_id IS NOT NULL`,
 * because `workflow_run` did not exist).
 *
 * Resolved HERE, in the application layer, so `domain/promotion-policy.ts` stays pure
 * and dependency-free — the same discipline `lastEvalRun` already follows, and what lets
 * one function back both the console's `allowedTransitions` hint and the real
 * enforcement inside the transaction.
 */
async function resolveSandboxGateInputs(
  ctx: TenantContext,
  version: WorkflowVersionRow,
): Promise<Pick<WorkflowPromotionCheckInput, "sandboxRun" | "reachableNodeIds">> {
  const reachableNodeIds = reachableNodesFromTrigger(version.graphJson);
  if (!version.sandboxRunId) return { sandboxRun: null, reachableNodeIds };

  const run = await findWorkflowRunById(ctx, version.sandboxRunId);
  if (!run) return { sandboxRun: null, reachableNodeIds };

  const steps = await listWorkflowRunSteps(ctx, run.id);
  return {
    sandboxRun: {
      workflowVersionId: run.workflowVersionId,
      state: run.state,
      // Any status counts, INCLUDING `Skipped` — see the policy's own module doc for
      // why (a Router branch not taken is legitimately not executed, and requiring it
      // would make every graph with a Router unpromotable).
      coveredNodeIds: [...new Set(steps.map((s) => s.nodeId))],
    },
    reachableNodeIds,
  };
}

/**
 * Every node id reachable from the single `Trigger` node, following `next`, Router
 * `branches`/`default`, Parallel `branches`/`joinNodeId`, Loop `bodyEntryNodeId`, and
 * HumanTask `onReject`.
 *
 * This is the DENOMINATOR of the coverage bar, computed from the authored graph rather
 * than from the run, so a run cannot define its own success criterion. V3 already
 * guarantees every node is reachable and every path terminates, so in practice this
 * returns the whole node set — it is computed properly anyway rather than assumed, so the
 * gate stays correct if V3's own semantics are ever relaxed.
 */
export function reachableNodesFromTrigger(graph: WorkflowGraph): string[] {
  const byId = new Map(graph.spec.nodes.map((n) => [n.id, n]));
  const trigger = graph.spec.nodes.find((n) => n.kind === "Trigger");
  if (!trigger) return [];

  const seen = new Set<string>();
  const queue = [trigger.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node) continue;
    for (const target of outgoingEdges(node)) {
      if (byId.has(target) && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen];
}

/** Every node id one node can hand control to. Kept as one exhaustive switch so a new
 *  node kind cannot silently contribute zero edges and quietly shrink the coverage bar. */
function outgoingEdges(node: WorkflowGraph["spec"]["nodes"][number]): string[] {
  switch (node.kind) {
    case "Trigger":
    case "Agent":
    case "Skill":
    case "ToolCall":
      return [node.next];
    case "Router":
      return [...node.branches.map((b) => b.to), ...(node.default ? [node.default] : [])];
    case "HumanTask":
      return [node.next, ...(node.onReject ? [node.onReject] : [])];
    case "Parallel":
      return [...node.branches, node.joinNodeId];
    case "Join":
      return [node.next];
    case "Loop":
      return [node.bodyEntryNodeId, node.next];
    case "SubWorkflow":
    case "Wait":
      return [node.next];
    case "End":
      return [];
    default: {
      const exhaustive: never = node;
      throw new Error(`outgoingEdges: unhandled node kind ${JSON.stringify(exhaustive)}`);
    }
  }
}

export async function getAllowedTransitions(ctx: TenantContext, versionId: string): Promise<WorkflowVersionStatusValue[]> {
  const version = await findWorkflowVersionById(ctx, versionId);
  if (!version) throw new WorkflowVersionNotFoundError(versionId);
  return allowedWorkflowVersionTransitions({
    currentStatus: version.status,
    versionId: version.id,
    createdByUserId: version.createdByUserId,
    actingUserId: null,
    lastEvalRun: null, // see domain/promotion-policy.ts's own doc: no eval-run-trigger endpoint exists in this phase's API surface
    yamlHash: version.yamlHash,
    sandboxRunId: version.sandboxRunId,
    ...(await resolveSandboxGateInputs(ctx, version)),
    hasActiveTraffic: false, // no workflow deployment/traffic-split surface exists yet
  });
}

/**
 * `POST /api/v1/admin/workflows/{id}/versions/{versionId}/transition`.
 *
 * The FSM decision is `domain/promotion-policy.ts`'s — the same function that
 * produces the console's `allowedTransitions` hint — so the UI and the
 * enforcement can never disagree, and the client's opinion is never trusted.
 */
export async function transitionWorkflowVersion(ctx: TenantContext, versionId: string, to: WorkflowVersionStatusValue, actingUserId: string): Promise<WorkflowVersionRow> {
  const version = await findWorkflowVersionById(ctx, versionId);
  if (!version) throw new WorkflowVersionNotFoundError(versionId);

  const check = canPromoteWorkflowVersion({
    currentStatus: version.status,
    targetStatus: to,
    versionId: version.id,
    createdByUserId: version.createdByUserId,
    actingUserId,
    lastEvalRun: null,
    yamlHash: version.yamlHash,
    sandboxRunId: version.sandboxRunId,
    ...(await resolveSandboxGateInputs(ctx, version)),
    hasActiveTraffic: false,
  });

  if (!check.allowed) {
    const isIllegalEdge = check.reason.startsWith("Cannot promote to") || check.reason.includes("already");
    if (isIllegalEdge) throw new IllegalWorkflowVersionTransition(version.status, to);
    throw new WorkflowPromotionBlockedError(check.reason);
  }

  const updated = await setWorkflowVersionStatus(ctx, versionId, to, to === "Approved" ? actingUserId : undefined);
  if (!updated) throw new WorkflowVersionNotFoundError(versionId);
  if (to === "Production") await setWorkflowCurrentVersion(ctx, version.workflowId, versionId);
  return updated;
}
