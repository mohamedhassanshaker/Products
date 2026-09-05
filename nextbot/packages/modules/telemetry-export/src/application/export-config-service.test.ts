import { describe, expect, it, vi, beforeEach } from "vitest";
import { WebhookTargetUrlInvalidError } from "@nextbot/contracts";

const getOtelExportConfigMock = vi.fn();
const upsertOtelExportConfigMock = vi.fn();
const getSiemExportConfigMock = vi.fn();
const upsertSiemExportConfigMock = vi.fn();

vi.mock("../infrastructure/otel-export-config-repository.js", () => ({
  getOtelExportConfig: (...args: unknown[]) => getOtelExportConfigMock(...args),
  upsertOtelExportConfig: (...args: unknown[]) => upsertOtelExportConfigMock(...args),
}));
vi.mock("../infrastructure/siem-export-config-repository.js", () => ({
  getSiemExportConfig: (...args: unknown[]) => getSiemExportConfigMock(...args),
  upsertSiemExportConfig: (...args: unknown[]) => upsertSiemExportConfigMock(...args),
}));

const ctx = { tenantId: "tenant-1", region: "US" as const, environment: "Sandbox" as const };

describe("export-config-service (unit, mocked repositories)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getOtelExportSettings delegates to the repository", async () => {
    getOtelExportConfigMock.mockResolvedValue({ otlpEndpointUrl: "https://collector.example.com", enabled: true });
    const { getOtelExportSettings } = await import("./export-config-service.js");
    await expect(getOtelExportSettings(ctx)).resolves.toMatchObject({ enabled: true });
  });

  it("updateOtelExportSettings rejects a non-https endpoint before ever calling the repository", async () => {
    const { updateOtelExportSettings } = await import("./export-config-service.js");
    await expect(updateOtelExportSettings(ctx, { otlpEndpointUrl: "http://insecure.example.com", enabled: true })).rejects.toBeInstanceOf(WebhookTargetUrlInvalidError);
    expect(upsertOtelExportConfigMock).not.toHaveBeenCalled();
  });

  it("updateOtelExportSettings upserts a valid https endpoint", async () => {
    upsertOtelExportConfigMock.mockResolvedValue({ otlpEndpointUrl: "https://collector.example.com", enabled: true });
    const { updateOtelExportSettings } = await import("./export-config-service.js");
    await updateOtelExportSettings(ctx, { otlpEndpointUrl: "https://collector.example.com", enabled: true });
    expect(upsertOtelExportConfigMock).toHaveBeenCalledWith(ctx, { otlpEndpointUrl: "https://collector.example.com", enabled: true });
  });

  it("getSiemExportSettings delegates to the repository", async () => {
    getSiemExportConfigMock.mockResolvedValue({ endpointUrl: "https://siem.example.com", enabled: false });
    const { getSiemExportSettings } = await import("./export-config-service.js");
    await expect(getSiemExportSettings(ctx)).resolves.toMatchObject({ enabled: false });
  });

  it("updateSiemExportSettings rejects a non-https endpoint before ever calling the repository", async () => {
    const { updateSiemExportSettings } = await import("./export-config-service.js");
    await expect(updateSiemExportSettings(ctx, { endpointUrl: "not-a-url", enabled: true })).rejects.toBeInstanceOf(WebhookTargetUrlInvalidError);
    expect(upsertSiemExportConfigMock).not.toHaveBeenCalled();
  });

  it("getEffectiveOtelExportEndpoint returns the endpoint only when enabled, else null", async () => {
    getOtelExportConfigMock.mockResolvedValueOnce({ otlpEndpointUrl: "https://collector.example.com", enabled: true });
    const { getEffectiveOtelExportEndpoint } = await import("./export-config-service.js");
    await expect(getEffectiveOtelExportEndpoint(ctx)).resolves.toBe("https://collector.example.com");

    getOtelExportConfigMock.mockResolvedValueOnce({ otlpEndpointUrl: "https://collector.example.com", enabled: false });
    await expect(getEffectiveOtelExportEndpoint(ctx)).resolves.toBeNull();

    getOtelExportConfigMock.mockResolvedValueOnce(null);
    await expect(getEffectiveOtelExportEndpoint(ctx)).resolves.toBeNull();
  });
});
