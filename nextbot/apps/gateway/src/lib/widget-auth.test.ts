import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const handleVerifyWidgetSessionMock = vi.fn();
vi.mock("@nextbot/conversations", () => ({
  handleVerifyWidgetSession: (...a: unknown[]) => handleVerifyWidgetSessionMock(...a),
}));

describe("requireWidgetSession", () => {
  beforeEach(() => {
    handleVerifyWidgetSessionMock.mockReset();
  });

  it("returns 401 when no Authorization header is present", async () => {
    const { requireWidgetSession } = await import("./widget-auth.js");
    const req = new NextRequest("http://localhost/api/v1/widget/messages");
    const result = await requireWidgetSession(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 when the token fails verification", async () => {
    handleVerifyWidgetSessionMock.mockRejectedValue(new Error("bad token"));
    const { requireWidgetSession } = await import("./widget-auth.js");
    const req = new NextRequest("http://localhost/api/v1/widget/messages", {
      headers: { authorization: "Bearer garbage" },
    });
    const result = await requireWidgetSession(req);
    expect((result as Response).status).toBe(401);
  });

  it("returns the decoded claims for a valid bearer token", async () => {
    const claims = { tenantId: "t1", conversationId: "c1" };
    handleVerifyWidgetSessionMock.mockResolvedValue(claims);
    const { requireWidgetSession } = await import("./widget-auth.js");
    const req = new NextRequest("http://localhost/api/v1/widget/messages", {
      headers: { authorization: "Bearer good-token" },
    });
    const result = await requireWidgetSession(req);
    expect(result).toEqual(claims);
    expect(handleVerifyWidgetSessionMock).toHaveBeenCalledWith("good-token");
  });
});

describe("requireWidgetSessionFromStreamRequest (EventSource has no custom headers)", () => {
  beforeEach(() => {
    handleVerifyWidgetSessionMock.mockReset();
  });

  it("accepts a token query param when no Authorization header is present", async () => {
    const claims = { tenantId: "t1", conversationId: "c1" };
    handleVerifyWidgetSessionMock.mockResolvedValue(claims);
    const { requireWidgetSessionFromStreamRequest } = await import("./widget-auth.js");
    const req = new NextRequest("http://localhost/api/v1/widget/stream?sinceSequence=0&token=query-token");
    const result = await requireWidgetSessionFromStreamRequest(req);
    expect(result).toEqual(claims);
    expect(handleVerifyWidgetSessionMock).toHaveBeenCalledWith("query-token");
  });

  it("prefers the Authorization header over the query param when both are present", async () => {
    handleVerifyWidgetSessionMock.mockResolvedValue({ tenantId: "t1" });
    const { requireWidgetSessionFromStreamRequest } = await import("./widget-auth.js");
    const req = new NextRequest("http://localhost/api/v1/widget/stream?token=query-token", {
      headers: { authorization: "Bearer header-token" },
    });
    await requireWidgetSessionFromStreamRequest(req);
    expect(handleVerifyWidgetSessionMock).toHaveBeenCalledWith("header-token");
  });

  it("returns 401 when neither a header nor a token query param is present", async () => {
    const { requireWidgetSessionFromStreamRequest } = await import("./widget-auth.js");
    const req = new NextRequest("http://localhost/api/v1/widget/stream");
    const result = await requireWidgetSessionFromStreamRequest(req);
    expect((result as Response).status).toBe(401);
  });
});
