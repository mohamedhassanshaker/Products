import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { discoverAndSyncTools, listCatalog } from "@nextbot/tool-registry";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { startMockMcpServer, type MockMcpServerHandle } from "@nextbot/testing";

const discoverToolsMock = vi.fn();
vi.mock("@nextbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorsModule>();
  return {
    ...actual,
    discoverTools: (...args: unknown[]) => discoverToolsMock(...args),
    findConnectorById: async (...args: Parameters<typeof actual.findConnectorById>) => {
      const real = await actual.findConnectorById(...args);
      return real && mcpServer ? { ...real, endpointUrl: mcpServer.url } : real;
    },
  };
});

let mcpServer: MockMcpServerHandle;
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  discoverToolsMock.mockReset();
  await mcpServer?.close();
});

async function setUpTool(rule: "Allow" | "None") {
  discoverToolsMock.mockResolvedValue([{ name: "get_order", inputSchema: { type: "object" }, outputSchema: { type: "object" } }]);
  mcpServer = await startMockMcpServer([{ name: "get_order", inputSchema: { type: "object" }, outputSchema: { type: "object" }, result: { ok: true } }]);
  const ctx = await createFixtureTenant();
  const connector = await createConnector(ctx, {
    name: "Orders", backendType: "CRM", transport: "StreamableHTTP",
    endpointUrl: "https://orders.example.com/mcp", authMethod: "None", environment: "Sandbox",
  });
  await withTenant(ctx, async (db) => db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id)));
  await discoverAndSyncTools(ctx, connector.id);
  const [tool] = await listCatalog(ctx, { connectorId: connector.id });
  if (rule === "None") {
    await withTenant(ctx, async (db) => db.delete(schema.toolPermissionRule).where(eq(schema.toolPermissionRule.tenantId, ctx.tenantId)));
  }
  return { ctx, connector, tool: tool! };
}

describe("createMcpEgressPort — apps/gateway mcp-egress (Phase 12, real Postgres + real MCP server)", () => {
  it("PEP re-check denies at egress even though nothing upstream claimed it was denied", async () => {
    const { ctx, connector, tool } = await setUpTool("None");
    createdTenantIds.push(ctx.tenantId);

    const { createMcpEgressPort } = await import("./mcp-egress.js");
    const egress = createMcpEgressPort(ctx);
    const result = await egress.invokeTool({
      toolCallId: "tc-1", tenantId: ctx.tenantId, toolId: tool.id, connectorId: connector.id,
      toolName: tool.name, args: {}, idempotencyKey: "idem-1",
    });

    expect(result).toEqual({ outcome: "Denied", reason: "no_matching_rule" });
  });

  it("succeeds end to end when permitted: real credential-less egress call to the mock MCP server", async () => {
    const { ctx, connector, tool } = await setUpTool("Allow");
    createdTenantIds.push(ctx.tenantId);

    const { createMcpEgressPort } = await import("./mcp-egress.js");
    const egress = createMcpEgressPort(ctx);
    const result = await egress.invokeTool({
      toolCallId: "tc-2", tenantId: ctx.tenantId, toolId: tool.id, connectorId: connector.id,
      toolName: tool.name, args: {}, idempotencyKey: "idem-2",
    });

    expect(result).toEqual({ outcome: "Succeeded", output: { ok: true } });
  });
});
