import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { discoverAndSyncTools, listCatalog } from "@nextbot/tool-registry";
import { extractToolCall } from "@nextbot/orchestration";

/**
 * `orchestration`'s `extractToolCall` (LLD §6.2 step 1) has no allowed module
 * dependency on `@nextbot/connectors` (LLD §2.3's module allow-list), so the
 * fixture setup this test needs (a real discovered tool behind a real connector)
 * lives here in `apps/gateway` — the composition root, which may depend on any
 * module — rather than inside `packages/modules/orchestration` itself.
 */
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

describe("extractToolCall — LLD §6.2 step 1 (real Postgres)", () => {
  it("rejects an unknown tool id to the LLM rather than throwing", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const result = await extractToolCall(ctx, { toolId: "00000000-0000-0000-0000-000000000000", toolName: "not_real", args: {} });
    expect(result).toEqual({ kind: "UnknownTool", toolId: "00000000-0000-0000-0000-000000000000" });
  });

  it("resolves a known, discovered tool id and threads the model-proposed args through unchanged", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_order", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Orders Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://orders.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    const result = await extractToolCall(ctx, { toolId: tool!.id, toolName: tool!.name, args: { orderId: "abc" } });
    expect(result).toEqual({ kind: "Resolved", tool, args: { orderId: "abc" } });
  });
});
