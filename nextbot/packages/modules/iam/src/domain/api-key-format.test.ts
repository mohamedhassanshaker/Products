import { describe, expect, it } from "vitest";
import { formatApiKey, generateApiKeyId, generateApiKeySecret, parseApiKey } from "./api-key-format.js";

describe("api-key-format (Phase 4, BL-36) — nbk_<tenantSlug>.<keyId>.<secret>", () => {
  it("round-trips format -> parse", () => {
    const key = formatApiKey("acme-corp", "abc123defgh", "s3cr3t-value");
    const parsed = parseApiKey(key);
    expect(parsed).toEqual({ tenantSlug: "acme-corp", keyId: "abc123defgh", secret: "s3cr3t-value" });
  });

  it("generates a fresh, non-empty keyId and secret each call", () => {
    const id1 = generateApiKeyId();
    const id2 = generateApiKeyId();
    expect(id1).not.toBe(id2);
    expect(id1.length).toBeGreaterThan(0);

    const secret1 = generateApiKeySecret();
    const secret2 = generateApiKeySecret();
    expect(secret1).not.toBe(secret2);
  });

  it("rejects a value missing the nbk_ prefix", () => {
    expect(parseApiKey("something_else.a.b")).toBeNull();
  });

  it("rejects a value with the wrong number of dot-separated segments", () => {
    expect(parseApiKey("nbk_acme-corp.onlyonepart")).toBeNull();
    expect(parseApiKey("nbk_acme-corp.a.b.c")).toBeNull();
  });

  it("rejects a value with an empty segment", () => {
    expect(parseApiKey("nbk_.keyid.secret")).toBeNull();
    expect(parseApiKey("nbk_acme-corp..secret")).toBeNull();
    expect(parseApiKey("nbk_acme-corp.keyid.")).toBeNull();
  });
});
