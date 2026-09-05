import { describe, expect, it } from "vitest";
import { generateChannelPublicKey } from "./public-key.js";

describe("generateChannelPublicKey", () => {
  it("produces a wc_-prefixed, URL-safe, sufficiently-random value", () => {
    const key = generateChannelPublicKey();
    expect(key).toMatch(/^wc_[0-9a-f]{32}$/);
  });

  it("never repeats across calls (collision-resistant)", () => {
    const keys = new Set(Array.from({ length: 1000 }, () => generateChannelPublicKey()));
    expect(keys.size).toBe(1000);
  });
});
