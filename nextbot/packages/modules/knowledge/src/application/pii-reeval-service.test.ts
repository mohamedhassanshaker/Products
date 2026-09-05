import { describe, expect, it, vi, beforeEach } from "vitest";

const getUploadMock = vi.fn();
vi.mock("../infrastructure/upload-store.js", () => ({
  getUpload: (...a: unknown[]) => getUploadMock(...a),
}));

const detectAndMaskMock = vi.fn();
const buildPolicyLookupMock = vi.fn();
const listCustomPiiRulesForMaskingMock = vi.fn();
vi.mock("@nextbot/pii", () => ({
  detectAndMask: (...a: unknown[]) => detectAndMaskMock(...a),
  buildPolicyLookup: (...a: unknown[]) => buildPolicyLookupMock(...a),
  listCustomPiiRulesForMasking: (...a: unknown[]) => listCustomPiiRulesForMaskingMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("resolveChunkTextForCaller (FR-KB-08 PII read-time re-evaluation, unit, mocked infra)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildPolicyLookupMock.mockResolvedValue(() => "FullMask");
    listCustomPiiRulesForMaskingMock.mockResolvedValue([]);
  });

  it("returns the already-computed chunk.text unchanged when no textUnmaskedRef was ever retained", async () => {
    const { resolveChunkTextForCaller } = await import("./pii-reeval-service.js");
    const result = await resolveChunkTextForCaller(ctx, { text: "**** is my SSN", textUnmaskedRef: null }, "Trusted");
    expect(result).toBe("**** is my SSN");
    expect(getUploadMock).not.toHaveBeenCalled();
  });

  it("re-derives masking fresh from the retained original text using the CALLER's own trust level", async () => {
    getUploadMock.mockResolvedValue(Buffer.from("Contact John at john@example.com for details."));
    detectAndMaskMock.mockResolvedValue("Contact John at [REDACTED] for details.");
    const { resolveChunkTextForCaller } = await import("./pii-reeval-service.js");
    const result = await resolveChunkTextForCaller(ctx, { text: "Contact John at *****@*******.*** for details.", textUnmaskedRef: "ref-1" }, "Untrusted");
    expect(getUploadMock).toHaveBeenCalledWith("t1", "ref-1");
    expect(detectAndMaskMock).toHaveBeenCalledWith("Contact John at john@example.com for details.", "Knowledge", "Untrusted", expect.any(Function), []);
    expect(result).toBe("Contact John at [REDACTED] for details.");
  });

  it("produces genuinely different output for a low-trust vs. high-trust caller reading the identical chunk (the adversarial property this requirement asks for)", async () => {
    getUploadMock.mockResolvedValue(Buffer.from("Contact John at john@example.com for details."));
    detectAndMaskMock.mockImplementation(async (_text: string, _ctx: string, trustLevel: string) =>
      trustLevel === "Trusted" ? "Contact John at john@example.com for details." : "Contact John at [REDACTED] for details.",
    );
    const { resolveChunkTextForCaller } = await import("./pii-reeval-service.js");
    const chunk = { text: "Contact John at *****@*******.*** for details.", textUnmaskedRef: "ref-1" };
    const lowTrustResult = await resolveChunkTextForCaller(ctx, chunk, "Untrusted");
    const highTrustResult = await resolveChunkTextForCaller(ctx, chunk, "Trusted");
    expect(lowTrustResult).not.toEqual(highTrustResult);
    expect(highTrustResult).toContain("john@example.com");
    expect(lowTrustResult).not.toContain("john@example.com");
  });

  it("fails closed to the already-safe baked-in text when the retained original can't be read (disk/permissions failure), never throwing into the read path", async () => {
    getUploadMock.mockRejectedValue(new Error("ENOENT: no such file"));
    const { resolveChunkTextForCaller } = await import("./pii-reeval-service.js");
    const result = await resolveChunkTextForCaller(ctx, { text: "**** is my SSN", textUnmaskedRef: "ref-missing" }, "Trusted");
    expect(result).toBe("**** is my SSN");
  });
});
