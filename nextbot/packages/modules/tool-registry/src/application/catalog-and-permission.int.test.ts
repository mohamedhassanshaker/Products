import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { withTenant, schema } from "@nextbot/db";
import { eq, and } from "drizzle-orm";

// This test proves catalog-sync + resolver behavior against a REAL Postgres — the
// only thing mocked is `@nextbot/connectors`'s `discoverTools` (the one function
// that reaches the network), since `connector.endpoint_url` has a DB-level
// https-only CHECK constraint (FR-SEC-02) that a local plain-HTTP mock server can't
// satisfy without a throwaway TLS cert. The real HTTP transport is already covered
// end-to-end by `packages/mcp-client`'s own integration tests, and `createConnector`
// (used below, real) + the vault round trip are covered by
// `packages/modules/connectors`'s own integration tests. `createConnector` itself
// stays real here (imported from the actual module) — only `discoverTools` is
// swapped out.
const discoverToolsMock = vi.fn();
vi.mock("@nextbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorsModule>();
  return { ...actual, discoverTools: (...args: unknown[]) => discoverToolsMock(...args) };
});

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  discoverToolsMock.mockReset();
});

async function forceToolStatus(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, toolId: string, status: "Active" | "Disabled") {
  await withTenant(ctx, async (db) => {
    await db.update(schema.tool).set({ status }).where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId)));
  });
}

/**
 * `connector.status` is a computed field — only the BL-11 health-checker subsystem
 * (`packages/modules/connectors`'s `probeConnectorHealth`, wired into the scheduled
 * worker) ever sets it away from its `Offline` default; see
 * `packages/db/src/schema/connectors.ts`'s doc comment. This suite's connectors are
 * never actually probed (no worker running here, and `discoverTools` is the only
 * thing mocked), so they stay at the DB-default `Offline`, which the permission
 * resolver's step 3 correctly denies (`connector_offline`) — entirely correct
 * behavior, but it means demonstrating the resolver's rule-matching branches (as
 * opposed to its Offline short-circuit) requires directly poking the column in
 * tests, the same way `forceToolStatus` already does for `tool.status`. The real
 * probe -> status transition itself is covered by
 * `packages/modules/connectors/src/application/health-check.int.test.ts`.
 */
async function forceConnectorConnected(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, connectorId: string) {
  await withTenant(ctx, async (db) => {
    await db.update(schema.connector).set({ status: "Connected" }).where(and(eq(schema.connector.tenantId, ctx.tenantId), eq(schema.connector.id, connectorId)));
  });
}

describe("discoverAndSyncTools + resolveToolPermission (BL-03, real Postgres)", () => {
  it("syncs discovered tools into the catalog with heuristic-classified rw_class/approval_tier", async () => {
    discoverToolsMock.mockResolvedValue([
      { name: "get_invoice", inputSchema: { type: "object" } },
      { name: "delete_invoice", inputSchema: { type: "object" } },
    ]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Billing Connector",
      backendType: "Billing",
      transport: "StreamableHTTP",
      endpointUrl: "https://billing.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });

    const { discoverAndSyncTools, listCatalog } = await import("./catalog-service.js");
    const syncResult = await discoverAndSyncTools(ctx, connector.id);
    expect(syncResult.toolsAdded).toBe(2);

    const catalog = await listCatalog(ctx, { connectorId: connector.id });
    const getInvoice = catalog.find((t) => t.name === "get_invoice")!;
    const deleteInvoice = catalog.find((t) => t.name === "delete_invoice")!;
    expect(getInvoice.rwClass).toBe("Read");
    expect(getInvoice.approvalTier).toBe("Tier1");
    expect(deleteInvoice.rwClass).toBe("Write");
    expect(deleteInvoice.approvalTier).toBe("Tier2"); // Billing Write -> always Tier2
  });

  it("resolves to Allow via the seeded BackendType-default rule after discovery", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_ticket", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Ticketing Connector",
      backendType: "Ticketing",
      transport: "StreamableHTTP",
      endpointUrl: "https://ticketing.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);

    const { discoverAndSyncTools, listCatalog } = await import("./catalog-service.js");
    const { resolveToolPermission } = await import("./permission-service.js");
    await discoverAndSyncTools(ctx, connector.id);
    const catalog = await listCatalog(ctx, { connectorId: connector.id });
    const tool = catalog[0]!;

    const resolution = await resolveToolPermission(ctx, tool.id, {});
    expect(resolution.effect).toBe("Allow");
  });

  it("fails closed to Deny when a tool is not Active, even with a seeded BackendType default present", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_ticket", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Ticketing Connector 2",
      backendType: "Ticketing",
      transport: "StreamableHTTP",
      endpointUrl: "https://ticketing2.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });

    const { discoverAndSyncTools, listCatalog } = await import("./catalog-service.js");
    const { resolveToolPermission } = await import("./permission-service.js");
    await discoverAndSyncTools(ctx, connector.id);
    const catalog = await listCatalog(ctx, { connectorId: connector.id });
    const tool = catalog[0]!;
    await forceToolStatus(ctx, tool.id, "Disabled");

    const resolution = await resolveToolPermission(ctx, tool.id, {});
    expect(resolution).toMatchObject({ effect: "Deny", reason: "tool_not_selectable" });
  });

  it("fails closed to Deny for a brand-new tenant/backend-type combination with genuinely no rule at all", async () => {
    // Proves the Phase 6 exit-gate requirement directly: a tool with NO rule and NO
    // backend-type default resolves to Deny. Achieved by resolving permission for a
    // tool whose connector's backend type has never been discovered-into before in
    // this tenant (so `ensureBackendTypeDefaultRule` was never called for it) —
    // simulated here by deleting the seeded default rule immediately after discovery.
    discoverToolsMock.mockResolvedValue([{ name: "get_lead", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "CRM Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);

    const { discoverAndSyncTools, listCatalog } = await import("./catalog-service.js");
    const { resolveToolPermission } = await import("./permission-service.js");
    await discoverAndSyncTools(ctx, connector.id);
    const catalog = await listCatalog(ctx, { connectorId: connector.id });
    const tool = catalog[0]!;

    // Remove the seeded BackendType-default rule discovery just created, so this
    // tool genuinely has zero applicable rules at any scope.
    await withTenant(ctx, async (db) => {
      await db.delete(schema.toolPermissionRule).where(eq(schema.toolPermissionRule.tenantId, ctx.tenantId));
    });

    const resolution = await resolveToolPermission(ctx, tool.id, {});
    expect(resolution).toEqual({ effect: "Deny", tier: null, matchedRuleId: null, reason: "no_matching_rule" });
  });
});
