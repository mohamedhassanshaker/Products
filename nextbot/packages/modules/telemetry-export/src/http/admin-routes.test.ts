import { describe, expect, it, vi } from "vitest";

const getOtelExportSettingsMock = vi.fn();
const updateOtelExportSettingsMock = vi.fn();
const getSiemExportSettingsMock = vi.fn();
const updateSiemExportSettingsMock = vi.fn();

vi.mock("../application/export-config-service.js", () => ({
  getOtelExportSettings: (...args: unknown[]) => getOtelExportSettingsMock(...args),
  updateOtelExportSettings: (...args: unknown[]) => updateOtelExportSettingsMock(...args),
  getSiemExportSettings: (...args: unknown[]) => getSiemExportSettingsMock(...args),
  updateSiemExportSettings: (...args: unknown[]) => updateSiemExportSettingsMock(...args),
}));

const ctx = { tenantId: "tenant-1", region: "US" as const, environment: "Sandbox" as const };

describe("telemetry-export http/admin-routes (unit, mocked application layer)", () => {
  it("handleGetOtelExportConfig delegates to getOtelExportSettings", async () => {
    getOtelExportSettingsMock.mockResolvedValue({ enabled: true });
    const { handleGetOtelExportConfig } = await import("./admin-routes.js");
    await expect(handleGetOtelExportConfig(ctx)).resolves.toEqual({ enabled: true });
  });

  it("handleUpdateOtelExportConfig delegates to updateOtelExportSettings", async () => {
    updateOtelExportSettingsMock.mockResolvedValue({ enabled: false });
    const { handleUpdateOtelExportConfig } = await import("./admin-routes.js");
    await handleUpdateOtelExportConfig(ctx, { otlpEndpointUrl: "https://collector.example.com", enabled: false });
    expect(updateOtelExportSettingsMock).toHaveBeenCalledWith(ctx, { otlpEndpointUrl: "https://collector.example.com", enabled: false });
  });

  it("handleGetSiemExportConfig delegates to getSiemExportSettings", async () => {
    getSiemExportSettingsMock.mockResolvedValue({ enabled: true });
    const { handleGetSiemExportConfig } = await import("./admin-routes.js");
    await expect(handleGetSiemExportConfig(ctx)).resolves.toEqual({ enabled: true });
  });

  it("handleUpdateSiemExportConfig delegates to updateSiemExportSettings", async () => {
    updateSiemExportSettingsMock.mockResolvedValue({ enabled: true });
    const { handleUpdateSiemExportConfig } = await import("./admin-routes.js");
    await handleUpdateSiemExportConfig(ctx, { endpointUrl: "https://siem.example.com", enabled: true });
    expect(updateSiemExportSettingsMock).toHaveBeenCalledWith(ctx, { endpointUrl: "https://siem.example.com", enabled: true });
  });
});
