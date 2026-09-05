import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WidgetSessionInvalidError } from "@nextbot/contracts";

describe("widget-session-token (anonymous widget JWT, distinct from admin sessions)", () => {
  const original = process.env.NEXTBOT_WIDGET_SESSION_SECRET;
  beforeEach(() => {
    process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
  });
  afterEach(() => {
    process.env.NEXTBOT_WIDGET_SESSION_SECRET = original;
  });

  it("round-trips issue -> verify with the same claims", async () => {
    const { issueWidgetSessionToken, verifyWidgetSessionToken } = await import("./widget-session-token.js");
    const token = await issueWidgetSessionToken({
      tenantId: "t1",
      region: "US",
      environment: "Sandbox",
      channelId: "c1",
      conversationId: "conv1",
    });
    const claims = await verifyWidgetSessionToken(token);
    expect(claims.tenantId).toBe("t1");
    expect(claims.conversationId).toBe("conv1");
    expect(claims.channelId).toBe("c1");
  });

  it("sets the audience claim to the channelId", async () => {
    const { issueWidgetSessionToken } = await import("./widget-session-token.js");
    const { decodeJwt } = await import("jose");
    const token = await issueWidgetSessionToken({
      tenantId: "t1",
      region: "US",
      environment: "Sandbox",
      channelId: "c1",
      conversationId: "conv1",
    });
    expect(decodeJwt(token).aud).toBe("c1");
  });

  it("throws WidgetSessionInvalidError for a malformed token", async () => {
    const { verifyWidgetSessionToken } = await import("./widget-session-token.js");
    await expect(verifyWidgetSessionToken("not-a-real-jwt")).rejects.toThrow(WidgetSessionInvalidError);
  });

  it("is signed with a distinct secret from the admin session token (never interchangeable)", async () => {
    // NEXTBOT_SESSION_SECRET (admin) deliberately unset here — a widget token must
    // verify using its own env var, not fall back to the admin one.
    delete process.env.NEXTBOT_SESSION_SECRET;
    const { issueWidgetSessionToken, verifyWidgetSessionToken } = await import("./widget-session-token.js");
    const token = await issueWidgetSessionToken({
      tenantId: "t1",
      region: "US",
      environment: "Sandbox",
      channelId: "c1",
      conversationId: "conv1",
    });
    await expect(verifyWidgetSessionToken(token)).resolves.toBeTruthy();
  });

  it("throws a startup config error when NEXTBOT_WIDGET_SESSION_SECRET is missing/too short", async () => {
    delete process.env.NEXTBOT_WIDGET_SESSION_SECRET;
    const { issueWidgetSessionToken } = await import("./widget-session-token.js");
    await expect(
      issueWidgetSessionToken({ tenantId: "t1", region: "US", environment: "Sandbox", channelId: "c1", conversationId: "conv1" }),
    ).rejects.toThrow();
  });
});
