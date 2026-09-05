// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: vi.fn().mockResolvedValue({ kind: "ok", data: { tenants: [] } }) }));

// See the identical note in `app/internal/ops/login/page.test.tsx`.
const assertOpsPageAllowedMock = vi.fn(async () => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: () => assertOpsPageAllowedMock(),
}));

const { default: TenantsPage } = await import("./page.js");

describe("app/internal/ops/(console)/tenants/page.tsx", () => {
  it("renders the Tenant List screen", async () => {
    render(await TenantsPage());
    expect(screen.getByText("Tenants")).toBeInTheDocument();
  });

  /**
   * Page-surface Defect 1 regression: without this gate call, a denied caller's response
   * still carried `TenantListScreen`'s real component/chunk names — the exact leak QA
   * reproduced.
   */
  it("runs the ops gate before constructing TenantListScreen", async () => {
    assertOpsPageAllowedMock.mockClear();
    assertOpsPageAllowedMock.mockImplementationOnce(async () => {
      throw new Error("NEXT_NOT_FOUND");
    });
    await expect(TenantsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(assertOpsPageAllowedMock).toHaveBeenCalledTimes(1);
  });
});
