import { describe, expect, it, vi, beforeEach } from "vitest";

const findConversationIdsOlderThan = vi.fn();
const deleteConversationsByIds = vi.fn();
const redactRawPiiOlderThan = vi.fn();
const redactToolCallPayloadsOlderThan = vi.fn();
const purgeToolCallMetadataOlderThan = vi.fn();
const deleteToolCallsByConversationIds = vi.fn();
const deleteEscalationsByConversationIds = vi.fn();
const computePurgeCutoff = vi.fn();
const getTenantDataPolicy = vi.fn();
const listActiveTenantContexts = vi.fn();
const markPurgeRun = vi.fn();

vi.mock("@nextbot/conversations", () => ({
  findConversationIdsOlderThan: (...args: unknown[]) => findConversationIdsOlderThan(...args),
  deleteConversationsByIds: (...args: unknown[]) => deleteConversationsByIds(...args),
  redactRawPiiOlderThan: (...args: unknown[]) => redactRawPiiOlderThan(...args),
}));
vi.mock("@nextbot/approvals", () => ({
  redactToolCallPayloadsOlderThan: (...args: unknown[]) => redactToolCallPayloadsOlderThan(...args),
  purgeToolCallMetadataOlderThan: (...args: unknown[]) => purgeToolCallMetadataOlderThan(...args),
  deleteToolCallsByConversationIds: (...args: unknown[]) => deleteToolCallsByConversationIds(...args),
}));
vi.mock("@nextbot/escalations", () => ({
  deleteEscalationsByConversationIds: (...args: unknown[]) => deleteEscalationsByConversationIds(...args),
}));
vi.mock("@nextbot/tenancy", () => ({
  computePurgeCutoff: (...args: unknown[]) => computePurgeCutoff(...args),
  getTenantDataPolicy: (...args: unknown[]) => getTenantDataPolicy(...args),
  listActiveTenantContexts: (...args: unknown[]) => listActiveTenantContexts(...args),
  markPurgeRun: (...args: unknown[]) => markPurgeRun(...args),
}));

const { runRetentionPurgeSweep } = await import("./retention-purge.js");

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };
const cutoffDate = new Date("2020-01-01T00:00:00Z");

describe("runRetentionPurgeSweep (QA fix BE-2 — all four tenant_data_policy categories)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listActiveTenantContexts.mockResolvedValue([ctx]);
    getTenantDataPolicy.mockResolvedValue({
      retentionTranscriptsDays: 90,
      retentionToolPayloadsDays: 30,
      retentionToolMetadataDays: 180,
      retentionPiiDays: 14,
    });
    computePurgeCutoff.mockImplementation((days: number) => (days === -1 ? null : cutoffDate));
    findConversationIdsOlderThan.mockResolvedValue(["c1", "c2"]);
    deleteConversationsByIds.mockResolvedValue(2);
    deleteToolCallsByConversationIds.mockResolvedValue(0);
    deleteEscalationsByConversationIds.mockResolvedValue(0);
    redactToolCallPayloadsOlderThan.mockResolvedValue(3);
    purgeToolCallMetadataOlderThan.mockResolvedValue(1);
    redactRawPiiOlderThan.mockResolvedValue(4);
  });

  it("enforces all four categories independently, each against its own configured cutoff", async () => {
    const result = await runRetentionPurgeSweep();

    expect(findConversationIdsOlderThan).toHaveBeenCalledWith(ctx, cutoffDate);
    expect(deleteConversationsByIds).toHaveBeenCalledWith(ctx, ["c1", "c2"]);
    expect(redactToolCallPayloadsOlderThan).toHaveBeenCalledWith(ctx, cutoffDate);
    expect(purgeToolCallMetadataOlderThan).toHaveBeenCalledWith(ctx, cutoffDate);
    expect(redactRawPiiOlderThan).toHaveBeenCalledWith(ctx, cutoffDate);

    expect(result).toEqual({
      tenantsChecked: 1,
      tenantsPurged: 1,
      conversationsDeleted: 2,
      toolCallPayloadsRedacted: 3,
      toolCallsPurged: 1,
      piiFieldsRedacted: 4,
    });
    expect(markPurgeRun).toHaveBeenCalledWith(ctx);
  });

  it("deletes referencing tool_call/escalation rows before deleting the aged conversations themselves (Defect A)", async () => {
    const callOrder: string[] = [];
    deleteToolCallsByConversationIds.mockImplementation(async () => {
      callOrder.push("toolCalls");
      return 1;
    });
    deleteEscalationsByConversationIds.mockImplementation(async () => {
      callOrder.push("escalations");
      return 1;
    });
    deleteConversationsByIds.mockImplementation(async () => {
      callOrder.push("conversations");
      return 2;
    });

    await runRetentionPurgeSweep();

    expect(deleteToolCallsByConversationIds).toHaveBeenCalledWith(ctx, ["c1", "c2"]);
    expect(deleteEscalationsByConversationIds).toHaveBeenCalledWith(ctx, ["c1", "c2"]);
    expect(callOrder).toEqual(["toolCalls", "escalations", "conversations"]);
  });

  it("skips the transcripts delete entirely (no tool-call/escalation lookups either) when there are no aged conversations", async () => {
    findConversationIdsOlderThan.mockResolvedValue([]);

    const result = await runRetentionPurgeSweep();

    expect(deleteToolCallsByConversationIds).not.toHaveBeenCalled();
    expect(deleteEscalationsByConversationIds).not.toHaveBeenCalled();
    expect(deleteConversationsByIds).not.toHaveBeenCalled();
    expect(result.conversationsDeleted).toBe(0);
  });

  it("skips a category whose configured retention is Indefinite (-1) without touching the others", async () => {
    getTenantDataPolicy.mockResolvedValue({
      retentionTranscriptsDays: -1,
      retentionToolPayloadsDays: 30,
      retentionToolMetadataDays: 180,
      retentionPiiDays: 14,
    });
    computePurgeCutoff.mockImplementation((days: number) => (days === -1 ? null : cutoffDate));

    const result = await runRetentionPurgeSweep();

    expect(findConversationIdsOlderThan).not.toHaveBeenCalled();
    expect(redactToolCallPayloadsOlderThan).toHaveBeenCalled();
    expect(purgeToolCallMetadataOlderThan).toHaveBeenCalled();
    expect(redactRawPiiOlderThan).toHaveBeenCalled();
    expect(result.conversationsDeleted).toBe(0);
  });

  it("skips a tenant with no data policy row without throwing", async () => {
    getTenantDataPolicy.mockResolvedValue(null);
    const result = await runRetentionPurgeSweep();
    expect(result.tenantsPurged).toBe(0);
    expect(findConversationIdsOlderThan).not.toHaveBeenCalled();
    expect(markPurgeRun).not.toHaveBeenCalled();
  });

  it("logs and continues to the next tenant when one tenant's sweep throws (Defect A compounding issue)", async () => {
    const ctx2 = { tenantId: "t2", region: "US" as const, environment: "Sandbox" as const };
    listActiveTenantContexts.mockResolvedValue([ctx, ctx2]);
    getTenantDataPolicy.mockImplementation(async (c: typeof ctx) =>
      c.tenantId === "t1"
        ? { retentionTranscriptsDays: 90, retentionToolPayloadsDays: 30, retentionToolMetadataDays: 180, retentionPiiDays: 14 }
        : { retentionTranscriptsDays: 90, retentionToolPayloadsDays: 30, retentionToolMetadataDays: 180, retentionPiiDays: 14 },
    );
    // Tenant t1's transcript-category delete throws (e.g. an FK violation);
    // tenant t2 must still be processed and marked done.
    let call = 0;
    deleteConversationsByIds.mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new Error("simulated FK violation");
      return 2;
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runRetentionPurgeSweep();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('tenant "t1"'), expect.any(Error));
    // t1's markPurgeRun must NOT fire (so the same aged data retries next tick).
    expect(markPurgeRun).not.toHaveBeenCalledWith(ctx);
    // t2 must still be processed and marked done.
    expect(markPurgeRun).toHaveBeenCalledWith(ctx2);
    expect(result.tenantsChecked).toBe(2);

    consoleErrorSpy.mockRestore();
  });
});
