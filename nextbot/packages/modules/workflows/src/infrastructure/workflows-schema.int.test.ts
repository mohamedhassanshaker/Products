import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant } from "@nextbot/db";
import { hashWorkflowArtifact } from "../domain/workflow-artifact.js";
import { minimalWorkflowArtifact } from "../testing/workflow-fixtures.js";
import {
  createWorkflow,
  insertWorkflowVersion,
  setWorkflowVersionStatus,
  bindWorkflowVersionSandboxRun,
  findWorkflowByName,
  setWorkflowVersionEvalBinding,
  setWorkflowCurrentVersion,
  findWorkflowById,
  listWorkflowVersions,
} from "./workflow-repository.js";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.1) — real-Postgres
 * proof of `workflow_version`'s three-layer immutability enforcement and its
 * schema-level invariants. Mirrors `teams/infrastructure/teams-schema.int.
 * test.ts`'s `team_version` suite exactly (this codebase's own established name
 * for where this proof actually lives, despite doc comments elsewhere in this
 * module referring to it — aspirationally, matching that same pre-existing
 * pattern — as `workflows.immutability.int.test.ts`).
 */

const AUTHOR = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function fixture() {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  const workflow = await createWorkflow(ctx, { name: "wf_schema_fixture", description: null, createdByUserId: AUTHOR });
  return { ctx, workflow };
}

describe("workflow_version schema invariants (real Postgres)", () => {
  it("workflow_version is IMMUTABLE — the trigger rejects a change to any authored column", async () => {
    const { ctx, workflow } = await fixture();
    const artifact = minimalWorkflowArtifact("wf_schema_fixture");
    const version = await insertWorkflowVersion(ctx, {
      workflowId: workflow.id,
      yaml: "kind: Workflow",
      yamlHash: hashWorkflowArtifact(artifact),
      graphJson: artifact,
      scopeJson: { origin: "WorkflowVersion", originId: "x", originLabel: "x" },
      runLimits: artifact.spec.runLimits,
      createdByUserId: AUTHOR,
    });

    await expect(withTenant(ctx, (db) => db.execute(sql`UPDATE workflow_version SET yaml = 'tampered' WHERE id = ${version.id}`))).rejects.toThrow(
      /WORKFLOW_VERSION_IMMUTABLE/,
    );
    await expect(withTenant(ctx, (db) => db.execute(sql`UPDATE workflow_version SET graph_json = '{}'::jsonb WHERE id = ${version.id}`))).rejects.toThrow(
      /WORKFLOW_VERSION_IMMUTABLE/,
    );

    // …but the promotion-ladder columns the repository legitimately sets still work.
    const promoted = await setWorkflowVersionStatus(ctx, version.id, "EvalGated");
    expect(promoted?.status).toBe("EvalGated");

    // Target Architecture Blueprint Phase 16 (BL-47b): this used to bind a FABRICATED
    // uuid, which was only possible because `workflow_version.sandbox_run_id` was
    // deliberately FK-less while `workflow_run` did not exist (Phase 15's own disclosed
    // relaxation). Migration `0081` completes the real FK now that the target table
    // exists, so the binding needs a REAL run — which is strictly better: the column now
    // cannot point at a run that never happened.
    const { createWorkflowRun } = await import("./workflow-run-repository.js");
    const { emptyCheckpoint } = await import("../domain/checkpoint.js");
    const { run: sandboxRun } = await createWorkflowRun(ctx, {
      workflowVersionId: version.id,
      triggerKind: "Sandbox",
      checkpoint: emptyCheckpoint(),
      scopeHash: "h",
      otelTraceId: "t",
      idempotencyKey: `schema-test-${version.id}`,
    });
    await bindWorkflowVersionSandboxRun(ctx, version.id, sandboxRun.id);

    // The stored hash still matches the stored yaml — layer 3 of the three-layer
    // immutability enforcement.
    const stored = await withTenant(ctx, (db) => db.select().from(schema.workflowVersion).where(eq(schema.workflowVersion.id, version.id)));
    expect(stored[0]?.yaml).toBe("kind: Workflow");
    expect(stored[0]?.yamlHash).toBe(hashWorkflowArtifact(artifact));
    expect(stored[0]?.sandboxRunId).toBe(sandboxRun.id);
  });

  it("workflow_version_approver_distinct: the author cannot be recorded as the approver", async () => {
    const { ctx, workflow } = await fixture();
    const artifact = minimalWorkflowArtifact("wf_schema_fixture2");
    const version = await insertWorkflowVersion(ctx, {
      workflowId: workflow.id,
      yaml: "y",
      yamlHash: "h",
      graphJson: artifact,
      scopeJson: {},
      runLimits: artifact.spec.runLimits,
      createdByUserId: AUTHOR,
    });

    await expect(setWorkflowVersionStatus(ctx, version.id, "Approved", AUTHOR)).rejects.toThrow(/workflow_version_approver_distinct/);
    const approved = await setWorkflowVersionStatus(ctx, version.id, "Approved", REVIEWER);
    expect(approved?.approvedByUserId).toBe(REVIEWER);
  });

  it("workflow_tenant_name_key: two workflows cannot share a name within the same tenant", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await createWorkflow(ctx, { name: "dup_workflow", description: null, createdByUserId: AUTHOR });
    await expect(createWorkflow(ctx, { name: "dup_workflow", description: null, createdByUserId: AUTHOR })).rejects.toThrow(/already exists/);
  });

  it("findWorkflowByName resolves a real workflow by name, and null for a name that doesn't exist", async () => {
    const { ctx, workflow } = await fixture();
    expect((await findWorkflowByName(ctx, "wf_schema_fixture"))?.id).toBe(workflow.id);
    expect(await findWorkflowByName(ctx, "no_such_workflow")).toBeNull();
  });

  it("setWorkflowVersionEvalBinding sets evalSuiteId/lastEvalRunId — the ready-made write path Phase 16's eval-run trigger will use", async () => {
    const { ctx, workflow } = await fixture();
    const artifact = minimalWorkflowArtifact("wf_schema_eval");
    const version = await insertWorkflowVersion(ctx, {
      workflowId: workflow.id,
      yaml: "y",
      yamlHash: "h",
      graphJson: artifact,
      scopeJson: {},
      runLimits: artifact.spec.runLimits,
      createdByUserId: AUTHOR,
    });
    await setWorkflowVersionEvalBinding(ctx, version.id, { evalSuiteId: "11111111-1111-1111-1111-111111111111", lastEvalRunId: "22222222-2222-2222-2222-222222222222" });
    const stored = await withTenant(ctx, (db) => db.select().from(schema.workflowVersion).where(eq(schema.workflowVersion.id, version.id)));
    expect(stored[0]?.evalSuiteId).toBe("11111111-1111-1111-1111-111111111111");
    expect(stored[0]?.lastEvalRunId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("setWorkflowCurrentVersion points workflow.current_version_id at the given version (set on Production promotion)", async () => {
    const { ctx, workflow } = await fixture();
    const artifact = minimalWorkflowArtifact("wf_schema_current");
    const version = await insertWorkflowVersion(ctx, {
      workflowId: workflow.id,
      yaml: "y",
      yamlHash: "h",
      graphJson: artifact,
      scopeJson: {},
      runLimits: artifact.spec.runLimits,
      createdByUserId: AUTHOR,
    });
    await setWorkflowCurrentVersion(ctx, workflow.id, version.id);
    const updated = await findWorkflowById(ctx, workflow.id);
    expect(updated?.currentVersionId).toBe(version.id);
  });

  it("listWorkflowVersions returns every version for a workflow, newest first", async () => {
    const { ctx, workflow } = await fixture();
    const artifact = minimalWorkflowArtifact("wf_schema_list");
    await insertWorkflowVersion(ctx, { workflowId: workflow.id, yaml: "v1", yamlHash: "h1", graphJson: artifact, scopeJson: {}, runLimits: artifact.spec.runLimits, createdByUserId: AUTHOR });
    await insertWorkflowVersion(ctx, { workflowId: workflow.id, yaml: "v2", yamlHash: "h2", graphJson: artifact, scopeJson: {}, runLimits: artifact.spec.runLimits, createdByUserId: AUTHOR });
    const versions = await listWorkflowVersions(ctx, workflow.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it("workflow_version_tenant_workflow_version_key: version ordinals are monotonic and unique per workflow", async () => {
    const { ctx, workflow } = await fixture();
    const artifact = minimalWorkflowArtifact("wf_schema_fixture3");
    const v1 = await insertWorkflowVersion(ctx, {
      workflowId: workflow.id,
      yaml: "v1",
      yamlHash: "h1",
      graphJson: artifact,
      scopeJson: {},
      runLimits: artifact.spec.runLimits,
      createdByUserId: AUTHOR,
    });
    const v2 = await insertWorkflowVersion(ctx, {
      workflowId: workflow.id,
      yaml: "v2",
      yamlHash: "h2",
      graphJson: artifact,
      scopeJson: {},
      runLimits: artifact.spec.runLimits,
      createdByUserId: AUTHOR,
    });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
  });
});
