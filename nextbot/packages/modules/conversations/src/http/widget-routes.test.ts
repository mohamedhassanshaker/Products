import { describe, expect, it, vi, beforeEach } from "vitest";

const createWidgetSessionMock = vi.fn();
const sendWidgetMessageMock = vi.fn();
const setWidgetTypingStateMock = vi.fn();
const setWidgetLanguageMock = vi.fn();
const replayMessagesSinceMock = vi.fn();
const subscribeToConversationMock = vi.fn();
const verifyWidgetSessionTokenMock = vi.fn();

vi.mock("../application/create-widget-session.js", () => ({ createWidgetSession: (...a: unknown[]) => createWidgetSessionMock(...a) }));
vi.mock("../application/send-widget-message.js", () => ({ sendWidgetMessage: (...a: unknown[]) => sendWidgetMessageMock(...a) }));
vi.mock("../application/set-widget-typing.js", () => ({ setWidgetTypingState: (...a: unknown[]) => setWidgetTypingStateMock(...a) }));
vi.mock("../application/set-widget-language.js", () => ({ setWidgetLanguage: (...a: unknown[]) => setWidgetLanguageMock(...a) }));
vi.mock("../application/stream-widget-events.js", () => ({
  replayMessagesSince: (...a: unknown[]) => replayMessagesSinceMock(...a),
  subscribeToConversation: (...a: unknown[]) => subscribeToConversationMock(...a),
}));
vi.mock("../application/widget-session-token.js", () => ({
  verifyWidgetSessionToken: (...a: unknown[]) => verifyWidgetSessionTokenMock(...a),
}));

const session = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const, channelId: "c1", conversationId: "conv1" };

describe("conversations http/widget-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    createWidgetSessionMock.mockReset();
    sendWidgetMessageMock.mockReset();
    setWidgetTypingStateMock.mockReset();
    setWidgetLanguageMock.mockReset();
    replayMessagesSinceMock.mockReset();
    subscribeToConversationMock.mockReset();
    verifyWidgetSessionTokenMock.mockReset();
  });

  it("handleCreateWidgetSession delegates to the application service", async () => {
    createWidgetSessionMock.mockResolvedValue({ sessionToken: "tok" });
    const { handleCreateWidgetSession } = await import("./widget-routes.js");
    const input = { tenantSlug: "t", channelPublicKey: "wc_x" };
    expect(await handleCreateWidgetSession(input)).toEqual({ sessionToken: "tok" });
    // Phase 6: always forwards its (possibly undefined) 2nd `verifiedPreview` param
    // through explicitly, rather than omitting the argument entirely.
    expect(createWidgetSessionMock).toHaveBeenCalledWith(input, undefined);
  });

  it("Phase 6: handleCreateWidgetSession forwards a real verifiedPreview through to the application service", async () => {
    createWidgetSessionMock.mockResolvedValue({ sessionToken: "tok" });
    const { handleCreateWidgetSession } = await import("./widget-routes.js");
    const input = { tenantSlug: "t", channelPublicKey: "wc_x", previewVersionId: "v1", previewToken: "signed" };
    const verifiedPreview = { tenantId: "t1", versionId: "v1" };
    expect(await handleCreateWidgetSession(input, verifiedPreview)).toEqual({ sessionToken: "tok" });
    expect(createWidgetSessionMock).toHaveBeenCalledWith(input, verifiedPreview);
  });

  it("handleVerifyWidgetSession delegates to verifyWidgetSessionToken", async () => {
    verifyWidgetSessionTokenMock.mockResolvedValue(session);
    const { handleVerifyWidgetSession } = await import("./widget-routes.js");
    expect(await handleVerifyWidgetSession("tok")).toEqual(session);
  });

  it("handleSendWidgetMessage delegates to the application service", async () => {
    sendWidgetMessageMock.mockResolvedValue({ messageId: "m1" });
    const { handleSendWidgetMessage } = await import("./widget-routes.js");
    const input = { clientMessageId: "c1", contentType: "Text" as const, payload: { contentType: "Text" as const, text: "hi" } };
    expect(await handleSendWidgetMessage(session, input)).toEqual({ messageId: "m1" });
    expect(sendWidgetMessageMock).toHaveBeenCalledWith(session, input, undefined);
  });

  it("handleSetWidgetTyping delegates synchronously", async () => {
    const { handleSetWidgetTyping } = await import("./widget-routes.js");
    handleSetWidgetTyping(session, "start");
    expect(setWidgetTypingStateMock).toHaveBeenCalledWith(session, "start");
  });

  it("handleSetWidgetLanguage delegates to the application service", async () => {
    const { handleSetWidgetLanguage } = await import("./widget-routes.js");
    await handleSetWidgetLanguage(session, "ar");
    expect(setWidgetLanguageMock).toHaveBeenCalledWith(session, "ar");
  });

  it("handleReplaySince delegates with a TenantContext derived from the session", async () => {
    replayMessagesSinceMock.mockResolvedValue([]);
    const { handleReplaySince } = await import("./widget-routes.js");
    await handleReplaySince(session, 5);
    expect(replayMessagesSinceMock).toHaveBeenCalledWith(
      { tenantId: "t1", region: "US", environment: "Sandbox" },
      "conv1",
      5,
    );
  });

  it("handleSubscribe delegates to subscribeToConversation", async () => {
    const unsubscribe = vi.fn();
    subscribeToConversationMock.mockReturnValue(unsubscribe);
    const { handleSubscribe } = await import("./widget-routes.js");
    const onEvent = vi.fn();
    expect(handleSubscribe(session, onEvent)).toBe(unsubscribe);
    expect(subscribeToConversationMock).toHaveBeenCalledWith("conv1", onEvent);
  });
});
