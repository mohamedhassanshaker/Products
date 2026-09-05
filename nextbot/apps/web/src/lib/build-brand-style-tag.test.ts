import { describe, expect, it, vi } from "vitest";

// "server-only" throws outside a Next build (see api-guard.test.ts's identical
// comment) — stubbed to a no-op so this file is unit-testable under plain vitest.
vi.mock("server-only", () => ({}));

const { buildBrandStyleTag } = await import("./build-brand-style-tag.js");

describe("buildBrandStyleTag (FR-ADM-07 per-tenant runtime branding)", () => {
  it("returns null when branding is null/undefined (white-labeling off)", () => {
    expect(buildBrandStyleTag(null)).toBeNull();
    expect(buildBrandStyleTag(undefined)).toBeNull();
  });

  it("emits a literal :root style block with the tenant's real hex values, scoped to the dedicated chrome-only --brand-accent token, never shadcn's own --primary", () => {
    const css = buildBrandStyleTag({
      primaryColor: "#4f46e5",
      secondaryColor: "#0e3b28",
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
      fontFamily: null,
    });
    expect(css).not.toBeNull();
    expect(css).toContain("--brand-accent:#4f46e5;");
    expect(css).toContain("--brand-sidebar:#0e3b28;");
    // #4f46e5 is a mid-tone indigo — white foreground clears AA against it.
    expect(css).toContain("--brand-accent-foreground:#ffffff;");
    // Post-QA scope-bug fix regression guard: this must NEVER override shadcn's
    // own --primary/--primary-foreground tokens — doing so recolored every
    // Button/Badge/etc. primitive across the whole Admin Console, not just chrome.
    expect(css).not.toContain("--primary:");
    expect(css).not.toContain("--primary-foreground:");
  });

  it("picks a black foreground against a light/pale primary color", () => {
    const css = buildBrandStyleTag({
      primaryColor: "#fef3c7", // pale amber — very light background
      secondaryColor: "#111111",
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
      fontFamily: null,
    });
    expect(css).toContain("--brand-accent-foreground:#000000;");
  });

  it("reuses the shared checkContrastRatio algorithm rather than a second implementation", async () => {
    const { checkContrastRatio } = await import("@nextbot/tenancy");
    const css = buildBrandStyleTag({
      primaryColor: "#4f46e5",
      secondaryColor: "#0e3b28",
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
      fontFamily: null,
    });
    const expectedForeground = checkContrastRatio("#ffffff", "#4f46e5").passesAA ? "#ffffff" : "#000000";
    expect(css).toContain(`--brand-accent-foreground:${expectedForeground};`);
  });

  it("defensively rejects a malformed hex value instead of interpolating it raw", () => {
    const css = buildBrandStyleTag({
      // Not a valid #rrggbb — e.g. a pre-validation-era row, or a hostile value if
      // TenantBrandingSchema's own write-time validation were ever bypassed.
      primaryColor: "</style><script>alert(1)</script>",
      secondaryColor: "#0e3b28",
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
      fontFamily: null,
    });
    expect(css).toBeNull();
  });
});
