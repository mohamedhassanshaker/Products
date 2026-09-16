import { describe, expect, it } from "vitest";
import { semanticColors, type SemanticColorTokens } from "@shj3/tokens";
import { ResolveTheme } from "./resolve-theme.js";
import { FakeThemeRepository } from "../testing/fakes.js";
import type { TenantBrandingSnapshot, UserPreferenceSnapshot } from "../ports/theme-repository.js";

/**
 * Built on the REAL system default colours (`@shj3/tokens`' own static export), each
 * overriding only the one key a test cares about. `ResolveTheme` reads the system tier
 * directly from `@shj3/tokens` (not from the fake repository — see `ThemeRepository`'s
 * doc comment for why), so assertions compare against `semanticColors` directly rather
 * than an injectable fixture.
 */
function tenantColors(overrides: Partial<SemanticColorTokens> = {}): SemanticColorTokens {
  return { ...semanticColors.light, ...overrides };
}
function tenantColorsDark(overrides: Partial<SemanticColorTokens> = {}): SemanticColorTokens {
  return { ...semanticColors.dark, ...overrides };
}

function tenantBranding(overrides: Partial<TenantBrandingSnapshot> = {}): TenantBrandingSnapshot {
  return {
    appTitle: "Tenant Assistant",
    defaultMode: "Light",
    defaultDirection: "LTR",
    density: "Comfortable",
    fontSize: "0.875rem",
    shadowDepth: "1",
    sidebarStyle: "neutral",
    activeSkinColors: { light: tenantColors(), dark: tenantColorsDark() },
    logoLightUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    ...overrides,
  };
}

function userPreference(overrides: Partial<UserPreferenceSnapshot> = {}): UserPreferenceSnapshot {
  return {
    mode: null,
    density: null,
    direction: null,
    fontSize: null,
    reducedMotion: null,
    personalSkinColors: null,
    ...overrides,
  };
}

const NO_PREFERENCE_SIGNAL = { clientHint: null, cookie: null };

describe("ResolveTheme — every tenant with no tenant branding (§9.3)", () => {
  it("resolves to pure system default when no TenantBranding row exists", async () => {
    const repo = new FakeThemeRepository({ tenantBranding: null });
    const theme = await new ResolveTheme(repo).execute({
      staffUserId: null,
      localeDirection: "LTR",
      prefersDarkSignal: NO_PREFERENCE_SIGNAL,
    });

    expect(theme.mode).toBe("light");
    expect(theme.colorTokens).toEqual(semanticColors.light);
    expect(theme.appTitle).toBe("SHJ3 Assistant");
  });

  it("never crashes for an anonymous (no-session) request — the citizen-facing surface", async () => {
    const repo = new FakeThemeRepository({ tenantBranding: null });
    await expect(
      new ResolveTheme(repo).execute({
        staffUserId: null,
        localeDirection: "RTL",
        prefersDarkSignal: NO_PREFERENCE_SIGNAL,
      }),
    ).resolves.toBeDefined();
  });
});

describe("ResolveTheme — tenant branding applies to every user with no overriding preference", () => {
  it("uses the tenant's active skin colours and settings", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: tenantBranding({ defaultMode: "Dark", appTitle: "SEWA Assistant" }),
    });
    const theme = await new ResolveTheme(repo).execute({
      staffUserId: null,
      localeDirection: "LTR",
      prefersDarkSignal: NO_PREFERENCE_SIGNAL,
    });

    expect(theme.mode).toBe("dark");
    expect(theme.colorTokens).toEqual(tenantColorsDark());
    expect(theme.appTitle).toBe("SEWA Assistant");
  });
});

describe("ResolveTheme — the per-token merge guarantee, at the full use-case level", () => {
  it("a user mode override does not blow away the tenant's brand colours or app title", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: tenantBranding({
        defaultMode: "Light",
        appTitle: "SEWA Assistant",
        activeSkinColors: {
          light: tenantColors({ primary: "#TENANT_PRIMARY_LIGHT" }),
          dark: tenantColorsDark({ primary: "#TENANT_PRIMARY_DARK" }),
        },
      }),
      users: new Map([["u1", userPreference({ mode: "Dark" })]]),
    });

    const theme = await new ResolveTheme(repo).execute({
      staffUserId: "u1",
      localeDirection: "LTR",
      prefersDarkSignal: NO_PREFERENCE_SIGNAL,
    });

    // The one thing the user changed:
    expect(theme.mode).toBe("dark");
    // Everything the tenant branded is untouched — this is the guarantee the brief
    // names as the single most important behaviour in the whole module: a user
    // override on one token (here, the whole mode) must not blow away unrelated
    // tenant-branding tokens.
    expect(theme.appTitle).toBe("SEWA Assistant");
    expect(theme.colorTokens.primary).toBe("#TENANT_PRIMARY_DARK");
    expect(theme.colorTokens).toEqual(tenantColorsDark({ primary: "#TENANT_PRIMARY_DARK" }));
  });

  it("a personal skin overrides colour only, leaving the tenant's scalar settings alone", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: tenantBranding({ density: "Compact", appTitle: "SEWA Assistant" }),
      users: new Map([
        [
          "u1",
          userPreference({
            personalSkinColors: {
              light: tenantColors({ primary: "#PERSONAL_PRIMARY" }),
              dark: tenantColorsDark({ primary: "#PERSONAL_PRIMARY_DARK" }),
            },
          }),
        ],
      ]),
    });

    const theme = await new ResolveTheme(repo).execute({
      staffUserId: "u1",
      localeDirection: "LTR",
      prefersDarkSignal: NO_PREFERENCE_SIGNAL,
    });

    expect(theme.colorTokens.primary).toBe("#PERSONAL_PRIMARY");
    // Density is a named scalar column, untouched by a colour-only personal skin.
    expect(theme.density).toBe("Compact");
    expect(theme.appTitle).toBe("SEWA Assistant");
  });

  it("a user font-size override does not change tenant density or direction", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: tenantBranding({ density: "Compact", defaultDirection: "RTL" }),
      users: new Map([["u1", userPreference({ fontSize: "1rem" })]]),
    });

    const theme = await new ResolveTheme(repo).execute({
      staffUserId: "u1",
      localeDirection: "LTR",
      prefersDarkSignal: NO_PREFERENCE_SIGNAL,
    });

    expect(theme.fontSize).toBe("1rem");
    expect(theme.density).toBe("Compact");
    expect(theme.direction).toBe("RTL");
  });
});

describe("ResolveTheme — mode: system resolves via the real prefersDark signal", () => {
  it("System at the tenant tier, no user override, resolves via the request signal", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: tenantBranding({ defaultMode: "System" }),
    });

    const dark = await new ResolveTheme(repo).execute({
      staffUserId: null,
      localeDirection: "LTR",
      prefersDarkSignal: { clientHint: "dark", cookie: null },
    });
    expect(dark.mode).toBe("dark");

    const light = await new ResolveTheme(repo).execute({
      staffUserId: null,
      localeDirection: "LTR",
      prefersDarkSignal: { clientHint: "light", cookie: null },
    });
    expect(light.mode).toBe("light");
  });
});

describe("ResolveTheme — brand assets (§9.1) are a direct tenant-tier read, never merged", () => {
  it("surfaces the tenant's uploaded logo/favicon URLs, and null when nothing has been uploaded", async () => {
    const withAssets = new FakeThemeRepository({
      tenantBranding: tenantBranding({
        logoLightUrl: "/uploads/brand-assets/sewa/light.png",
        logoDarkUrl: "/uploads/brand-assets/sewa/dark.png",
        faviconUrl: "/uploads/brand-assets/sewa/favicon.ico",
      }),
    });
    const theme = await new ResolveTheme(withAssets).execute({
      staffUserId: null,
      localeDirection: "LTR",
      prefersDarkSignal: NO_PREFERENCE_SIGNAL,
    });
    expect(theme.logoLightUrl).toBe("/uploads/brand-assets/sewa/light.png");
    expect(theme.logoDarkUrl).toBe("/uploads/brand-assets/sewa/dark.png");
    expect(theme.faviconUrl).toBe("/uploads/brand-assets/sewa/favicon.ico");

    const noAssets = new FakeThemeRepository({ tenantBranding: tenantBranding() });
    const themeNoAssets = await new ResolveTheme(noAssets).execute({
      staffUserId: null,
      localeDirection: "LTR",
      prefersDarkSignal: NO_PREFERENCE_SIGNAL,
    });
    expect(themeNoAssets.logoLightUrl).toBeNull();
    expect(themeNoAssets.logoDarkUrl).toBeNull();
    expect(themeNoAssets.faviconUrl).toBeNull();
  });

  it("resolves to null for every asset when the tenant has no TenantBranding row at all", async () => {
    const repo = new FakeThemeRepository({ tenantBranding: null });
    const theme = await new ResolveTheme(repo).execute({
      staffUserId: null,
      localeDirection: "LTR",
      prefersDarkSignal: NO_PREFERENCE_SIGNAL,
    });
    expect(theme.logoLightUrl).toBeNull();
    expect(theme.logoDarkUrl).toBeNull();
    expect(theme.faviconUrl).toBeNull();
  });
});

describe("ResolveTheme — a dangling personal skin defers to the tenant tier", () => {
  it("null personalSkinColors (soft-deleted or never chosen) uses the tenant's colours", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: tenantBranding({
        activeSkinColors: { light: tenantColors({ primary: "#TENANT" }), dark: tenantColorsDark() },
      }),
      users: new Map([["u1", userPreference({ personalSkinColors: null })]]),
    });

    const theme = await new ResolveTheme(repo).execute({
      staffUserId: "u1",
      localeDirection: "LTR",
      prefersDarkSignal: NO_PREFERENCE_SIGNAL,
    });

    expect(theme.colorTokens.primary).toBe("#TENANT");
  });
});
