import { describe, expect, it, vi, beforeEach } from "vitest";

const listOwnProvidersForTenantMock = vi.fn();

vi.mock("../infrastructure/model-gateway-repository.js", () => ({
  listOwnProvidersForTenant: (...a: unknown[]) => listOwnProvidersForTenantMock(...a),
  getProvider: vi.fn(),
  listCatalogEntries: vi.fn(),
  createCatalogEntry: vi.fn(),
  updateCatalogEntry: vi.fn(),
  setProviderStatus: vi.fn(),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("listProvidersDueForCatalogSync — adapter-capability filtering (ADR-0011 §2.1)", () => {
  beforeEach(() => {
    listOwnProvidersForTenantMock.mockReset();
  });

  it("excludes a disabled provider even if its type supports sync", async () => {
    listOwnProvidersForTenantMock.mockResolvedValue([{ id: "p1", type: "openai", enabled: false }]);
    const { listProvidersDueForCatalogSync } = await import("./catalog-sync-service.js");
    expect(await listProvidersDueForCatalogSync(ctx)).toEqual([]);
  });

  it("excludes an enabled provider whose type has no discovery API (e.g. custom)", async () => {
    listOwnProvidersForTenantMock.mockResolvedValue([{ id: "p1", type: "custom", enabled: true }]);
    const { listProvidersDueForCatalogSync } = await import("./catalog-sync-service.js");
    expect(await listProvidersDueForCatalogSync(ctx)).toEqual([]);
  });

  it("includes an enabled provider whose type supports sync (e.g. ollama, openai-compatible)", async () => {
    listOwnProvidersForTenantMock.mockResolvedValue([
      { id: "p1", type: "ollama", enabled: true },
      { id: "p2", type: "openai-compatible", enabled: true },
    ]);
    const { listProvidersDueForCatalogSync } = await import("./catalog-sync-service.js");
    const due = await listProvidersDueForCatalogSync(ctx);
    expect(due.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});
