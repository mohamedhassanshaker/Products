import { describe, expect, it } from "vitest";
import { checkContrastRatio, MIN_AA_CONTRAST_RATIO } from "./contrast-checker.js";

describe("checkContrastRatio (widget's own duplicated copy — see this file's doc comment for why)", () => {
  it("computes a high ratio and passes AA for black-on-white", () => {
    const result = checkContrastRatio("#000000", "#ffffff");
    expect(result.ratio).toBeCloseTo(21, 0);
    expect(result.passesAA).toBe(true);
  });

  it("fails AA for a low-contrast pairing", () => {
    const result = checkContrastRatio("#777777", "#888888");
    expect(result.passesAA).toBe(false);
  });

  it("is symmetric regardless of foreground/background order", () => {
    const a = checkContrastRatio("#4f46e5", "#ffffff");
    const b = checkContrastRatio("#ffffff", "#4f46e5");
    expect(a.ratio).toBe(b.ratio);
  });

  it("respects a custom minimum ratio override", () => {
    // A ratio (~3.95:1) that clears 3:1 (large text/UI) but not the default 4.5:1.
    const result = checkContrastRatio("#808080", "#ffffff", 3);
    expect(result.passesAA).toBe(true);
    expect(checkContrastRatio("#808080", "#ffffff", MIN_AA_CONTRAST_RATIO).passesAA).toBe(false);
  });
});
