import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { startMockMetaGraphServer, createMockMetaGraphState } from "@nextbot/testing";
import { createWhatsAppChannel } from "./create-whatsapp-channel.js";
import { connectMetaBusinessAccount } from "./connect-meta-business-account.js";
import { recordConsent } from "./whatsapp-consent-service.js";

/** ADR-0001 §6 cross-tenant proof for the new WhatsApp/Meta-family tables (BL-15) —
 * `rls-coverage.isolation.test.ts` already proves every one of these tables has RLS
 * enabled/forced/policied; this proves the policy actually blocks a real cross-
 * tenant read, the same standard every other module's isolation test applies. */
describe("WhatsApp/Meta-family tenant isolation (BL-15)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a tenant scoped to A reads zero rows of B's meta_business_account", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bChannel = await createWhatsAppChannel(b, { name: "B's WhatsApp", environment: "Sandbox" });
    const state = createMockMetaGraphState();
    state.businessInfo["biz-b"] = { id: "biz-b", name: "B Corp" };
    const server = await startMockMetaGraphServer(state);
    let bAccount;
    try {
      bAccount = await connectMetaBusinessAccount(
        b,
        { channelId: bChannel.id, businessId: "biz-b", businessName: "B Corp", systemUserToken: "tok", appId: "app", appSecret: "secret" },
        { graphApiBaseUrl: server.url },
      );
    } finally {
      await server.close();
    }

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.metaBusinessAccount).where(eq(schema.metaBusinessAccount.id, bAccount.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's consent_record", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bChannel = await createWhatsAppChannel(b, { name: "B's WhatsApp 2", environment: "Sandbox" });
    const state = createMockMetaGraphState();
    state.businessInfo["biz-b2"] = { id: "biz-b2", name: "B Corp 2" };
    const server = await startMockMetaGraphServer(state);
    try {
      await connectMetaBusinessAccount(
        b,
        { channelId: bChannel.id, businessId: "biz-b2", businessName: "B Corp 2", systemUserToken: "tok", appId: "app", appSecret: "secret" },
        { graphApiBaseUrl: server.url },
      );
    } finally {
      await server.close();
    }
    const bConsent = await recordConsent(b, bChannel.id, { customerIdentifier: "+15550001111", state: "OptedIn", source: "CustomerInitiatedMessage" });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.consentRecord).where(eq(schema.consentRecord.id, bConsent.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });
});
