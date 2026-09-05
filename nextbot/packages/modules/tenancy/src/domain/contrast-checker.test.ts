import { describe, expect, it } from "vitest";
import { checkContrastRatio, MIN_AA_CONTRAST_RATIO } from "./contrast-checker.js";

describe("checkContrastRatio (FR-ADM-07 / NFR-7 — WCAG 2.2 AA)", () => {
  it("black on white passes AA with the maximum possible ratio (21:1)", () => {
    const result = checkContrastRatio("#000000", "#FFFFFF");
    expect(result.ratio).toBeCloseTo(21, 0);
    expect(result.passesAA).toBe(true);
  });

  it("white on white fails (ratio 1:1)", () => {
    const result = checkContrastRatio("#FFFFFF", "#FFFFFF");
    expect(result.ratio).toBeCloseTo(1, 1);
    expect(result.passesAA).toBe(false);
  });

  it("is symmetric — foreground/background order does not change the ratio", () => {
    const a = checkContrastRatio("#1B6B4A", "#FFFFFF");
    const b = checkContrastRatio("#FFFFFF", "#1B6B4A");
    expect(a.ratio).toBe(b.ratio);
  });

  it("a light gray-on-white pair fails the AA text threshold (light surface)", () => {
    const result = checkContrastRatio("#CCCCCC", "#FFFFFF");
    expect(result.passesAA).toBe(false);
  });

  it("a saturated brand green on a dark surface can fail even though it passes on light", () => {
    const onLight = checkContrastRatio("#1B6B4A", "#FFFFFF");
    const onDark = checkContrastRatio("#1B6B4A", "#111111");
    // Same color pair, different WCAG outcome depending on the surface — this is
    // exactly why FR-ADM-07 checks both light *and* dark surfaces before allowing a
    // save, not just one.
    expect(onLight.passesAA).toBe(true);
    expect(onDark.passesAA).toBe(false);
  });

  it("honors a custom minRatio (e.g. the 3:1 large-text/UI-component threshold)", () => {
    const result = checkContrastRatio("#767676", "#FFFFFF", 3);
    expect(result.ratio).toBeGreaterThanOrEqual(3);
    expect(result.passesAA).toBe(true);
  });

  it("MIN_AA_CONTRAST_RATIO is the standard 4.5:1 normal-text threshold", () => {
    expect(MIN_AA_CONTRAST_RATIO).toBe(4.5);
  });
});
