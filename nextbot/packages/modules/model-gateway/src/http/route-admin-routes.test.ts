import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CreateModelRouteVersionRequest } from "@nextbot/contracts";

/**
 * A complete, valid `ModelRoutePolicy`. `ModelRoutePolicySchema` declares seven required
 * members with no schema-level defaults, so `policy: {}` does not type-check — these two
 * call sites are pure pass-through assertions (they only prove the handler forwards
 * whatever policy it was given, untouched), so any valid policy serves.
 *
 * PRE-EXISTING typecheck failure, found and repaired during Target Architecture
 * Blueprint Phase 16 (BL-47b) and disclosed rather than silently fixed: it is unrelated
 * to that phase's scope, and it was reproduced independently of every Phase 16 change
 * (the same two errors occur with Phase 16's contracts export removed).
 */
const VALID_POLICY: CreateModelRouteVersionRequest["policy"] = {
  strategy: "FixedPriority",
  failoverOn: ["429", "5xx", "timeout"],
  retry: { maxPerHop: 1, backoff: "exponential" },
  totalTimeoutMs: 30_000,
  cacheMode: "Off",
  onBudgetBreach: "Fail",
  allowOutOfRegionFailover: false,
};

const createRouteMock = vi.fn();
const listRoutesMock = vi.fn();
const getRouteOrThrowMock = vi.fn();
const listVersionsForRouteMock = vi.fn();
const createRouteVersionMock = vi.fn();
const validateRouteVersionDryRunMock = vi.fn();
const publishRouteVersionMock = vi.fn();
const getStandardRoutesChecklistMock = vi.fn();

vi.mock("../application/route-service.js", () => ({
  createRoute: (...a: unknown[]) => createRouteMock(...a),
  listRoutes: (...a: unknown[]) => listRoutesMock(...a),
  getRouteOrThrow: (...a: unknown[]) => getRouteOrThrowMock(...a),
  listVersionsForRoute: (...a: unknown[]) => listVersionsForRouteMock(...a),
  createRouteVersion: (...a: unknown[]) => createRouteVersionMock(...a),
  validateRouteVersionDryRun: (...a: unknown[]) => validateRouteVersionDryRunMock(...a),
  publishRouteVersion: (...a: unknown[]) => publishRouteVersionMock(...a),
  getStandardRoutesChecklist: (...a: unknown[]) => getStandardRoutesChecklistMock(...a),
}));

const getUsageReportMock = vi.fn();
const getCostPerResolvedConversationMock = vi.fn();
vi.mock("../application/usage-service.js", () => ({
  getUsageReport: (...a: unknown[]) => getUsageReportMock(...a),
  getCostPerResolvedConversation: (...a: unknown[]) => getCostPerResolvedConversationMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("model-gateway http/route-admin-routes (unit, mocked application layer, LLD §14.8.5)", () => {
  beforeEach(() => {
    for (const m of [
      createRouteMock,
      listRoutesMock,
      getRouteOrThrowMock,
      listVersionsForRouteMock,
      createRouteVersionMock,
      validateRouteVersionDryRunMock,
      publishRouteVersionMock,
      getStandardRoutesChecklistMock,
      getUsageReportMock,
      getCostPerResolvedConversationMock,
    ]) {
      m.mockReset();
    }
  });

  it("handleCreateRoute delegates to route-service.createRoute", async () => {
    const { handleCreateRoute } = await import("./route-admin-routes.js");
    createRouteMock.mockResolvedValue({ id: "r1" });
    const result = await handleCreateRoute(ctx, { name: "chat.primary" });
    expect(createRouteMock).toHaveBeenCalledWith(ctx, { name: "chat.primary" });
    expect(result).toEqual({ id: "r1" });
  });

  it("handleListRoutes delegates to route-service.listRoutes", async () => {
    const { handleListRoutes } = await import("./route-admin-routes.js");
    listRoutesMock.mockResolvedValue([{ id: "r1" }]);
    expect(await handleListRoutes(ctx)).toEqual([{ id: "r1" }]);
  });

  it("handleGetRoute delegates to route-service.getRouteOrThrow", async () => {
    const { handleGetRoute } = await import("./route-admin-routes.js");
    getRouteOrThrowMock.mockResolvedValue({ id: "r1" });
    expect(await handleGetRoute(ctx, "r1")).toEqual({ id: "r1" });
    expect(getRouteOrThrowMock).toHaveBeenCalledWith(ctx, "r1");
  });

  it("handleListRouteVersions delegates to route-service.listVersionsForRoute", async () => {
    const { handleListRouteVersions } = await import("./route-admin-routes.js");
    listVersionsForRouteMock.mockResolvedValue([{ id: "v1" }]);
    expect(await handleListRouteVersions(ctx, "r1")).toEqual([{ id: "v1" }]);
  });

  it("handleCreateRouteVersion passes chain/policy/createdByUserId and the request's own publish flag through to createRouteVersion", async () => {
    const { handleCreateRouteVersion } = await import("./route-admin-routes.js");
    createRouteVersionMock.mockResolvedValue({ id: "v1", status: "Published" });
    const input: CreateModelRouteVersionRequest & { publish: boolean } = {
      chain: [{ ordinal: 0, providerId: "p1", catalogEntryId: "c1", params: {}, timeoutMs: 30000 }],
      policy: VALID_POLICY,
      publish: true,
    };
    await handleCreateRouteVersion(ctx, "r1", input, "u1");
    expect(createRouteVersionMock).toHaveBeenCalledWith(ctx, "r1", { chain: input.chain, policy: input.policy, createdByUserId: "u1" }, true);
  });

  it("handleValidateRouteVersion delegates to the dry-run validator, never the save path", async () => {
    const { handleValidateRouteVersion } = await import("./route-admin-routes.js");
    validateRouteVersionDryRunMock.mockResolvedValue({ errors: [], warnings: [] });
    const input: CreateModelRouteVersionRequest = { chain: [], policy: VALID_POLICY };
    await handleValidateRouteVersion(ctx, "r1", input);
    expect(validateRouteVersionDryRunMock).toHaveBeenCalledWith(ctx, "r1", input);
    expect(createRouteVersionMock).not.toHaveBeenCalled();
  });

  it("handlePublishRouteVersion delegates to route-service.publishRouteVersion", async () => {
    const { handlePublishRouteVersion } = await import("./route-admin-routes.js");
    publishRouteVersionMock.mockResolvedValue({ id: "v1", status: "Published" });
    expect(await handlePublishRouteVersion(ctx, "r1", "v1")).toEqual({ id: "v1", status: "Published" });
  });

  it("handleGetStandardRoutes delegates to route-service.getStandardRoutesChecklist", async () => {
    const { handleGetStandardRoutes } = await import("./route-admin-routes.js");
    getStandardRoutesChecklistMock.mockResolvedValue([{ role: "chat.primary", configured: false, routeId: null }]);
    expect(await handleGetStandardRoutes(ctx)).toEqual([{ role: "chat.primary", configured: false, routeId: null }]);
  });

  it("handleGetUsageReport parses from/to into Date objects and forwards groupBy", async () => {
    const { handleGetUsageReport } = await import("./route-admin-routes.js");
    getUsageReportMock.mockResolvedValue([]);
    await handleGetUsageReport(ctx, { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z", groupBy: "provider" });
    const call = getUsageReportMock.mock.calls[0]!;
    expect(call[0]).toBe(ctx);
    expect(call[1].from).toBeInstanceOf(Date);
    expect(call[1].to).toBeInstanceOf(Date);
    expect(call[1].groupBy).toBe("provider");
  });

  it("handleGetCostPerResolvedConversation parses from/to into Date objects", async () => {
    const { handleGetCostPerResolvedConversation } = await import("./route-admin-routes.js");
    getCostPerResolvedConversationMock.mockResolvedValue({ totalCostUsd: 0, conversationCount: 0, costPerConversation: null });
    await handleGetCostPerResolvedConversation(ctx, { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z" });
    const call = getCostPerResolvedConversationMock.mock.calls[0]!;
    expect(call[1].from).toBeInstanceOf(Date);
    expect(call[1].to).toBeInstanceOf(Date);
  });
});
