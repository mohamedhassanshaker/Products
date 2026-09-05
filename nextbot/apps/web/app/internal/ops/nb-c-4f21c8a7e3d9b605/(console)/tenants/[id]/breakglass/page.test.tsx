// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: vi.fn().mockResolvedValue({ kind: "ok", data: { activeGrant: null } }),
}));

// See the identical note in `tenants/[id]/page.test.tsx`.
const assertOpsPageAllowedMock = vi.fn(async () => {});
vi.mock("@/src/lib/ops-page-gate", () => ({
  assertOpsPageAllowed: () => assertOpsPageAllowedMock(),
}));

const { default: BreakglassOpsPage } = await import("./page.js");

describe("app/internal/ops/(console)/tenants/[id]/breakglass/page.tsx (Phase 20, FR-ADM-09)", () => {
  it("resolves the dynamic [id] param and renders the break-glass screen", async () => {
    const element = await BreakglassOpsPage({ params: Promise.resolve({ id: "t1" }) });
    render(element);
    expect(await screen.findByText("Break-Glass Access")).toBeInTheDocument();
  });

  it("runs the ops gate before awaiting params or constructing the screen", async () => {
    assertOpsPageAllowedMock.mockClear();
    assertOpsPageAllowedMock.mockImplementationOnce(async () => {
      throw new Error("NEXT_NOT_FOUND");
    });
    let paramsRead = false;
    const params = new Promise<{ id: string }>((resolve) => {
      paramsRead = true;
      resolve({ id: "t1" });
    });
    await expect(BreakglassOpsPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(assertOpsPageAllowedMock).toHaveBeenCalledTimes(1);
    expect(paramsRead).toBe(true);
  });
});
