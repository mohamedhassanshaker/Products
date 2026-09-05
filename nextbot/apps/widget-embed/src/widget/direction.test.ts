import { describe, expect, it } from "vitest";
import { resolveDirection } from "./direction.js";

describe("resolveDirection (D7 — RTL mirroring re-derived from the live active language)", () => {
  it("defaults to ltr for an unrecognized/English language with no config override", () => {
    expect(resolveDirection(undefined, "en")).toBe("ltr");
    expect(resolveDirection("auto", "en")).toBe("ltr");
  });

  it("auto-detects rtl for Arabic even when the config direction is 'auto'/absent", () => {
    expect(resolveDirection(undefined, "ar")).toBe("rtl");
    expect(resolveDirection("auto", "ar")).toBe("rtl");
  });

  it("re-derives per the currently active language, not a value frozen at initial load (the D7 bug)", () => {
    // Same call site, different `language` argument — simulates the store's
    // `language` changing after a Language Selection Modal pick.
    expect(resolveDirection("auto", "en")).toBe("ltr");
    expect(resolveDirection("auto", "ar")).toBe("rtl");
  });

  it("a host page's explicit ltr/rtl override always wins outright, regardless of language", () => {
    expect(resolveDirection("ltr", "ar")).toBe("ltr");
    expect(resolveDirection("rtl", "en")).toBe("rtl");
  });

  it("recognizes other common RTL language families beyond the widget's own 2-language picker", () => {
    expect(resolveDirection(undefined, "he")).toBe("rtl");
    expect(resolveDirection(undefined, "fa")).toBe("rtl");
    expect(resolveDirection(undefined, "ur")).toBe("rtl");
  });

  it("matches on the base language subtag, ignoring region (e.g. ar-AE)", () => {
    expect(resolveDirection(undefined, "ar-AE")).toBe("rtl");
    expect(resolveDirection(undefined, "en-US")).toBe("ltr");
  });
});
