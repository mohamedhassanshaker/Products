// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

vi.mock("./actions", () => ({ opsLoginAction: vi.fn() }));

// The real `ops-page-gate` imports `server-only`, which throws under this jsdom
// environment; it also reads `next/headers`. Mocked so this test covers the page's own
// rendering, with `assertOpsPageAllowed`'s own behaviour covered in
// `src/lib/ops-page-gate.test.ts`.
const assertOpsPageAllowedMock = vi.fn(async () => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: () => assertOpsPageAllowedMock(),
}));

const { default: OpsLoginPage } = await import("./page.js");

describe("app/internal/ops/login/page.tsx", () => {
  it("renders the operator login form", async () => {
    render(await OpsLoginPage());
    expect(screen.getByLabelText(/operator token/i)).toBeInTheDocument();
  });

  /**
   * Page-surface Defect 1 regression: page segments render in parallel with their
   * layouts, so this page must gate itself — otherwise a caller the root gate already
   * refused still received `OpsLoginForm`'s real component/chunk names, confirming that
   * `/internal/ops/login` is a real route.
   */
  it("runs the ops gate before constructing the login form", async () => {
    assertOpsPageAllowedMock.mockClear();
    assertOpsPageAllowedMock.mockImplementationOnce(async () => {
      throw new Error("NEXT_NOT_FOUND");
    });
    await expect(OpsLoginPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(assertOpsPageAllowedMock).toHaveBeenCalledTimes(1);
  });
});
