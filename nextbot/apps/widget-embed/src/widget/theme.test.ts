import { describe, expect, it } from "vitest";
import { buildWidgetBrandStyleTag } from "./theme.js";

describe("buildWidgetBrandStyleTag (Plan Phase 5 — CSS custom-property injection, supersedes the old Chakra extendTheme instance)", () => {
  it("applies the provided brand color as --primary", () => {
    const style = buildWidgetBrandStyleTag({ primaryColor: "#1B6B4A" });
    expect(style).toContain("--primary:#1B6B4A;");
  });

  it("falls back to the sensible default primary when no branding is supplied", () => {
    const style = buildWidgetBrandStyleTag();
    expect(style).toContain("--primary:#4f46e5;");
  });

  it("computes a WCAG-AA-passing --primary-foreground for a light brand color", () => {
    const style = buildWidgetBrandStyleTag({ primaryColor: "#fde047" });
    expect(style).toContain("--primary-foreground:#000000;");
  });

  it("computes a WCAG-AA-passing --primary-foreground for a dark brand color", () => {
    const style = buildWidgetBrandStyleTag({ primaryColor: "#1B6B4A" });
    expect(style).toContain("--primary-foreground:#ffffff;");
  });

  it("defensively falls back to the default primary for a malformed hex value (never interpolated raw)", () => {
    const style = buildWidgetBrandStyleTag({ primaryColor: "not-a-color; } body { display: none" });
    expect(style).toBe(":root{--primary:#4f46e5;--primary-foreground:#ffffff;}");
  });

  it("produces a single, well-formed :root rule", () => {
    const style = buildWidgetBrandStyleTag({ primaryColor: "#1B6B4A" });
    expect(style).toMatch(/^:root\{--primary:#[0-9a-fA-F]{6};--primary-foreground:#(ffffff|000000);\}$/);
  });
});
