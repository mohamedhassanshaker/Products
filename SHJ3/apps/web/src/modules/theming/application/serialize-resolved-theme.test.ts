import { describe, expect, it } from "vitest";
import { semanticColors } from "@shj3/tokens";
import { serializeResolvedTheme } from "./serialize-resolved-theme.js";
import type { ResolvedTheme } from "../domain/theme.js";

function theme(overrides: Partial<ResolvedTheme> = {}): ResolvedTheme {
  return {
    mode: "light",
    density: "Comfortable",
    direction: "LTR",
    fontSize: "0.875rem",
    reducedMotion: false,
    shadowDepth: "1",
    sidebarStyle: "neutral",
    appTitle: "SHJ3 Assistant",
    colorTokens: semanticColors.light,
    logoLightUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    ...overrides,
  };
}

describe("serializeResolvedTheme", () => {
  it("emits the resolved colour tokens, not the static default, when they differ", () => {
    const css = serializeResolvedTheme(
      theme({ colorTokens: { ...semanticColors.light, primary: "#123456" } }),
    );
    expect(css).toContain("--primary: #123456;");
  });

  it("emits the dark shadow colour when mode is dark", () => {
    const css = serializeResolvedTheme(theme({ mode: "dark", colorTokens: semanticColors.dark }));
    // SHADOW_COLOR_BY_MODE.dark is "4 6 9" (css.ts's own published value).
    expect(css).toContain("--shadow-color: 4 6 9;");
  });

  it("includes every layer serializeBaseStylesheet also includes: primitives, density stops, reduced-motion media query", () => {
    const css = serializeResolvedTheme(theme());
    expect(css).toContain("--shj3-"); // primitive layer prefix
    expect(css).toContain('[data-density="compact"]');
    expect(css).toContain('[data-density="comfortable"]');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("forces reduced motion unconditionally (not just inside the media query) when the user's preference says so", () => {
    const withPreference = serializeResolvedTheme(theme({ reducedMotion: true }));
    const withoutPreference = serializeResolvedTheme(theme({ reducedMotion: false }));

    // Two occurrences of the override block when forced (once inside the media
    // query, once unconditional); only one (inside the media query) otherwise.
    const countOccurrences = (css: string, needle: string) => css.split(needle).length - 1;
    expect(countOccurrences(withPreference, "--duration-instant: 1ms;")).toBe(2);
    expect(countOccurrences(withoutPreference, "--duration-instant: 1ms;")).toBe(1);
  });

  it("re-validates every value at emit time via the real serializeTokens (defence in depth)", () => {
    // An unsafe value reaching this far (e.g. from a row written by an older build)
    // must still fail loudly rather than being inlined into the page.
    expect(() =>
      serializeResolvedTheme(
        theme({ colorTokens: { ...semanticColors.light, primary: "not-a-colour" } }),
      ),
    ).toThrow();
  });

  it("minifies when asked, matching the inlined <head> use case", () => {
    const css = serializeResolvedTheme(theme(), { minify: true });
    expect(css).not.toContain("\n");
  });
});
