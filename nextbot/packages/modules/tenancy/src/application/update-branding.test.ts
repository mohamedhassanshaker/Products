import { describe, expect, it, vi, beforeEach } from "vitest";
import { BrandingContrastInsufficientError } from "@nextbot/contracts";

const updateTenantBrandingMock = vi.fn();
vi.mock("./tenant-branding.js", () => ({
  updateTenantBranding: (...a: unknown[]) => updateTenantBrandingMock(...a),
}));

const VALID_BRANDING = {
  primaryColor: "#1B6B4A",
  secondaryColor: "#0E3B28",
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  fontFamily: null,
};

describe("updateBranding (FR-ADM-07 contrast gate)", () => {
  beforeEach(() => {
    updateTenantBrandingMock.mockReset();
  });

  it("persists a color where white widget text passes AA on it", async () => {
    const { updateBranding } = await import("./update-branding.js");
    await updateBranding("t1", { branding: VALID_BRANDING });
    expect(updateTenantBrandingMock).toHaveBeenCalledWith("t1", { brandingConfig: VALID_BRANDING, whiteLabelEnabled: undefined });
  });

  it("rejects a primaryColor where white widget text fails AA on it (a mid-gray dead zone)", async () => {
    const { updateBranding } = await import("./update-branding.js");
    await expect(
      updateBranding("t1", { branding: { ...VALID_BRANDING, primaryColor: "#7D7D7D" } }),
    ).rejects.toThrow(BrandingContrastInsufficientError);
    expect(updateTenantBrandingMock).not.toHaveBeenCalled();
  });

  it("rejects a washed-out near-white color even though dark text would read fine on it (D5 regression — the widget never renders dark text)", async () => {
    const { updateBranding } = await import("./update-branding.js");
    // #FFFACD (light yellow) is illegible as a background for the widget's actual
    // *white* header/launcher text, even though a hypothetical dark-text treatment
    // (which this product never renders) would read fine on it — the gate must
    // reject it, not accept it on the strength of a text color the widget doesn't
    // use.
    await expect(
      updateBranding("t1", { branding: { ...VALID_BRANDING, primaryColor: "#FFFACD" } }),
    ).rejects.toThrow(BrandingContrastInsufficientError);
  });

  it("rejects the exact near-white color QA found slipping through pre-fix (#f5f5f5)", async () => {
    const { updateBranding } = await import("./update-branding.js");
    await expect(
      updateBranding("t1", { branding: { ...VALID_BRANDING, primaryColor: "#f5f5f5" } }),
    ).rejects.toThrow(BrandingContrastInsufficientError);
    expect(updateTenantBrandingMock).not.toHaveBeenCalled();
  });

  it("rejects a secondaryColor landing in the same mid-gray dead zone", async () => {
    const { updateBranding } = await import("./update-branding.js");
    await expect(
      updateBranding("t1", { branding: { ...VALID_BRANDING, secondaryColor: "#7D7D7D" } }),
    ).rejects.toThrow(BrandingContrastInsufficientError);
  });

  it("names the failing field in the thrown error", async () => {
    const { updateBranding } = await import("./update-branding.js");
    try {
      await updateBranding("t1", { branding: { ...VALID_BRANDING, primaryColor: "#7D7D7D" } });
      expect.fail("expected updateBranding to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BrandingContrastInsufficientError);
      expect((err as BrandingContrastInsufficientError).fields?.[0]?.path).toBe("primaryColor");
    }
  });
});
