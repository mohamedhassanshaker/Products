import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import type * as ConnectorsModule from "@nextbot/connectors";
import { discoverAndSyncTools, listCatalog } from "@nextbot/tool-registry";
import { withTenant, schema, generateId } from "@nextbot/db";
import { queryAgentRunSpans, _resetClickHouseForTests } from "@nextbot/db/clickhouse";
import { getAgentRun } from "@nextbot/agent-platform";
import { resolveOrSynthesizeRouteVersionForKey } from "@nextbot/model-gateway";
import { eq } from "drizzle-orm";
import type * as AiRegistryModule from "@nextbot/ai-registry";
import { runTurnPipeline, type EgressPort } from "@nextbot/orchestration";

/**
 * Phase 13 (BL-06) — the NFR-9 assertion the plan calls for: "every run that
 * produced a tool call is end-to-end traceable". Exercises the real Phase 12 turn
 * pipeline with a real `agentDefinitionVersionId` supplied (see
 * `TurnPipelineInput`'s doc for why this is opt-in) and asserts the resulting
 * `agent_run` row plus its `agent_run_span` rows in ClickHouse form a complete trace:
 * a `ModelCall` span for goal/tool selection and a `ToolCall` span for the dispatch,
 * both attributable to the same `agent_run.id`/`otel_trace_id`.
 *
 * Seeds `agent_definition`/`agent_definition_version` directly via Drizzle rather
 * than through `@nextbot/agent-platform`'s Git-backed version-authoring flow — this
 * test is exercising the turn pipeline's tracing wiring, not agent-platform's version
 * creation feature, so a direct fixture insert is the right level of isolation.
 */
const discoverToolsMock = vi.fn();
vi.mock("@nextbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorsModule>();
  return { ...actual, discoverTools: (...args: unknown[]) => discoverToolsMock(...args) };
});

const generateStructuredMock = vi.fn();
vi.mock("@nextbot/ai-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof AiRegistryModule>();
  return { ...actual, generateStructured: (...args: unknown[]) => generateStructuredMock(...args) };
});

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  discoverToolsMock.mockReset();
  generateStructuredMock.mockReset();
  await _resetClickHouseForTests();
});

async function forceConnectorConnected(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, connectorId: string) {
  await withTenant(ctx, async (db) => {
    await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connectorId));
  });
}

async function seedAgentDefinitionVersion(ctx: Awaited<ReturnType<typeof createFixtureTenant>>): Promise<string> {
  // Target Architecture Blueprint Phase 2 (BL-33, FR-AGT-22) — `agent_definition_
  // version.model_route_version_id` is a real, NOT NULL FK now; this direct-insert
  // fixture (bypassing `createAgentDefinitionVersion`'s own resolution) must supply
  // one, same as every other real caller would get via `resolveOrSynthesizeRouteVersionForKey`.
  const routeVersion = await resolveOrSynthesizeRouteVersionForKey(ctx, "chat.primary");
  return withTenant(ctx, async (db) => {
    const definitionId = generateId();
    await db.insert(schema.agentDefinition).values({ id: definitionId, tenantId: ctx.tenantId, name: `trace-fixture-${definitionId}` });
    const versionId = generateId();
    await db.insert(schema.agentDefinitionVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      agentDefinitionId: definitionId,
      version: "1.0.0",
      definitionYaml: "apiVersion: nextbot.io/v1\nkind: AgentDefinition\n",
      definitionHash: "fixture-hash",
      modelRouteKey: "chat.primary",
      modelRouteVersionId: routeVersion.id,
    });
    return versionId;
  });
}

describe("runTurnPipeline tracing (Phase 13 / BL-06, NFR-9 — real Postgres + ClickHouse)", () => {
  it("a Tier-1 tool-call turn produces a Succeeded agent_run with a complete ModelCall+ToolCall span trace", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_order", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Orders", backendType: "CRM", transport: "StreamableHTTP",
      endpointUrl: "https://orders.example.com/mcp", authMethod: "None", environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    const versionId = await seedAgentDefinitionVersion(ctx);
    generateStructuredMock.mockResolvedValue({ action: "call_tool", toolName: tool!.id, args: { orderId: "1" }, confidence: 0.95 });
    const egress: EgressPort = {
      invokeTool: vi.fn().mockResolvedValue({ outcome: "Succeeded", output: { columns: ["Order", "Status"], rows: [["#1", "Shipped"]] } }),
    };

    const { payload, runId } = await runTurnPipeline(
      ctx,
      { egress },
      { customerText: "where is my order", agentDefinitionVersionId: versionId },
    );

    expect(payload).toEqual({ contentType: "DataTable", title: undefined, columns: ["Order", "Status"], rows: [["#1", "Shipped"]] });
    expect(runId).not.toBeNull();

    const run = await getAgentRun(ctx, runId!);
    expect(run?.status).toBe("Succeeded");
    expect(run?.endedAt).not.toBeNull();
    expect(run?.otelTraceId).toMatch(/^[0-9a-f]{32}$/);

    const spans = await queryAgentRunSpans(ctx, runId!);
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(spans.every((s) => s.agentRunId === runId)).toBe(true);
    expect(spans.every((s) => s.traceId === run!.otelTraceId)).toBe(true);
    const kinds = spans.map((s) => s.kind);
    expect(kinds).toContain("ModelCall");
    expect(kinds).toContain("ToolCall");
    expect(spans.every((s) => s.status === "Ok")).toBe(true);
    // Time-ordered: the ModelCall (goal/tool selection) precedes the ToolCall (dispatch).
    const modelCallIndex = kinds.indexOf("ModelCall");
    const toolCallIndex = kinds.indexOf("ToolCall");
    expect(modelCallIndex).toBeLessThan(toolCallIndex);
  });

  it("a failed tool dispatch still produces a complete (Failed) trace, not a silent gap — NFR-9", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_order", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Orders", backendType: "CRM", transport: "StreamableHTTP",
      endpointUrl: "https://orders.example.com/mcp", authMethod: "None", environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    const versionId = await seedAgentDefinitionVersion(ctx);
    generateStructuredMock.mockResolvedValue({ action: "call_tool", toolName: tool!.id, args: {}, confidence: 0.9 });
    const egress: EgressPort = { invokeTool: vi.fn().mockResolvedValue({ outcome: "Failed", errorMessage: "upstream 500" }) };

    const { payload, runId } = await runTurnPipeline(ctx, { egress }, { customerText: "get my order", agentDefinitionVersionId: versionId });

    expect(payload).toMatchObject({ contentType: "Error", reason: "ToolCallFailure" });
    const run = await getAgentRun(ctx, runId!);
    expect(run?.status).toBe("Failed");

    const spans = await queryAgentRunSpans(ctx, runId!);
    const toolCallSpan = spans.find((s) => s.kind === "ToolCall");
    expect(toolCallSpan?.status).toBe("Error");
  });

  it("a guardrail-blocked turn (no tool dispatch at all) still ends its agent_run as Failed, not left Running", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_order", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Orders", backendType: "CRM", transport: "StreamableHTTP",
      endpointUrl: "https://orders.example.com/mcp", authMethod: "None", environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    const versionId = await seedAgentDefinitionVersion(ctx);
    generateStructuredMock.mockResolvedValue({ action: "call_tool", toolName: tool!.id, args: {}, confidence: 0.9 });
    const egress: EgressPort = { invokeTool: vi.fn() };

    const { payload, runId } = await runTurnPipeline(
      ctx,
      { egress },
      {
        customerText: "delete my order",
        agentDefinitionVersionId: versionId,
        guardrailRules: [{ id: "r1", toolName: tool!.name, effect: "BlockToolCall", reason: "test block" }],
      },
    );

    expect(payload).toMatchObject({ contentType: "Error", reason: "ToolCallFailure" });
    expect(egress.invokeTool).not.toHaveBeenCalled();
    const run = await getAgentRun(ctx, runId!);
    expect(run?.status).toBe("Failed");
    // Only the ModelCall (goal selection) span exists — no ToolCall span since the
    // guardrail blocked before dispatch.
    const spans = await queryAgentRunSpans(ctx, runId!);
    expect(spans.map((s) => s.kind)).toEqual(["ModelCall"]);
  });

  it("egress throwing (transport failure) still records an Error ToolCall span and ends the run Failed", async () => {
    discoverToolsMock.mockResolvedValue([{ name: "get_order", inputSchema: { type: "object" } }]);
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Orders", backendType: "CRM", transport: "StreamableHTTP",
      endpointUrl: "https://orders.example.com/mcp", authMethod: "None", environment: "Sandbox",
    });
    await forceConnectorConnected(ctx, connector.id);
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    const versionId = await seedAgentDefinitionVersion(ctx);
    generateStructuredMock.mockResolvedValue({ action: "call_tool", toolName: tool!.id, args: {}, confidence: 0.9 });
    const egress: EgressPort = { invokeTool: vi.fn().mockRejectedValue(new Error("transport error")) };

    const { payload, runId } = await runTurnPipeline(ctx, { egress }, { customerText: "get my order", agentDefinitionVersionId: versionId });

    expect(payload).toMatchObject({ contentType: "Error", reason: "ToolCallFailure" });
    const run = await getAgentRun(ctx, runId!);
    expect(run?.status).toBe("Failed");
    const spans = await queryAgentRunSpans(ctx, runId!);
    const toolCallSpan = spans.find((s) => s.kind === "ToolCall");
    expect(toolCallSpan?.status).toBe("Error");
  });
});
