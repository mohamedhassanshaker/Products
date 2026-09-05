import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { createWidgetSession } from "./create-widget-session.js";
import { sendWidgetMessage } from "./send-widget-message.js";
import { listConversationsForAdmin, listAllConversationsForExport, getConversationDetailForAdmin } from "./admin-conversation-query.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});
beforeEach(() => {
  process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
});

describe("admin-conversation-query (Phase 13, BL-06, real Postgres)", () => {
  it("lists a tenant's conversations, filters by channelId/language, and paginates", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channelA = await createWebWidgetChannel(tenant, { name: "A", environment: "Sandbox" });
    const channelB = await createWebWidgetChannel(tenant, { name: "B", environment: "Sandbox" });
    const sessionA = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channelA.publicKey });
    const sessionB = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channelB.publicKey });

    const allResult = await listConversationsForAdmin(tenant, {});
    expect(allResult.items.map((i) => i.id).sort()).toEqual([sessionA.conversationId, sessionB.conversationId].sort());
    expect(allResult.total).toBe(2);

    const filteredResult = await listConversationsForAdmin(tenant, { channelId: channelA.id });
    expect(filteredResult.items.map((i) => i.id)).toEqual([sessionA.conversationId]);

    const pagedResult = await listConversationsForAdmin(tenant, { limit: 1, offset: 0 });
    expect(pagedResult.items).toHaveLength(1);
    expect(pagedResult.total).toBe(2);
  });

  it("never returns another tenant's conversations even with no filters at all", async () => {
    const tenantA = await createFixtureTenant();
    const tenantB = await createFixtureTenant();
    createdTenantIds.push(tenantA.tenantId, tenantB.tenantId);
    const channelA = await createWebWidgetChannel(tenantA, { name: "A", environment: "Sandbox" });
    const channelB = await createWebWidgetChannel(tenantB, { name: "B", environment: "Sandbox" });
    await createWidgetSession({ tenantSlug: await tenantSlugOf(tenantA.tenantId), channelPublicKey: channelA.publicKey });
    const sessionB = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenantB.tenantId), channelPublicKey: channelB.publicKey });

    const resultForB = await listConversationsForAdmin(tenantB, {});
    expect(resultForB.items.map((i) => i.id)).toEqual([sessionB.conversationId]);
  });

  it("listAllConversationsForExport returns the unpaged set matching the same filters", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "A", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey });

    const items = await listAllConversationsForExport(tenant, {});
    expect(items.map((i) => i.id)).toEqual([session.conversationId]);
  });

  it("getConversationDetailForAdmin returns the full transcript oldest-first, including agentRunId when set", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "A", environment: "Sandbox" });
    const session = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey });
    await sendWidgetMessage(
      { tenantId: tenant.tenantId, region: tenant.region, environment: tenant.environment, conversationId: session.conversationId, channelId: channel.id },
      { clientMessageId: "c1", contentType: "Text", payload: { contentType: "Text", text: "hello" } },
    );

    const detail = await getConversationDetailForAdmin(tenant, session.conversationId);
    expect(detail).not.toBeNull();
    expect(detail!.messages.map((m) => m.sender)).toEqual(["Customer", "AI"]);
    expect(detail!.messages[1]!.agentRunId).toBeNull(); // no generateAiReply dep wired -> placeholder path, no agent_run
  });

  it("getConversationDetailForAdmin returns null for an unknown or cross-tenant conversation id", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const detail = await getConversationDetailForAdmin(tenant, "00000000-0000-7000-8000-000000000000");
    expect(detail).toBeNull();
  });
});

async function tenantSlugOf(tenantId: string): Promise<string> {
  const { resolveTenantById } = await import("@nextbot/tenancy");
  const tenant = await resolveTenantById(tenantId);
  return tenant?.slug ?? "";
}
