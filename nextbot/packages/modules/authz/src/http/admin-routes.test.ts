import { describe, expect, it, vi } from "vitest";

const simulateMock = vi.fn();
vi.mock("../application/simulate-service.js", () => ({ simulate: (...args: unknown[]) => simulateMock(...args) }));

describe("authz http/admin-routes (unit, mocked application layer)", () => {
  it("handleSimulate delegates to simulate()", async () => {
    const { handleSimulate } = await import("./admin-routes.js");
    simulateMock.mockResolvedValue({ decision: "Allow", trace: [], scopeHash: "abc" });
    const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };
    const request = { chain: [{ ref: "inline" as const, scope: { origin: "AgentVersion" as const, originId: "v1", originLabel: "v1" } }] };

    const result = await handleSimulate(ctx, request);

    expect(simulateMock).toHaveBeenCalledWith(ctx, request);
    expect(result).toEqual({ decision: "Allow", trace: [], scopeHash: "abc" });
  });
});
