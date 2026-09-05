import { describe, expect, it, vi, beforeEach } from "vitest";

const listOwnProvidersForTenantMock = vi.fn();

vi.mock("../infrastructure/model-gateway-repository.js", () => ({
  listOwnProvidersForTenant: (...a: unknown[]) => listOwnProvidersForTenantMock(...a),
  getProvider: vi.fn(),
  setProviderStatus: vi.fn(),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

function provider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    enabled: true,
    lastProbeAt: null,
    healthIntervalSeconds: 300,
    ...overrides,
  };
}

describe("listProvidersDueForProbe — cadence filtering (LLD §14.8.3)", () => {
  beforeEach(() => {
    listOwnProvidersForTenantMock.mockReset();
  });

  it("excludes a disabled provider", async () => {
    listOwnProvidersForTenantMock.mockResolvedValue([provider({ enabled: false })]);
    const { listProvidersDueForProbe } = await import("./provider-probe-service.js");
    expect(await listProvidersDueForProbe(ctx)).toEqual([]);
  });

  it("includes a provider that has never been probed", async () => {
    listOwnProvidersForTenantMock.mockResolvedValue([provider({ lastProbeAt: null })]);
    const { listProvidersDueForProbe } = await import("./provider-probe-service.js");
    expect(await listProvidersDueForProbe(ctx)).toHaveLength(1);
  });

  it("excludes a provider probed more recently than its health_interval_seconds", async () => {
    const now = new Date("2026-01-01T00:10:00Z");
    listOwnProvidersForTenantMock.mockResolvedValue([
      provider({ lastProbeAt: new Date("2026-01-01T00:09:00Z"), healthIntervalSeconds: 300 }),
    ]);
    const { listProvidersDueForProbe } = await import("./provider-probe-service.js");
    expect(await listProvidersDueForProbe(ctx, now)).toEqual([]);
  });

  it("includes a provider whose health_interval_seconds has elapsed since its last probe", async () => {
    const now = new Date("2026-01-01T00:10:00Z");
    listOwnProvidersForTenantMock.mockResolvedValue([
      provider({ lastProbeAt: new Date("2026-01-01T00:00:00Z"), healthIntervalSeconds: 300 }),
    ]);
    const { listProvidersDueForProbe } = await import("./provider-probe-service.js");
    expect(await listProvidersDueForProbe(ctx, now)).toHaveLength(1);
  });
});
