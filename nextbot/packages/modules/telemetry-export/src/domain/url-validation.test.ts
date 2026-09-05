import { describe, expect, it } from "vitest";
import { isWellFormedHttpsUrl } from "./url-validation.js";

describe("isWellFormedHttpsUrl (pure, security-review requirement: server-side input validation)", () => {
  it("accepts a well-formed https:// URL", () => {
    expect(isWellFormedHttpsUrl("https://collector.example.com:4318")).toBe(true);
  });

  it("rejects a plain http:// URL", () => {
    expect(isWellFormedHttpsUrl("http://collector.example.com:4318")).toBe(false);
  });

  it("rejects garbage input that is not a URL at all", () => {
    expect(isWellFormedHttpsUrl("not a url")).toBe(false);
  });
});
