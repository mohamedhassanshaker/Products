import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq, and } from "drizzle-orm";
import { createConnector } from "./create-connector.js";
import * as McpClient from "@nextbot/mcp-client";

// QA Final Review B1: nothing ever set `connector.status` away from its DB-default
// `Offline`, so `permission-resolver.ts`'s `connector_offline` hard-deny fired for
// every real tool call in the product. This suite proves `probeConnectorHealth`
// (the health-check worker's own probe function) is now the fix: a successful probe
// transitions `Connected`, a failing probe (re)confirms `Offline`, and a slow-but-
// succeeding probe (above the connector's own `latency_threshold_ms`) is `Degraded`.
vi.mock("@nextbot/mcp-client", async (importOriginal) => {
  const actual = await importOriginal<typeof McpClient>();
  return { ...actual, listTools: vi.fn() };
});

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  vi.mocked(McpClient.listTools).mockReset();
});

async function readConnectorStatus(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, connectorId: string) {
  const rows = await withTenant(ctx, (db) =>
    db.select().from(schema.connector).where(and(eq(schema.connector.tenantId, ctx.tenantId), eq(schema.connector.id, connectorId))),
  );
  return rows[0]!.status;
}

describe("probeConnectorHealth transitions connector.status (BL-11/B1 regression, real Postgres)", () => {
  it("transitions Offline -> Connected after a successful probe, unblocking tool calls previously denied for connector_offline", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Health Probe Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    expect(connector.status).toBe("Offline");

    vi.mocked(McpClient.listTools).mockResolvedValue([{ name: "get_lead", inputSchema: { type: "object" } }] as never);

    const { probeConnectorHealth } = await import("./health-check.js");
    const result = await probeConnectorHealth(ctx, connector.id);
    expect(result.ok).toBe(true);

    // This is the exact column `permission-resolver.ts`'s step-3 short-circuit
    // reads (`connector.status === "Offline"` -> deny `connector_offline`); proving
    // it flips to `Connected` here is what unblocks every real tool call the
    // resolver would otherwise hard-deny (resolver behavior itself is covered by
    // `packages/modules/tool-registry`'s own unit tests, which pass this exact
    // value in as `ResolverConnector.status`).
    expect(await readConnectorStatus(ctx, connector.id)).toBe("Connected");
  });

  it("sets status to Offline when the probe fails", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Failing Probe Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });

    vi.mocked(McpClient.listTools).mockRejectedValue(new Error("connection refused"));

    const { probeConnectorHealth } = await import("./health-check.js");
    const result = await probeConnectorHealth(ctx, connector.id);
    expect(result.ok).toBe(false);
    expect(await readConnectorStatus(ctx, connector.id)).toBe("Offline");
  });

  it("sets status to Degraded when the probe succeeds but exceeds the connector's latency threshold", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const connector = await createConnector(ctx, {
      name: "Slow Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });

    // Tighten the latency threshold to well below what the (near-instant) mocked
    // call will still measure as elapsed, so the "above threshold" branch is
    // exercised deterministically rather than racing the real clock.
    await withTenant(ctx, (db) =>
      db.update(schema.connector).set({ latencyThresholdMs: -1 }).where(and(eq(schema.connector.tenantId, ctx.tenantId), eq(schema.connector.id, connector.id))),
    );

    vi.mocked(McpClient.listTools).mockResolvedValue([{ name: "get_lead", inputSchema: { type: "object" } }] as never);

    const { probeConnectorHealth } = await import("./health-check.js");
    const result = await probeConnectorHealth(ctx, connector.id);
    expect(result.ok).toBe(true);
    expect(await readConnectorStatus(ctx, connector.id)).toBe("Degraded");
  });
});
