import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { resolveTenantById } from "@nextbot/tenancy";
import { discoverAndSyncTools, listCatalog } from "@nextbot/tool-registry";
import { withTenant, schema, generateId } from "@nextbot/db";
import { eq } from "drizzle-orm";
import type { TenantContext } from "@nextbot/db";
import { resolveOrSynthesizeRouteVersionForKey } from "@nextbot/model-gateway";
import { startMockMcpServer, startMockOpenAiCompatibleServer, type MockMcpServerHandle, type MockOpenAiServerHandle } from "@nextbot/testing";
import type * as ConnectorsModule from "@nextbot/connectors";
import { POST as createSession } from "../sessions/route.js";
import { POST as sendMessage } from "./route.js";

/**
 * The Phase 12 (BL-05) backlog-item e2e: a real widget message goes in through the
 * real HTTP route, through the real `orchestration` turn pipeline (real Postgres
 * catalog/permission resolution, real domain-event outbox), through a real MCP tool
 * call over the network to `packages/testing`'s mock MCP server, back out as a real
 * structured card persisted for the widget. The AI model call is also real HTTP
 * (against `startMockOpenAiCompatibleServer`) — not mocked at the ai-registry layer.
 *
 * Only `discoverTools` (network reach for connector discovery) and the `endpointUrl`
 * `findConnectorById` returns are substituted: `connector.endpoint_url` carries a
 * DB-level https-only CHECK constraint (FR-SEC-02) that a local plain-HTTP test
 * server cannot satisfy without a throwaway TLS certificate — the same scoped
 * exception `tool-registry/catalog-and-permission.int.test.ts` already documents and
 * uses for the identical reason. Everything else in this test is real.
 */
let mcpServer: MockMcpServerHandle;
let aiServer: MockOpenAiServerHandle;
let expectedToolId = "";

const discoverToolsMock = vi.fn();
vi.mock("@nextbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorsModule>();
  return {
    ...actual,
    discoverTools: (...args: unknown[]) => discoverToolsMock(...args),
    findConnectorById: async (...args: Parameters<typeof actual.findConnectorById>) => {
      const real = await actual.findConnectorById(...args);
      return real ? { ...real, endpointUrl: mcpServer.url } : real;
    },
  };
});

beforeAll(async () => {
  mcpServer = await startMockMcpServer([
    {
      name: "get_order_status",
      inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
      outputSchema: { type: "object" },
      result: (args: unknown) => ({ columns: ["Order", "Status"], rows: [[(args as { orderId: string }).orderId, "Shipped"]] }),
    },
  ]);
  aiServer = await startMockOpenAiCompatibleServer({
    onChatCompletion: () => ({
      content: JSON.stringify({ action: "call_tool", toolName: expectedToolId, args: { orderId: "e2e-42" }, confidence: 0.95 }),
    }),
  });
  process.env.AI_PROVIDER = "openai-compatible";
  process.env.AI_BASE_URL = aiServer.url;
  process.env.AI_MODEL_CHAT_PRIMARY = "test-model";
  process.env.AI_MODEL_REASONING_PLANNER = "test-model";
  process.env.AI_API_KEY = "test-key";
  process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
});
afterAll(async () => {
  await mcpServer.close();
  await aiServer.close();
});

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  discoverToolsMock.mockReset();
});

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
}

/** QA Final Review S1 test fixture — directly seeds one `Production`-status
 * `agent_definition_version` for the tenant (bypassing the full promotion
 * workflow, the same "force the column directly" convention already used
 * elsewhere in this suite for `connector.status`), so version resolution has something
 * real to resolve.
 *
 * **Phase 17 (BL-48) note — this fixture deliberately still exercises the FALLBACK path.**
 * The function it used to name, `findActiveAgentDefinitionVersion`, is now
 * `findActiveAgentDefinitionVersionTenantWideFallback` and is no longer the live
 * resolution: `resolveTurnAgentVersion` runs `channel → agent definition → deployment
 * traffic split → version` first. This suite's channel has no `agent_definition_id`
 * binding, so the resolver falls through to exactly this tenant-wide lookup — which is
 * precisely ADR-0019 §6 item 10's fallback-preservation requirement, and why this suite
 * passing UNMODIFIED across Phase 17 is itself a piece of evidence rather than an
 * oversight. */
async function seedProductionAgentVersion(ctx: TenantContext): Promise<string> {
  const definitionId = generateId();
  const versionId = generateId();
  // Target Architecture Blueprint Phase 2 (BL-33, FR-AGT-22) — `model_route_version_id`
  // is a real, NOT NULL FK now; resolve/synthesize one the same way any real caller
  // (`createAgentDefinitionVersion`) would, since this fixture bypasses that path.
  const routeVersion = await resolveOrSynthesizeRouteVersionForKey(ctx, "chat.primary");
  await withTenant(ctx, async (db) => {
    await db.insert(schema.agentDefinition).values({ id: definitionId, tenantId: ctx.tenantId, name: "S1 Regression Bot" });
    await db.insert(schema.agentDefinitionVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      agentDefinitionId: definitionId,
      version: "1.0.0",
      status: "Production",
      definitionYaml: "apiVersion: nextbot.io/v1\nkind: AgentDefinition\n",
      definitionHash: "test-hash",
      modelRouteKey: "chat.primary",
      modelRouteVersionId: routeVersion.id,
    });
  });
  return versionId;
}

describe("Phase 12 e2e: widget message -> real turn pipeline -> real MCP tool call -> rendered card", () => {
  it("ask a question -> tool call -> structured DataTable card is persisted", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "E2E Widget", environment: "Sandbox" });
    const resolved = await resolveTenantById(tenant.tenantId);

    const { createConnector } = await import("@nextbot/connectors");
    const connector = await createConnector(tenant, {
      name: "Orders Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://orders.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await withTenant(tenant, async (db) => {
      await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id));
    });

    discoverToolsMock.mockResolvedValue([
      { name: "get_order_status", inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] }, outputSchema: { type: "object" } },
    ]);
    await discoverAndSyncTools(tenant, connector.id); // seeds the BackendType-default Allow rule
    const [tool] = await listCatalog(tenant, { connectorId: connector.id });
    expectedToolId = tool!.id;

    const sessionRes = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", { tenantSlug: resolved!.slug, channelPublicKey: channel.publicKey }),
    );
    expect(sessionRes.status).toBe(201);
    const session = (await sessionRes.json()) as { sessionToken: string; conversationId: string };

    const messageRes = await sendMessage(
      jsonRequest(
        "http://localhost/api/v1/widget/messages",
        { clientMessageId: "e2e-tool-1", contentType: "Text", payload: { contentType: "Text", text: "where is my order e2e-42" } },
        { authorization: `Bearer ${session.sessionToken}`, "idempotency-key": "e2e-tool-1" },
      ),
    );
    expect(messageRes.status).toBe(202);

    const messages = await withTenant(tenant, async (db) =>
      db.select().from(schema.message).where(eq(schema.message.conversationId, session.conversationId)),
    );
    const aiMessage = messages.find((m) => m.sender === "AI");
    expect(aiMessage).toBeTruthy();
    expect(aiMessage!.contentType).toBe("DataTable");
    expect(aiMessage!.payload).toMatchObject({ contentType: "DataTable", columns: ["Order", "Status"], rows: [["e2e-42", "Shipped"]] });
  });

  // QA Final Review S1: nothing ever set `channel.agent_definition_version_id`,
  // so `agent_run` (and every ClickHouse span) was never created for real
  // traffic — the Trace Viewer/cost/Runtime Traces screens were permanently
  // empty. This proves a real conversation turn, once the tenant has a
  // `Production`-status agent definition version, now creates a real `agent_run`
  // row (and stamps the message with a non-null `agentRunId`) instead of
  // `runId: null`.
  it("a real conversation turn creates a real agent_run once the tenant has a Production agent definition version", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    await seedProductionAgentVersion(tenant);

    const channel = await createWebWidgetChannel(tenant, { name: "S1 Widget", environment: "Sandbox" });
    const resolved = await resolveTenantById(tenant.tenantId);

    const { createConnector } = await import("@nextbot/connectors");
    const connector = await createConnector(tenant, {
      name: "S1 Orders Connector",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://s1-orders.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await withTenant(tenant, async (db) => {
      await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id));
    });

    discoverToolsMock.mockResolvedValue([
      { name: "get_order_status", inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] }, outputSchema: { type: "object" } },
    ]);
    await discoverAndSyncTools(tenant, connector.id);
    const [tool] = await listCatalog(tenant, { connectorId: connector.id });
    expectedToolId = tool!.id;

    const sessionRes = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", { tenantSlug: resolved!.slug, channelPublicKey: channel.publicKey }),
    );
    const session = (await sessionRes.json()) as { sessionToken: string; conversationId: string };

    const messageRes = await sendMessage(
      jsonRequest(
        "http://localhost/api/v1/widget/messages",
        { clientMessageId: "s1-tool-1", contentType: "Text", payload: { contentType: "Text", text: "where is my order e2e-42" } },
        { authorization: `Bearer ${session.sessionToken}`, "idempotency-key": "s1-tool-1" },
      ),
    );
    expect(messageRes.status).toBe(202);

    const messages = await withTenant(tenant, async (db) =>
      db.select().from(schema.message).where(eq(schema.message.conversationId, session.conversationId)),
    );
    const aiMessage = messages.find((m) => m.sender === "AI");
    expect(aiMessage!.agentRunId).not.toBeNull();

    const runs = await withTenant(tenant, async (db) =>
      db.select().from(schema.agentRun).where(eq(schema.agentRun.id, aiMessage!.agentRunId!)),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("Succeeded");
  });
});
