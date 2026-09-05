// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: vi.fn().mockResolvedValue({ kind: "ok", data: { tiers: [] } }) }));

// See the identical note in `app/internal/ops/login/page.test.tsx`.
const assertOpsPageAllowedMock = vi.fn(async () => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: () => assertOpsPageAllowedMock(),
}));

const { default: PlanTiersPage } = await import("./page.js");

describe("app/internal/ops/(console)/plan-tiers/page.tsx", () => {
  it("renders the Plan Tiers screen", async () => {
    render(await PlanTiersPage());
    expect(screen.getByText("Plan Tiers")).toBeInTheDocument();
  });

  /**
   * Page-surface Defect 1 regression (same class as the Tenant List screen's, see
   * that page's own test): without this gate call, a denied caller's response still
   * carries `PlanTiersScreen`'s real component/chunk names.
   */
  it("runs the ops gate before constructing PlanTiersScreen", async () => {
    assertOpsPageAllowedMock.mockClear();
    assertOpsPageAllowedMock.mockImplementationOnce(async () => {
      throw new Error("NEXT_NOT_FOUND");
    });
    await expect(PlanTiersPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(assertOpsPageAllowedMock).toHaveBeenCalledTimes(1);
  });
});
