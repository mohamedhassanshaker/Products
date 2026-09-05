import { describe, expect, it } from "vitest";
import { isWellFormedHttpsUrl } from "./url-validation.js";

describe("isWellFormedHttpsUrl (pure, security-review requirement: server-side input validation)", () => {
  it("accepts a well-formed https:// URL", () => {
    expect(isWellFormedHttpsUrl("https://example.com/webhooks/nextbot")).toBe(true);
  });

  it("rejects a plain http:// URL", () => {
    expect(isWellFormedHttpsUrl("http://example.com/webhooks/nextbot")).toBe(false);
  });

  it("rejects garbage input that is not a URL at all", () => {
    expect(isWellFormedHttpsUrl("not a url")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isWellFormedHttpsUrl("")).toBe(false);
  });

  it("rejects a non-http(s) scheme (e.g. a file:// URL)", () => {
    expect(isWellFormedHttpsUrl("file:///etc/passwd")).toBe(false);
  });
});
