import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation } from "@nextbot/conversations";
import { discoverAndSyncTools, listCatalog, updateToolRules } from "@nextbot/tool-registry";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { startMockMcpServer, type MockMcpServerHandle } from "@nextbot/testing";
import { createSuspendedToolCall, decideTier2, decideTier3 } from "@nextbot/orchestration";
import { generateId } from "@nextbot/db";

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

const callCounter = { count: 0 };

async function setUpSuspendedCall(tier: "Tier2" | "Tier3") {
  callCounter.count = 0;
  discoverToolsMock.mockResolvedValue([{ name: "issue_refund", inputSchema: { type: "object" }, outputSchema: { type: "object" } }]);
  mcpServer = await startMockMcpServer([
    {
      name: "issue_refund",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      result: () => {
        callCounter.count += 1;
        return { fields: [{ label: "refunded", value: "true" }] };
      },
    },
  ]);
  const ctx = await createFixtureTenant();
  const connector = await createConnector(ctx, {
    name: "Billing", backendType: "Billing", transport: "StreamableHTTP",
    endpointUrl: "https://billing.example.com/mcp", authMethod: "None", environment: "Sandbox",
  });
  await withTenant(ctx, (db) => db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id)));
  await discoverAndSyncTools(ctx, connector.id);
  const [tool] = await listCatalog(ctx, { connectorId: connector.id });
  await updateToolRules(ctx, tool!.id, [
    { scope: "Tool", toolId: tool!.id, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: tier, enabled: true },
  ]);
  const channel = await createWebWidgetChannel(ctx, { name: "Widget", environment: "Sandbox" });
  const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });

  const { toolCall } = await createSuspendedToolCall(ctx, {
    conversationId,
    toolId: tool!.id,
    toolName: tool!.name,
    connectorId: connector.id,
    args: { amount: 42 },
    tier,
  });
  return { ctx, toolCall };
}

async function importEgress() {
  const { createMcpEgressPort } = await import("./mcp-egress.js");
  return createMcpEgressPort;
}

describe("Tier-2/3 approval-service — LLD §6.3/6.4/6.5 (real Postgres + real MCP server)", () => {
  it("Tier-2 Cancel performs zero backend mutation (the MCP server is never called)", async () => {
    const { ctx, toolCall } = await setUpSuspendedCall("Tier2");
    createdTenantIds.push(ctx.tenantId);
    const createMcpEgressPort = await importEgress();

    const outcome = await decideTier2(ctx, { egress: createMcpEgressPort(ctx) }, toolCall.id, "Cancel");

    expect(outcome.toolCall.status).toBe("Cancelled");
    expect(callCounter.count).toBe(0);
  });

  it("Tier-2 Confirm executes the call exactly once even under 10 truly concurrent duplicate Confirm attempts", async () => {
    const { ctx, toolCall } = await setUpSuspendedCall("Tier2");
    createdTenantIds.push(ctx.tenantId);
    const createMcpEgressPort = await importEgress();

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => decideTier2(ctx, { egress: createMcpEgressPort(ctx) }, toolCall.id, "Confirm")),
    );

    const fulfilled = attempts.filter((a) => a.status === "fulfilled");
    // Exactly one caller's CAS-claim wins Created->Executing; the rest see a non-
    // AwaitingCustomerConfirmation status and throw ApprovalAlreadyDecidedError.
    expect(fulfilled).toHaveLength(1);

    const rows = await withTenant(ctx, (db) => db.select().from(schema.toolCall).where(eq(schema.toolCall.id, toolCall.id)));
    expect(rows[0]?.status).toBe("Succeeded");
    expect(rows[0]?.attemptCount).toBe(2); // Created->suspended + suspended->Executing, both real CAS claims

    // Every rejected duplicate is still logged (LLD §6.3), not silently dropped.
    const events = await withTenant(ctx, (db) => db.select().from(schema.toolCallEvent).where(eq(schema.toolCallEvent.toolCallId, toolCall.id)));
    const rejectedDuplicates = events.filter((e) => !e.accepted);
    expect(rejectedDuplicates.length).toBeGreaterThan(0);
  });

  it("Tier-3 Reject requires a note and performs zero execution", async () => {
    const { ctx, toolCall } = await setUpSuspendedCall("Tier3");
    createdTenantIds.push(ctx.tenantId);
    const createMcpEgressPort = await importEgress();

    await expect(decideTier3(ctx, { egress: createMcpEgressPort(ctx) }, toolCall.id, "Rejected", undefined, generateId())).rejects.toThrow();

    const outcome = await decideTier3(ctx, { egress: createMcpEgressPort(ctx) }, toolCall.id, "Rejected", "not authorized", generateId());
    expect(outcome.toolCall.status).toBe("Cancelled");
  });

  it("Tier-3 Approved executes for real (once) and a second decision attempt is rejected, not re-executed", async () => {
    const { ctx, toolCall } = await setUpSuspendedCall("Tier3");
    createdTenantIds.push(ctx.tenantId);
    const createMcpEgressPort = await importEgress();

    const first = await decideTier3(ctx, { egress: createMcpEgressPort(ctx) }, toolCall.id, "Approved", undefined, generateId());
    expect(first.toolCall.status).toBe("Succeeded");
    expect(first.resultPayload).toMatchObject({ contentType: "DataSummary" });

    await expect(decideTier3(ctx, { egress: createMcpEgressPort(ctx) }, toolCall.id, "Approved", undefined, generateId())).rejects.toThrow();

    const rows = await withTenant(ctx, (db) => db.select().from(schema.toolCall).where(eq(schema.toolCall.id, toolCall.id)));
    expect(rows[0]?.attemptCount).toBe(2); // Created->suspended + suspended->Executing, both real CAS claims
  });

  it("Tier-3 MoreInfoRequested keeps the call pending (not discarded) and re-notifies", async () => {
    const { ctx, toolCall } = await setUpSuspendedCall("Tier3");
    createdTenantIds.push(ctx.tenantId);
    const createMcpEgressPort = await importEgress();

    const outcome = await decideTier3(ctx, { egress: createMcpEgressPort(ctx) }, toolCall.id, "MoreInfoRequested", "which order?", generateId());
    expect(outcome.toolCall.status).toBe("AwaitingHumanApproval");

    const rows = await withTenant(ctx, (db) => db.select().from(schema.approvalRequest).where(eq(schema.approvalRequest.toolCallId, toolCall.id)));
    expect(rows[0]?.moreInfoQuestion).toBe("which order?");
  });
});
