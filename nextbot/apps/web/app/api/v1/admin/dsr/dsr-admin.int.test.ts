import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation } from "@nextbot/conversations";
import { generateId } from "@nextbot/db";

const testUserId = generateId();

vi.mock("server-only", () => ({}));

let ctx: TenantContext;
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
});

async function mockSessionAs(level: "Read" | "Write" | "None") {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () =>
      level === "None"
        ? { permissions: {}, tenantId: ctx.tenantId, userId: testUserId, roleIds: [] }
        : { permissions: { security_settings: level }, tenantId: ctx.tenantId, userId: testUserId, roleIds: ["role-1"] },
    getSessionTenantContext: async () => ctx,
  }));
}

/**
 * Integration-level test for the Phase 17 (BL-10) DSR (Data Subject Request) tool
 * — real Postgres, real RBAC guard, only the session/auth seam mocked (same
 * convention as every other admin-route integration test this dispatch's sibling
 * suites use).
 */
describe("DSR admin API (Phase 17, BL-10, real Postgres)", () => {
  it("GET /dsr 403s without security_settings=Read", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("None");
    const { GET } = await import("./route.js");
    expect((await GET()).status).toBe(403);
  });

  it("Search finds a real conversation matching the customer identifier; Delete actually removes it", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, {
      name: "Web Widget",
      environment: "Sandbox",
      config: { allowedOrigins: ["https://example.com"] },
    });
    const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });

    // Stamp a customer identifier directly (no admin API exposes this yet — the
    // widget session flow sets it in later phases' scope) so the DSR search has a
    // real row to find.
    const { withTenant, schema } = await import("@nextbot/db");
    const { eq } = await import("drizzle-orm");
    await withTenant(ctx, async (db) => {
      await db
        .update(schema.conversation)
        .set({ customerIdentifier: "dsr-test@example.com" })
        .where(eq(schema.conversation.id, conversationId));
    });

    await mockSessionAs("Write");
    const { POST } = await import("./route.js");

    const searchRes = await POST(
      new NextRequest("http://localhost/api/v1/admin/dsr", {
        method: "POST",
        body: JSON.stringify({ requestType: "Search", customerIdentifier: "dsr-test@example.com" }),
      }),
    );
    expect(searchRes.status).toBe(201);
    const searchBody = await searchRes.json();
    expect(searchBody.outcome.conversationsFound).toBe(1);

    const deleteRes = await POST(
      new NextRequest("http://localhost/api/v1/admin/dsr", {
        method: "POST",
        body: JSON.stringify({ requestType: "Delete", customerIdentifier: "dsr-test@example.com" }),
      }),
    );
    expect(deleteRes.status).toBe(201);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.outcome.conversationsDeleted).toBe(1);

    const { findConversationById } = await import("@nextbot/conversations");
    expect(await findConversationById(ctx, conversationId)).toBeNull();
  });

  it("regression (BE-3): Export/Search/Delete cover messages, escalations, and tool calls too, not just conversation metadata", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, {
      name: "Web Widget",
      environment: "Sandbox",
      config: { allowedOrigins: ["https://example.com"] },
    });
    const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });

    const { withTenant, schema, generateId } = await import("@nextbot/db");
    const { eq } = await import("drizzle-orm");
    const customerIdentifier = "be3-test@example.com";
    await withTenant(ctx, async (db) => {
      await db.update(schema.conversation).set({ customerIdentifier }).where(eq(schema.conversation.id, conversationId));
    });

    const { insertMessage } = await import("@nextbot/conversations");
    await insertMessage(ctx, { conversationId, sender: "Customer", contentType: "Text", payload: { text: "hello" } });

    const { ensureDefaultQueue } = await import("@nextbot/escalations");
    const queue = await ensureDefaultQueue(ctx);
    const escalationId = generateId();
    await withTenant(ctx, async (db) => {
      await db.insert(schema.escalation).values({
        id: escalationId,
        tenantId: ctx.tenantId,
        conversationId,
        reason: "LowConfidence",
        reasonDetail: null,
        queueId: queue.id,
        status: "Waiting",
        aiContextSnapshot: {},
      });
    });

    const toolCallId = generateId();
    await withTenant(ctx, async (db) => {
      await db.insert(schema.toolCall).values({
        id: toolCallId,
        tenantId: ctx.tenantId,
        conversationId,
        toolId: generateId(),
        toolName: "lookup_order",
        approvalTier: "Tier1",
        status: "Succeeded",
        inputArgs: { orderId: "123" },
        idempotencyKey: generateId(),
      });
    });

    await mockSessionAs("Write");
    const { POST } = await import("./route.js");

    const exportRes = await POST(
      new NextRequest("http://localhost/api/v1/admin/dsr", {
        method: "POST",
        body: JSON.stringify({ requestType: "Export", customerIdentifier }),
      }),
    );
    expect(exportRes.status).toBe(200);
    const exportBody = await exportRes.json();
    expect(exportBody.conversations.length).toBe(1);
    expect(exportBody.messages.length).toBe(1);
    expect(exportBody.escalations.length).toBe(1);
    expect(exportBody.toolCalls.length).toBe(1);

    const searchRes = await POST(
      new NextRequest("http://localhost/api/v1/admin/dsr", {
        method: "POST",
        body: JSON.stringify({ requestType: "Search", customerIdentifier }),
      }),
    );
    const searchBody = await searchRes.json();
    expect(searchBody.outcome.messagesFound).toBe(1);
    expect(searchBody.outcome.escalationsFound).toBe(1);
    expect(searchBody.outcome.toolCallsFound).toBe(1);
    expect(searchBody.outcome.data.conversations.length).toBe(1);

    // Delete must not fail on the tool_call/escalation FKs (no ON DELETE CASCADE)
    // and must actually remove them, not just the conversation/message rows.
    const deleteRes = await POST(
      new NextRequest("http://localhost/api/v1/admin/dsr", {
        method: "POST",
        body: JSON.stringify({ requestType: "Delete", customerIdentifier }),
      }),
    );
    expect(deleteRes.status).toBe(201);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.outcome.conversationsDeleted).toBe(1);
    expect(deleteBody.outcome.toolCallsDeleted).toBe(1);
    expect(deleteBody.outcome.escalationsDeleted).toBe(1);

    await withTenant(ctx, async (db) => {
      const remainingToolCalls = await db.select().from(schema.toolCall).where(eq(schema.toolCall.id, toolCallId));
      expect(remainingToolCalls.length).toBe(0);
      const remainingEscalations = await db.select().from(schema.escalation).where(eq(schema.escalation.id, escalationId));
      expect(remainingEscalations.length).toBe(0);
    });
  });

  it("rejects an invalid body with 422", async () => {
    ctx = await createFixtureTenant();
    await mockSessionAs("Write");
    const { POST } = await import("./route.js");
    const res = await POST(new NextRequest("http://localhost/api/v1/admin/dsr", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(422);
  });
});
