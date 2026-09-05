import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { getTenantBranding, updateTenantBranding } from "./tenant-branding.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("tenant branding (FR-ADM-07, real Postgres)", () => {
  it("a freshly-provisioned tenant has no branding configured yet", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const branding = await getTenantBranding(ctx.tenantId);
    expect(branding?.brandingConfig).toBeNull();
    expect(branding?.whiteLabelEnabled).toBe(false);
  });

  it("updateTenantBranding persists the brand profile and whiteLabelEnabled", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    await updateTenantBranding(ctx.tenantId, {
      brandingConfig: {
        primaryColor: "#1B6B4A",
        secondaryColor: "#0E3B28",
        logoLightUrl: "https://example.com/logo-light.svg",
        logoDarkUrl: "https://example.com/logo-dark.svg",
        faviconUrl: null,
        fontFamily: "Inter",
      },
      whiteLabelEnabled: true,
    });

    const branding = await getTenantBranding(ctx.tenantId);
    expect(branding?.brandingConfig?.primaryColor).toBe("#1B6B4A");
    expect(branding?.whiteLabelEnabled).toBe(true);
  });
});
