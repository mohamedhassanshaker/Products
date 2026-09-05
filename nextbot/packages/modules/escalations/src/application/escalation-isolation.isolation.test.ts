import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation } from "@nextbot/conversations";
import { withTenant, schema, generateId } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { triggerEscalation } from "./trigger-escalation.js";
import { claimEscalation } from "./claim-escalation.js";
import { createAgentQueue } from "../infrastructure/agent-queue-repository.js";

/** ADR-0001 §6 cross-tenant proof for `escalation`/`agent_queue` (Phase 16, BL-09). */
describe("escalation/agent_queue tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a tenant scoped to A reads zero rows of B's escalation", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bChannel = await createWebWidgetChannel(b, { name: "B Widget", environment: "Sandbox" });
    const bConversationId = await insertConversation(b, { channelId: bChannel.id, language: "en" });
    const { escalation: bEscalation } = await triggerEscalation(b, {
      conversationId: bConversationId,
      reason: "CustomerRequest",
      aiContextSnapshot: {},
    });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.escalation).where(eq(schema.escalation.id, bEscalation.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's agent_queue", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bQueue = await createAgentQueue(b, { name: "B's Billing Queue" });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.agentQueue).where(eq(schema.agentQueue.id, bQueue.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — the two new tables.
  it("a tenant scoped to A reads zero rows of B's agent_presence", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bChannel = await createWebWidgetChannel(b, { name: "B Widget", environment: "Sandbox" });
    const bConversationId = await insertConversation(b, { channelId: bChannel.id, language: "en" });
    const bAgent = await withTenant(b, async (db) => {
      const [row] = await db
        .insert(schema.appUser)
        .values({ id: generateId(), tenantId: b.tenantId, email: `${crypto.randomUUID()}@example.com`, displayName: "B Agent", status: "Active" })
        .returning({ id: schema.appUser.id });
      return row!.id;
    });
    const { escalation: bEscalation } = await triggerEscalation(b, { conversationId: bConversationId, reason: "CustomerRequest", aiContextSnapshot: {} });
    await claimEscalation(b, bEscalation.id, bAgent);

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.agentPresence).where(eq(schema.agentPresence.userId, bAgent)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's escalation_assignment_log", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bChannel = await createWebWidgetChannel(b, { name: "B Widget", environment: "Sandbox" });
    const bConversationId = await insertConversation(b, { channelId: bChannel.id, language: "en" });
    const bAgent = await withTenant(b, async (db) => {
      const [row] = await db
        .insert(schema.appUser)
        .values({ id: generateId(), tenantId: b.tenantId, email: `${crypto.randomUUID()}@example.com`, displayName: "B Agent", status: "Active" })
        .returning({ id: schema.appUser.id });
      return row!.id;
    });
    const { escalation: bEscalation } = await triggerEscalation(b, { conversationId: bConversationId, reason: "CustomerRequest", aiContextSnapshot: {} });
    await claimEscalation(b, bEscalation.id, bAgent);

    const rowsSeenByA = await withTenant(a, (db) =>
      db.select().from(schema.escalationAssignmentLog).where(eq(schema.escalationAssignmentLog.escalationId, bEscalation.id)),
    );
    expect(rowsSeenByA).toHaveLength(0);
  });
});
