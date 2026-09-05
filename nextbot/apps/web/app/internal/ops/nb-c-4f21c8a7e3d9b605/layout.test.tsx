// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

// Typed to accept a variadic arg list (rather than the zero-arg signature TS would
// otherwise infer from a no-op-args implementation) so a spread call type-checks —
// `vi.fn()`'s inferred call signature comes from its implementation's parameter list.
const assertOpsPageAllowedMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: (...a: unknown[]) => assertOpsPageAllowedMock(...a),
}));

const layoutModule = await import("./layout.js");
const OpsRootLayout = layoutModule.default;

describe("app/internal/ops/layout.tsx (NFR-11 root gate)", () => {
  beforeEach(() => {
    assertOpsPageAllowedMock.mockReset();
    assertOpsPageAllowedMock.mockResolvedValue(undefined);
  });

  it("awaits the shared ops gate before rendering children", async () => {
    const result = await OpsRootLayout({ children: <p>child</p> });
    expect(assertOpsPageAllowedMock).toHaveBeenCalledTimes(1);
    expect(result).toBeTruthy();
  });

  it("propagates the gate's not-found signal instead of rendering children", async () => {
    assertOpsPageAllowedMock.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    await expect(OpsRootLayout({ children: <p>child</p> })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  /**
   * Page-surface Defect 1 regression, and the fix for the reported `ETag`/`Content-Length`
   * divergence at its root cause: without `force-dynamic`, a production build (which
   * normally runs with the ops env vars unset) prerendered `/internal/ops/login`,
   * `/internal/ops/tenants` and `/internal/ops/tenants/new` as *baked 404 shells*, each
   * with its own `ETag` and `Content-Length` — a one-request route-enumeration oracle —
   * and served those cached 404s even to a correctly-configured, allow-listed operator at
   * runtime. Route-segment config propagates down the subtree, so declaring it here
   * covers every ops page.
   */
  it("forces dynamic rendering for the whole /internal/ops subtree", () => {
    expect(layoutModule.dynamic).toBe("force-dynamic");
  });
});
