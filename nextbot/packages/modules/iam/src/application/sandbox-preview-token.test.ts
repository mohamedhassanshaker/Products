import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { SandboxPreviewInvalidError } from "@nextbot/contracts";

describe("sandbox-preview-token (Phase 6 Admin Console -> Gateway Plane sandbox-preview authorization)", () => {
  const original = process.env.NEXTBOT_SESSION_SECRET;
  const secret = "a-sufficiently-long-test-secret-value-1234";
  beforeEach(() => {
    process.env.NEXTBOT_SESSION_SECRET = secret;
  });
  afterEach(() => {
    process.env.NEXTBOT_SESSION_SECRET = original;
  });

  it("round-trips issue -> verify with the exact tenant/user/version claims", async () => {
    const { issueSandboxPreviewToken, verifySandboxPreviewToken } = await import("./sandbox-preview-token.js");
    const token = await issueSandboxPreviewToken("t1", "u1", "v1");
    const claims = await verifySandboxPreviewToken(token);
    expect(claims).toMatchObject({ purpose: "sandbox_preview", tenantId: "t1", userId: "u1", versionId: "v1" });
  });

  it("throws SandboxPreviewInvalidError for a malformed token (the anonymous-caller-guesses-the-param case)", async () => {
    const { verifySandboxPreviewToken } = await import("./sandbox-preview-token.js");
    await expect(verifySandboxPreviewToken("garbage")).rejects.toThrow(SandboxPreviewInvalidError);
  });

  it("throws SandboxPreviewInvalidError for an empty/missing token", async () => {
    const { verifySandboxPreviewToken } = await import("./sandbox-preview-token.js");
    await expect(verifySandboxPreviewToken("")).rejects.toThrow(SandboxPreviewInvalidError);
  });

  it("throws SandboxPreviewInvalidError for a token signed for a different purpose (a real Admin Console session token)", async () => {
    const { issueSessionToken } = await import("./session-token.js");
    const { verifySandboxPreviewToken } = await import("./sandbox-preview-token.js");
    const sessionToken = await issueSessionToken({ tenantId: "t1", userId: "u1", roleIds: [], permissions: {} as never });
    await expect(verifySandboxPreviewToken(sessionToken)).rejects.toThrow(SandboxPreviewInvalidError);
  });

  it("throws SandboxPreviewInvalidError for an expired token", async () => {
    const { verifySandboxPreviewToken } = await import("./sandbox-preview-token.js");
    const expired = await new SignJWT({ purpose: "sandbox_preview", tenantId: "t1", userId: "u1", versionId: "v1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(new TextEncoder().encode(secret));
    await expect(verifySandboxPreviewToken(expired)).rejects.toThrow(SandboxPreviewInvalidError);
  });

  it("throws SandboxPreviewInvalidError for a token signed with the wrong secret (tampered)", async () => {
    const { verifySandboxPreviewToken } = await import("./sandbox-preview-token.js");
    const tampered = await new SignJWT({ purpose: "sandbox_preview", tenantId: "t1", userId: "u1", versionId: "v1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("a-completely-different-signing-secret-value"));
    await expect(verifySandboxPreviewToken(tampered)).rejects.toThrow(SandboxPreviewInvalidError);
  });

  it("startup-config-fails loudly when NEXTBOT_SESSION_SECRET is unset (fail-closed, not a silent default)", async () => {
    delete process.env.NEXTBOT_SESSION_SECRET;
    const { issueSandboxPreviewToken } = await import("./sandbox-preview-token.js");
    await expect(issueSandboxPreviewToken("t1", "u1", "v1")).rejects.toThrow(/NEXTBOT_SESSION_SECRET/);
  });
});
