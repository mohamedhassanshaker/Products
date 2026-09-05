import { describe, expect, it } from "vitest";
import { generateRandomSecret, hashBearerSecret, verifyBearerSecret } from "./token-hash.js";

describe("token-hash (Phase 4, BL-36) — bearer-secret hashing for API keys/SCIM tokens", () => {
  it("hashes a secret to something other than the plaintext", async () => {
    const hash = await hashBearerSecret("my-plaintext-secret");
    expect(hash).not.toBe("my-plaintext-secret");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("round-trips hash -> verify for the correct secret", async () => {
    const hash = await hashBearerSecret("correct-secret");
    await expect(verifyBearerSecret(hash, "correct-secret")).resolves.toBe(true);
  });

  it("rejects verification against the wrong secret", async () => {
    const hash = await hashBearerSecret("correct-secret");
    await expect(verifyBearerSecret(hash, "wrong-secret")).resolves.toBe(false);
  });

  it("never throws on a malformed/corrupt stored hash — treated as a verification failure", async () => {
    await expect(verifyBearerSecret("not-a-real-argon2-hash", "anything")).resolves.toBe(false);
  });

  it("generateRandomSecret produces distinct, non-empty values", () => {
    const a = generateRandomSecret();
    const b = generateRandomSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
