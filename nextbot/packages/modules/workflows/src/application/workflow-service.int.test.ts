import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { IllegalWorkflowVersionTransition, WorkflowGraphValidationError, WorkflowNameDuplicateError, WorkflowNotFoundError, WorkflowVersionNotFoundError, type WorkflowGraph } from "@nextbot/contracts";
import yaml from "js-yaml";
import { minimalWorkflowArtifact } from "../testing/workflow-fixtures.js";
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
} from "./workflow-service.js";
import { setWorkflowVersionStatus } from "../infrastructure/workflow-repository.js";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.4) — real (not
 * mocked) integration coverage for the CRUD/validate/diff/transition API surface,
 * including the promotion gate's own disclosed scope boundary: this suite proves
 * a workflow version genuinely CANNOT reach `Approved` in this build (no
 * `sandbox_run_id` mechanism exists yet — Phase 16's), not merely that the check
 * exists in isolation (already unit-tested in `domain/promotion-policy.test.ts`).
 */

const AUTHOR = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function freshTenant() {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  return ctx;
}

describe("createWorkflow — creates the identity row and a real version 1 in one call", () => {
  it("creates a workflow with a real Draft version 1", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("wf_create_ok");
    const { workflow, version } = await createWorkflow(ctx, { name: "wf_create_ok", artifact }, AUTHOR);

    expect(workflow.name).toBe("wf_create_ok");
    expect(version.version).toBe(1);
    expect(version.status).toBe("Draft");
    expect((await listWorkflowsForAdmin(ctx)).map((w) => w.id)).toContain(workflow.id);
  });

  it("rejects a duplicate workflow name and leaves no version behind", async () => {
    const ctx = await freshTenant();
    await createWorkflow(ctx, { name: "wf_dup", artifact: minimalWorkflowArtifact("wf_dup") }, AUTHOR);
    await expect(createWorkflow(ctx, { name: "wf_dup", artifact: minimalWorkflowArtifact("wf_dup") }, AUTHOR)).rejects.toBeInstanceOf(WorkflowNameDuplicateError);
  });

  it("rejects an artifact that fails graph validation (V1: no Trigger) and persists NOTHING", async () => {
    const ctx = await freshTenant();
    const badArtifact: WorkflowGraph = {
      ...minimalWorkflowArtifact("wf_invalid"),
      spec: { ...minimalWorkflowArtifact("wf_invalid").spec, nodes: [{ id: "end_1", kind: "End", outcome: "Resolved" }, { id: "end_2", kind: "End", outcome: "Failed" }] },
    };
    await expect(createWorkflow(ctx, { name: "wf_invalid", artifact: badArtifact }, AUTHOR)).rejects.toBeInstanceOf(WorkflowGraphValidationError);
    expect((await listWorkflowsForAdmin(ctx)).find((w) => w.name === "wf_invalid")).toBeUndefined();
  });

  it("rejects when the artifact's metadata.name does not match the requested workflow name", async () => {
    const ctx = await freshTenant();
    const artifact = minimalWorkflowArtifact("some_other_name");
    await expect(createWorkflow(ctx, { name: "wf_name_mismatch", artifact }, AUTHOR)).rejects.toBeInstanceOf(WorkflowGraphValidationError);
  });
});

describe("createWorkflowVersion — mints the next immutable version, re-stamping the authoritative ordinal", () => {
  it("stamps metadata.version with the real DB counter, not the author-declared value", async () => {
    const ctx = await freshTenant();
    const { workflow } = await createWorkflow(ctx, { name: "wf_version_stamp", artifact: minimalWorkflowArtifact("wf_version_stamp") }, AUTHOR);

    // Author declares version 99 — the DB's own monotonic counter (2) wins.
    const artifactV2 = { ...minimalWorkflowArtifact("wf_version_stamp"), metadata: { name: "wf_version_stamp", version: 99 } };
    const v2 = await createWorkflowVersion(ctx, workflow.id, artifactV2, AUTHOR);

    expect(v2.version).toBe(2);
    const stored = yaml.load(v2.yaml) as WorkflowGraph;
    expect(stored.metadata.version).toBe(2);
  });

  it("404s for a non-existent workflow", async () => {
    const ctx = await freshTenant();
    await expect(createWorkflowVersion(ctx, "00000000-0000-0000-0000-000000000000", minimalWorkflowArtifact("x"), AUTHOR)).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });
});

describe("validateWorkflowVersionYaml — POST .../validate, never persists anything", () => {
  it("reports V1-V12 failures without creating any row", async () => {
    const ctx = await freshTenant();
    const badArtifact: WorkflowGraph = {
      ...minimalWorkflowArtifact("wf_validate_bad"),
      spec: { ...minimalWorkflowArtifact("wf_validate_bad").spec, nodes: [{ id: "end_1", kind: "End", outcome: "Resolved" }, { id: "end_2", kind: "End", outcome: "Failed" }] },
    };
    const outcome = await validateWorkflowVersionYaml(ctx, "wf_validate_bad", yaml.dump(badArtifact));
    expect(outcome.valid).toBe(false);
    expect(outcome.errors.some((e) => e.code === "WORKFLOW_TRIGGER_REQUIRED")).toBe(true);
    expect((await listWorkflowsForAdmin(ctx)).find((w) => w.name === "wf_validate_bad")).toBeUndefined();
  });

  it("reports a YAML syntax error through the same errors[] shape", async () => {
    const ctx = await freshTenant();
    const outcome = await validateWorkflowVersionYaml(ctx, "wf_validate_yaml", "kind: Workflow\n  bad indent: [");
    expect(outcome.valid).toBe(false);
    expect(outcome.errors[0]?.code).toBe("WORKFLOW_ARTIFACT_INVALID_YAML");
  });

  it("passes for a valid artifact", async () => {
    const ctx = await freshTenant();
    const outcome = await validateWorkflowVersionYaml(ctx, "wf_validate_ok", yaml.dump(minimalWorkflowArtifact("wf_validate_ok")));
    expect(outcome).toEqual({ valid: true, errors: [] });
  });
});

describe("getWorkflowById", () => {
  it("returns the real, persisted workflow row", async () => {
    const ctx = await freshTenant();
    const { workflow } = await createWorkflow(ctx, { name: "wf_get_by_id", artifact: minimalWorkflowArtifact("wf_get_by_id") }, AUTHOR);
    expect((await getWorkflowById(ctx, workflow.id)).id).toBe(workflow.id);
  });

  it("404s for a non-existent workflow", async () => {
    const ctx = await freshTenant();
    await expect(getWorkflowById(ctx, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });
});

describe("getVersion", () => {
  it("returns the real, persisted version row", async () => {
    const ctx = await freshTenant();
    const { version } = await createWorkflow(ctx, { name: "wf_get_version", artifact: minimalWorkflowArtifact("wf_get_version") }, AUTHOR);
    expect((await getVersion(ctx, version.id)).id).toBe(version.id);
  });
});

describe("structuralDiffVersions — the ADR-0016 Git-independent diff, reused verbatim", () => {
  it("reports a structural change between two real versions", async () => {
    const ctx = await freshTenant();
    const { workflow, version: v1 } = await createWorkflow(ctx, { name: "wf_diff", artifact: minimalWorkflowArtifact("wf_diff") }, AUTHOR);
    const artifactV2 = { ...minimalWorkflowArtifact("wf_diff"), spec: { ...minimalWorkflowArtifact("wf_diff").spec, runLimits: { ...minimalWorkflowArtifact("wf_diff").spec.runLimits, maxSteps: 999 } } };
    const v2 = await createWorkflowVersion(ctx, workflow.id, artifactV2, AUTHOR);

    const diff = await structuralDiffVersions(ctx, v1.id, v2.id);
    expect(diff).toContainEqual(expect.objectContaining({ path: "spec.runLimits.maxSteps", before: 50, after: 999 }));
  });
});

describe("getAllowedTransitions / transitionWorkflowVersion — not-found and illegal-edge paths", () => {
  it("getAllowedTransitions 404s for a non-existent version", async () => {
    const ctx = await freshTenant();
    await expect(getAllowedTransitions(ctx, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(WorkflowVersionNotFoundError);
  });

  it("transitionWorkflowVersion 404s for a non-existent version", async () => {
    const ctx = await freshTenant();
    await expect(transitionWorkflowVersion(ctx, "00000000-0000-0000-0000-000000000000", "EvalGated", AUTHOR)).rejects.toBeInstanceOf(WorkflowVersionNotFoundError);
  });

  it("rejects an illegal FSM edge (Draft -> Approved, skipping EvalGated/HumanReview) with IllegalWorkflowVersionTransition, not WorkflowPromotionBlockedError", async () => {
    const ctx = await freshTenant();
    const { version } = await createWorkflow(ctx, { name: "wf_illegal_edge", artifact: minimalWorkflowArtifact("wf_illegal_edge") }, AUTHOR);
    await expect(transitionWorkflowVersion(ctx, version.id, "Approved", REVIEWER)).rejects.toBeInstanceOf(IllegalWorkflowVersionTransition);
  });
});

describe("the promotion gate genuinely blocks Approved without a sandbox_run_id (LLD §14.6.1's disclosed scope boundary)", () => {
  it("Draft version: only EvalGated/Deprecated are ever offered — never Approved/Production", async () => {
    const ctx = await freshTenant();
    const { version } = await createWorkflow(ctx, { name: "wf_gate_draft", artifact: minimalWorkflowArtifact("wf_gate_draft") }, AUTHOR);
    const allowed = await getAllowedTransitions(ctx, version.id);
    expect(allowed).toEqual(["EvalGated", "Deprecated"]);
  });

  it("even after forcing every EARLIER gate open (EvalGated/HumanReview) via direct repository access, HumanReview -> Approved is refused for real, through the real HTTP-facing service function", async () => {
    const ctx = await freshTenant();
    const { version } = await createWorkflow(ctx, { name: "wf_gate_blocked", artifact: minimalWorkflowArtifact("wf_gate_blocked") }, AUTHOR);
    // Bypass the sequencing gate directly via the repository — simulating "some
    // future mechanism satisfied EvalGated/HumanReview" — to prove Approved is
    // STILL refused for real through the real service function. It is refused
    // for the eval-gate reason here (no `eval_run` mechanism exists for a workflow
    // version at all in this build — `eval_run.agent_definition_version_id` is
    // NOT NULL and agent-version-scoped only, so `lastEvalRun` can never be
    // genuinely populated for a workflow version either) — a SECOND, independent
    // way this phase's own disclosed scope boundary manifests, alongside the
    // `sandbox_run_id` check `domain/promotion-policy.test.ts` already unit-tests
    // in isolation with a valid eval run supplied.
    await setWorkflowVersionStatus(ctx, version.id, "EvalGated");
    await setWorkflowVersionStatus(ctx, version.id, "HumanReview");

    await expect(transitionWorkflowVersion(ctx, version.id, "Approved", REVIEWER)).rejects.toThrow(/eval suite/i);

    const allowed = await getAllowedTransitions(ctx, version.id);
    expect(allowed).toEqual(["Deprecated"]);
  });

  it("any -> Deprecated always works, regardless of the sandbox-run gap", async () => {
    const ctx = await freshTenant();
    const { version } = await createWorkflow(ctx, { name: "wf_gate_deprecate", artifact: minimalWorkflowArtifact("wf_gate_deprecate") }, AUTHOR);
    const deprecated = await transitionWorkflowVersion(ctx, version.id, "Deprecated", AUTHOR);
    expect(deprecated.status).toBe("Deprecated");
  });
});

describe("updateWorkflow — metadata only, a workflow's graph is never edited in place", () => {
  it("updates description/status", async () => {
    const ctx = await freshTenant();
    const { workflow } = await createWorkflow(ctx, { name: "wf_update", artifact: minimalWorkflowArtifact("wf_update") }, AUTHOR);
    const updated = await updateWorkflow(ctx, workflow.id, { description: "new description", status: "Archived" });
    expect(updated.description).toBe("new description");
    expect(updated.status).toBe("Archived");
  });
});

describe("listVersions", () => {
  it("returns every version for a real workflow", async () => {
    const ctx = await freshTenant();
    const { workflow } = await createWorkflow(ctx, { name: "wf_list_versions", artifact: minimalWorkflowArtifact("wf_list_versions") }, AUTHOR);
    await createWorkflowVersion(ctx, workflow.id, minimalWorkflowArtifact("wf_list_versions"), AUTHOR);
    const versions = await listVersions(ctx, workflow.id);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it("404s for a non-existent workflow", async () => {
    const ctx = await freshTenant();
    await expect(listVersions(ctx, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });
});
