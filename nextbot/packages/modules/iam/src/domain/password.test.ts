import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing (argon2id, LLD library table)", () => {
  it("hashes and verifies a matching password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects a non-matching password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("never throws on a malformed/corrupt stored hash — returns false instead", async () => {
    await expect(verifyPassword("not-a-real-argon2-hash", "anything")).resolves.toBe(false);
  });

  it("produces a different hash for the same password each time (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });
});
