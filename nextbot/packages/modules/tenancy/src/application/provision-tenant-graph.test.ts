import { beforeEach, describe, expect, it, vi } from "vitest";

const loadGraphStoreEnvMock = vi.fn();
const tenantDatabaseNameMock = vi.fn();
const ensureTenantGraphDatabaseMock = vi.fn();
const withPlatformMock = vi.fn();

vi.mock("@nextbot/graph-store", () => ({
  loadGraphStoreEnv: (...a: unknown[]) => loadGraphStoreEnvMock(...a),
  tenantDatabaseName: (...a: unknown[]) => tenantDatabaseNameMock(...a),
}));
vi.mock("@nextbot/graph-store/provisioning", () => ({
  ensureTenantGraphDatabase: (...a: unknown[]) => ensureTenantGraphDatabaseMock(...a),
}));
vi.mock("@nextbot/db/platform-only", () => ({
  withPlatform: (fn: (db: unknown) => unknown) => withPlatformMock(fn),
}));
vi.mock("@nextbot/db", () => ({
  schema: {
    tenantGraphDatabaseRoute: { tenantId: "tenantId" },
  },
}));

describe("provisionTenantGraphDatabase (Phase 7a — best-effort, non-fatal to tenant creation)", () => {
  beforeEach(() => {
    loadGraphStoreEnvMock.mockReset();
    tenantDatabaseNameMock.mockReset();
    ensureTenantGraphDatabaseMock.mockReset();
    withPlatformMock.mockReset();
    withPlatformMock.mockImplementation(async (fn: (db: unknown) => unknown) => {
      const fakeDb = {
        insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      };
      return fn(fakeDb);
    });
  });

  it("is a silent no-op when the graph store is not configured in this environment", async () => {
    loadGraphStoreEnvMock.mockImplementation(() => {
      throw new Error("missing config");
    });
    const { provisionTenantGraphDatabase } = await import("./provision-tenant-graph.js");
    await expect(provisionTenantGraphDatabase("tenant-1")).resolves.toBeUndefined();
    expect(withPlatformMock).not.toHaveBeenCalled();
    expect(ensureTenantGraphDatabaseMock).not.toHaveBeenCalled();
  });

  it("writes the routing row and calls ensureTenantGraphDatabase when configured", async () => {
    loadGraphStoreEnvMock.mockReturnValue({ GRAPH_STORE_URL: "bolt://x", GRAPH_STORE_DATABASE_PREFIX: "t" });
    tenantDatabaseNameMock.mockReturnValue("t-abc123");
    ensureTenantGraphDatabaseMock.mockResolvedValue({ databaseName: "t-abc123", created: true });

    const { provisionTenantGraphDatabase } = await import("./provision-tenant-graph.js");
    await provisionTenantGraphDatabase("tenant-1");

    expect(ensureTenantGraphDatabaseMock).toHaveBeenCalledWith("tenant-1");
    // Two withPlatform calls: the initial routing-row insert, then the
    // provisionedAt-stamping update on success.
    expect(withPlatformMock).toHaveBeenCalledTimes(2);
  });

  it("never throws when ensureTenantGraphDatabase fails — tenant creation must not be blocked", async () => {
    loadGraphStoreEnvMock.mockReturnValue({ GRAPH_STORE_URL: "bolt://x", GRAPH_STORE_DATABASE_PREFIX: "t" });
    tenantDatabaseNameMock.mockReturnValue("t-abc123");
    ensureTenantGraphDatabaseMock.mockRejectedValue(new Error("Neo4j unreachable"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { provisionTenantGraphDatabase } = await import("./provision-tenant-graph.js");
    await expect(provisionTenantGraphDatabase("tenant-1")).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Neo4j graph database provisioning failed"),
      expect.objectContaining({ tenantId: "tenant-1" }),
    );
    consoleErrorSpy.mockRestore();
  });

  it("never throws when even the routing-row write itself fails", async () => {
    loadGraphStoreEnvMock.mockReturnValue({ GRAPH_STORE_URL: "bolt://x", GRAPH_STORE_DATABASE_PREFIX: "t" });
    tenantDatabaseNameMock.mockReturnValue("t-abc123");
    withPlatformMock.mockRejectedValueOnce(new Error("duplicate key"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { provisionTenantGraphDatabase } = await import("./provision-tenant-graph.js");
    await expect(provisionTenantGraphDatabase("tenant-1")).resolves.toBeUndefined();
    expect(ensureTenantGraphDatabaseMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
