import { describe, expect, it, vi } from "vitest";

describe("closeAllPools", () => {
  it("resolves cleanly even when no pool has been opened yet", async () => {
    vi.resetModules();
    const { closeAllPools } = await import("./pool.js");
    await expect(closeAllPools()).resolves.toBeUndefined();
  });
});
