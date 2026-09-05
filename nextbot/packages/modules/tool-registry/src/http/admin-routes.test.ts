import { describe, expect, it, vi, beforeEach } from "vitest";

const discoverAndSyncToolsMock = vi.fn();
const listCatalogMock = vi.fn();
const getToolRulesMock = vi.fn();
const updateToolRulesMock = vi.fn();
const simulatePermissionMock = vi.fn();
const setToolVisibilityMock = vi.fn();
const setToolPriorityWeightMock = vi.fn();
const setToolCapabilityGroupMock = vi.fn();
const findToolByIdMock = vi.fn();
const listCapabilityGroupsMock = vi.fn();
const listCapabilityGroupsWithToolCountsMock = vi.fn();
const createCapabilityGroupMock = vi.fn();

vi.mock("../application/catalog-service.js", () => ({
  discoverAndSyncTools: (...a: unknown[]) => discoverAndSyncToolsMock(...a),
  listCatalog: (...a: unknown[]) => listCatalogMock(...a),
}));
vi.mock("../application/permission-service.js", () => ({
  getToolRules: (...a: unknown[]) => getToolRulesMock(...a),
  updateToolRules: (...a: unknown[]) => updateToolRulesMock(...a),
  simulatePermission: (...a: unknown[]) => simulatePermissionMock(...a),
}));
vi.mock("../infrastructure/tool-repository.js", () => ({
  setToolVisibility: (...a: unknown[]) => setToolVisibilityMock(...a),
  setToolPriorityWeight: (...a: unknown[]) => setToolPriorityWeightMock(...a),
  setToolCapabilityGroup: (...a: unknown[]) => setToolCapabilityGroupMock(...a),
  findToolById: (...a: unknown[]) => findToolByIdMock(...a),
}));
vi.mock("../infrastructure/capability-group-repository.js", () => ({
  listCapabilityGroups: (...a: unknown[]) => listCapabilityGroupsMock(...a),
  listCapabilityGroupsWithToolCounts: (...a: unknown[]) => listCapabilityGroupsWithToolCountsMock(...a),
  createCapabilityGroup: (...a: unknown[]) => createCapabilityGroupMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("tool-registry http/admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    for (const m of [
      discoverAndSyncToolsMock,
      listCatalogMock,
      getToolRulesMock,
      updateToolRulesMock,
      simulatePermissionMock,
      setToolVisibilityMock,
      setToolPriorityWeightMock,
      setToolCapabilityGroupMock,
      findToolByIdMock,
      listCapabilityGroupsMock,
      listCapabilityGroupsWithToolCountsMock,
      createCapabilityGroupMock,
    ]) {
      m.mockReset();
    }
  });

  it("handleListTools passes an optional connectorId filter through", async () => {
    listCatalogMock.mockResolvedValue([]);
    const { handleListTools } = await import("./admin-routes.js");
    await handleListTools(ctx, "conn-1");
    expect(listCatalogMock).toHaveBeenCalledWith(ctx, { connectorId: "conn-1" });
    await handleListTools(ctx);
    expect(listCatalogMock).toHaveBeenLastCalledWith(ctx, undefined);
  });

  it("handleDiscoverAndSync delegates to the catalog service", async () => {
    discoverAndSyncToolsMock.mockResolvedValue({ toolsAdded: 1, toolsUpdated: 0, breakingChanges: [] });
    const { handleDiscoverAndSync } = await import("./admin-routes.js");
    const result = await handleDiscoverAndSync(ctx, "conn-1");
    expect(result.toolsAdded).toBe(1);
  });

  it("handleSetVisibility/handleSetPriorityWeight/handleSetCapabilityGroup delegate correctly", async () => {
    const { handleSetVisibility, handleSetPriorityWeight, handleSetCapabilityGroup } = await import("./admin-routes.js");
    await handleSetVisibility(ctx, "tool-1", false);
    expect(setToolVisibilityMock).toHaveBeenCalledWith(ctx, "tool-1", false);
    await handleSetPriorityWeight(ctx, "tool-1", 80);
    expect(setToolPriorityWeightMock).toHaveBeenCalledWith(ctx, "tool-1", 80);
    await handleSetCapabilityGroup(ctx, "tool-1", "group-1");
    expect(setToolCapabilityGroupMock).toHaveBeenCalledWith(ctx, "tool-1", "group-1");
  });

  it("handleListCapabilityGroups/handleCreateCapabilityGroup delegate correctly", async () => {
    listCapabilityGroupsMock.mockResolvedValue([]);
    createCapabilityGroupMock.mockResolvedValue("group-new");
    const { handleListCapabilityGroups, handleCreateCapabilityGroup } = await import("./admin-routes.js");
    await handleListCapabilityGroups(ctx);
    expect(listCapabilityGroupsMock).toHaveBeenCalledWith(ctx);
    const id = await handleCreateCapabilityGroup(ctx, { name: "Billing Ops" });
    expect(id).toBe("group-new");
  });

  it("handleListCapabilityGroupsWithToolCounts (Phase 10, item 8) delegates to the tool-count-aware repository function", async () => {
    const rows = [{ id: "g1", tenantId: "t1", name: "billing", guidanceText: null, priorityWeight: 50, toolCount: 3 }];
    listCapabilityGroupsWithToolCountsMock.mockResolvedValue(rows);
    const { handleListCapabilityGroupsWithToolCounts } = await import("./admin-routes.js");
    const result = await handleListCapabilityGroupsWithToolCounts(ctx);
    expect(listCapabilityGroupsWithToolCountsMock).toHaveBeenCalledWith(ctx);
    expect(result).toBe(rows);
  });

  it("handleGetToolRules/handleUpdateToolRules/handleSimulatePermission delegate correctly", async () => {
    getToolRulesMock.mockResolvedValue([]);
    const { handleGetToolRules, handleUpdateToolRules, handleSimulatePermission } = await import("./admin-routes.js");
    await handleGetToolRules(ctx, "tool-1");
    expect(getToolRulesMock).toHaveBeenCalledWith(ctx, "tool-1");
    await handleUpdateToolRules(ctx, "tool-1", []);
    expect(updateToolRulesMock).toHaveBeenCalledWith(ctx, "tool-1", []);
    await handleSimulatePermission(ctx, "tool-1", {});
    expect(simulatePermissionMock).toHaveBeenCalledWith(ctx, "tool-1", {});
  });
});
