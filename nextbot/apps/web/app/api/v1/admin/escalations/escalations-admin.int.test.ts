import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema, generateId, type TenantContext } from "@nextbot/db";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation } from "@nextbot/conversations";
import { triggerEscalation, claimEscalation, setAgentMaxConcurrent } from "@nextbot/escalations";
import { createConnector } from "@nextbot/connectors";
import { discoverAndSyncTools, listCatalog, updateToolRules } from "@nextbot/tool-registry";
import { findToolCallById } from "@nextbot/orchestration";
import { eq } from "drizzle-orm";
import type * as AiRegistryModule from "@nextbot/ai-registry";
import type * as ConnectorsModule from "@nextbot/connectors";

const generateStructuredMock = vi.fn();
vi.mock("@nextbot/ai-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof AiRegistryModule>();
  return { ...actual, generateStructured: (...args: unknown[]) => generateStructuredMock(...args) };
});

const discoverToolsMock = vi.fn();
vi.mock("@nextbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorsModule>();
  return { ...actual, discoverTools: (...args: unknown[]) => discoverToolsMock(...args) };
});

const callToolMock = vi.fn();
vi.mock("@nextbot/mcp-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, callTool: (...args: unknown[]) => callToolMock(...args) };
});

/**
 * Integration-level test for the Phase 16 (BL-09) escalation admin API surface: real
 * Postgres, real RBAC guard (`@nextbot/iam`'s `requirePermission`, not mocked), only
 * the session/auth seam mocked — same convention as `conversations-admin.int.test.ts`
 * / `bind-eval-suite/route.int.test.ts`.
 */
vi.mock("server-only", () => ({}));

let ctx: TenantContext;
let agentUserId: string;
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
  generateStructuredMock.mockReset();
  discoverToolsMock.mockReset();
  callToolMock.mockReset();
});

async function mockSessionAs(level: "Read" | "Write" | "None", approvalQueueLevel?: "Read" | "Write" | "None") {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () =>
      level === "None"
        ? { permissions: {}, tenantId: ctx.tenantId, userId: agentUserId, roleIds: [] }
        : {
            permissions: {
              escalations: level,
              ...(approvalQueueLevel && approvalQueueLevel !== "None" ? { approval_queue: approvalQueueLevel } : {}),
            },
            tenantId: ctx.tenantId,
            userId: agentUserId,
            roleIds: ["role-1"],
          },
    getSessionTenantContext: async () => ctx,
  }));
}

async function setUp() {
  ctx = await createFixtureTenant();
  const channel = await createWebWidgetChannel(ctx, { name: "Escalation Admin API Widget", environment: "Sandbox" });
  const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });
  agentUserId = await withTenant(ctx, async (db) => {
    const [row] = await db
      .insert(schema.appUser)
      .values({ id: generateId(), tenantId: ctx.tenantId, email: `${crypto.randomUUID()}@example.com`, displayName: "Sam", status: "Active" })
      .returning({ id: schema.appUser.id });
    return row!.id;
  });
  const { escalation } = await triggerEscalation(ctx, { conversationId, reason: "CustomerRequest", aiContextSnapshot: {} });
  return { conversationId, escalation };
}

describe("escalation admin API (Phase 16, BL-09)", () => {
  it("GET /escalations 403s without escalations=Read, 200s with it and includes the real row", async () => {
    await setUp();

    await mockSessionAs("None");
    const { GET: getForbidden } = await import("./route.js");
    expect((await getForbidden()).status).toBe(403);

    vi.resetModules();
    await mockSessionAs("Read");
    const { GET } = await import("./route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ reason: string }> };
    expect(body.items.some((i) => i.reason === "CustomerRequest")).toBe(true);
  });

  it("GET /escalations/{id} returns the takeover context detail, 404s an unknown id", async () => {
    const { escalation } = await setUp();
    await mockSessionAs("Read");
    const { GET } = await import("./[id]/route.js");

    const res = await GET(new NextRequest(`http://localhost/api/v1/admin/escalations/${escalation.id}`), {
      params: Promise.resolve({ id: escalation.id }),
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { reason: string; aiAttempts: unknown[] };
    expect(detail.reason).toBe("CustomerRequest");
    expect(Array.isArray(detail.aiAttempts)).toBe(true);

    const notFound = await GET(new NextRequest("http://localhost/api/v1/admin/escalations/nope"), {
      params: Promise.resolve({ id: "00000000-0000-7000-8000-000000000000" }),
    });
    expect(notFound.status).toBe(404);
  });

  it("full takeover flow through the real HTTP routes: claim -> message -> resolve", async () => {
    const { escalation } = await setUp();
    await mockSessionAs("Write");
    const { POST: claim } = await import("./[id]/claim/route.js");
    const claimRes = await claim(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });
    expect(claimRes.status).toBe(200);
    expect((await claimRes.json()).status).toBe("InProgress");

    // A second claim attempt now 409s (already claimed).
    const secondClaimRes = await claim(new NextRequest("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: escalation.id }),
    });
    expect(secondClaimRes.status).toBe(409);

    const { POST: sendMessage } = await import("./[id]/messages/route.js");
    const messageRes = await sendMessage(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ payload: { contentType: "Text", text: "Hi, how can I help?" } }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(messageRes.status).toBe(200);

    const { POST: resolve } = await import("./[id]/resolve/route.js");
    const resolveRes = await resolve(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });
    expect(resolveRes.status).toBe(200);
    expect((await resolveRes.json()).status).toBe("Resolved");

    // QA Final Review B4: claiming an escalation must produce an audit entry
    // attributed to the claiming agent, not `system`.
    const rows = await withTenant(ctx, (db) =>
      db.select().from(schema.auditLogEntry).where(eq(schema.auditLogEntry.tenantId, ctx.tenantId)),
    );
    const claimEntry = rows.find((r) => r.actionType === "escalation.claim");
    expect(claimEntry).toBeDefined();
    expect(claimEntry?.actorId).toBe(agentUserId);
    expect(claimEntry?.outcome).toBe("Success");
  });

  it("Target Architecture Blueprint Phase 13 (BL-45): a claim past max_concurrent 409s AGENT_AT_CONCURRENCY_CEILING via the real HTTP route, and CSAT capture round-trips through resolve", async () => {
    const { escalation } = await setUp();
    await setAgentMaxConcurrent(ctx, agentUserId, 1);

    // Fill the agent's single slot with an unrelated escalation first.
    const otherChannel = await createWebWidgetChannel(ctx, { name: "Other Widget", environment: "Sandbox" });
    const otherConversationId = await insertConversation(ctx, { channelId: otherChannel.id, language: "en" });
    const { escalation: blocker } = await triggerEscalation(ctx, { conversationId: otherConversationId, reason: "ToolFailure", aiContextSnapshot: {} });
    await claimEscalation(ctx, blocker.id, agentUserId);

    await mockSessionAs("Write");
    const { POST: claim } = await import("./[id]/claim/route.js");
    const res = await claim(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("AGENT_AT_CONCURRENCY_CEILING");

    // The rejected escalation is unaffected: still Waiting, discoverable in the list.
    const { GET: list } = await import("./route.js");
    const listRes = await list();
    const listBody = (await listRes.json()) as { items: Array<{ id: string; status: string }> };
    expect(listBody.items.find((i) => i.id === escalation.id)?.status).toBe("Waiting");

    // CSAT: resolve the blocker (which frees the slot) with a CSAT body, and confirm
    // it round-trips through the real route.
    const { POST: resolve } = await import("./[id]/resolve/route.js");
    const resolveRes = await resolve(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ csatScore: 4, csatComment: "Good enough" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: blocker.id }) },
    );
    expect(resolveRes.status).toBe(200);
    const resolveBody = (await resolveRes.json()) as { status: string; csatCapturedAt: string | null };
    expect(resolveBody.status).toBe("Resolved");
    expect(resolveBody.csatCapturedAt).not.toBeNull();
  });

  it("Target Architecture Blueprint Phase 13 (BL-45): resolve/return-to-bot/reassign 403 without escalations=Write; resolve 422s an invalid CSAT body; resolving an already-terminal escalation 409s", async () => {
    const { escalation } = await setUp();
    await mockSessionAs("None");
    const { POST: resolveForbidden } = await import("./[id]/resolve/route.js");
    expect((await resolveForbidden(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) })).status).toBe(403);

    vi.resetModules();
    await mockSessionAs("None");
    const { POST: returnToBotForbidden } = await import("./[id]/return-to-bot/route.js");
    expect(
      (await returnToBotForbidden(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) })).status,
    ).toBe(403);

    vi.resetModules();
    await mockSessionAs("None");
    const { POST: reassignForbidden } = await import("./[id]/reassign/route.js");
    expect(
      (
        await reassignForbidden(
          new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({}), headers: { "content-type": "application/json" } }),
          { params: Promise.resolve({ id: escalation.id }) },
        )
      ).status,
    ).toBe(403);

    vi.resetModules();
    await mockSessionAs("Write");
    const { POST: resolve } = await import("./[id]/resolve/route.js");
    const invalidCsatRes = await resolve(
      new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ csatScore: 99 }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(invalidCsatRes.status).toBe(422);

    // Resolving a still-Waiting (never claimed) escalation exercises the real
    // EscalationAlreadyClaimedError -> problemResponse 409 catch path.
    const notInProgressRes = await resolve(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });
    expect(notInProgressRes.status).toBe(409);
  });

  it("return-to-bot posts the exact system message and reopens the conversation to Active", async () => {
    const { escalation, conversationId } = await setUp();
    await mockSessionAs("Write");
    const { POST: claim } = await import("./[id]/claim/route.js");
    await claim(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });

    const { POST: returnToBot } = await import("./[id]/return-to-bot/route.js");
    const res = await returnToBot(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ReturnedToBot");

    const { findConversationById, listMessagesSince } = await import("@nextbot/conversations");
    const conversation = await findConversationById(ctx, conversationId);
    expect(conversation?.status).toBe("Active");
    const transcript = await listMessagesSince(ctx, conversationId, 0);
    expect(transcript.some((m) => m.sender === "System" && m.payload.text === "Your issue has been resolved. Returning to AI assistant.")).toBe(
      true,
    );
  });

  it("Target Architecture Blueprint Phase 13 (BL-45): return-to-bot 422s an invalid CSAT body and 409s on an already-terminal escalation", async () => {
    const { escalation } = await setUp();
    await mockSessionAs("Write");
    const { POST: claim } = await import("./[id]/claim/route.js");
    await claim(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });

    const { POST: returnToBot } = await import("./[id]/return-to-bot/route.js");
    const invalidRes = await returnToBot(
      new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ csatScore: -1 }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(invalidRes.status).toBe(422);

    const okRes = await returnToBot(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });
    expect(okRes.status).toBe(200);

    // Already ReturnedToBot — a second call exercises the real problemResponse catch path.
    const secondRes = await returnToBot(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });
    expect(secondRes.status).toBe(409);
  });

  it("reassign moves a Waiting escalation to a different queue via the real route", async () => {
    const { escalation } = await setUp();
    const otherQueueId = await withTenant(ctx, async (db) => {
      const [row] = await db.insert(schema.agentQueue).values({ id: generateId(), tenantId: ctx.tenantId, name: "Tier 2" }).returning({ id: schema.agentQueue.id });
      return row!.id;
    });
    await mockSessionAs("Write");
    const { POST: reassign } = await import("./[id]/reassign/route.js");
    const res = await reassign(
      new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ queueId: otherQueueId }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).queueId).toBe(otherQueueId);
  });

  it("GET/PUT /escalation-routing-rules round trips a real rule", async () => {
    await setUp();
    const otherQueueId = await withTenant(ctx, async (db) => {
      const [row] = await db.insert(schema.agentQueue).values({ id: generateId(), tenantId: ctx.tenantId, name: "Billing" }).returning({ id: schema.agentQueue.id });
      return row!.id;
    });
    await mockSessionAs("Write");
    const { PUT } = await import("../escalation-routing-rules/route.js");
    const putRes = await PUT(
      new NextRequest("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ rules: [{ conditions: { reasons: ["SensitiveTopic"] }, queueId: otherQueueId, enabled: true }] }),
        headers: { "content-type": "application/json" },
      }) as unknown as Parameters<typeof PUT>[0],
    );
    expect(putRes.status).toBe(200);

    vi.resetModules();
    await mockSessionAs("Read");
    const { GET } = await import("../escalation-routing-rules/route.js");
    const getRes = await GET();
    const body = (await getRes.json()) as { rules: Array<{ queueId: string }> };
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]!.queueId).toBe(otherQueueId);
  });

  it("GET/POST /escalation-queues auto-provisions the default queue and creates a new one", async () => {
    await setUp();
    await mockSessionAs("Read");
    const { GET } = await import("../escalation-queues/route.js");
    const getRes = await GET();
    const body = (await getRes.json()) as { queues: Array<{ isDefault: boolean }> };
    expect(body.queues.some((q) => q.isDefault)).toBe(true);

    vi.resetModules();
    await mockSessionAs("Write");
    const { POST } = await import("../escalation-queues/route.js");
    const postRes = await POST(
      new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ name: "VIP Support" }), headers: { "content-type": "application/json" } }),
    );
    expect(postRes.status).toBe(201);
  });

  it("POST /escalations/{id}/draft returns a never-sent AI-drafted suggestion (FR-AI-08)", async () => {
    const { escalation, conversationId } = await setUp();
    generateStructuredMock.mockResolvedValue({ draftText: "Happy to help with that!", confidence: 0.8 });
    await mockSessionAs("Write");
    const { POST: draft } = await import("./[id]/draft/route.js");
    const res = await draft(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draftText: string };
    expect(body.draftText).toBe("Happy to help with that!");

    const { listMessagesSince } = await import("@nextbot/conversations");
    const transcript = await listMessagesSince(ctx, conversationId, 0);
    // FR-AI-08: never auto-sent — no HumanAgent message exists from the draft call alone.
    expect(transcript.some((m) => m.sender === "HumanAgent")).toBe(false);
  });

  it("POST /escalations/{id}/tool-calls 409s when the escalation hasn't been claimed yet", async () => {
    const { escalation } = await setUp();
    await mockSessionAs("Write");
    const { POST: invokeTool } = await import("./[id]/tool-calls/route.js");
    const res = await invokeTool(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ toolId: "00000000-0000-7000-8000-000000000000", args: {} }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(res.status).toBe(409);
  });

  it("POST /escalations/{id}/tool-calls 422s an invalid body and 404s an unknown tool id once claimed", async () => {
    const { escalation } = await setUp();
    await mockSessionAs("Write");
    const { POST: claim } = await import("./[id]/claim/route.js");
    await claim(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: escalation.id }) });

    const { POST: invokeTool } = await import("./[id]/tool-calls/route.js");
    const invalidRes = await invokeTool(
      new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({}), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(invalidRes.status).toBe(422);

    const notFoundRes = await invokeTool(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ toolId: "00000000-0000-7000-8000-000000000000", args: {} }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(notFoundRes.status).toBe(404);
  });

  it("POST /escalations/{id}/tool-calls invokes a real permitted tool end-to-end once claimed", async () => {
    const { escalation } = await setUp();
    discoverToolsMock.mockResolvedValue([{ name: "check_order_status", inputSchema: { type: "object" } }]);
    const connector = await createConnector(ctx, {
      name: "Orders",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://orders.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await withTenant(ctx, async (db) => {
      await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id));
    });
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });

    await claimEscalation(ctx, escalation.id, agentUserId);
    callToolMock.mockResolvedValue({ status: "Shipped" });

    await mockSessionAs("Write");
    const { POST: invokeTool } = await import("./[id]/tool-calls/route.js");
    const res = await invokeTool(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ toolId: tool!.id, args: { orderId: "1" } }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string; output: unknown };
    expect(body.outcome).toBe("Succeeded");
    expect(callToolMock).toHaveBeenCalled();
  });

  it("POST /escalations/{id}/tool-calls (BE1): a Tier-3 tool manually triggered suspends into the real Approval Queue instead of executing", async () => {
    const { escalation } = await setUp();
    discoverToolsMock.mockResolvedValue([{ name: "issue_refund", inputSchema: { type: "object" } }]);
    const connector = await createConnector(ctx, {
      name: "Billing",
      backendType: "Billing",
      transport: "StreamableHTTP",
      endpointUrl: "https://billing.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await withTenant(ctx, async (db) => {
      await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id));
    });
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });
    await updateToolRules(ctx, tool!.id, [
      { scope: "Tool", toolId: tool!.id, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3", enabled: true },
    ]);

    await claimEscalation(ctx, escalation.id, agentUserId);
    await mockSessionAs("Write", "Write");
    const { POST: invokeTool } = await import("./[id]/tool-calls/route.js");
    const res = await invokeTool(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ toolId: tool!.id, args: { amount: 500 } }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string; toolCallId: string };
    expect(body.outcome).toBe("AwaitingHumanApproval");
    expect(callToolMock).not.toHaveBeenCalled();
    const toolCall = await findToolCallById(ctx, body.toolCallId);
    expect(toolCall?.status).toBe("AwaitingHumanApproval");
    expect(toolCall?.approvalTier).toBe("Tier3");
  });

  it("POST /escalations/{id}/tool-calls (BE1): a Tier-2 tool manually triggered suspends for customer confirmation instead of executing", async () => {
    const { escalation } = await setUp();
    discoverToolsMock.mockResolvedValue([{ name: "send_replacement", inputSchema: { type: "object" } }]);
    const connector = await createConnector(ctx, {
      name: "Orders",
      backendType: "CRM",
      transport: "StreamableHTTP",
      endpointUrl: "https://orders.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await withTenant(ctx, async (db) => {
      await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id));
    });
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });
    await updateToolRules(ctx, tool!.id, [
      { scope: "Tool", toolId: tool!.id, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier2", enabled: true },
    ]);

    await claimEscalation(ctx, escalation.id, agentUserId);
    await mockSessionAs("Write", "Write");
    const { POST: invokeTool } = await import("./[id]/tool-calls/route.js");
    const res = await invokeTool(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ toolId: tool!.id, args: {} }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("AwaitingCustomerConfirmation");
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("POST /escalations/{id}/tool-calls (BE1): a Tier-3 tool is rejected 403 without approval_queue=Write, even with escalations=Write", async () => {
    const { escalation } = await setUp();
    discoverToolsMock.mockResolvedValue([{ name: "issue_refund", inputSchema: { type: "object" } }]);
    const connector = await createConnector(ctx, {
      name: "Billing2",
      backendType: "Billing",
      transport: "StreamableHTTP",
      endpointUrl: "https://billing2.example.com/mcp",
      authMethod: "None",
      environment: "Sandbox",
    });
    await withTenant(ctx, async (db) => {
      await db.update(schema.connector).set({ status: "Connected" }).where(eq(schema.connector.id, connector.id));
    });
    await discoverAndSyncTools(ctx, connector.id);
    const [tool] = await listCatalog(ctx, { connectorId: connector.id });
    await updateToolRules(ctx, tool!.id, [
      { scope: "Tool", toolId: tool!.id, ordinal: 0, conditions: {}, effect: "RequireApproval", requiredTier: "Tier3", enabled: true },
    ]);

    await claimEscalation(ctx, escalation.id, agentUserId);
    // escalations=Write but no approval_queue grant at all — must not be able to
    // end-run the real Approval Queue's RBAC gate through this panel.
    await mockSessionAs("Write");
    const { POST: invokeTool } = await import("./[id]/tool-calls/route.js");
    const res = await invokeTool(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ toolId: tool!.id, args: { amount: 500 } }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(res.status).toBe(403);
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("POST /escalations/{id}/messages 422s an invalid body; POST /reassign 422s one too", async () => {
    const { escalation } = await setUp();
    await mockSessionAs("Write");
    const { POST: sendMessage } = await import("./[id]/messages/route.js");
    const messagesRes = await sendMessage(
      new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({}), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(messagesRes.status).toBe(422);

    const { POST: reassign } = await import("./[id]/reassign/route.js");
    const reassignRes = await reassign(
      new NextRequest("http://localhost", { method: "POST", body: "not json", headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: escalation.id }) },
    );
    expect(reassignRes.status).toBe(422);
  });
});
