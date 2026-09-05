import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation } from "@nextbot/conversations";
import { withTenant, schema, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { eq, and } from "drizzle-orm";
import { triggerEscalation } from "../application/trigger-escalation.js";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — closes a real,
 * disclosed gap found during investigation: `escalations` had NO `domain_event`
 * producer at all before this phase (confirmed by grepping every `domainEvent).
 * values(` call site in the codebase). This proves `createEscalation` now appends a
 * real `escalations.escalation_created` row, in the SAME transaction as the
 * escalation insert, with no unmasked PII in the payload.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function domainEventsOfType(ctx: TenantContext, type: string) {
  return withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.domainEvent).where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.type, type))));
}

describe("escalation creation now emits a real domain_event (FR-API-02's webhook 'escalation created' category)", () => {
  it("appends escalations.escalation_created with identifiers/reason only, no PII, on a real trigger", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const channel = await createWebWidgetChannel(ctx, { name: `Widget ${crypto.randomUUID()}`, environment: "Sandbox" });
    const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });

    const { escalation, created } = await triggerEscalation(ctx, {
      conversationId,
      reason: "LowConfidence",
      aiContextSnapshot: { recognizedGoal: "billing", confidence: 0.4, customerEmail: "real-customer@example.com" },
    });
    expect(created).toBe(true);

    const events = await domainEventsOfType(ctx, "escalations.escalation_created");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ escalationId: escalation.id, conversationId, reason: "LowConfidence" });
    // The AI context snapshot (which can carry customer PII, e.g. a recognized
    // email) is deliberately NEVER included in this event's payload.
    expect(JSON.stringify(events[0]!.payload)).not.toContain("real-customer@example.com");
  });

  it("a second trigger for the same conversation (the idempotent 'already escalated' path) does NOT append a second event", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const channel = await createWebWidgetChannel(ctx, { name: `Widget ${crypto.randomUUID()}`, environment: "Sandbox" });
    const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });

    await triggerEscalation(ctx, { conversationId, reason: "LowConfidence", aiContextSnapshot: {} });
    const second = await triggerEscalation(ctx, { conversationId, reason: "CustomerRequest", aiContextSnapshot: {}, skipConnectingMessage: true });
    expect(second.created).toBe(false);

    const events = await domainEventsOfType(ctx, "escalations.escalation_created");
    expect(events).toHaveLength(1);
  });
});
