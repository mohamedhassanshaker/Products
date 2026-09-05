// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

const assertOpsPageAllowedMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: (...a: unknown[]) => assertOpsPageAllowedMock(...a),
}));

const notFoundMock = vi.fn((..._args: unknown[]) => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: (...a: unknown[]) => notFoundMock(...a),
}));

const pageModule = await import("./page.js");
const OpsUnmatchedPage = pageModule.default;

describe("app/internal/ops/[...unmatched]/page.tsx (NFR-11 page-surface Defect 1)", () => {
  beforeEach(() => {
    assertOpsPageAllowedMock.mockReset();
    assertOpsPageAllowedMock.mockResolvedValue(undefined);
    notFoundMock.mockClear();
  });

  /**
   * A nonexistent path under `/internal/ops` must run the *same* gate, in the *same* tree
   * position, as a real-but-denied one — otherwise the two are answered by different render
   * paths whose outputs can be diffed into a route-enumeration oracle.
   */
  it("runs the ops gate and then answers not-found even when the gate passes", async () => {
    await expect(OpsUnmatchedPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(assertOpsPageAllowedMock).toHaveBeenCalledTimes(1);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(notFoundMock.mock.calls[0]).toEqual([]);
  });

  it("propagates the gate's denial without reaching its own notFound()", async () => {
    assertOpsPageAllowedMock.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    await expect(OpsUnmatchedPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  /** A prerendered catch-all would carry its own ETag/fixed Content-Length that a
   * per-request gate denial could never match. */
  it("is force-dynamic so it is never prerendered", () => {
    expect(pageModule.dynamic).toBe("force-dynamic");
  });

  it("takes no route params", () => {
    expect(OpsUnmatchedPage.length).toBe(0);
  });
});
