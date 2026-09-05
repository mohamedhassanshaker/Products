import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { insertConversation } from "../infrastructure/conversation-repository.js";
import { insertMessage } from "../infrastructure/message-repository.js";

/** ADR-0001 §6 cross-tenant proof for `conversation`/`message` (Phase 7). */
describe("conversation/message tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a tenant scoped to A reads zero rows of B's conversation", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bChannel = await createWebWidgetChannel(b, { name: "B Widget", environment: "Sandbox" });
    const bConversationId = await insertConversation(b, { channelId: bChannel.id, language: "en" });

    const rowsSeenByA = await withTenant(a, (db) =>
      db.select().from(schema.conversation).where(eq(schema.conversation.id, bConversationId)),
    );
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's message", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bChannel = await createWebWidgetChannel(b, { name: "B Widget 2", environment: "Sandbox" });
    const bConversationId = await insertConversation(b, { channelId: bChannel.id, language: "en" });
    const bMessage = await insertMessage(b, {
      conversationId: bConversationId,
      sender: "Customer",
      contentType: "Text",
      payload: { contentType: "Text", text: "secret" },
    });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.message).where(eq(schema.message.id, bMessage.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });
});
