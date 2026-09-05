import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { startMockMcpServer, type MockMcpTool, type MockMcpServerHandle } from "@nextbot/testing";
import { and, eq } from "drizzle-orm";
import { withTenant, schema } from "@nextbot/db";
import { createServerWithApprovedVersion, getServer, reviewDrift } from "./mcp-server-repository.js";
import { reconcileServer } from "../application/reconciler.js";
import { mcpClientManifestFetchPort } from "../application/manifest-fetch-port.js";

const AUTHOR = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "22222222-2222-2222-2222-222222222222";

const createdTenantIds: string[] = [];
const servers: MockMcpServerHandle[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  for (const s of servers.splice(0)) await s.close();
});

async function pendingDriftEvents(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, serverId: string) {
  return withTenant(ctx, async (db) => db.select().from(schema.mcpDriftEvent).where(and(eq(schema.mcpDriftEvent.tenantId, ctx.tenantId), eq(schema.mcpDriftEvent.serverId, serverId))));
}

describe("reviewDrift (ADR-0014 §2.2/§2.3 — drift review mints a new version, never mutates the old one)", () => {
  it("Accept on an ItemAdded event mints a new Approved version containing the new item, disabled + Tier3, while the old version stays intact and Superseded", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const tools: MockMcpTool[] = [{ name: "get_order", inputSchema: { type: "object" } }];
    const mock = await startMockMcpServer(tools);
    servers.push(mock);
    const { server, serverVersionId: v1 } = await createServerWithApprovedVersion(ctx, {
      name: "orders-mcp",
      endpointUrl: mock.url,
      items: [{ kind: "Tool", name: "get_order", descriptionSource: "", schemaJson: { type: "object" }, approvalTier: "Tier1", enabled: true }],
      createdByUserId: AUTHOR,
    });

    tools.push({ name: "cancel_order", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } });
    await reconcileServer(ctx, (await getServer(ctx, server.id))!, mcpClientManifestFetchPort);

    const events = await pendingDriftEvents(ctx, server.id);
    expect(events).toHaveLength(1);

    const result = await reviewDrift(ctx, server.id, [{ driftEventId: events[0]!.id, action: "Accept", schemaJsonForAccepted: { type: "object", properties: { orderId: { type: "string" } } }, descriptionSourceForAccepted: "Cancel an order" }], REVIEWER);
    expect(result.accepted).toBe(1);
    expect(result.newServerVersionId).not.toBeNull();

    const serverAfter = await getServer(ctx, server.id);
    expect(serverAfter?.currentVersionId).toBe(result.newServerVersionId);

    // The OLD version is untouched (still has exactly its original one item) and is
    // now marked Superseded, never deleted.
    const v1Row = await withTenant(ctx, async (db) => {
      const [row] = await db.select().from(schema.mcpServerVersion).where(and(eq(schema.mcpServerVersion.tenantId, ctx.tenantId), eq(schema.mcpServerVersion.id, v1)));
      return row;
    });
    expect(v1Row?.status).toBe("Superseded");
    const v1Items = await withTenant(ctx, async (db) => db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, v1))));
    expect(v1Items).toHaveLength(1);
    expect(v1Items[0]?.name).toBe("get_order");

    // The NEW version carries forward the old item AND the newly-accepted item,
    // fail-closed (disabled + Tier3) since no override was supplied.
    const v2Items = await withTenant(ctx, async (db) => db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, result.newServerVersionId!))));
    expect(v2Items).toHaveLength(2);
    const cancelOrder = v2Items.find((i) => i.name === "cancel_order");
    expect(cancelOrder).toMatchObject({ approvalTier: "Tier3", enabled: false });
    const getOrder = v2Items.find((i) => i.name === "get_order");
    expect(getOrder).toMatchObject({ approvalTier: "Tier1", enabled: true });

    const eventAfter = await pendingDriftEvents(ctx, server.id);
    expect(eventAfter[0]).toMatchObject({ resolution: "Accepted", resultingVersionId: result.newServerVersionId });
  });

  it("Accept on a SchemaChanged event creates an entirely NEW item (never an in-place update) — the old item row is left intact and is excluded from the new version's manifest", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const tools: MockMcpTool[] = [{ name: "get_order", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } }];
    const mock = await startMockMcpServer(tools);
    servers.push(mock);
    const { server, serverVersionId: v1 } = await createServerWithApprovedVersion(ctx, {
      name: "orders-mcp-2",
      endpointUrl: mock.url,
      items: [{ kind: "Tool", name: "get_order", descriptionSource: "", schemaJson: { type: "object", properties: { orderId: { type: "string" } } }, approvalTier: "Tier1", enabled: true }],
      createdByUserId: AUTHOR,
    });
    const v1Items = await withTenant(ctx, async (db) => db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, v1))));
    const originalItem = v1Items[0]!;

    tools[0]!.inputSchema = { type: "object", properties: { orderId: { type: "string" }, includeHistory: { type: "boolean" } } };
    await reconcileServer(ctx, (await getServer(ctx, server.id))!, mcpClientManifestFetchPort);
    const events = await pendingDriftEvents(ctx, server.id);
    expect(events[0]?.changeKind).toBe("SchemaChanged");

    const result = await reviewDrift(ctx, server.id, [{ driftEventId: events[0]!.id, action: "Accept", schemaJsonForAccepted: tools[0]!.inputSchema, descriptionSourceForAccepted: "" }], REVIEWER);

    // The original item is byte-identical — never mutated.
    const originalAfter = await withTenant(ctx, async (db) => {
      const [row] = await db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.id, originalItem.id)));
      return row;
    });
    expect(originalAfter?.schemaHash).toBe(originalItem.schemaHash);
    expect(originalAfter?.schemaJson).toEqual(originalItem.schemaJson);

    // The new version has exactly ONE `get_order` item — the new shape, with a fresh
    // id and `supersedesItemId` pointing back at the original.
    const v2Items = await withTenant(ctx, async (db) => db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, result.newServerVersionId!))));
    const getOrderItems = v2Items.filter((i) => i.name === "get_order");
    expect(getOrderItems).toHaveLength(1);
    expect(getOrderItems[0]?.id).not.toBe(originalItem.id);
    expect(getOrderItems[0]?.supersedesItemId).toBe(originalItem.id);
    expect(getOrderItems[0]?.schemaHash).not.toBe(originalItem.schemaHash);
    // Fail-closed default (no override supplied in this call).
    expect(getOrderItems[0]).toMatchObject({ approvalTier: "Tier3", enabled: false });
  });

  it("Rejecting all pending drift mints NO new version — the pinned version stays authoritative", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const tools: MockMcpTool[] = [{ name: "get_order", inputSchema: { type: "object" } }];
    const mock = await startMockMcpServer(tools);
    servers.push(mock);
    const { server, serverVersionId: v1 } = await createServerWithApprovedVersion(ctx, {
      name: "orders-mcp-3",
      endpointUrl: mock.url,
      items: [{ kind: "Tool", name: "get_order", descriptionSource: "", schemaJson: { type: "object" }, approvalTier: "Tier1", enabled: true }],
      createdByUserId: AUTHOR,
    });
    tools.push({ name: "cancel_order", inputSchema: { type: "object" } });
    await reconcileServer(ctx, (await getServer(ctx, server.id))!, mcpClientManifestFetchPort);
    const events = await pendingDriftEvents(ctx, server.id);

    const result = await reviewDrift(ctx, server.id, [{ driftEventId: events[0]!.id, action: "Reject", note: "Not approving this expansion right now" }], REVIEWER);
    expect(result.newServerVersionId).toBeNull();
    expect(result.rejected).toBe(1);

    const serverAfter = await getServer(ctx, server.id);
    expect(serverAfter?.currentVersionId).toBe(v1);

    const eventAfter = await pendingDriftEvents(ctx, server.id);
    expect(eventAfter[0]).toMatchObject({ resolution: "Rejected", resolutionNote: "Not approving this expansion right now" });
  });
});
