import { describe, expect, it, vi, beforeEach } from "vitest";

const createProviderRegistrationMock = vi.fn();
const listProviderRegistrationsMock = vi.fn();
const updateProviderRegistrationMock = vi.fn();
const deactivateProviderRegistrationMock = vi.fn();
const probeProviderMock = vi.fn();
const syncProviderCatalogMock = vi.fn();
const listCatalogMock = vi.fn();
const declareCatalogEntryMock = vi.fn();
const updateCatalogEntryDeclarationMock = vi.fn();
const removeCatalogEntryMock = vi.fn();

vi.mock("../application/provider-service.js", () => ({
  createProviderRegistration: (...a: unknown[]) => createProviderRegistrationMock(...a),
  listProviderRegistrations: (...a: unknown[]) => listProviderRegistrationsMock(...a),
  updateProviderRegistration: (...a: unknown[]) => updateProviderRegistrationMock(...a),
  deactivateProviderRegistration: (...a: unknown[]) => deactivateProviderRegistrationMock(...a),
}));
vi.mock("../application/catalog-service.js", () => ({
  listCatalog: (...a: unknown[]) => listCatalogMock(...a),
  declareCatalogEntry: (...a: unknown[]) => declareCatalogEntryMock(...a),
  updateCatalogEntryDeclaration: (...a: unknown[]) => updateCatalogEntryDeclarationMock(...a),
  removeCatalogEntry: (...a: unknown[]) => removeCatalogEntryMock(...a),
}));
vi.mock("../application/provider-probe-service.js", () => ({
  probeProvider: (...a: unknown[]) => probeProviderMock(...a),
}));
vi.mock("../application/catalog-sync-service.js", () => ({
  syncProviderCatalog: (...a: unknown[]) => syncProviderCatalogMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("model-gateway http/admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    for (const m of [
      createProviderRegistrationMock,
      listProviderRegistrationsMock,
      updateProviderRegistrationMock,
      deactivateProviderRegistrationMock,
      probeProviderMock,
      syncProviderCatalogMock,
      listCatalogMock,
      declareCatalogEntryMock,
      updateCatalogEntryDeclarationMock,
      removeCatalogEntryMock,
    ]) {
      m.mockReset();
    }
  });

  it("handleCreateProvider delegates to createProviderRegistration", async () => {
    createProviderRegistrationMock.mockResolvedValue({ id: "p1" });
    const { handleCreateProvider } = await import("./admin-routes.js");
    const input = { type: "openai", name: "X" } as never;
    expect(await handleCreateProvider(ctx, input)).toEqual({ id: "p1" });
    expect(createProviderRegistrationMock).toHaveBeenCalledWith(ctx, input);
  });

  it("handleListProviders delegates to listProviderRegistrations", async () => {
    listProviderRegistrationsMock.mockResolvedValue([{ id: "p1" }]);
    const { handleListProviders } = await import("./admin-routes.js");
    expect(await handleListProviders(ctx)).toEqual([{ id: "p1" }]);
    expect(listProviderRegistrationsMock).toHaveBeenCalledWith(ctx);
  });

  it("handleUpdateProvider delegates to updateProviderRegistration", async () => {
    updateProviderRegistrationMock.mockResolvedValue({ id: "p1", name: "Renamed" });
    const { handleUpdateProvider } = await import("./admin-routes.js");
    const input = { name: "Renamed" } as never;
    expect(await handleUpdateProvider(ctx, "p1", input)).toEqual({ id: "p1", name: "Renamed" });
    expect(updateProviderRegistrationMock).toHaveBeenCalledWith(ctx, "p1", input);
  });

  it("handleDeactivateProvider delegates to deactivateProviderRegistration", async () => {
    deactivateProviderRegistrationMock.mockResolvedValue({ id: "p1", enabled: false });
    const { handleDeactivateProvider } = await import("./admin-routes.js");
    expect(await handleDeactivateProvider(ctx, "p1")).toEqual({ id: "p1", enabled: false });
    expect(deactivateProviderRegistrationMock).toHaveBeenCalledWith(ctx, "p1");
  });

  it("handleProbeProvider delegates to probeProvider", async () => {
    probeProviderMock.mockResolvedValue({ id: "p1", status: "Active" });
    const { handleProbeProvider } = await import("./admin-routes.js");
    expect(await handleProbeProvider(ctx, "p1")).toEqual({ id: "p1", status: "Active" });
    expect(probeProviderMock).toHaveBeenCalledWith(ctx, "p1");
  });

  it("handleSyncProviderCatalog delegates to syncProviderCatalog", async () => {
    syncProviderCatalogMock.mockResolvedValue({ created: 1, updated: 0, retired: 0, models: [] });
    const { handleSyncProviderCatalog } = await import("./admin-routes.js");
    expect(await handleSyncProviderCatalog(ctx, "p1")).toEqual({ created: 1, updated: 0, retired: 0, models: [] });
    expect(syncProviderCatalogMock).toHaveBeenCalledWith(ctx, "p1");
  });

  it("handleListCatalog delegates to listCatalog with filters", async () => {
    listCatalogMock.mockResolvedValue([{ id: "c1" }]);
    const { handleListCatalog } = await import("./admin-routes.js");
    expect(await handleListCatalog(ctx, { providerId: "p1" })).toEqual([{ id: "c1" }]);
    expect(listCatalogMock).toHaveBeenCalledWith(ctx, { providerId: "p1" });
  });

  it("handleDeclareCatalogEntry delegates to declareCatalogEntry", async () => {
    declareCatalogEntryMock.mockResolvedValue({ id: "c1" });
    const { handleDeclareCatalogEntry } = await import("./admin-routes.js");
    const input = { providerId: "p1", modelId: "m1" } as never;
    expect(await handleDeclareCatalogEntry(ctx, input)).toEqual({ id: "c1" });
    expect(declareCatalogEntryMock).toHaveBeenCalledWith(ctx, input);
  });

  it("handleUpdateCatalogEntry delegates to updateCatalogEntryDeclaration", async () => {
    updateCatalogEntryDeclarationMock.mockResolvedValue({ id: "c1", status: "Retired" });
    const { handleUpdateCatalogEntry } = await import("./admin-routes.js");
    const input = { status: "Retired" } as never;
    expect(await handleUpdateCatalogEntry(ctx, "c1", input)).toEqual({ id: "c1", status: "Retired" });
    expect(updateCatalogEntryDeclarationMock).toHaveBeenCalledWith(ctx, "c1", input);
  });

  it("handleDeleteCatalogEntry delegates to removeCatalogEntry", async () => {
    removeCatalogEntryMock.mockResolvedValue(undefined);
    const { handleDeleteCatalogEntry } = await import("./admin-routes.js");
    await handleDeleteCatalogEntry(ctx, "c1");
    expect(removeCatalogEntryMock).toHaveBeenCalledWith(ctx, "c1");
  });

  it("handleProviderSupportsCatalogSync reflects the adapter registry (no mocking needed — pure)", async () => {
    const { handleProviderSupportsCatalogSync } = await import("./admin-routes.js");
    expect(handleProviderSupportsCatalogSync("ollama")).toBe(true);
    expect(handleProviderSupportsCatalogSync("custom")).toBe(false);
  });
});
