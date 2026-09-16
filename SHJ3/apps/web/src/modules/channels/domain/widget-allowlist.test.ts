import { describe, expect, it } from "vitest";
import { isValidWidgetAllowedDomain } from "./widget-allowlist.js";

describe("isValidWidgetAllowedDomain", () => {
  it("accepts the seeded plain hosts", () => {
    expect(isValidWidgetAllowedDomain("sharjah.ae")).toBe(true);
    expect(isValidWidgetAllowedDomain("services.shj.ae")).toBe(true);
  });

  it("accepts a single-label wildcard subdomain", () => {
    expect(isValidWidgetAllowedDomain("*.sharjah.ae")).toBe(true);
  });

  it("rejects a scheme", () => {
    expect(isValidWidgetAllowedDomain("https://sharjah.ae")).toBe(false);
  });

  it("rejects a path", () => {
    expect(isValidWidgetAllowedDomain("sharjah.ae/embed")).toBe(false);
  });

  it("rejects an IPv4 literal", () => {
    expect(isValidWidgetAllowedDomain("192.168.1.1")).toBe(false);
  });

  it("rejects a bare TLD", () => {
    expect(isValidWidgetAllowedDomain("ae")).toBe(false);
  });

  it("rejects a wildcarded bare TLD, even though the SQL CHECK alone would not catch it", () => {
    expect(isValidWidgetAllowedDomain("*.ae")).toBe(false);
  });

  it("rejects a bare wildcard", () => {
    expect(isValidWidgetAllowedDomain("*")).toBe(false);
  });

  it("rejects more than one wildcard label", () => {
    expect(isValidWidgetAllowedDomain("*.*.sharjah.ae")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isValidWidgetAllowedDomain("   ")).toBe(false);
  });
});
