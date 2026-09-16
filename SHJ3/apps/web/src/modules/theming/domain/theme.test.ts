import { describe, expect, it } from "vitest";
import { SHARJAH_DEFAULT } from "@shj3/tokens";
import type { SemanticColorTokens, Skin } from "@shj3/tokens";
import {
  mergeColorTokens,
  resolveDensity,
  resolveDirection,
  resolveFontSize,
  resolveMode,
  resolveReducedMotion,
  systemFallbackAppearance,
} from "./theme.js";

/**
 * The single most important behavioural guarantee in the theming module
 * (design-system.md §9.4's own emphasis): resolution is a PER-TOKEN merge, not a
 * whole-object pick. A user override on one token must never blow away unrelated
 * tenant-branding tokens, and a tenant skin must never blow away a system token it
 * never customised.
 */
describe("mergeColorTokens — per-token merge, not a whole-object pick", () => {
  // Minimal fixtures rather than the full 66-role catalogue: the guarantee under test
  // is about merge ORDER and KEY INDEPENDENCE, which three keys already exhibit fully,
  // and a real complete set is exercised by the resolve-theme integration test instead.
  const system: SemanticColorTokens = {
    background: "#SYS_BG",
    foreground: "#SYS_FG",
    primary: "#SYS_PRIMARY",
  } as unknown as SemanticColorTokens;

  it("with no tenant or personal override, resolves to the system set untouched", () => {
    expect(mergeColorTokens(system, undefined, undefined)).toEqual(system);
  });

  it("a tenant skin overriding ONE token leaves every other system token untouched", () => {
    const tenant = { ...system, primary: "#TENANT_PRIMARY" };
    const merged = mergeColorTokens(system, tenant, undefined);
    expect(merged.primary).toBe("#TENANT_PRIMARY");
    // The tokens the tenant skin did not touch still come from the system set —
    // this is the completeness case (§7.4 stage 4), not a coincidence of the fixture.
    expect(merged.background).toBe("#SYS_BG");
    expect(merged.foreground).toBe("#SYS_FG");
  });

  it("a PARTIAL tenant object (simulating a pre-schema-evolution skin) still fills gaps from system", () => {
    // Deliberately a partial object, not a complete SemanticColorTokens — the exact
    // scenario the merge (rather than a plain "use tenant's set") exists to cover: a
    // tenant skin saved before a new system token existed must not resolve to
    // `undefined` for that token.
    const partialTenant = { primary: "#TENANT_PRIMARY" } as unknown as SemanticColorTokens;
    const merged = mergeColorTokens(system, partialTenant, undefined);
    expect(merged.primary).toBe("#TENANT_PRIMARY");
    expect(merged.background).toBe("#SYS_BG");
    expect(merged.foreground).toBe("#SYS_FG");
  });

  it("a personal skin overriding one token wins over BOTH system and tenant, per token", () => {
    const tenant = { ...system, primary: "#TENANT_PRIMARY", background: "#TENANT_BG" };
    const personal = { foreground: "#PERSONAL_FG" } as unknown as SemanticColorTokens;
    const merged = mergeColorTokens(system, tenant, personal);
    // The user's one personal override wins...
    expect(merged.foreground).toBe("#PERSONAL_FG");
    // ...but the tenant's unrelated customisations survive completely unharmed —
    // this is the exact case the brief calls out: "a user override on one token
    // doesn't blow away unrelated tenant-branding tokens".
    expect(merged.primary).toBe("#TENANT_PRIMARY");
    expect(merged.background).toBe("#TENANT_BG");
  });

  it("order is strictly last-wins: personal > tenant > system for the SAME key", () => {
    const merged = mergeColorTokens(
      { primary: "#1" } as unknown as SemanticColorTokens,
      { primary: "#2" } as unknown as SemanticColorTokens,
      { primary: "#3" } as unknown as SemanticColorTokens,
    );
    expect(merged.primary).toBe("#3");
  });
});

describe("resolveMode", () => {
  it("user's explicit mode wins over the tenant's default", () => {
    expect(resolveMode("Dark", "Light", false)).toBe("dark");
  });

  it("falls back to the tenant's default when the user has not chosen", () => {
    expect(resolveMode(null, "Dark", false)).toBe("dark");
    expect(resolveMode(undefined, "Light", true)).toBe("light");
  });

  it("falls back to System (resolved via prefersDark) with neither tier set", () => {
    expect(resolveMode(null, undefined, true)).toBe("dark");
    expect(resolveMode(null, undefined, false)).toBe("light");
  });

  it("a tier explicitly choosing System resolves via prefersDark rather than falling through", () => {
    // The user chose "follow system" — that is an explicit, terminal choice, not an
    // absence, so it must NOT fall through to the tenant's own mode.
    expect(resolveMode("System", "Dark", false)).toBe("light");
    expect(resolveMode("System", "Dark", true)).toBe("dark");
  });
});

describe("resolveDensity / resolveDirection / resolveFontSize / resolveReducedMotion", () => {
  it("density: user wins, then tenant, then the documented default", () => {
    expect(resolveDensity("Compact", "Comfortable")).toBe("Compact");
    expect(resolveDensity(null, "Compact")).toBe("Compact");
    expect(resolveDensity(null, undefined)).toBe("Comfortable");
  });

  it("direction: an override at either tier wins over the locale's own direction", () => {
    expect(resolveDirection("RTL", "LTR", "LTR")).toBe("RTL");
    expect(resolveDirection(null, "RTL", "LTR")).toBe("RTL");
    expect(resolveDirection(null, undefined, "RTL")).toBe("RTL");
  });

  it("fontSize: user wins, then tenant, then the documented default, rejecting a foreign value", () => {
    expect(resolveFontSize("1rem", "0.8125rem")).toBe("1rem");
    expect(resolveFontSize(null, "0.9375rem")).toBe("0.9375rem");
    expect(resolveFontSize(null, undefined)).toBe("0.875rem");
    // A value outside the four allowlisted stops (defence in depth against a row an
    // older build or a direct database edit produced) falls back rather than emitting
    // an arbitrary string into the stylesheet.
    expect(resolveFontSize("22px", undefined)).toBe("0.875rem");
  });

  it("reducedMotion: has no tenant tier at all, defaults to false", () => {
    expect(resolveReducedMotion(true)).toBe(true);
    expect(resolveReducedMotion(null)).toBe(false);
    expect(resolveReducedMotion(undefined)).toBe(false);
  });
});

describe("systemFallbackAppearance", () => {
  it("reads appTitle/shadowDepth/sidebarStyle from the real shipped skin's own published defaults", () => {
    const fallback = systemFallbackAppearance(SHARJAH_DEFAULT);
    expect(fallback.appTitle).toBe(SHARJAH_DEFAULT.assets?.appTitle);
    expect(fallback.shadowDepth).toBe(String(SHARJAH_DEFAULT.geometry?.shadowDepth));
    expect(fallback.sidebarStyle).toBe(SHARJAH_DEFAULT.geometry?.sidebarStyle);
  });

  it("falls back to the documented literal defaults when a skin carries no assets/geometry at all", () => {
    const bare = { ...SHARJAH_DEFAULT, assets: undefined, geometry: undefined } as unknown as Skin;
    const fallback = systemFallbackAppearance(bare);
    expect(fallback).toEqual({
      appTitle: "SHJ3 Assistant",
      shadowDepth: "1",
      sidebarStyle: "neutral",
    });
  });
});
