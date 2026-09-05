import { and, asc, desc, eq, max } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { GitPrStatusValue, WorkflowGraph, WorkflowRunLimits, WorkflowStatusValue, WorkflowVersionStatusValue } from "@nextbot/contracts";
import { WorkflowNameDuplicateError, WorkflowNotFoundError, WorkflowVersionNotFoundError } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.1) — persistence for
 * `workflow` / `workflow_version`.
 *
 * **Immutability, layer 1 of 3.** This file deliberately exposes no generic
 * `updateWorkflowVersion`. `workflow_version` can only be created, and then have
 * its promotion-ladder bookkeeping columns set through the narrow
 * `setWorkflowVersionStatus`/`bindWorkflowVersionSandboxRun`/
 * `setWorkflowVersionEvalBinding` functions. Layer 2 is migration `0079`'s
 * `workflow_version_immutable` BEFORE UPDATE trigger (so even raw SQL cannot
 * bypass layer 1); layer 3 is `workflows.immutability.int.test.ts`.
 */

export interface WorkflowRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: WorkflowStatusValue;
  currentVersionId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowVersionRow {
  id: string;
  tenantId: string;
  workflowId: string;
  version: number;
  yaml: string;
  yamlHash: string;
  graphJson: WorkflowGraph;
  scopeJson: unknown;
  runLimits: WorkflowRunLimits;
  status: WorkflowVersionStatusValue;
  evalSuiteId: string | null;
  lastEvalRunId: string | null;
  sandboxRunId: string | null;
  gitCommitSha: string | null;
  gitPrNumber: number | null;
  gitPrStatus: GitPrStatusValue;
  createdByUserId: string;
  approvedByUserId: string | null;
  createdAt: Date;
}

export interface NewWorkflowVersionInput {
  workflowId: string;
  version?: number;
  yaml: string;
  yamlHash: string;
  graphJson: WorkflowGraph;
  scopeJson: unknown;
  runLimits: WorkflowRunLimits;
  gitCommitSha?: string | null;
  createdByUserId: string;
}

export async function createWorkflow(ctx: TenantContext, input: { name: string; description: string | null; createdByUserId: string }): Promise<WorkflowRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db.select({ id: schema.workflow.id }).from(schema.workflow).where(and(eq(schema.workflow.tenantId, ctx.tenantId), eq(schema.workflow.name, input.name)));
    if (existing.length > 0) throw new WorkflowNameDuplicateError(input.name);

    const rows = await db
      .insert(schema.workflow)
      .values({ id: generateId(), tenantId: ctx.tenantId, name: input.name, description: input.description, createdByUserId: input.createdByUserId })
      .returning();
    return rows[0]! as WorkflowRow;
  });
}

export async function listWorkflows(ctx: TenantContext): Promise<WorkflowRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.workflow).where(eq(schema.workflow.tenantId, ctx.tenantId)).orderBy(asc(schema.workflow.name));
    return rows as WorkflowRow[];
  });
}

export async function findWorkflowById(ctx: TenantContext, id: string): Promise<WorkflowRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.workflow).where(and(eq(schema.workflow.tenantId, ctx.tenantId), eq(schema.workflow.id, id)));
    return (rows[0] as WorkflowRow | undefined) ?? null;
  });
}

export async function getWorkflow(ctx: TenantContext, id: string): Promise<WorkflowRow> {
  const row = await findWorkflowById(ctx, id);
  if (!row) throw new WorkflowNotFoundError(id);
  return row;
}

export async function findWorkflowByName(ctx: TenantContext, name: string): Promise<WorkflowRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.workflow).where(and(eq(schema.workflow.tenantId, ctx.tenantId), eq(schema.workflow.name, name)));
    return (rows[0] as WorkflowRow | undefined) ?? null;
  });
}

export async function updateWorkflowMetadata(
  ctx: TenantContext,
  id: string,
  patch: { description?: string | null; status?: WorkflowStatusValue },
): Promise<WorkflowRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .update(schema.workflow)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.workflow.tenantId, ctx.tenantId), eq(schema.workflow.id, id)))
      .returning();
    return (rows[0] as WorkflowRow | undefined) ?? null;
  });
}

/** The next monotonic version ordinal for a workflow. Read inside the SAME
 * transaction that inserts, so two concurrent creates cannot both compute `N+1`
 * and silently lose one — the loser hits `workflow_version_tenant_workflow_
 * version_key` and fails loudly, the correct outcome for an immutable-version
 * artifact. */
async function nextVersionOrdinal(db: TenantScopedClient, tenantId: string, workflowId: string): Promise<number> {
  const rows = await db
    .select({ current: max(schema.workflowVersion.version) })
    .from(schema.workflowVersion)
    .where(and(eq(schema.workflowVersion.tenantId, tenantId), eq(schema.workflowVersion.workflowId, workflowId)));
  return (rows[0]?.current ?? 0) + 1;
}

/** The current latest version ordinal for a workflow (0 if it has none yet) — used
 * by the application layer to stamp the AUTHOR-DECLARED `metadata.version` with
 * the real, about-to-be-assigned ordinal before hashing (mirrors `skills`' own
 * `getLatestVersionNumber` + `prepareVersion` re-stamping discipline: the DB's
 * monotonic counter is authoritative, never the authored value). */
export async function getLatestVersionNumber(ctx: TenantContext, workflowId: string): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ current: max(schema.workflowVersion.version) })
      .from(schema.workflowVersion)
      .where(and(eq(schema.workflowVersion.tenantId, ctx.tenantId), eq(schema.workflowVersion.workflowId, workflowId)));
    return rows[0]?.current ?? 0;
  });
}

export async function insertWorkflowVersion(ctx: TenantContext, input: NewWorkflowVersionInput): Promise<WorkflowVersionRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const version = input.version ?? (await nextVersionOrdinal(db, ctx.tenantId, input.workflowId));
    const rows = await db
      .insert(schema.workflowVersion)
      .values({
        id: generateId(),
        tenantId: ctx.tenantId,
        workflowId: input.workflowId,
        version,
        yaml: input.yaml,
        yamlHash: input.yamlHash,
        graphJson: input.graphJson,
        scopeJson: input.scopeJson,
        runLimits: input.runLimits,
        gitCommitSha: input.gitCommitSha ?? null,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    return rows[0]! as WorkflowVersionRow;
  });
}

export async function listWorkflowVersions(ctx: TenantContext, workflowId: string): Promise<WorkflowVersionRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.workflowVersion)
      .where(and(eq(schema.workflowVersion.tenantId, ctx.tenantId), eq(schema.workflowVersion.workflowId, workflowId)))
      .orderBy(desc(schema.workflowVersion.version));
    return rows as WorkflowVersionRow[];
  });
}

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.5) — every `Production`
 * version for this tenant, which is the set the webhook trigger surface resolves a path
 * against.
 *
 * Deliberately `Production` only: a Draft/Approved version carrying a `Webhook` trigger
 * is NOT addressable, so promoting a version is what makes its endpoint live. That is
 * the same "only Production serves traffic" rule every other artifact in this codebase
 * follows, and it means an in-review workflow cannot be invoked from the internet by
 * anyone who guesses its path.
 */
export async function listProductionWorkflowVersions(ctx: TenantContext): Promise<WorkflowVersionRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.workflowVersion)
      .where(and(eq(schema.workflowVersion.tenantId, ctx.tenantId), eq(schema.workflowVersion.status, "Production")));
    return rows as WorkflowVersionRow[];
  });
}

export async function findWorkflowVersionById(ctx: TenantContext, id: string): Promise<WorkflowVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.workflowVersion).where(and(eq(schema.workflowVersion.tenantId, ctx.tenantId), eq(schema.workflowVersion.id, id)));
    return (rows[0] as WorkflowVersionRow | undefined) ?? null;
  });
}

export async function getWorkflowVersion(ctx: TenantContext, id: string): Promise<WorkflowVersionRow> {
  const row = await findWorkflowVersionById(ctx, id);
  if (!row) throw new WorkflowVersionNotFoundError(id);
  return row;
}

/** The ONLY status-mutating path (immutability layer 1). `approvedByUserId` is
 * written in the same statement as the `Approved` status so the DB's
 * `workflow_version_approver_distinct` CHECK evaluates against the real pair. */
export async function setWorkflowVersionStatus(
  ctx: TenantContext,
  id: string,
  status: WorkflowVersionStatusValue,
  approvedByUserId?: string | null,
): Promise<WorkflowVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .update(schema.workflowVersion)
      .set({ status, ...(approvedByUserId !== undefined ? { approvedByUserId } : {}) })
      .where(and(eq(schema.workflowVersion.tenantId, ctx.tenantId), eq(schema.workflowVersion.id, id)))
      .returning();
    return (rows[0] as WorkflowVersionRow | undefined) ?? null;
  });
}

/** LLD §14.6.1 — records which sandbox run this version was exercised against.
 * Phase 16's executor is the real writer of this column; no endpoint in THIS
 * phase's API surface calls it (see `domain/promotion-policy.ts`'s own module
 * doc) — kept here now so Phase 16 has a ready-made, already-reviewed write path
 * rather than inventing a second one. */
export async function bindWorkflowVersionSandboxRun(ctx: TenantContext, id: string, sandboxRunId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.update(schema.workflowVersion).set({ sandboxRunId }).where(and(eq(schema.workflowVersion.tenantId, ctx.tenantId), eq(schema.workflowVersion.id, id)));
  });
}

/** Same disclosed status as `bindWorkflowVersionSandboxRun` — no eval-run-trigger
 * endpoint exists in this phase's API surface, so this setter is currently only
 * reachable from a test/manual call, not a real HTTP handler. Kept for the same
 * "ready-made write path" reason. */
export async function setWorkflowVersionEvalBinding(ctx: TenantContext, id: string, input: { evalSuiteId?: string | null; lastEvalRunId?: string | null }): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.update(schema.workflowVersion).set({ ...input }).where(and(eq(schema.workflowVersion.tenantId, ctx.tenantId), eq(schema.workflowVersion.id, id)));
  });
}

export async function setWorkflowCurrentVersion(ctx: TenantContext, workflowId: string, versionId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.update(schema.workflow).set({ currentVersionId: versionId, updatedAt: new Date() }).where(and(eq(schema.workflow.tenantId, ctx.tenantId), eq(schema.workflow.id, workflowId)));
  });
}
