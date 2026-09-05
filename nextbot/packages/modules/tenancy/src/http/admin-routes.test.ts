import { describe, expect, it, vi, beforeEach } from "vitest";

const getTenantBrandingMock = vi.fn();
const updateBrandingMock = vi.fn();

vi.mock("../application/tenant-branding.js", () => ({
  getTenantBranding: (...a: unknown[]) => getTenantBrandingMock(...a),
}));
vi.mock("../application/update-branding.js", () => ({
  updateBranding: (...a: unknown[]) => updateBrandingMock(...a),
}));

describe("tenancy http/admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    getTenantBrandingMock.mockReset();
    updateBrandingMock.mockReset();
  });

  it("handleGetBranding delegates to getTenantBranding", async () => {
    getTenantBrandingMock.mockResolvedValue({ brandingConfig: null, whiteLabelEnabled: false });
    const { handleGetBranding } = await import("./admin-routes.js");
    const result = await handleGetBranding("t1");
    expect(result).toEqual({ brandingConfig: null, whiteLabelEnabled: false });
    expect(getTenantBrandingMock).toHaveBeenCalledWith("t1");
  });

  it("handleUpdateBranding validates+persists via updateBranding, then returns the fresh read", async () => {
    updateBrandingMock.mockResolvedValue(undefined);
    getTenantBrandingMock.mockResolvedValue({ brandingConfig: { primaryColor: "#4f46e5" }, whiteLabelEnabled: true });
    const { handleUpdateBranding } = await import("./admin-routes.js");
    const input = { branding: { primaryColor: "#4f46e5" } } as never;
    const result = await handleUpdateBranding("t1", input);
    expect(updateBrandingMock).toHaveBeenCalledWith("t1", input);
    expect(getTenantBrandingMock).toHaveBeenCalledWith("t1");
    expect(result).toEqual({ brandingConfig: { primaryColor: "#4f46e5" }, whiteLabelEnabled: true });
  });

  it("handleUpdateBranding propagates a validation failure without calling getTenantBranding", async () => {
    updateBrandingMock.mockRejectedValue(new Error("contrast failure"));
    const { handleUpdateBranding } = await import("./admin-routes.js");
    await expect(handleUpdateBranding("t1", { branding: {} } as never)).rejects.toThrow("contrast failure");
    expect(getTenantBrandingMock).not.toHaveBeenCalled();
  });
});
