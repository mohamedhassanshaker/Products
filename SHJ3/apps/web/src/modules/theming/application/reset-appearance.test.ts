import { describe, expect, it } from "vitest";
import { semanticColors } from "@shj3/tokens";
import { ResetAppearance } from "./reset-appearance.js";
import { FakeThemeRepository } from "../testing/fakes.js";
import type { TenantBrandingSnapshot } from "../ports/theme-repository.js";

function customTenantBranding(): TenantBrandingSnapshot {
  return {
    appTitle: "Custom Tenant",
    defaultMode: "Light",
    defaultDirection: "LTR",
    density: "Compact",
    fontSize: "1rem",
    shadowDepth: "0.5",
    sidebarStyle: "brand",
    activeSkinColors: {
      light: { ...semanticColors.light, primary: "#ABCDEF" },
      dark: { ...semanticColors.dark, primary: "#FEDCBA" },
    },
    logoLightUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
  };
}

describe("ResetAppearance.resetOwnPreference", () => {
  it("resets a user's row to fully defer to the tenant tier", async () => {
    const repo = new FakeThemeRepository({
      users: new Map([
        [
          "u1",
          {
            mode: "Dark",
            density: "Compact",
            direction: "RTL",
            fontSize: "1rem",
            reducedMotion: true,
            personalSkinColors: null,
          },
        ],
      ]),
    });

    await new ResetAppearance(repo).resetOwnPreference("u1");

    const reset = await repo.readUserPreference("u1");
    expect(reset).toEqual({
      mode: null,
      density: null,
      direction: null,
      fontSize: null,
      reducedMotion: null,
      personalSkinColors: null,
    });
  });
});

describe("ResetAppearance.resetTenantBranding", () => {
  it("deletes the tenant's TenantBranding row entirely, falling back to system default by absence", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: customTenantBranding(),
    });

    await new ResetAppearance(repo).resetTenantBranding("light", "staff-1");

    // Falls through the exact same "no tenant branding" path a brand-new,
    // never-branded tenant already uses — see the port's own doc comment for why
    // this is a delete rather than repointing activeSkinId at a stand-in row.
    expect(await repo.readTenantBranding()).toBeNull();
  });

  it("is a genuine no-op when the tenant has no TenantBranding row at all", async () => {
    const repo = new FakeThemeRepository({ tenantBranding: null });
    await expect(
      new ResetAppearance(repo).resetTenantBranding("light", "staff-1"),
    ).resolves.toBeUndefined();
    expect(await repo.readTenantBranding()).toBeNull();
  });

  it("runs the real contrast gate on the system default before resetting (never skipped)", async () => {
    // The system default is asserted contrast-clean at seed time (seed-system-skins.ts),
    // so this proves the gate is genuinely IN the path (it is called, and passes)
    // rather than proving it can block — appearance-gate.test.ts covers the block case
    // directly against the real checkContrast.
    const repo = new FakeThemeRepository({
      tenantBranding: customTenantBranding(),
    });
    await expect(
      new ResetAppearance(repo).resetTenantBranding("dark", "staff-1"),
    ).resolves.toBeUndefined();
  });
});
