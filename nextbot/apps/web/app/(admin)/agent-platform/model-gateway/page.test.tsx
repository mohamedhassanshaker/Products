import { describe, it, expect, vi } from "vitest";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("legacy /agent-platform/model-gateway page (Target Architecture Blueprint Phase 2)", () => {
  it("redirects to the unified /model-gateway console rather than rendering the retired v1 Routes/Provider Registry screen", async () => {
    const { default: LegacyModelGatewayPage } = await import("./page");
    LegacyModelGatewayPage();
    expect(redirect).toHaveBeenCalledWith("/model-gateway");
  });
});
