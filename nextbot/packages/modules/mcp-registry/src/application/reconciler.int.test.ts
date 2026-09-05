import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { startMockMcpServer, type MockMcpTool, type MockMcpServerHandle } from "@nextbot/testing";
import { and, eq } from "drizzle-orm";
import { withTenant, schema } from "@nextbot/db";
import { createServerWithApprovedVersion, getServer } from "../infrastructure/mcp-server-repository.js";
import { reconcileServer } from "./reconciler.js";
import { mcpClientManifestFetchPort } from "./manifest-fetch-port.js";

const AUTHOR = "11111111-1111-1111-1111-111111111111";

const createdTenantIds: string[] = [];
const servers: MockMcpServerHandle[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  for (const s of servers.splice(0)) await s.close();
});

async function enrolServerAgainst(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, tools: MockMcpTool[]) {
  const mock = await startMockMcpServer(tools);
  servers.push(mock);
  const { server } = await createServerWithApprovedVersion(ctx, {
    name: "orders-mcp",
    endpointUrl: mock.url,
    items: tools.map((t) => ({ kind: "Tool" as const, name: t.name, descriptionSource: t.description ?? "", schemaJson: t.inputSchema, approvalTier: "Tier1" as const, enabled: true })),
    createdByUserId: AUTHOR,
  });
  return { mock, server };
}

async function pendingDriftEvents(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, serverId: string) {
  return withTenant(ctx, async (db) => db.select().from(schema.mcpDriftEvent).where(and(eq(schema.mcpDriftEvent.tenantId, ctx.tenantId), eq(schema.mcpDriftEvent.serverId, serverId))));
}

describe("reconcileServer (ADR-0014 §6 verification list, real Postgres + a real in-process MCP server)", () => {
  it("Verification 1 (idempotency): three consecutive reconciler runs against an unchanged server produce exactly zero drift events", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const { server } = await enrolServerAgainst(ctx, [{ name: "get_order", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } }]);

    for (let i = 0; i < 3; i++) {
      const fresh = (await getServer(ctx, server.id))!;
      const result = await reconcileServer(ctx, fresh, mcpClientManifestFetchPort);
      expect(result.outcome).toBe("NoChange");
      expect(result.driftEventsInserted).toBe(0);
    }
    expect(await pendingDriftEvents(ctx, server.id)).toHaveLength(0);
    const finalServer = await getServer(ctx, server.id);
    expect(finalServer?.reachability).toBe("Reachable");
  });

  it("Verification 2 (new tool): a tool appearing on the live server enrols as an ItemAdded drift event, and the pinned version is completely unaffected", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const tools: MockMcpTool[] = [{ name: "get_order", inputSchema: { type: "object" } }];
    const { mock, server } = await enrolServerAgainst(ctx, tools);
    const versionBefore = (await getServer(ctx, server.id))!.currentVersionId;

    tools.push({ name: "cancel_order", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } });
    void mock; // the mock server reads `tools` live from this same array reference

    const fresh = (await getServer(ctx, server.id))!;
    const result = await reconcileServer(ctx, fresh, mcpClientManifestFetchPort);
    expect(result.outcome).toBe("DriftDetected");
    expect(result.driftEventsInserted).toBe(1);

    const events = await pendingDriftEvents(ctx, server.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ changeKind: "ItemAdded", itemName: "cancel_order", resolution: "Pending" });

    // The pinned version itself never changes until a human reviews the drift.
    const serverAfter = await getServer(ctx, server.id);
    expect(serverAfter?.currentVersionId).toBe(versionBefore);
  });

  it("Verification 3 (changed schema): an approved tool's changed input schema produces a SchemaChanged drift event; the original manifest item is untouched and the server stays pinned to the old version", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const tools: MockMcpTool[] = [{ name: "get_order", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } }];
    const { server } = await enrolServerAgainst(ctx, tools);
    const versionBefore = (await getServer(ctx, server.id))!.currentVersionId;

    const originalItems = await withTenant(ctx, async (db) => db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, versionBefore!))));
    expect(originalItems).toHaveLength(1);
    const originalItem = originalItems[0]!;

    // The live server's schema for the SAME tool name genuinely changes shape.
    tools[0]!.inputSchema = { type: "object", properties: { orderId: { type: "string" }, includeHistory: { type: "boolean" } } };

    const fresh = (await getServer(ctx, server.id))!;
    const result = await reconcileServer(ctx, fresh, mcpClientManifestFetchPort);
    expect(result.outcome).toBe("DriftDetected");

    const events = await pendingDriftEvents(ctx, server.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ changeKind: "SchemaChanged", itemName: "get_order" });
    expect(events[0]?.oldSchemaHash).toBe(originalItem.schemaHash);
    expect(events[0]?.newSchemaHash).not.toBe(originalItem.schemaHash);

    // The original item row is byte-identical — never mutated in place.
    const originalItemAfter = await withTenant(ctx, async (db) => {
      const [row] = await db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.id, originalItem.id)));
      return row;
    });
    expect(originalItemAfter?.schemaHash).toBe(originalItem.schemaHash);
    expect(originalItemAfter?.schemaJson).toEqual(originalItem.schemaJson);

    // The server still resolves the OLD (pinned) version's contract — nothing was
    // silently re-approved for the new shape.
    const serverAfter = await getServer(ctx, server.id);
    expect(serverAfter?.currentVersionId).toBe(versionBefore);
  });

  it("Verification 4 (cosmetic change): re-serializing the same schema with different key order produces no drift", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const tools: MockMcpTool[] = [{ name: "get_order", inputSchema: { type: "object", properties: { orderId: { type: "string" }, verbose: { type: "boolean" } } } }];
    const { server } = await enrolServerAgainst(ctx, tools);

    // Same schema, different key order at every level — canonicalization must treat
    // this identically to the original.
    tools[0]!.inputSchema = { properties: { verbose: { type: "boolean" }, orderId: { type: "string" } }, type: "object" };

    const fresh = (await getServer(ctx, server.id))!;
    const result = await reconcileServer(ctx, fresh, mcpClientManifestFetchPort);
    expect(result.outcome).toBe("NoChange");
    expect(await pendingDriftEvents(ctx, server.id)).toHaveLength(0);
  });

  it("Verification 5 (unreachable): a server that stops answering produces an Unreachable health transition and NO drift event", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const { mock, server } = await enrolServerAgainst(ctx, [{ name: "get_order", inputSchema: { type: "object" } }]);
    await mock.close();
    // Remove from the cleanup list — it's already closed.
    servers.splice(servers.indexOf(mock), 1);

    const fresh = (await getServer(ctx, server.id))!;
    const result = await reconcileServer(ctx, fresh, mcpClientManifestFetchPort);
    expect(result.outcome).toBe("Unreachable");
    expect(result.driftEventsInserted).toBe(0);
    expect(await pendingDriftEvents(ctx, server.id)).toHaveLength(0);

    const serverAfter = await getServer(ctx, server.id);
    expect(serverAfter?.reachability).toBe("Unreachable");
    expect(serverAfter?.lastProbeError).toBeTruthy();
  });

  it("Verification 7 (enrolment fail-closed): an item enrolled with no explicit tier/enabled override defaults to Tier3 + disabled", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const mock = await startMockMcpServer([{ name: "delete_account", inputSchema: { type: "object" } }]);
    servers.push(mock);
    const { serverVersionId } = await createServerWithApprovedVersion(ctx, {
      name: "unclassified-server",
      endpointUrl: mock.url,
      items: [{ kind: "Tool", name: "delete_account", descriptionSource: "", schemaJson: { type: "object" } }],
      createdByUserId: AUTHOR,
    });
    const items = await withTenant(ctx, async (db) => db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, serverVersionId))));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ approvalTier: "Tier3", enabled: false });
  });
});
