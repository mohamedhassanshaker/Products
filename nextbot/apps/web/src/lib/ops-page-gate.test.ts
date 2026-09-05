import { describe, expect, it, vi, beforeEach } from "vitest";

// "server-only" throws outside a Next build — stubbed the same way every other
// apps/web unit test does (see build-brand-style-tag.test.ts's identical comment).
vi.mock("server-only", () => ({}));

const isPlatformOpsConfiguredMock = vi.fn();
const isRequestFromAllowedNetworkMock = vi.fn();
vi.mock("./platform-ops-auth", () => ({
  isPlatformOpsConfigured: () => isPlatformOpsConfiguredMock(),
  isRequestFromAllowedNetwork: (...a: unknown[]) => isRequestFromAllowedNetworkMock(...a),
}));

const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => headersMock(),
}));

const notFoundMock = vi.fn((..._args: unknown[]) => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: (...a: unknown[]) => notFoundMock(...a),
}));

const { assertOpsPageAllowed } = await import("./ops-page-gate.js");

describe("assertOpsPageAllowed (NFR-11 page-segment gate)", () => {
  beforeEach(() => {
    isPlatformOpsConfiguredMock.mockReset();
    isRequestFromAllowedNetworkMock.mockReset();
    notFoundMock.mockClear();
    headersMock.mockReturnValue(new Headers({ "x-forwarded-for": "10.0.0.1" }));
  });

  it("denies an unconfigured deployment without even resolving the caller IP", async () => {
    isPlatformOpsConfiguredMock.mockReturnValue(false);
    await expect(assertOpsPageAllowed()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(isRequestFromAllowedNetworkMock).not.toHaveBeenCalled();
  });

  it("denies a configured deployment when the caller's network is disallowed", async () => {
    isPlatformOpsConfiguredMock.mockReturnValue(true);
    isRequestFromAllowedNetworkMock.mockReturnValue(false);
    await expect(assertOpsPageAllowed()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("resolves silently when configured and the network is allowed", async () => {
    isPlatformOpsConfiguredMock.mockReturnValue(true);
    isRequestFromAllowedNetworkMock.mockReturnValue(true);
    await expect(assertOpsPageAllowed()).resolves.toBeUndefined();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  /**
   * Page-surface Defect 1: `notFound()` must be called with no arguments, and both denial
   * branches must reach the identical call. Anything derived from the request (a reason
   * code, the path, a message) would be a distinguishing signal — the same "no arguments,
   * by design" rule `apiNotFoundResponse()` follows on the API surface.
   */
  it("signals both denial reasons through the identical argument-free notFound() call", async () => {
    isPlatformOpsConfiguredMock.mockReturnValue(false);
    await expect(assertOpsPageAllowed()).rejects.toThrow("NEXT_NOT_FOUND");
    isPlatformOpsConfiguredMock.mockReturnValue(true);
    isRequestFromAllowedNetworkMock.mockReturnValue(false);
    await expect(assertOpsPageAllowed()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(2);
    for (const call of notFoundMock.mock.calls) {
      expect(call).toEqual([]);
    }
  });
});
