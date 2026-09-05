// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: vi.fn().mockResolvedValue({ kind: "ok", data: { connectors: [] } }) }));

// See the identical note in `app/internal/ops/login/page.test.tsx`.
const assertOpsPageAllowedMock = vi.fn(async () => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: () => assertOpsPageAllowedMock(),
}));

const { default: HealthPage } = await import("./page.js");

describe("app/internal/ops/(console)/health/page.tsx", () => {
  it("renders the Health screen", async () => {
    render(await HealthPage());
    expect(screen.getByText("Health")).toBeInTheDocument();
  });

  /**
   * Page-surface Defect 1 regression (Phase 1): without this gate call, a denied
   * caller's response still carried the real screen's component/chunk names — the
   * exact leak QA reproduced. Every ops page segment must gate itself.
   */
  it("runs the ops gate before constructing HealthRollupScreen", async () => {
    assertOpsPageAllowedMock.mockClear();
    assertOpsPageAllowedMock.mockImplementationOnce(async () => {
      throw new Error("NEXT_NOT_FOUND");
    });
    await expect(HealthPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(assertOpsPageAllowedMock).toHaveBeenCalledTimes(1);
  });
});
