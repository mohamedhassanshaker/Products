import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext } from "@nextbot/db";
import { createConnector, findConnectorById } from "@nextbot/connectors";
import { migrateExistingConnectorsForTenant } from "./connector-migration.js";
import { listBindingsForVersion, listServers } from "../infrastructure/mcp-server-repository.js";
import { computeSchemaHash } from "../domain/manifest-hash.js";

const ACTOR = "44444444-4444-4444-4444-444444444444";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

/** Simulates "already discovered via the pre-existing v1 connector flow" without a
 * live network call — this test's job is the migration's own read/wrap logic, not
 * re-testing discovery (covered elsewhere). */
async function seedDiscoveredTool(ctx: TenantContext, connectorId: string, name: string, inputSchema: object) {
  const toolId = generateId();
  const versionId = generateId();
  await withTenant(ctx, async (db) => {
    await db.insert(schema.tool).values({
      id: toolId,
      tenantId: ctx.tenantId,
      connectorId,
      name,
      descriptionSource: `Fetch ${name}`,
      rwClass: "Read",
      rwClassSource: "AutoHeuristic",
      approvalTier: "Tier1",
      approvalTierSource: "BackendTypeDefault",
    });
    await db.insert(schema.toolSchemaVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      toolId,
      versionOrdinal: 1,
      inputSchema,
      outputSchema: {},
      schemaHash: computeSchemaHash(inputSchema),
      breakingChange: false,
    });
    await db.update(schema.tool).set({ currentSchemaVersionId: versionId }).where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId)));
  });
  return toolId;
}

describe("migrateExistingConnectorsForTenant (BL-34, LLD §14.3.1 — existing-connector migration)", () => {
  it("wraps pre-existing connector rows in a synthesized mcp_server without touching any connector/tool row", async () => {
    const ctx: TenantContext = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const sandboxConnector = await createConnector(ctx, {
      name: "legacy-crm",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm-sandbox.example.com/mcp",
      authMethod: "APIKey",
      credentialPlaintext: "sandbox-key",
      environment: "Sandbox",
    });
    const productionConnector = await createConnector(ctx, {
      name: "legacy-crm",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://crm-production.example.com/mcp",
      authMethod: "APIKey",
      credentialPlaintext: "production-key",
      environment: "Production",
    });
    // A connector whose name appears in only one environment — should get its own
    // one-binding server, exactly as LLD §14.3.1 specifies.
    const soloConnector = await createConnector(ctx, {
      name: "legacy-billing",
      backendType: "Billing",
      transport: "StreamableHTTP",
      endpointUrl: "https://billing.example.com/mcp",
      authMethod: "None",
      environment: "Production",
    });

    const toolId = await seedDiscoveredTool(ctx, sandboxConnector.id, "get_account", { type: "object", properties: { accountId: { type: "string" } } });

    const beforeSandbox = await findConnectorById(ctx, sandboxConnector.id);
    const beforeProduction = await findConnectorById(ctx, productionConnector.id);
    const beforeSolo = await findConnectorById(ctx, soloConnector.id);

    const result = await migrateExistingConnectorsForTenant(ctx, ACTOR);
    expect(result.serversCreated).toBe(2);
    expect(result.bindingsCreated).toBe(3);

    // --- No connector row is deleted, renamed, or otherwise mutated. ---
    const afterSandbox = await findConnectorById(ctx, sandboxConnector.id);
    const afterProduction = await findConnectorById(ctx, productionConnector.id);
    const afterSolo = await findConnectorById(ctx, soloConnector.id);
    expect(afterSandbox).toEqual(beforeSandbox);
    expect(afterProduction).toEqual(beforeProduction);
    expect(afterSolo).toEqual(beforeSolo);

    // --- No tool's connector_id FK target ever changes. ---
    const [toolAfter] = await withTenant(ctx, (db) => db.select().from(schema.tool).where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId))));
    expect(toolAfter?.connectorId).toBe(sandboxConnector.id);

    // --- The synthesized servers exist, wrapping the right connectors. ---
    const servers = await listServers(ctx);
    const crmServer = servers.find((s) => s.name === "legacy-crm")!;
    const billingServer = servers.find((s) => s.name === "legacy-billing")!;
    expect(crmServer).toBeTruthy();
    expect(billingServer).toBeTruthy();
    expect(crmServer.backendType).toBe("CRM");
    expect(billingServer.backendType).toBe("Billing");

    const crmBindings = await listBindingsForVersion(ctx, crmServer.currentVersionId!);
    expect(crmBindings).toHaveLength(2);
    expect(new Set(crmBindings.map((b) => b.connectorId))).toEqual(new Set([sandboxConnector.id, productionConnector.id]));

    const billingBindings = await listBindingsForVersion(ctx, billingServer.currentVersionId!);
    expect(billingBindings).toHaveLength(1);
    expect(billingBindings[0]?.connectorId).toBe(soloConnector.id);

    // --- The manifest item links back to the EXISTING tool row (no re-creation). ---
    const [manifestItem] = await withTenant(ctx, (db) =>
      db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, crmServer.currentVersionId!))),
    );
    expect(manifestItem?.toolId).toBe(toolId);
    expect(manifestItem?.name).toBe("get_account");

    // --- Idempotent: re-running inserts nothing further. ---
    const secondRun = await migrateExistingConnectorsForTenant(ctx, ACTOR);
    expect(secondRun.serversCreated).toBe(0);
    expect(secondRun.bindingsCreated).toBe(0);
    expect(secondRun.connectorsSkippedAlreadyBound).toBe(3);
    expect(await listServers(ctx)).toHaveLength(2);
  });
});
