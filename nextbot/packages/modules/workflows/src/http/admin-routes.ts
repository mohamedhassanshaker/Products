import type { TenantContext } from "@nextbot/db";
import { WorkflowVersionNotFoundError, type UpdateWorkflowRequest, type WorkflowVersionStatusValue } from "@nextbot/contracts";
import {
  createWorkflow,
  createWorkflowVersion,
  getAllowedTransitions,
  getVersion,
  getWorkflowById,
  listVersions,
  listWorkflowsForAdmin,
  structuralDiffVersions,
  transitionWorkflowVersion,
  updateWorkflow,
  validateWorkflowVersionYaml,
} from "../application/workflow-service.js";
import { findWorkflowVersionById, listWorkflowVersions } from "../infrastructure/workflow-repository.js";

/**
 * `http/` layer (LLD §2.2) — plain functions, no framework types. RBAC is applied
 * by the composition root (`apps/web`), which gates every route below on
 * `agent_platform:Read`/`agent_platform:Write` — the same module the Skills
 * Library/Teams surface already use, per this project's established "each new
 * Agent Platform artifact kind is part of that same RBAC surface, not a new
 * module" precedent (spec §5.2).
 *
 * LLD §14.6.4's authoring-half endpoint list, in order. `/sandbox-run` and
 * `/workflow-runs*` are deliberately absent — Phase 16 (see this module's
 * top-level scope-boundary doc, `index.ts`).
 */

/** `GET /api/v1/admin/workflows` */
export async function handleListWorkflows(ctx: TenantContext) {
  return listWorkflowsForAdmin(ctx);
}

/** `POST /api/v1/admin/workflows` — creates the workflow AND its version 1. */
export async function handleCreateWorkflow(ctx: TenantContext, body: { name: string; description?: string; artifact: unknown }, actingUserId: string) {
  return createWorkflow(ctx, body, actingUserId);
}

/** `GET /api/v1/admin/workflows/{id}` */
export async function handleGetWorkflow(ctx: TenantContext, id: string) {
  const workflow = await getWorkflowById(ctx, id);
  return { workflow, versions: await listWorkflowVersions(ctx, id) };
}

/** `PATCH /api/v1/admin/workflows/{id}` */
export async function handleUpdateWorkflow(ctx: TenantContext, id: string, body: UpdateWorkflowRequest) {
  return { workflow: await updateWorkflow(ctx, id, body) };
}

/** `GET /api/v1/admin/workflows/{id}/versions` */
export async function handleListWorkflowVersions(ctx: TenantContext, workflowId: string) {
  return { versions: await listVersions(ctx, workflowId) };
}

/** `POST /api/v1/admin/workflows/{id}/versions` */
export async function handleCreateWorkflowVersion(ctx: TenantContext, workflowId: string, body: { artifact: unknown }, actingUserId: string) {
  return { version: await createWorkflowVersion(ctx, workflowId, body.artifact, actingUserId) };
}

/** `GET /api/v1/admin/workflows/{id}/versions/{versionId}` */
export async function handleGetWorkflowVersion(ctx: TenantContext, versionId: string) {
  const version = await findWorkflowVersionById(ctx, versionId);
  if (!version) throw new WorkflowVersionNotFoundError(versionId);
  return { version, allowedTransitions: await getAllowedTransitions(ctx, versionId) };
}

/** `POST /api/v1/admin/workflows/{id}/versions/{versionId}/validate` — V1-V12
 * without saving. `workflowId` is used only to derive the human-readable scope
 * label the pre-save check runs against — never persisted. */
export async function handleValidateWorkflowVersion(ctx: TenantContext, workflowId: string, yamlText: string) {
  const workflow = await getWorkflowById(ctx, workflowId).catch(() => null);
  return validateWorkflowVersionYaml(ctx, workflow?.name ?? "new_workflow", yamlText);
}

/** `GET /api/v1/admin/workflows/{id}/versions/diff?from&to` — the structural
 * (Git-independent) diff, reused verbatim from `@nextbot/yaml-diff` (ADR-0016/
 * Phase 0's own baseline) — never a second diff mechanism. */
export async function handleDiffWorkflowVersions(ctx: TenantContext, fromVersionId: string, toVersionId: string) {
  const [from, to, changes] = await Promise.all([getVersion(ctx, fromVersionId), getVersion(ctx, toVersionId), structuralDiffVersions(ctx, fromVersionId, toVersionId)]);
  return {
    from: { id: from.id, version: from.version, yaml: from.yaml },
    to: { id: to.id, version: to.version, yaml: to.yaml },
    identical: from.yamlHash === to.yamlHash,
    changes,
  };
}

/** `POST /api/v1/admin/workflows/{id}/versions/{versionId}/transition` */
export async function handleTransitionWorkflowVersion(ctx: TenantContext, versionId: string, to: WorkflowVersionStatusValue, actingUserId: string) {
  return { version: await transitionWorkflowVersion(ctx, versionId, to, actingUserId) };
}
