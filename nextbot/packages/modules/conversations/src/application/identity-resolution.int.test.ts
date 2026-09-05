import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { setIdentityResolutionPolicyEnabled } from "@nextbot/tenancy";
import { findOrCreateConversationForChannelCustomer } from "../infrastructure/conversation-repository.js";
import { resolveLinkedConversations } from "./identity-resolution.js";

/**
 * Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — the adversarial proof
 * this feature's own hard requirement demands: cross-channel identity linking is
 * OFF by default, only an exact `customer_identifier_hash` match ever links two
 * conversations, and it NEVER fires while the tenant's own opt-in is disabled — even
 * against an identical identifier. Real Postgres throughout (no mocked repository).
 */
describe("resolveLinkedConversations (Phase 19, BL-50, FR-OC-08, real Postgres)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("links two conversations across different channels with an IDENTICAL identifier once the tenant opts in", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channelA = await createWebWidgetChannel(tenant, { name: "Widget A", environment: "Sandbox" });
    const channelB = await createWebWidgetChannel(tenant, { name: "Widget B", environment: "Sandbox" });

    const convoA = await findOrCreateConversationForChannelCustomer(tenant, {
      channelId: channelA.id,
      externalThreadId: "thread-a",
      customerIdentifier: "+971501234567",
      language: "en",
    });
    const convoB = await findOrCreateConversationForChannelCustomer(tenant, {
      channelId: channelB.id,
      externalThreadId: "thread-b",
      customerIdentifier: "+971501234567",
      language: "en",
    });

    // Default OFF: not enabling the tenant setting must NEVER link, even though the
    // identifiers are byte-for-byte identical.
    expect(await resolveLinkedConversations(tenant, convoA.id)).toEqual([]);
    expect(await resolveLinkedConversations(tenant, convoB.id)).toEqual([]);

    await setIdentityResolutionPolicyEnabled(tenant, true);

    const linkedFromA = await resolveLinkedConversations(tenant, convoA.id);
    expect(linkedFromA).toHaveLength(1);
    expect(linkedFromA[0]?.conversationId).toBe(convoB.id);

    const linkedFromB = await resolveLinkedConversations(tenant, convoB.id);
    expect(linkedFromB).toHaveLength(1);
    expect(linkedFromB[0]?.conversationId).toBe(convoA.id);
  });

  it("NEVER links two conversations whose identifiers are merely similar, not identical — no fuzzy matching", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    await setIdentityResolutionPolicyEnabled(tenant, true);
    const channelA = await createWebWidgetChannel(tenant, { name: "Widget A", environment: "Sandbox" });
    const channelB = await createWebWidgetChannel(tenant, { name: "Widget B", environment: "Sandbox" });

    const convoA = await findOrCreateConversationForChannelCustomer(tenant, {
      channelId: channelA.id,
      externalThreadId: "thread-a",
      customerIdentifier: "+971501234567",
      language: "en",
    });
    // A single differing trailing digit — deliberately the "closest possible"
    // mismatch a similarity/fuzzy matcher might conflate.
    await findOrCreateConversationForChannelCustomer(tenant, {
      channelId: channelB.id,
      externalThreadId: "thread-b",
      customerIdentifier: "+971501234568",
      language: "en",
    });

    expect(await resolveLinkedConversations(tenant, convoA.id)).toEqual([]);
  });

  it("returns [] when the source conversation has no recorded identifier at all, even with linking enabled", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    await setIdentityResolutionPolicyEnabled(tenant, true);
    const channelA = await createWebWidgetChannel(tenant, { name: "Widget A", environment: "Sandbox" });
    // Widget conversations created without a channel-customer identifier (the
    // ordinary widget-session path) never get one — simulated directly here via the
    // same insert path a plain widget session takes (no customerIdentifier field).
    const { insertConversation } = await import("../infrastructure/conversation-repository.js");
    const conversationId = await insertConversation(tenant, { channelId: channelA.id, language: "en" });

    expect(await resolveLinkedConversations(tenant, conversationId)).toEqual([]);
  });

  it("never links across tenants even with an identical identifier and both tenants opted in", async () => {
    const tenantA = await createFixtureTenant();
    const tenantB = await createFixtureTenant();
    createdTenantIds.push(tenantA.tenantId, tenantB.tenantId);
    await setIdentityResolutionPolicyEnabled(tenantA, true);
    await setIdentityResolutionPolicyEnabled(tenantB, true);
    const channelA = await createWebWidgetChannel(tenantA, { name: "Widget A", environment: "Sandbox" });
    const channelB = await createWebWidgetChannel(tenantB, { name: "Widget B", environment: "Sandbox" });

    const convoA = await findOrCreateConversationForChannelCustomer(tenantA, {
      channelId: channelA.id,
      externalThreadId: "thread-a",
      customerIdentifier: "+971501234567",
      language: "en",
    });
    await findOrCreateConversationForChannelCustomer(tenantB, {
      channelId: channelB.id,
      externalThreadId: "thread-b",
      customerIdentifier: "+971501234567",
      language: "en",
    });

    // RLS scopes `resolveLinkedConversations` to tenantA's own rows only — a match in
    // tenantB must never surface here.
    expect(await resolveLinkedConversations(tenantA, convoA.id)).toEqual([]);
  });
});
