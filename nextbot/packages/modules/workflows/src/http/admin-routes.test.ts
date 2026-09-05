import { describe, expect, it, vi } from "vitest";

/**
 * Thin `http/` delegation checks: every handler is a pure adapter onto an
 * application-layer function, so the only thing worth asserting here is that it
 * calls the right one with the right arguments (the behaviour itself is covered
 * by the real-Postgres integration suites) — mirrors `teams`'/`skills`' own
 * `admin-routes.test.ts` convention exactly.
 */
const listWorkflowsForAdminMock = vi.fn();
const createWorkflowMock = vi.fn();
const getWorkflowByIdMock = vi.fn();
const updateWorkflowMock = vi.fn();
const listVersionsMock = vi.fn();
const createWorkflowVersionMock = vi.fn();
const getVersionMock = vi.fn();
const getAllowedTransitionsMock = vi.fn();
const validateWorkflowVersionYamlMock = vi.fn();
const structuralDiffVersionsMock = vi.fn();
const transitionWorkflowVersionMock = vi.fn();

vi.mock("../application/workflow-service.js", () => ({
  listWorkflowsForAdmin: (...args: unknown[]) => listWorkflowsForAdminMock(...args),
  createWorkflow: (...args: unknown[]) => createWorkflowMock(...args),
  getWorkflowById: (...args: unknown[]) => getWorkflowByIdMock(...args),
  updateWorkflow: (...args: unknown[]) => updateWorkflowMock(...args),
  listVersions: (...args: unknown[]) => listVersionsMock(...args),
  createWorkflowVersion: (...args: unknown[]) => createWorkflowVersionMock(...args),
  getVersion: (...args: unknown[]) => getVersionMock(...args),
  getAllowedTransitions: (...args: unknown[]) => getAllowedTransitionsMock(...args),
  validateWorkflowVersionYaml: (...args: unknown[]) => validateWorkflowVersionYamlMock(...args),
  structuralDiffVersions: (...args: unknown[]) => structuralDiffVersionsMock(...args),
  transitionWorkflowVersion: (...args: unknown[]) => transitionWorkflowVersionMock(...args),
}));
const findWorkflowVersionByIdMock = vi.fn();
const listWorkflowVersionsMock = vi.fn();
vi.mock("../infrastructure/workflow-repository.js", () => ({
  findWorkflowVersionById: (...args: unknown[]) => findWorkflowVersionByIdMock(...args),
  listWorkflowVersions: (...args: unknown[]) => listWorkflowVersionsMock(...args),
}));

const CTX = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("workflows http/admin-routes (unit, mocked application layer)", () => {
  it("handleListWorkflows delegates to listWorkflowsForAdmin()", async () => {
    const { handleListWorkflows } = await import("./admin-routes.js");
    listWorkflowsForAdminMock.mockResolvedValue([{ id: "wf-1" }]);

    expect(await handleListWorkflows(CTX)).toEqual([{ id: "wf-1" }]);
    expect(listWorkflowsForAdminMock).toHaveBeenCalledWith(CTX);
  });

  it("handleCreateWorkflow passes the body and acting user straight through", async () => {
    const { handleCreateWorkflow } = await import("./admin-routes.js");
    createWorkflowMock.mockResolvedValue({ workflow: { id: "wf-1" }, version: { id: "v1" } });

    const body = { name: "support_workflow", artifact: { kind: "Workflow" } };
    const result = await handleCreateWorkflow(CTX, body, "user-1");

    expect(createWorkflowMock).toHaveBeenCalledWith(CTX, body, "user-1");
    expect(result).toEqual({ workflow: { id: "wf-1" }, version: { id: "v1" } });
  });

  it("handleGetWorkflow combines the workflow and its versions", async () => {
    getWorkflowByIdMock.mockResolvedValue({ id: "wf-1", name: "support_workflow" });
    listWorkflowVersionsMock.mockResolvedValue([{ id: "v1" }]);
    const { handleGetWorkflow } = await import("./admin-routes.js");

    const result = await handleGetWorkflow(CTX, "wf-1");

    expect(getWorkflowByIdMock).toHaveBeenCalledWith(CTX, "wf-1");
    expect(listWorkflowVersionsMock).toHaveBeenCalledWith(CTX, "wf-1");
    expect(result).toEqual({ workflow: { id: "wf-1", name: "support_workflow" }, versions: [{ id: "v1" }] });
  });

  it("handleUpdateWorkflow wraps the updated row", async () => {
    updateWorkflowMock.mockResolvedValue({ id: "wf-1", status: "Archived" });
    const { handleUpdateWorkflow } = await import("./admin-routes.js");

    const result = await handleUpdateWorkflow(CTX, "wf-1", { status: "Archived" });

    expect(updateWorkflowMock).toHaveBeenCalledWith(CTX, "wf-1", { status: "Archived" });
    expect(result).toEqual({ workflow: { id: "wf-1", status: "Archived" } });
  });

  it("handleListWorkflowVersions wraps the list", async () => {
    listVersionsMock.mockResolvedValue([{ id: "v1" }, { id: "v2" }]);
    const { handleListWorkflowVersions } = await import("./admin-routes.js");

    expect(await handleListWorkflowVersions(CTX, "wf-1")).toEqual({ versions: [{ id: "v1" }, { id: "v2" }] });
    expect(listVersionsMock).toHaveBeenCalledWith(CTX, "wf-1");
  });

  it("handleCreateWorkflowVersion passes the artifact and acting user through", async () => {
    createWorkflowVersionMock.mockResolvedValue({ id: "v2", version: 2 });
    const { handleCreateWorkflowVersion } = await import("./admin-routes.js");

    const result = await handleCreateWorkflowVersion(CTX, "wf-1", { artifact: { kind: "Workflow" } }, "user-1");

    expect(createWorkflowVersionMock).toHaveBeenCalledWith(CTX, "wf-1", { kind: "Workflow" }, "user-1");
    expect(result).toEqual({ version: { id: "v2", version: 2 } });
  });

  it("handleGetWorkflowVersion combines the version and its allowedTransitions", async () => {
    findWorkflowVersionByIdMock.mockResolvedValue({ id: "v1", status: "Draft" });
    getAllowedTransitionsMock.mockResolvedValue(["EvalGated", "Deprecated"]);
    const { handleGetWorkflowVersion } = await import("./admin-routes.js");

    const result = await handleGetWorkflowVersion(CTX, "v1");

    expect(result).toEqual({ version: { id: "v1", status: "Draft" }, allowedTransitions: ["EvalGated", "Deprecated"] });
  });

  it("handleGetWorkflowVersion 404s when the version doesn't resolve", async () => {
    findWorkflowVersionByIdMock.mockResolvedValue(null);
    const { handleGetWorkflowVersion } = await import("./admin-routes.js");

    await expect(handleGetWorkflowVersion(CTX, "missing")).rejects.toThrow(/was not found/);
  });

  it("handleValidateWorkflowVersion falls back to a generic label when the workflow id doesn't resolve (the editor's 'new' placeholder)", async () => {
    getWorkflowByIdMock.mockRejectedValueOnce(new Error("not found"));
    const { handleValidateWorkflowVersion } = await import("./admin-routes.js");
    validateWorkflowVersionYamlMock.mockResolvedValue({ valid: true, errors: [] });

    await handleValidateWorkflowVersion(CTX, "new", "apiVersion: nextbot.io/v1");

    expect(validateWorkflowVersionYamlMock).toHaveBeenCalledWith(CTX, "new_workflow", "apiVersion: nextbot.io/v1");
  });

  it("handleValidateWorkflowVersion uses the REAL workflow name when it resolves", async () => {
    getWorkflowByIdMock.mockResolvedValueOnce({ id: "wf-1", name: "support_workflow" });
    const { handleValidateWorkflowVersion } = await import("./admin-routes.js");
    validateWorkflowVersionYamlMock.mockResolvedValue({ valid: true, errors: [] });

    await handleValidateWorkflowVersion(CTX, "wf-1", "yaml text");

    expect(validateWorkflowVersionYamlMock).toHaveBeenCalledWith(CTX, "support_workflow", "yaml text");
  });

  it("handleDiffWorkflowVersions returns both versions' yaml plus the structural changes", async () => {
    getVersionMock.mockImplementation(async (_ctx: unknown, id: string) => ({ id, version: id === "v1" ? 1 : 2, yaml: `yaml-${id}`, yamlHash: `hash-${id}` }));
    structuralDiffVersionsMock.mockResolvedValue([{ op: "changed", path: "spec.runLimits.maxSteps", before: 1, after: 2, securityRelevant: true }]);
    const { handleDiffWorkflowVersions } = await import("./admin-routes.js");

    const result = await handleDiffWorkflowVersions(CTX, "v1", "v2");

    expect(structuralDiffVersionsMock).toHaveBeenCalledWith(CTX, "v1", "v2");
    expect(result).toEqual({
      from: { id: "v1", version: 1, yaml: "yaml-v1" },
      to: { id: "v2", version: 2, yaml: "yaml-v2" },
      identical: false,
      changes: [{ op: "changed", path: "spec.runLimits.maxSteps", before: 1, after: 2, securityRelevant: true }],
    });
  });

  it("handleTransitionWorkflowVersion passes the ACTING user through — the four-eyes check has real input", async () => {
    const { handleTransitionWorkflowVersion } = await import("./admin-routes.js");
    transitionWorkflowVersionMock.mockResolvedValue({ id: "v1", status: "Approved" });

    const result = await handleTransitionWorkflowVersion(CTX, "v1", "Approved", "user-9");

    expect(transitionWorkflowVersionMock).toHaveBeenCalledWith(CTX, "v1", "Approved", "user-9");
    expect(result).toEqual({ version: { id: "v1", status: "Approved" } });
  });
});
