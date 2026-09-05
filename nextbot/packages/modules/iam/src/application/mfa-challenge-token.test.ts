import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MfaChallengeInvalidError } from "@nextbot/contracts";

describe("mfa-challenge-token (short-lived JWT correlating login step 1/2)", () => {
  const original = process.env.NEXTBOT_SESSION_SECRET;
  beforeEach(() => {
    process.env.NEXTBOT_SESSION_SECRET = "a-sufficiently-long-test-secret-value-1234";
  });
  afterEach(() => {
    process.env.NEXTBOT_SESSION_SECRET = original;
  });

  it("round-trips issue -> verify", async () => {
    const { issueMfaChallengeToken, verifyMfaChallengeToken } = await import("./mfa-challenge-token.js");
    const token = await issueMfaChallengeToken("t1", "u1");
    const claims = await verifyMfaChallengeToken(token);
    expect(claims).toMatchObject({ purpose: "mfa_challenge", tenantId: "t1", userId: "u1" });
  });

  it("throws MfaChallengeInvalidError for a malformed token", async () => {
    const { verifyMfaChallengeToken } = await import("./mfa-challenge-token.js");
    await expect(verifyMfaChallengeToken("garbage")).rejects.toThrow(MfaChallengeInvalidError);
  });

  it("throws MfaChallengeInvalidError for a token signed for a different purpose (a real session token)", async () => {
    const { issueSessionToken } = await import("./session-token.js");
    const { verifyMfaChallengeToken } = await import("./mfa-challenge-token.js");
    const sessionToken = await issueSessionToken({ tenantId: "t1", userId: "u1", roleIds: [], permissions: {} as never });
    await expect(verifyMfaChallengeToken(sessionToken)).rejects.toThrow(MfaChallengeInvalidError);
  });

  // QA Defect B3 regression: the forced-enrollment token must be a genuinely
  // distinct purpose from the challenge token — neither should verify as the other.
  it("round-trips the enrollment token, distinctly from the challenge token", async () => {
    const { issueMfaEnrollmentToken, verifyMfaEnrollmentToken, issueMfaChallengeToken, verifyMfaChallengeToken } = await import(
      "./mfa-challenge-token.js"
    );
    const enrollmentToken = await issueMfaEnrollmentToken("t1", "u1");
    const claims = await verifyMfaEnrollmentToken(enrollmentToken);
    expect(claims).toMatchObject({ purpose: "mfa_enrollment", tenantId: "t1", userId: "u1" });

    await expect(verifyMfaChallengeToken(enrollmentToken)).rejects.toThrow(MfaChallengeInvalidError);

    const challengeToken = await issueMfaChallengeToken("t1", "u1");
    await expect(verifyMfaEnrollmentToken(challengeToken)).rejects.toThrow(MfaChallengeInvalidError);
  });
});
