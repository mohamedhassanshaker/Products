import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { startMockMcpServer, type MockMcpTool, type MockMcpServerHandle } from "@nextbot/testing";
import { withTenant, schema, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { eq, and } from "drizzle-orm";
import { createServerWithApprovedVersion, getServer } from "./mcp-server-repository.js";
import { reconcileServer } from "../application/reconciler.js";
import { mcpClientManifestFetchPort } from "../application/manifest-fetch-port.js";

const AUTHOR = "11111111-1111-1111-1111-111111111111";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-02/FR-MCP-18) — closes a
 * real, disclosed gap: `mcp-registry` had NO `domain_event` producer at all before
 * this phase (confirmed by inspection). Proves `insertDriftEventsAndMarkReconciled`
 * now emits ONE `mcp-registry.drift_detected` event per reconcile tick that finds
 * genuinely new drift, and — per ADR-0014's own idempotency guarantee — NOT a second
 * event for a re-run that only re-observes already-pending drift.
 */
const createdTenantIds: string[] = [];
const servers: MockMcpServerHandle[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  for (const s of servers.splice(0)) await s.close();
});

async function domainEventsOfType(ctx: TenantContext, type: string) {
  return withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.domainEvent).where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.type, type))));
}

describe("reconcileServer now emits mcp-registry.drift_detected on genuine new drift, never on a re-observed no-op re-run", () => {
  it("emits exactly one drift_detected event when a live tool appears that wasn't in the pinned manifest", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const tools: MockMcpTool[] = [{ name: "get_order", inputSchema: { type: "object" } }];
    const mock = await startMockMcpServer(tools);
    servers.push(mock);
    const { server } = await createServerWithApprovedVersion(ctx, {
      name: "orders-mcp",
      endpointUrl: mock.url,
      items: [{ kind: "Tool" as const, name: "get_order", descriptionSource: "", schemaJson: { type: "object" }, approvalTier: "Tier1" as const, enabled: true }],
      createdByUserId: AUTHOR,
    });

    tools.push({ name: "cancel_order", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } });

    const fresh = (await getServer(ctx, server.id))!;
    const result = await reconcileServer(ctx, fresh, mcpClientManifestFetchPort);
    expect(result.outcome).toBe("DriftDetected");
    expect(result.driftEventsInserted).toBe(1);

    const events = await domainEventsOfType(ctx, "mcp-registry.drift_detected");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ serverId: server.id, changeCount: 1 });

    // A second reconcile tick against the SAME (still-drifted, not-yet-reviewed)
    // state must NOT insert a second event — ADR-0014's own idempotency guarantee
    // ("a re-run against the same live state inserts nothing new") applies to the
    // webhook signal too, not just the mcp_drift_event table.
    const rerun = await reconcileServer(ctx, (await getServer(ctx, server.id))!, mcpClientManifestFetchPort);
    expect(rerun.driftEventsInserted).toBe(0);
    expect(await domainEventsOfType(ctx, "mcp-registry.drift_detected")).toHaveLength(1);
  });

  it("an unchanged server (NoChange outcome) emits no drift_detected event at all", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const mock = await startMockMcpServer([{ name: "get_order", inputSchema: { type: "object" } }]);
    servers.push(mock);
    const { server } = await createServerWithApprovedVersion(ctx, {
      name: "orders-mcp-stable",
      endpointUrl: mock.url,
      items: [{ kind: "Tool" as const, name: "get_order", descriptionSource: "", schemaJson: { type: "object" }, approvalTier: "Tier1" as const, enabled: true }],
      createdByUserId: AUTHOR,
    });

    const result = await reconcileServer(ctx, (await getServer(ctx, server.id))!, mcpClientManifestFetchPort);
    expect(result.outcome).toBe("NoChange");
    expect(await domainEventsOfType(ctx, "mcp-registry.drift_detected")).toHaveLength(0);
  });
});
