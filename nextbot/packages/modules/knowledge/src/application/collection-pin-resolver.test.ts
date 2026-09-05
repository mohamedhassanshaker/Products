import { describe, expect, it, vi, beforeEach } from "vitest";

const getCollectionByNameMock = vi.fn();
vi.mock("../infrastructure/collection-repository.js", () => ({
  getCollectionByName: (...a: unknown[]) => getCollectionByNameMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("resolveKnowledgeCollectionPin (unit, mocked repository)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("splits a '<name>@<N>' pin on the LAST '@' and resolves the name half to a real id", async () => {
    getCollectionByNameMock.mockResolvedValue({ id: "col-1", name: "billing_policy" });
    const { resolveKnowledgeCollectionPin } = await import("./collection-pin-resolver.js");
    const result = await resolveKnowledgeCollectionPin(ctx, "billing_policy@12");
    expect(result).toEqual({ collectionId: "col-1", collectionName: "billing_policy" });
    expect(getCollectionByNameMock).toHaveBeenCalledWith(ctx, "billing_policy");
  });

  it("throws KnowledgeCollectionNotFoundError (never silently dangling) when the name half doesn't resolve", async () => {
    getCollectionByNameMock.mockResolvedValue(null);
    const { resolveKnowledgeCollectionPin } = await import("./collection-pin-resolver.js");
    await expect(resolveKnowledgeCollectionPin(ctx, "does_not_exist@1")).rejects.toMatchObject({ code: "KNOWLEDGE_COLLECTION_NOT_FOUND" });
  });

  it("treats a pin with no '@' at all as the whole string being the name (defensive, not the documented shape)", async () => {
    getCollectionByNameMock.mockResolvedValue({ id: "col-2", name: "no_at_sign" });
    const { resolveKnowledgeCollectionPin } = await import("./collection-pin-resolver.js");
    const result = await resolveKnowledgeCollectionPin(ctx, "no_at_sign");
    expect(result.collectionId).toBe("col-2");
    expect(getCollectionByNameMock).toHaveBeenCalledWith(ctx, "no_at_sign");
  });
});
