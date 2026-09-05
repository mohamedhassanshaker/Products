import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { createWebWidgetChannel } from "./create-web-widget-channel.js";

/** ADR-0001 §6 cross-tenant proof for `channel` (Phase 7). */
describe("channel tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a tenant scoped to A reads zero rows of B's channel (incl. by direct id lookup)", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bChannel = await createWebWidgetChannel(b, { name: "B's Widget", environment: "Sandbox" });

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.channel).where(eq(schema.channel.id, bChannel.id)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("a tenant scoped to A cannot resolve B's channel by public key even with the correct value", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    const bChannel = await createWebWidgetChannel(b, { name: "B's Widget 2", environment: "Sandbox" });

    const { findChannelByPublicKey } = await import("../infrastructure/channel-repository.js");
    const seenByA = await findChannelByPublicKey(a, bChannel.publicKey);
    expect(seenByA).toBeNull();
  });
});
