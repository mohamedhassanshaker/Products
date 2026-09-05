import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";

const discoverToolsMock = vi.fn();
vi.mock("@nextbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorsModule>();
  return { ...actual, discoverTools: (...args: unknown[]) => discoverToolsMock(...args) };
});

/** ADR-0001 §6 cross-tenant proof for `tool`/`tool_permission_rule` (Phase 6). */
describe("tool-registry tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
    discoverToolsMock.mockReset();
  });

  it("a tenant scoped to A reads zero rows of B's tool catalog", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_x", inputSchema: { type: "object" } }]);
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bConnector = await createConnector(b, {
      name: "B's Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    const { discoverAndSyncTools } = await import("./catalog-service.js");
    await discoverAndSyncTools(b, bConnector.id);

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.tool).where(eq(schema.tool.connectorId, bConnector.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });
});
