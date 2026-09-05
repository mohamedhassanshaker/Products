import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation } from "@nextbot/conversations";
import { discoverAndSyncTools, listCatalog, updateToolRules, createCapabilityGroup, handleSetCapabilityGroup } from "@nextbot/tool-registry";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { runTierEngine } from "@nextbot/orchestration";

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

async function forceConnectorConnected(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, connectorId: string) {
  await withTenant(ctx, async (db) => {
    await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connectorId));
  });
}

async function fixtureConversation(ctx: Awaited<ReturnType<typeof createFixtureTenant>>): Promise<string> {
  const channel = await createWebWidgetChannel(ctx, { name: "Widget", environment: "Sandbox" });
  return insertConversation(ctx, { channelId: channel.id, language: "en" });
}

describe("runTierEngine — LLD §6.2 steps 4/7/6 (Tier-1 immediate + Tier-2/3 suspension, real Postgres)", () => {
  it("Tier1Executable when resolvePermission Allows and the tool's tier is Tier1", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_ticket", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Ticketing", backendType: "Ticketing", transport: "StreamableHTTP",
      endpointUrl: "https://ticketing.example.com/mcp", authMethod: "None", environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);
    await discoverAndSyncTools(ctx, connector.id); // seeds the BackendType-default Allow rule

    const [tool] = await listCatalog(ctx, { connectorId: connector.id });
    const conversationId = await fixtureConversation(ctx);
    const outcome = await runTierEngine(ctx, tool!.id, {}, { conversationId, tool: { toolId: tool!.id, toolName: tool!.name, connectorId: connector.id }, args: {} });
    expect(outcome.kind).toBe("Tier1Executable");
  });

  it("PolicyDenied (fail-closed) when no rule matches at all", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_lead", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "CRM", backendType: "CRM", transport: "StreamableHTTP",
      endpointUrl: "https://crm.example.com/mcp", authMethod: "None", environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    await withTenant(ctx, async (db) => {
      await db.delete(schema.toolPermissionRule).where(eq(schema.toolPermissionRule.tenantId, ctx.tenantId));
    });

    const conversationId = await fixtureConversation(ctx);
    const outcome = await runTierEngine(ctx, tool!.id, {}, { conversationId, tool: { toolId: tool!.id, toolName: tool!.name, connectorId: connector.id }, args: {} });
    expect(outcome).toMatchObject({ kind: "PolicyDenied", resolution: { effect: "Deny", reason: "no_matching_rule" } });
  });

  it("SuspendedForApproval (Tier-3, no card) when the resolver requires Tier3 human approval", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "issue_refund", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Billing", backendType: "Billing", transport: "StreamableHTTP",
      endpointUrl: "https://billing.example.com/mcp", authMethod: "None", environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    await updateToolRules(ctx, tool!.id, [
      { scope: "Tool", toolId: tool!.id, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3", enabled: true },
    ]);

    const conversationId = await fixtureConversation(ctx);
    const outcome = await runTierEngine(ctx, tool!.id, {}, {
      conversationId,
      tool: { toolId: tool!.id, toolName: tool!.name, connectorId: connector.id },
      args: { amount: 42 },
    });
    expect(outcome.kind).toBe("SuspendedForApproval");
    expect((outcome as { resolution: { tier: string } }).resolution.tier).toBe("Tier3");
    expect((outcome as { payload: unknown }).payload).toBeNull();
    expect((outcome as { toolCallId: string }).toolCallId).toBeTruthy();

    // Real DB assertion: the row actually landed in AwaitingHumanApproval, with an
    // approval_request queue row alongside it (not just an in-memory outcome shape).
    const toolCallId = (outcome as { toolCallId: string }).toolCallId;
    const toolCallRows = await withTenant(ctx, (db) => db.select().from(schema.toolCall).where(eq(schema.toolCall.id, toolCallId)));
    expect(toolCallRows[0]?.status).toBe("AwaitingHumanApproval");
    const approvalRows = await withTenant(ctx, (db) => db.select().from(schema.approvalRequest).where(eq(schema.approvalRequest.toolCallId, toolCallId)));
    expect(approvalRows).toHaveLength(1);
  });

  it("SuspendedForApproval (Tier-2, Confirmation card) when the resolver requires Tier2 customer confirmation", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "update_address", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "CRM2", backendType: "CRM", transport: "StreamableHTTP",
      endpointUrl: "https://crm2.example.com/mcp", authMethod: "None", environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    await updateToolRules(ctx, tool!.id, [
      { scope: "Tool", toolId: tool!.id, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier2", enabled: true },
    ]);

    const conversationId = await fixtureConversation(ctx);
    const outcome = await runTierEngine(ctx, tool!.id, {}, {
      conversationId,
      tool: { toolId: tool!.id, toolName: tool!.name, connectorId: connector.id },
      args: { newAddress: "123 Main St" },
    });
    expect(outcome.kind).toBe("SuspendedForApproval");
    const payload = (outcome as { payload: { contentType: string; state: string } }).payload;
    expect(payload?.contentType).toBe("Confirmation");
    expect(payload?.state).toBe("pending");
  });

  /**
   * Phase 17 (client-feedback-batch capability-group enforcement) — proves the
   * `resolvePermission` `capability_group_not_permitted` re-check is a REAL,
   * independent authorization boundary, not merely inferred from the catalog
   * pre-filter working correctly. `runTierEngine` is called directly here (bypassing
   * `runTurnPipeline`'s catalog/goal-selection stage entirely) with
   * `allowedCapabilityGroupIds` supplied straight into `resolverCtx`, the exact same
   * shape `turn-pipeline.ts` threads through once it resolves an agent version's
   * `toolPolicy.capabilityGroups` — so this test would fail if the resolver-layer
   * check were ever accidentally removed, even though the pre-filter (proven
   * separately in `orchestration-turn-pipeline.int.test.ts`) would still be doing its
   * job and might otherwise mask the regression.
   */
  describe("Phase 17 — capability-group `allowedCapabilityGroupIds` (defense in depth, independent of the catalog pre-filter)", () => {
    it("PolicyDenied (capability_group_not_permitted) when the tool's assigned group isn't in the caller's allowed list, even though a real Allow rule exists", async () => {
      discoverToolsMock.mockResolvedValue([{ name: "get_ticket", inputSchema: { type: "object" } }]);
      const ctx = await createFixtureTenant();
      createdTenantIds.push(ctx.tenantId);
      const connector = await createConnector(ctx, {
        name: "Ticketing2", backendType: "Ticketing", transport: "StreamableHTTP",
        endpointUrl: "https://ticketing2.example.com/mcp", authMethod: "None", environment: "Sandbox",
      });
      await forceConnectorConnected(ctx, connector.id);
      await discoverAndSyncTools(ctx, connector.id); // seeds the BackendType-default Allow rule
      const [tool] = await listCatalog(ctx, { connectorId: connector.id });

      const billingGroupId = await createCapabilityGroup(ctx, { name: "billing" });
      await handleSetCapabilityGroup(ctx, tool!.id, billingGroupId);

      const conversationId = await fixtureConversation(ctx);
      const outcome = await runTierEngine(
        ctx,
        tool!.id,
        { allowedCapabilityGroupIds: ["some-other-group-id"] }, // deliberately NOT billingGroupId
        { conversationId, tool: { toolId: tool!.id, toolName: tool!.name, connectorId: connector.id }, args: {} },
      );
      expect(outcome).toMatchObject({ kind: "PolicyDenied", resolution: { effect: "Deny", reason: "capability_group_not_permitted" } });
    });

    it("Tier1Executable when the tool's assigned group IS in the caller's allowed list", async () => {
      discoverToolsMock.mockResolvedValue([{ name: "get_ticket", inputSchema: { type: "object" } }]);
      const ctx = await createFixtureTenant();
      createdTenantIds.push(ctx.tenantId);
      const connector = await createConnector(ctx, {
        name: "Ticketing3", backendType: "Ticketing", transport: "StreamableHTTP",
        endpointUrl: "https://ticketing3.example.com/mcp", authMethod: "None", environment: "Sandbox",
      });
      await forceConnectorConnected(ctx, connector.id);
      await discoverAndSyncTools(ctx, connector.id);
      const [tool] = await listCatalog(ctx, { connectorId: connector.id });

      const billingGroupId = await createCapabilityGroup(ctx, { name: "billing" });
      await handleSetCapabilityGroup(ctx, tool!.id, billingGroupId);

      const conversationId = await fixtureConversation(ctx);
      const outcome = await runTierEngine(
        ctx,
        tool!.id,
        { allowedCapabilityGroupIds: [billingGroupId] },
        { conversationId, tool: { toolId: tool!.id, toolName: tool!.name, connectorId: connector.id }, args: {} },
      );
      expect(outcome.kind).toBe("Tier1Executable");
    });

    it("Tier1Executable for an UNGROUPED tool even under an active, non-empty restriction (matches the Design Studio's shipped field hint)", async () => {
      discoverToolsMock.mockResolvedValue([{ name: "get_ticket", inputSchema: { type: "object" } }]);
      const ctx = await createFixtureTenant();
      createdTenantIds.push(ctx.tenantId);
      const connector = await createConnector(ctx, {
        name: "Ticketing4", backendType: "Ticketing", transport: "StreamableHTTP",
        endpointUrl: "https://ticketing4.example.com/mcp", authMethod: "None", environment: "Sandbox",
      });
      await forceConnectorConnected(ctx, connector.id);
      await discoverAndSyncTools(ctx, connector.id);
      const [tool] = await listCatalog(ctx, { connectorId: connector.id }); // never assigned a capability group

      const conversationId = await fixtureConversation(ctx);
      const outcome = await runTierEngine(
        ctx,
        tool!.id,
        { allowedCapabilityGroupIds: ["some-other-tenants-real-group-id"] },
        { conversationId, tool: { toolId: tool!.id, toolName: tool!.name, connectorId: connector.id }, args: {} },
      );
      expect(outcome.kind).toBe("Tier1Executable");
    });

    it("`allowedCapabilityGroupIds: undefined` (the default) applies no restriction at all, even for a grouped tool — every pre-Phase-17 caller of resolveToolPermission/runTierEngine is unaffected", async () => {
      discoverToolsMock.mockResolvedValue([{ name: "get_ticket", inputSchema: { type: "object" } }]);
      const ctx = await createFixtureTenant();
      createdTenantIds.push(ctx.tenantId);
      const connector = await createConnector(ctx, {
        name: "Ticketing5", backendType: "Ticketing", transport: "StreamableHTTP",
        endpointUrl: "https://ticketing5.example.com/mcp", authMethod: "None", environment: "Sandbox",
      });
      await forceConnectorConnected(ctx, connector.id);
      await discoverAndSyncTools(ctx, connector.id);
      const [tool] = await listCatalog(ctx, { connectorId: connector.id });

      const billingGroupId = await createCapabilityGroup(ctx, { name: "billing" });
      await handleSetCapabilityGroup(ctx, tool!.id, billingGroupId);

      const conversationId = await fixtureConversation(ctx);
      const outcome = await runTierEngine(
        ctx,
        tool!.id,
        {}, // no `allowedCapabilityGroupIds` at all
        { conversationId, tool: { toolId: tool!.id, toolName: tool!.name, connectorId: connector.id }, args: {} },
      );
      expect(outcome.kind).toBe("Tier1Executable");
    });
  });
});
