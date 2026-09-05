// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

const verifyOperatorTokenMock = vi.fn();
vi.mock("@/src/lib/platform-ops-auth", () => ({
  OPS_SESSION_COOKIE: "nb_ops_session",
  verifyOperatorToken: (...a: unknown[]) => verifyOperatorTokenMock(...a),
}));

const cookieGetMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGetMock }),
}));

// Typed to accept a variadic arg list — see the identical comment in
// app/internal/ops/layout.test.tsx's notFoundMock for why (TS2556 fix).
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("NEXT_REDIRECT");
});
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
}));

const assertOpsPageAllowedMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: (...a: unknown[]) => assertOpsPageAllowedMock(...a),
}));

vi.mock("./OpsShell", () => ({
  OpsShell: ({ children }: { children: unknown }) => <div data-testid="ops-shell">{children as never}</div>,
}));

const { default: OpsConsoleLayout } = await import("./layout.js");

describe("app/internal/ops/(console)/layout.tsx (NFR-11 — session-cookie gate + shell)", () => {
  beforeEach(() => {
    verifyOperatorTokenMock.mockReset();
    cookieGetMock.mockReset();
    redirectMock.mockClear();
    assertOpsPageAllowedMock.mockReset();
    assertOpsPageAllowedMock.mockResolvedValue(undefined);
  });

  /**
   * Page-surface Defect 1 regression. Layouts render in parallel with each other, so the
   * root gate denying did not stop this layout from running — and when it ran anyway, its
   * `redirect()` serialized the literal `NEXT_REDIRECT;replace;/internal/ops/login;307;`
   * into the denied response's payload, naming a real route to an unauthenticated caller
   * on an unconfigured deployment. Gating here first, *before* the session check, means an
   * unconfigured/network-disallowed caller can only ever get the shared not-found answer,
   * never a redirect.
   */
  it("applies the ops gate before the session check, so a denial can never be a redirect", async () => {
    assertOpsPageAllowedMock.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    cookieGetMock.mockReturnValue(undefined);
    await expect(OpsConsoleLayout({ children: <p>child</p> })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(redirectMock).not.toHaveBeenCalled();
    expect(cookieGetMock).not.toHaveBeenCalled();
  });

  it("redirects to /internal/ops/login when no session cookie is present", async () => {
    cookieGetMock.mockReturnValue(undefined);
    await expect(OpsConsoleLayout({ children: <p>child</p> })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/internal/ops/login");
  });

  it("redirects to /internal/ops/login when the cookie's token is invalid", async () => {
    cookieGetMock.mockReturnValue({ value: "stale-token" });
    verifyOperatorTokenMock.mockReturnValue(false);
    await expect(OpsConsoleLayout({ children: <p>child</p> })).rejects.toThrow("NEXT_REDIRECT");
  });

  it("renders the OpsShell with children when the cookie's token is valid", async () => {
    cookieGetMock.mockReturnValue({ value: "correct-token" });
    verifyOperatorTokenMock.mockReturnValue(true);
    const result = await OpsConsoleLayout({ children: <p>child</p> });
    expect(result).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
