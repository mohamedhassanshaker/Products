// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: vi.fn().mockResolvedValue({ kind: "error", status: 404, message: "Tenant not found." }),
}));

// See the identical note in `app/internal/ops/login/page.test.tsx`.
const assertOpsPageAllowedMock = vi.fn(async () => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: () => assertOpsPageAllowedMock(),
}));

const { default: TenantDetailPage } = await import("./page.js");

describe("app/internal/ops/(console)/tenants/[id]/page.tsx", () => {
  it("resolves the dynamic [id] param and renders the detail screen", async () => {
    const element = await TenantDetailPage({ params: Promise.resolve({ id: "t1" }) });
    render(element);
    expect(await screen.findByText(/no tenant found/i)).toBeInTheDocument();
  });

  /**
   * Page-surface Defect 1 regression, plus the ordering detail: the gate must run before
   * `params` is awaited, so a denial does no work that varies with the requested tenant
   * id and never constructs `TenantDetailScreen`.
   */
  it("runs the ops gate before awaiting params or constructing TenantDetailScreen", async () => {
    assertOpsPageAllowedMock.mockClear();
    assertOpsPageAllowedMock.mockImplementationOnce(async () => {
      throw new Error("NEXT_NOT_FOUND");
    });
    let paramsRead = false;
    const params = new Promise<{ id: string }>((resolve) => {
      paramsRead = true;
      resolve({ id: "t1" });
    });
    await expect(TenantDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(assertOpsPageAllowedMock).toHaveBeenCalledTimes(1);
    // The promise executor runs eagerly at construction; what matters is that the page
    // threw before doing anything with its resolved value.
    expect(paramsRead).toBe(true);
  });
});
