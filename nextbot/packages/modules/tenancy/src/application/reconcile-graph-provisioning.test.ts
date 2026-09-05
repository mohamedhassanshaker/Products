import { beforeEach, describe, expect, it, vi } from "vitest";

const provisionTenantGraphDatabaseMock = vi.fn();
const withPlatformMock = vi.fn();

vi.mock("./provision-tenant-graph.js", () => ({
  provisionTenantGraphDatabase: (...a: unknown[]) => provisionTenantGraphDatabaseMock(...a),
}));
vi.mock("@nextbot/db/platform-only", () => ({
  withPlatform: (fn: (db: unknown) => unknown) => withPlatformMock(fn),
}));
vi.mock("@nextbot/db", () => ({
  schema: {
    tenantGraphDatabaseRoute: { tenantId: "tenantId", provisionedAt: "provisionedAt" },
  },
}));

/** A queue of canned query results, consumed in call order — this unit test isn't
 *  exercising real SQL filtering (the int test below does, against real Postgres);
 *  it's exercising `reconcileStrandedGraphProvisioning()`'s own control flow: list,
 *  then per-tenant repair, then per-tenant re-check. */
function fakeDbReturning(queue: unknown[]): unknown {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(queue.shift()),
      }),
    }),
  };
}

describe("reconcileStrandedGraphProvisioning (Phase 7b fast-follow, ADR-0018 §4)", () => {
  beforeEach(() => {
    provisionTenantGraphDatabaseMock.mockReset();
    withPlatformMock.mockReset();
  });

  it("is a no-op reporting zero stranded tenants when nothing is stranded", async () => {
    const queue: unknown[] = [[]]; // the initial list query
    withPlatformMock.mockImplementation((fn: (db: unknown) => unknown) => fn(fakeDbReturning(queue)));

    const { reconcileStrandedGraphProvisioning } = await import("./reconcile-graph-provisioning.js");
    const result = await reconcileStrandedGraphProvisioning();

    expect(result).toEqual({ strandedCount: 0, repairedTenantIds: [], stillStrandedTenantIds: [] });
    expect(provisionTenantGraphDatabaseMock).not.toHaveBeenCalled();
  });

  it("repairs a stranded tenant and reports it as repaired once its row is no longer null", async () => {
    const queue: unknown[] = [
      [{ tenantId: "tenant-1" }], // list query
      [], // re-check query for tenant-1: empty = no longer stranded = repaired
    ];
    withPlatformMock.mockImplementation((fn: (db: unknown) => unknown) => fn(fakeDbReturning(queue)));
    provisionTenantGraphDatabaseMock.mockResolvedValue(undefined);

    const { reconcileStrandedGraphProvisioning } = await import("./reconcile-graph-provisioning.js");
    const result = await reconcileStrandedGraphProvisioning();

    expect(provisionTenantGraphDatabaseMock).toHaveBeenCalledWith("tenant-1");
    expect(result).toEqual({ strandedCount: 1, repairedTenantIds: ["tenant-1"], stillStrandedTenantIds: [] });
  });

  it("reports a tenant as still stranded when the repair attempt didn't clear provisionedAt (e.g. Neo4j still unreachable)", async () => {
    const queue: unknown[] = [
      [{ tenantId: "tenant-1" }], // list query
      [{ tenantId: "tenant-1" }], // re-check query: still present = still stranded
    ];
    withPlatformMock.mockImplementation((fn: (db: unknown) => unknown) => fn(fakeDbReturning(queue)));
    provisionTenantGraphDatabaseMock.mockResolvedValue(undefined);

    const { reconcileStrandedGraphProvisioning } = await import("./reconcile-graph-provisioning.js");
    const result = await reconcileStrandedGraphProvisioning();

    expect(result).toEqual({ strandedCount: 1, repairedTenantIds: [], stillStrandedTenantIds: ["tenant-1"] });
  });

  it("isolates a per-tenant repair failure — one tenant's unexpected throw never stops the rest of the sweep", async () => {
    const queue: unknown[] = [
      [{ tenantId: "tenant-1" }, { tenantId: "tenant-2" }], // list query
      [{ tenantId: "tenant-1" }], // re-check for tenant-1 (still stranded, since its repair threw)
      [], // re-check for tenant-2 (repaired)
    ];
    withPlatformMock.mockImplementation((fn: (db: unknown) => unknown) => fn(fakeDbReturning(queue)));
    provisionTenantGraphDatabaseMock.mockImplementation(async (tenantId: string) => {
      if (tenantId === "tenant-1") throw new Error("unexpected");
      return undefined;
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { reconcileStrandedGraphProvisioning } = await import("./reconcile-graph-provisioning.js");
    const result = await reconcileStrandedGraphProvisioning();

    expect(provisionTenantGraphDatabaseMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ strandedCount: 2, repairedTenantIds: ["tenant-2"], stillStrandedTenantIds: ["tenant-1"] });
    consoleErrorSpy.mockRestore();
  });
});
