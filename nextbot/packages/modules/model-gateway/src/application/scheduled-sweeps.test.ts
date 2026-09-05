import { describe, expect, it, vi, beforeEach } from "vitest";

const listActiveTenantContextsMock = vi.fn();
const listProvidersDueForProbeMock = vi.fn();
const probeProviderMock = vi.fn();
const listProvidersDueForCatalogSyncMock = vi.fn();
const syncProviderCatalogMock = vi.fn();

vi.mock("@nextbot/tenancy", () => ({
  listActiveTenantContexts: (...a: unknown[]) => listActiveTenantContextsMock(...a),
}));
vi.mock("./provider-probe-service.js", () => ({
  listProvidersDueForProbe: (...a: unknown[]) => listProvidersDueForProbeMock(...a),
  probeProvider: (...a: unknown[]) => probeProviderMock(...a),
}));
vi.mock("./catalog-sync-service.js", () => ({
  listProvidersDueForCatalogSync: (...a: unknown[]) => listProvidersDueForCatalogSyncMock(...a),
  syncProviderCatalog: (...a: unknown[]) => syncProviderCatalogMock(...a),
}));

const tenantA = { tenantId: "a", region: "US" as const, environment: "Sandbox" as const };
const tenantB = { tenantId: "b", region: "EU" as const, environment: "Sandbox" as const };

describe("scheduled-sweeps — model-gateway.provider-probe / model-gateway.catalog-sync (Target Architecture Blueprint Phase 1)", () => {
  beforeEach(() => {
    for (const m of [
      listActiveTenantContextsMock,
      listProvidersDueForProbeMock,
      probeProviderMock,
      listProvidersDueForCatalogSyncMock,
      syncProviderCatalogMock,
    ]) {
      m.mockReset();
    }
  });

  it("runProviderProbeSweep probes every due provider across every active tenant", async () => {
    listActiveTenantContextsMock.mockResolvedValue([tenantA, tenantB]);
    listProvidersDueForProbeMock.mockImplementation(async (ctx: { tenantId: string }) =>
      ctx.tenantId === "a" ? [{ id: "p1" }, { id: "p2" }] : [{ id: "p3" }],
    );
    probeProviderMock.mockResolvedValue(undefined);

    const { runProviderProbeSweep } = await import("./scheduled-sweeps.js");
    const result = await runProviderProbeSweep();

    expect(result).toEqual({ tenantsChecked: 2, probed: 3, failed: 0 });
    expect(probeProviderMock).toHaveBeenCalledWith(tenantA, "p1");
    expect(probeProviderMock).toHaveBeenCalledWith(tenantA, "p2");
    expect(probeProviderMock).toHaveBeenCalledWith(tenantB, "p3");
  });

  it("runProviderProbeSweep counts a failed probe without stopping the sweep for the rest", async () => {
    listActiveTenantContextsMock.mockResolvedValue([tenantA]);
    listProvidersDueForProbeMock.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    probeProviderMock.mockImplementation(async (_ctx: unknown, id: string) => {
      if (id === "p1") throw new Error("boom");
    });

    const { runProviderProbeSweep } = await import("./scheduled-sweeps.js");
    const result = await runProviderProbeSweep();

    expect(result).toEqual({ tenantsChecked: 1, probed: 1, failed: 1 });
  });

  it("runCatalogSyncSweep syncs every due provider across every active tenant", async () => {
    listActiveTenantContextsMock.mockResolvedValue([tenantA]);
    listProvidersDueForCatalogSyncMock.mockResolvedValue([{ id: "p1" }]);
    syncProviderCatalogMock.mockResolvedValue(undefined);

    const { runCatalogSyncSweep } = await import("./scheduled-sweeps.js");
    const result = await runCatalogSyncSweep();

    expect(result).toEqual({ tenantsChecked: 1, synced: 1, failed: 0 });
    expect(syncProviderCatalogMock).toHaveBeenCalledWith(tenantA, "p1");
  });

  it("runCatalogSyncSweep counts a failed sync without stopping the sweep for the rest", async () => {
    listActiveTenantContextsMock.mockResolvedValue([tenantA]);
    listProvidersDueForCatalogSyncMock.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    syncProviderCatalogMock.mockImplementation(async (_ctx: unknown, id: string) => {
      if (id === "p2") throw new Error("boom");
    });

    const { runCatalogSyncSweep } = await import("./scheduled-sweeps.js");
    const result = await runCatalogSyncSweep();

    expect(result).toEqual({ tenantsChecked: 1, synced: 1, failed: 1 });
  });
});
