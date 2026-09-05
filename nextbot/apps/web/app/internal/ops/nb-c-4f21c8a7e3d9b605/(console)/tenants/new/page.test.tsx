// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// See the identical note in `app/internal/ops/login/page.test.tsx`.
const assertOpsPageAllowedMock = vi.fn(async () => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: () => assertOpsPageAllowedMock(),
}));

const { default: ProvisionTenantPage } = await import("./page.js");

describe("app/internal/ops/(console)/tenants/new/page.tsx", () => {
  it("renders the provisioning form", async () => {
    render(await ProvisionTenantPage());
    expect(screen.getByText("Provision new tenant")).toBeInTheDocument();
  });

  /** Page-surface Defect 1 regression — see the sibling tenants/page.test.tsx. */
  it("runs the ops gate before constructing ProvisionTenantForm", async () => {
    assertOpsPageAllowedMock.mockClear();
    assertOpsPageAllowedMock.mockImplementationOnce(async () => {
      throw new Error("NEXT_NOT_FOUND");
    });
    await expect(ProvisionTenantPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(assertOpsPageAllowedMock).toHaveBeenCalledTimes(1);
  });
});
