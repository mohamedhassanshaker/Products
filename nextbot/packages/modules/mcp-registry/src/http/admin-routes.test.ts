import { describe, expect, it, vi, beforeEach } from "vitest";

const createServerWithApprovedVersionMock = vi.fn();
const getServerMock = vi.fn();
const listBindingsForVersionMock = vi.fn();
const listServersMock = vi.fn();
const listServerVersionsMock = vi.fn();
const listPendingDriftEventsMock = vi.fn();
const reviewDriftMock = vi.fn();

const reconcileServerMock = vi.fn();
const migrateExistingConnectorsForTenantMock = vi.fn();

const createDraftMock = vi.fn();
const getEnrolmentDraftMock = vi.fn();
const deleteEnrolmentDraftMock = vi.fn();
const submitIdentifyMock = vi.fn();
const submitTransportMock = vi.fn();
const submitAuthMock = vi.fn();
const submitDiscoverMock = vi.fn();
const submitClassifyMock = vi.fn();
const submitGroupingMock = vi.fn();
const submitPolicyMock = vi.fn();
const submitDryRunMock = vi.fn();
const submitEnrolMock = vi.fn();

vi.mock("../infrastructure/mcp-server-repository.js", () => ({
  createServerWithApprovedVersion: (...a: unknown[]) => createServerWithApprovedVersionMock(...a),
  getServer: (...a: unknown[]) => getServerMock(...a),
  listBindingsForVersion: (...a: unknown[]) => listBindingsForVersionMock(...a),
  listServers: (...a: unknown[]) => listServersMock(...a),
  listServerVersions: (...a: unknown[]) => listServerVersionsMock(...a),
  listPendingDriftEvents: (...a: unknown[]) => listPendingDriftEventsMock(...a),
  reviewDrift: (...a: unknown[]) => reviewDriftMock(...a),
}));
vi.mock("../application/reconciler.js", () => ({
  reconcileServer: (...a: unknown[]) => reconcileServerMock(...a),
}));
vi.mock("../application/connector-migration.js", () => ({
  migrateExistingConnectorsForTenant: (...a: unknown[]) => migrateExistingConnectorsForTenantMock(...a),
}));
vi.mock("../application/enrolment-draft-service.js", () => ({
  createDraft: (...a: unknown[]) => createDraftMock(...a),
  getEnrolmentDraft: (...a: unknown[]) => getEnrolmentDraftMock(...a),
  deleteEnrolmentDraft: (...a: unknown[]) => deleteEnrolmentDraftMock(...a),
  submitIdentify: (...a: unknown[]) => submitIdentifyMock(...a),
  submitTransport: (...a: unknown[]) => submitTransportMock(...a),
  submitAuth: (...a: unknown[]) => submitAuthMock(...a),
  submitDiscover: (...a: unknown[]) => submitDiscoverMock(...a),
  submitClassify: (...a: unknown[]) => submitClassifyMock(...a),
  submitGrouping: (...a: unknown[]) => submitGroupingMock(...a),
  submitPolicy: (...a: unknown[]) => submitPolicyMock(...a),
  submitDryRun: (...a: unknown[]) => submitDryRunMock(...a),
  submitEnrol: (...a: unknown[]) => submitEnrolMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("mcp-registry http/admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Phase 0 handlers delegate to the repository/reconciler unchanged", async () => {
    const {
      handleCreateServer,
      handleGetServer,
      handleReconcileServer,
      handleListPendingDrift,
      handleReviewDrift,
      handleListServers,
      handleListServerVersions,
      handleListBindingsForVersion,
      handleMigrateExistingConnectors,
    } = await import("./admin-routes.js");

    createServerWithApprovedVersionMock.mockResolvedValue({ server: { id: "s1" }, serverVersionId: "v1" });
    await handleCreateServer(ctx, { name: "n", endpointUrl: "https://x", items: [] }, "user-1");
    expect(createServerWithApprovedVersionMock).toHaveBeenCalledWith(ctx, expect.objectContaining({ name: "n", createdByUserId: "user-1" }));

    getServerMock.mockResolvedValue({ id: "s1" });
    expect(await handleGetServer(ctx, "s1")).toEqual({ id: "s1" });

    getServerMock.mockResolvedValueOnce({ id: "s1" });
    reconcileServerMock.mockResolvedValue({ outcome: "NoChange" });
    expect(await handleReconcileServer(ctx, "s1")).toEqual({ outcome: "NoChange" });

    getServerMock.mockResolvedValueOnce(null);
    await expect(handleReconcileServer(ctx, "missing")).rejects.toThrow();

    listPendingDriftEventsMock.mockResolvedValue([{ id: "d1" }]);
    expect(await handleListPendingDrift(ctx, "s1")).toEqual([{ id: "d1" }]);

    reviewDriftMock.mockResolvedValue({ accepted: 1, rejected: 0, newServerVersionId: "v2" });
    await handleReviewDrift(ctx, "s1", [{ driftEventId: "d1", action: "Accept" }], "user-1");
    expect(reviewDriftMock).toHaveBeenCalledWith(ctx, "s1", [{ driftEventId: "d1", action: "Accept" }], "user-1");

    listServersMock.mockResolvedValue([{ id: "s1" }]);
    expect(await handleListServers(ctx)).toEqual([{ id: "s1" }]);

    listServerVersionsMock.mockResolvedValue([{ id: "v1" }]);
    expect(await handleListServerVersions(ctx, "s1")).toEqual([{ id: "v1" }]);

    listBindingsForVersionMock.mockResolvedValue([{ id: "b1" }]);
    expect(await handleListBindingsForVersion(ctx, "v1")).toEqual([{ id: "b1" }]);

    migrateExistingConnectorsForTenantMock.mockResolvedValue({ serversCreated: 1, bindingsCreated: 2, connectorsSkippedAlreadyBound: 0 });
    expect(await handleMigrateExistingConnectors(ctx, "user-1")).toEqual({ serversCreated: 1, bindingsCreated: 2, connectorsSkippedAlreadyBound: 0 });
  });

  it("wizard handlers delegate to the enrolment-draft-service unchanged", async () => {
    const {
      handleCreateDraft,
      handleGetDraft,
      handleDeleteDraft,
      handleSubmitIdentify,
      handleSubmitTransport,
      handleSubmitAuth,
      handleSubmitDiscover,
      handleSubmitClassify,
      handleSubmitGrouping,
      handleSubmitPolicy,
      handleSubmitDryRun,
      handleSubmitEnrol,
    } = await import("./admin-routes.js");

    createDraftMock.mockResolvedValue({ id: "draft-1", step: 1 });
    expect(await handleCreateDraft(ctx, "user-1")).toEqual({ id: "draft-1", step: 1 });
    expect(createDraftMock).toHaveBeenCalledWith(ctx, "user-1");

    getEnrolmentDraftMock.mockResolvedValue({ id: "draft-1" });
    expect(await handleGetDraft(ctx, "draft-1")).toEqual({ id: "draft-1" });

    deleteEnrolmentDraftMock.mockResolvedValue(undefined);
    await handleDeleteDraft(ctx, "draft-1");
    expect(deleteEnrolmentDraftMock).toHaveBeenCalledWith(ctx, "draft-1");

    const identifyInput = { name: "n", backendType: "Custom", ownerUserId: "u1", criticality: "Medium" } as never;
    submitIdentifyMock.mockResolvedValue({ id: "draft-1", step: 2 });
    await handleSubmitIdentify(ctx, "draft-1", identifyInput);
    expect(submitIdentifyMock).toHaveBeenCalledWith(ctx, "draft-1", identifyInput);

    const transportInput = { bindings: [] } as never;
    submitTransportMock.mockResolvedValue({ step: 3 });
    await handleSubmitTransport(ctx, "draft-1", transportInput);
    expect(submitTransportMock).toHaveBeenCalledWith(ctx, "draft-1", transportInput);

    const authInput = { bindings: [] } as never;
    submitAuthMock.mockResolvedValue({ step: 4 });
    await handleSubmitAuth(ctx, "draft-1", authInput);
    expect(submitAuthMock).toHaveBeenCalledWith(ctx, "draft-1", authInput);

    submitDiscoverMock.mockResolvedValue({ draft: {}, response: { itemCount: 0 } });
    expect(await handleSubmitDiscover(ctx, "draft-1")).toEqual({ draft: {}, response: { itemCount: 0 } });

    const classifyInput = { items: [] } as never;
    submitClassifyMock.mockResolvedValue({ step: 6 });
    await handleSubmitClassify(ctx, "draft-1", classifyInput);
    expect(submitClassifyMock).toHaveBeenCalledWith(ctx, "draft-1", classifyInput);

    const groupingInput = { items: [] } as never;
    submitGroupingMock.mockResolvedValue({ step: 7 });
    await handleSubmitGrouping(ctx, "draft-1", groupingInput);
    expect(submitGroupingMock).toHaveBeenCalledWith(ctx, "draft-1", groupingInput);

    const policyInput = { timeoutMs: 15000, retryMax: 1, retryBackoff: "none", circuitErrorRatePct: 5, circuitOpenSeconds: 60, egressAllowlist: [] } as never;
    submitPolicyMock.mockResolvedValue({ step: 8 });
    await handleSubmitPolicy(ctx, "draft-1", policyInput);
    expect(submitPolicyMock).toHaveBeenCalledWith(ctx, "draft-1", policyInput);

    const dryRunInput = { toolName: "get_order", environment: "Sandbox" } as never;
    submitDryRunMock.mockResolvedValue({ draft: {}, response: { rawResult: {} } });
    expect(await handleSubmitDryRun(ctx, "draft-1", dryRunInput)).toEqual({ draft: {}, response: { rawResult: {} } });

    submitEnrolMock.mockResolvedValue({ serverId: "s1" });
    expect(await handleSubmitEnrol(ctx, "draft-1", "user-1")).toEqual({ serverId: "s1" });
    expect(submitEnrolMock).toHaveBeenCalledWith(ctx, "draft-1", "user-1");
  });
});
