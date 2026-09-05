import { describe, expect, it, vi, beforeEach } from "vitest";

const resetMfaEnrollment = vi.fn();

vi.mock("../infrastructure/user-repository.js", () => ({
  resetMfaEnrollment: (...a: unknown[]) => resetMfaEnrollment(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Production" as const };

describe("resetUserMfa (unit — QA Defect B2 admin MFA-reset action)", () => {
  beforeEach(() => {
    resetMfaEnrollment.mockReset();
  });

  it("delegates to the repository's resetMfaEnrollment", async () => {
    const { resetUserMfa } = await import("./reset-mfa.js");
    await resetUserMfa(ctx, "user-1");
    expect(resetMfaEnrollment).toHaveBeenCalledWith(ctx, "user-1");
  });
});
