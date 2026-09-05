import { describe, expect, it, vi, beforeEach } from "vitest";

const getOtelExportConfigMock = vi.fn();
const getAgentRunMetricsSnapshotMock = vi.fn();
const exportTenantMetricsSnapshotMock = vi.fn();
const listActiveTenantContextsMock = vi.fn();

vi.mock("../infrastructure/otel-export-config-repository.js", () => ({
  getOtelExportConfig: (...args: unknown[]) => getOtelExportConfigMock(...args),
}));
vi.mock("../infrastructure/agent-run-metrics-reader.js", () => ({
  getAgentRunMetricsSnapshot: (...args: unknown[]) => getAgentRunMetricsSnapshotMock(...args),
}));
vi.mock("@nextbot/observability", () => ({
  exportTenantMetricsSnapshot: (...args: unknown[]) => exportTenantMetricsSnapshotMock(...args),
}));
vi.mock("@nextbot/tenancy", () => ({
  listActiveTenantContexts: (...args: unknown[]) => listActiveTenantContextsMock(...args),
}));

const ctx = { tenantId: "tenant-1", region: "US" as const, environment: "Sandbox" as const };

describe("otel-metrics-export-service (unit, mocked infra/SDK)", () => {
  // `resetAllMocks` (not merely `clearAllMocks`) — a prior test's `mockRejectedValue`
  // on `exportTenantMetricsSnapshotMock` must not leak its IMPLEMENTATION into a
  // later test that expects the happy path.
  beforeEach(() => vi.resetAllMocks());

  it("is a no-op when the tenant has no OTel export config at all", async () => {
    getOtelExportConfigMock.mockResolvedValue(null);
    const { exportOtelMetricsForTenant } = await import("./otel-metrics-export-service.js");
    await expect(exportOtelMetricsForTenant(ctx)).resolves.toEqual({ exported: false });
    expect(exportTenantMetricsSnapshotMock).not.toHaveBeenCalled();
  });

  it("is a no-op when export is configured but disabled", async () => {
    getOtelExportConfigMock.mockResolvedValue({ otlpEndpointUrl: "https://collector.example.com", enabled: false });
    const { exportOtelMetricsForTenant } = await import("./otel-metrics-export-service.js");
    await expect(exportOtelMetricsForTenant(ctx)).resolves.toEqual({ exported: false });
    expect(exportTenantMetricsSnapshotMock).not.toHaveBeenCalled();
  });

  it("is a no-op when enabled but there was zero real activity in the window (avoids all-zero noise)", async () => {
    getOtelExportConfigMock.mockResolvedValue({ otlpEndpointUrl: "https://collector.example.com", enabled: true });
    getAgentRunMetricsSnapshotMock.mockResolvedValue({ succeededCount: 0, failedCount: 0, avgDurationMs: null, totalCostUsd: null });
    const { exportOtelMetricsForTenant } = await import("./otel-metrics-export-service.js");
    await expect(exportOtelMetricsForTenant(ctx)).resolves.toEqual({ exported: false });
    expect(exportTenantMetricsSnapshotMock).not.toHaveBeenCalled();
  });

  it("pushes a real snapshot (including optional duration/cost metrics) when enabled and there is real activity", async () => {
    getOtelExportConfigMock.mockResolvedValue({ otlpEndpointUrl: "https://collector.example.com", enabled: true });
    getAgentRunMetricsSnapshotMock.mockResolvedValue({ succeededCount: 3, failedCount: 1, avgDurationMs: 250, totalCostUsd: 0.42 });
    const { exportOtelMetricsForTenant } = await import("./otel-metrics-export-service.js");
    await expect(exportOtelMetricsForTenant(ctx)).resolves.toEqual({ exported: true });
    expect(exportTenantMetricsSnapshotMock).toHaveBeenCalledWith(
      "https://collector.example.com",
      expect.arrayContaining([
        { name: "nextbot.agent_run.succeeded_count", value: 3 },
        { name: "nextbot.agent_run.failed_count", value: 1 },
        { name: "nextbot.agent_run.avg_duration_ms", value: 250, unit: "ms" },
        { name: "nextbot.agent_run.total_cost_usd", value: 0.42, unit: "usd" },
      ]),
    );
  });

  it("fails safe (never throws) when the real export call rejects", async () => {
    getOtelExportConfigMock.mockResolvedValue({ otlpEndpointUrl: "https://collector.example.com", enabled: true });
    getAgentRunMetricsSnapshotMock.mockResolvedValue({ succeededCount: 1, failedCount: 0, avgDurationMs: null, totalCostUsd: null });
    exportTenantMetricsSnapshotMock.mockRejectedValue(new Error("collector unreachable"));
    const { exportOtelMetricsForTenant } = await import("./otel-metrics-export-service.js");
    await expect(exportOtelMetricsForTenant(ctx)).resolves.toEqual({ exported: false });
  });

  it("exportOtelMetricsAcrossAllTenants sweeps every active tenant and counts real exports", async () => {
    listActiveTenantContextsMock.mockResolvedValue([ctx, { ...ctx, tenantId: "tenant-2" }]);
    getOtelExportConfigMock.mockResolvedValueOnce({ otlpEndpointUrl: "https://collector.example.com", enabled: true }).mockResolvedValueOnce(null);
    getAgentRunMetricsSnapshotMock.mockResolvedValue({ succeededCount: 1, failedCount: 0, avgDurationMs: null, totalCostUsd: null });
    const { exportOtelMetricsAcrossAllTenants } = await import("./otel-metrics-export-service.js");
    await expect(exportOtelMetricsAcrossAllTenants()).resolves.toEqual({ tenantsChecked: 2, exported: 1 });
  });
});
