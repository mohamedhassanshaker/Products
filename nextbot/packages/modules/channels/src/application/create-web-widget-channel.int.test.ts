import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { ChannelNameDuplicateError } from "@nextbot/contracts";
import { createWebWidgetChannel } from "./create-web-widget-channel.js";
import { resolveWidgetChannel } from "./resolve-widget-channel.js";
import { WidgetChannelInactiveError, WidgetChannelNotFoundError } from "@nextbot/contracts";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("createWebWidgetChannel (BL-04 backend slice, real Postgres)", () => {
  it("creates an Active WebWidget channel with a unique public key", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const channel = await createWebWidgetChannel(ctx, { name: "Main Widget", environment: "Sandbox" });

    expect(channel.type).toBe("WebWidget");
    expect(channel.status).toBe("Active");
    expect(channel.publicKey).toMatch(/^wc_/);
  });

  it("rejects a duplicate (tenant, environment, name)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await createWebWidgetChannel(ctx, { name: "Dup", environment: "Sandbox" });
    await expect(createWebWidgetChannel(ctx, { name: "Dup", environment: "Sandbox" })).rejects.toThrow(
      ChannelNameDuplicateError,
    );
  });

  it("resolveWidgetChannel finds an Active channel by public key", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const channel = await createWebWidgetChannel(ctx, { name: "Findable", environment: "Sandbox" });

    const resolved = await resolveWidgetChannel(ctx, channel.publicKey);
    expect(resolved.id).toBe(channel.id);
  });

  it("resolveWidgetChannel fails closed (WidgetChannelNotFoundError) for an unknown public key", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await expect(resolveWidgetChannel(ctx, "wc_does_not_exist")).rejects.toThrow(WidgetChannelNotFoundError);
  });

  it("resolveWidgetChannel fails closed (WidgetChannelInactiveError) for an Inactive channel", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const channel = await createWebWidgetChannel(ctx, { name: "Later Deactivated", environment: "Sandbox" });
    await withTenant(ctx, (db) =>
      db.update(schema.channel).set({ status: "Inactive" }).where(eq(schema.channel.id, channel.id)),
    );

    await expect(resolveWidgetChannel(ctx, channel.publicKey)).rejects.toThrow(WidgetChannelInactiveError);
  });
});
