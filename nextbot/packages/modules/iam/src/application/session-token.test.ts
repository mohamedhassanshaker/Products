import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionInvalidError } from "@nextbot/contracts";

describe("session-token (JWT issuance/verification)", () => {
  const original = process.env.NEXTBOT_SESSION_SECRET;
  beforeEach(() => {
    process.env.NEXTBOT_SESSION_SECRET = "a-sufficiently-long-test-secret-value-1234";
  });
  afterEach(() => {
    process.env.NEXTBOT_SESSION_SECRET = original;
  });

  it("round-trips issue -> verify with the same claims", async () => {
    const { issueSessionToken, verifySessionToken } = await import("./session-token.js");
    const token = await issueSessionToken({ tenantId: "t1", userId: "u1", roleIds: ["r1"], permissions: {} as never });
    const claims = await verifySessionToken(token);
    expect(claims.tenantId).toBe("t1");
    expect(claims.userId).toBe("u1");
  });

  it("throws SessionInvalidError for a malformed token", async () => {
    const { verifySessionToken } = await import("./session-token.js");
    await expect(verifySessionToken("not-a-real-jwt")).rejects.toThrow(SessionInvalidError);
  });

  it("throws a startup config error when NEXTBOT_SESSION_SECRET is missing/too short", async () => {
    delete process.env.NEXTBOT_SESSION_SECRET;
    const { issueSessionToken } = await import("./session-token.js");
    await expect(issueSessionToken({ tenantId: "t1", userId: "u1", roleIds: [], permissions: {} as never })).rejects.toThrow();
  });
});
