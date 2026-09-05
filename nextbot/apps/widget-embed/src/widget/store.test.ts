// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "./api.js";

const createWidgetSessionMock = vi.fn();
const sendWidgetMessageMock = vi.fn();
const setWidgetLanguageMock = vi.fn();
const openWidgetStreamMock = vi.fn();

vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof ApiModule>("./api.js");
  return {
    ...actual,
    createWidgetSession: (...a: unknown[]) => createWidgetSessionMock(...a),
    sendWidgetMessage: (...a: unknown[]) => sendWidgetMessageMock(...a),
    setWidgetLanguage: (...a: unknown[]) => setWidgetLanguageMock(...a),
    openWidgetStream: (...a: unknown[]) => openWidgetStreamMock(...a),
  };
});

function fakeEventSource() {
  return { close: vi.fn(), addEventListener: vi.fn(), onerror: null } as unknown as EventSource;
}

describe("widget store (Zustand, apps/widget-embed)", () => {
  beforeEach(() => {
    createWidgetSessionMock.mockReset();
    sendWidgetMessageMock.mockReset();
    setWidgetLanguageMock.mockReset();
    openWidgetStreamMock.mockReset().mockReturnValue(fakeEventSource());
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it("bootstrap() sets sessionToken/conversationId/hidePoweredBy on success", async () => {
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: {}, languages: ["en"], hidePoweredBy: true },
      resumeFromSequence: 0,
    });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });

    const state = useWidgetStore.getState();
    expect(state.sessionToken).toBe("tok");
    expect(state.conversationId).toBe("conv1");
    expect(state.hidePoweredBy).toBe(true);
    expect(state.initError).toBeNull();
  });

  it("bootstrap() sets initError='inactive' on a 403 and 'not-found' on any other failure", async () => {
    const { WidgetApiError } = await import("./api.js");
    createWidgetSessionMock.mockRejectedValueOnce(new WidgetApiError(403, "Chat is temporarily unavailable."));
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });
    expect(useWidgetStore.getState().initError).toBe("inactive");

    createWidgetSessionMock.mockRejectedValueOnce(new WidgetApiError(404, "Chat is temporarily unavailable."));
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });
    expect(useWidgetStore.getState().initError).toBe("not-found");
  });

  it("send() while online posts optimistically then reconciles with the server's messageId/sequence", async () => {
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: {}, languages: ["en"], hidePoweredBy: false },
      resumeFromSequence: 0,
    });
    sendWidgetMessageMock.mockResolvedValue({ messageId: "real-id", sequence: 1, acceptedAt: new Date().toISOString(), runId: "run1" });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });

    await useWidgetStore.getState().send("Text", { contentType: "Text", text: "hi" });

    const messages = useWidgetStore.getState().messages;
    expect(messages).toHaveLength(1);
    const message = messages.at(0);
    expect(message?.tick).toBe("sent");
    expect(message?.id).toBe("real-id");
    expect(message?.sequence).toBe(1);
  });

  it("send() while offline queues the message instead of calling the API", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ sessionToken: "tok", isOnline: false });

    await useWidgetStore.getState().send("Text", { contentType: "Text", text: "queued msg" });

    expect(sendWidgetMessageMock).not.toHaveBeenCalled();
    expect(useWidgetStore.getState().offlineQueue).toHaveLength(1);
    expect(useWidgetStore.getState().messages.at(0)?.tick).toBe("queued");
  });

  it("drops the oldest queued message beyond 20 and shows a one-time notice", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ sessionToken: "tok", isOnline: false, messages: [], offlineQueue: [] });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 22; i++) {
      await useWidgetStore.getState().send("Text", { contentType: "Text", text: `msg ${i}` });
    }

    expect(useWidgetStore.getState().offlineQueue).toHaveLength(20);
    expect(warnSpy).toHaveBeenCalled();
    const noticeCount = useWidgetStore
      .getState()
      .messages.filter((m) => m.sender === "System" && m.payload.contentType === "Text" && m.payload.text.includes("removed"))
      .length;
    expect(noticeCount).toBe(1);
  });

  it("setOnline(true) after being offline flushes the queue", async () => {
    sendWidgetMessageMock.mockResolvedValue({ messageId: "real-id", sequence: 1, acceptedAt: new Date().toISOString(), runId: "run1" });
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ sessionToken: "tok", isOnline: false, messages: [], offlineQueue: [] });
    await useWidgetStore.getState().send("Text", { contentType: "Text", text: "queued" });
    expect(useWidgetStore.getState().offlineQueue).toHaveLength(1);

    useWidgetStore.getState().setOnline(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendWidgetMessageMock).toHaveBeenCalled();
    expect(useWidgetStore.getState().offlineQueue).toHaveLength(0);
  });

  it("handleStreamEvent ignores a duplicate sequence (reconnect replay dedup)", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ messages: [] });
    const dto = {
      id: "m1",
      conversationId: "conv1",
      sequence: 5,
      sender: "AI" as const,
      contentType: "Text" as const,
      payload: { contentType: "Text", text: "hello" },
      confidenceScore: null,
      createdAt: new Date().toISOString(),
    };
    useWidgetStore.getState().handleStreamEvent("message", { message: dto });
    useWidgetStore.getState().handleStreamEvent("message", { message: dto });
    expect(useWidgetStore.getState().messages).toHaveLength(1);
  });

  it("Phase 16 (BL-09): handleStreamEvent('conversation', Escalated) sets escalationWait, cleared on Active", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ escalationWait: null });
    useWidgetStore.getState().handleStreamEvent("conversation", { status: "Escalated", escalation: { queueName: "Billing Support" } });
    expect(useWidgetStore.getState().escalationWait).toEqual({ queueName: "Billing Support" });

    useWidgetStore.getState().handleStreamEvent("conversation", { status: "Active" });
    expect(useWidgetStore.getState().escalationWait).toBeNull();
  });

  it("handleStreamEvent bumps unreadCount only when the launcher (not window) is showing an AI message", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ messages: [], view: "launcher", unreadCount: 0 });
    useWidgetStore.getState().handleStreamEvent("message", {
      message: {
        id: "m2",
        conversationId: "conv1",
        sequence: 1,
        sender: "AI",
        contentType: "Text",
        payload: { contentType: "Text", text: "hi" },
        confidenceScore: null,
        createdAt: new Date().toISOString(),
      },
    });
    expect(useWidgetStore.getState().unreadCount).toBe(1);
  });

  it("selectLanguage() applies the selection client-side even if persistence fails", async () => {
    setWidgetLanguageMock.mockRejectedValue(new Error("network error"));
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ sessionToken: "tok", languageModalOpen: true });
    await useWidgetStore.getState().selectLanguage("ar");
    expect(useWidgetStore.getState().language).toBe("ar");
    expect(useWidgetStore.getState().languageModalOpen).toBe(false);
  });

  it("D4: bootstrap() applies the server-resolved channel.config.theme as the default theme", async () => {
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: { theme: { primaryColor: "#1B6B4A", headerTitle: "Acme Support" } }, languages: ["en"], hidePoweredBy: false },
      resumeFromSequence: 0,
    });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });
    expect(useWidgetStore.getState().channelTheme).toEqual({ primaryColor: "#1B6B4A", headerTitle: "Acme Support" });
  });

  it("D12: bootstrap() sends a previously-saved resume token and persists whatever token comes back", async () => {
    const { saveResumeToken } = await import("./resume-token.js");
    saveResumeToken({ tenantId: "acme", channelId: "wc_1" }, "prior-session-tok");
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "resumed-tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: {}, languages: ["en"], hidePoweredBy: false },
      resumeFromSequence: 3,
    });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });

    expect(createWidgetSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSessionToken: "prior-session-tok" }),
    );
    // A successful resume (resumeFromSequence > 0) shows the conversation screen
    // immediately rather than the Welcome screen, since history is about to be
    // replayed via the SSE gap-fill.
    expect(useWidgetStore.getState().screen).toBe("conversation");

    const { loadResumeToken } = await import("./resume-token.js");
    expect(loadResumeToken({ tenantId: "acme", channelId: "wc_1" })).toBe("resumed-tok");
  });

  it("D12 (retry 2): a resumed session opens the SSE stream with sinceSequence=0, not resumeFromSequence, so the freshly-empty store gets the full replayed history", async () => {
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "resumed-tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: {}, languages: ["en"], hidePoweredBy: false },
      // A nonzero resumeFromSequence means there IS prior history — but since the
      // local store is empty on this fresh mount, sequence > resumeFromSequence
      // would match nothing were it (wrongly) used as the replay cursor.
      resumeFromSequence: 7,
    });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });

    expect(openWidgetStreamMock).toHaveBeenCalledWith("resumed-tok", 0);
  });

  it("D12: a fresh bootstrap with no saved token starts a new conversation and shows the Welcome screen", async () => {
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "new-tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: {}, languages: ["en"], hidePoweredBy: false },
      resumeFromSequence: 0,
    });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });

    expect(createWidgetSessionMock).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionToken: undefined }));
    expect(useWidgetStore.getState().screen).toBe("welcome");
  });

  it("Phase 6 (sandbox preview): bootstrap() forwards previewVersionId/previewToken to createWidgetSession", async () => {
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "preview-tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: {}, languages: ["en"], hidePoweredBy: false },
      resumeFromSequence: 0,
    });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({
      tenantId: "acme",
      channelId: "wc_1",
      previewVersionId: "version-A",
      previewToken: "signed-preview-token",
    });

    expect(createWidgetSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ previewVersionId: "version-A", previewToken: "signed-preview-token" }),
    );
  });

  it("Phase 6 (sandbox preview): a preview mount never resumes a saved token, and never persists its own", async () => {
    const { saveResumeToken, loadResumeToken } = await import("./resume-token.js");
    saveResumeToken({ tenantId: "acme", channelId: "wc_1" }, "some-other-real-customer-session-tok");
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "preview-tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: {}, languages: ["en"], hidePoweredBy: false },
      resumeFromSequence: 0,
    });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({
      tenantId: "acme",
      channelId: "wc_1",
      previewVersionId: "version-A",
      previewToken: "signed-preview-token",
    });

    expect(createWidgetSessionMock).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionToken: undefined }));
    // The real customer session token saved above must survive untouched — a
    // sandbox preview mount must never clobber a real embed's own resume state
    // (they're isolated by tenantId+channelId, but this asserts the preview path
    // itself never writes to that key at all).
    expect(loadResumeToken({ tenantId: "acme", channelId: "wc_1" })).toBe("some-other-real-customer-session-tok");
  });

  it("D6: an SSE echo of the customer's own message arriving before the HTTP response reconciles the bubble instead of appending a duplicate", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({
      messages: [
        {
          id: "client-abc",
          sequence: -1,
          sender: "Customer",
          contentType: "Text",
          payload: { contentType: "Text", text: "hi" },
          createdAt: new Date().toISOString(),
          tick: "sending",
          clientMessageId: "client-abc",
        },
      ],
    });

    useWidgetStore.getState().handleStreamEvent("message", {
      message: {
        id: "server-real-id",
        conversationId: "conv1",
        sequence: 1,
        sender: "Customer",
        contentType: "Text",
        payload: { contentType: "Text", text: "hi" },
        confidenceScore: null,
        createdAt: new Date().toISOString(),
        clientMessageId: "client-abc",
      },
    });

    const messages = useWidgetStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("server-real-id");
    expect(messages[0]?.sequence).toBe(1);
    expect(messages[0]?.tick).toBe("sent");
  });

  it("D8: a client-detected send failure renders the widget's ErrorBubble in addition to marking the bubble failed", async () => {
    sendWidgetMessageMock.mockRejectedValue(new Error("network error"));
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ sessionToken: "tok", messages: [] });

    await useWidgetStore.getState().send("Text", { contentType: "Text", text: "hi" });

    const messages = useWidgetStore.getState().messages;
    expect(messages.some((m) => m.tick === "failed")).toBe(true);
    const errorBubble = messages.find((m) => m.payload.contentType === "Error");
    expect(errorBubble).toBeDefined();
    expect(errorBubble?.sender).toBe("AI");
    if (errorBubble?.payload.contentType === "Error") {
      expect(errorBubble.payload.reason).toBe("BackendTimeout");
    }
  });

  it("openWindow() switches to the window view and clears unreadCount", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ view: "launcher", unreadCount: 3 });
    useWidgetStore.getState().openWindow();
    expect(useWidgetStore.getState().view).toBe("window");
    expect(useWidgetStore.getState().unreadCount).toBe(0);
  });

  it("minimizeWindow() switches back to the launcher view", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ view: "window" });
    useWidgetStore.getState().minimizeWindow();
    expect(useWidgetStore.getState().view).toBe("launcher");
  });

  it("openLanguageModal()/closeLanguageModal() toggle languageModalOpen", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ languageModalOpen: false });
    useWidgetStore.getState().openLanguageModal();
    expect(useWidgetStore.getState().languageModalOpen).toBe(true);
    useWidgetStore.getState().closeLanguageModal();
    expect(useWidgetStore.getState().languageModalOpen).toBe(false);
  });

  it("bootstrap() falls back to 'en' when the server returns no languages, and to a generic 500/'not-found' for a non-WidgetApiError failure", async () => {
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: {}, languages: [], hidePoweredBy: false },
      resumeFromSequence: 0,
    });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });
    expect(useWidgetStore.getState().language).toBe("en");

    createWidgetSessionMock.mockRejectedValueOnce(new Error("connection reset"));
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });
    expect(useWidgetStore.getState().initError).toBe("not-found");
  });

  it("selectLanguage() is a no-op against the API when there is no sessionToken yet", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ sessionToken: null, languageModalOpen: true });
    await useWidgetStore.getState().selectLanguage("ar");
    expect(setWidgetLanguageMock).not.toHaveBeenCalled();
    expect(useWidgetStore.getState().language).toBe("ar");
  });

  it("send() while online with no sessionToken yet is a safe no-op beyond the optimistic bubble (dispatchSend's own guard)", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ sessionToken: null, isOnline: true, messages: [] });
    await useWidgetStore.getState().send("Text", { contentType: "Text", text: "hi" });
    expect(sendWidgetMessageMock).not.toHaveBeenCalled();
    expect(useWidgetStore.getState().messages).toHaveLength(1);
  });

  it("reconciles only the matching message when multiple customer bubbles are in flight (dispatchSend's success and failure paths both map over the full list)", async () => {
    sendWidgetMessageMock
      .mockResolvedValueOnce({ messageId: "real-1", sequence: 1, acceptedAt: new Date().toISOString(), runId: "run1" })
      .mockRejectedValueOnce(new Error("network error"));
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ sessionToken: "tok", isOnline: true, messages: [] });

    await useWidgetStore.getState().send("Text", { contentType: "Text", text: "first" });
    await useWidgetStore.getState().send("Text", { contentType: "Text", text: "second" });

    const messages = useWidgetStore.getState().messages;
    const first = messages.find((m) => m.payload.contentType === "Text" && m.payload.text === "first");
    const second = messages.find((m) => m.payload.contentType === "Text" && m.payload.text === "second");
    expect(first?.tick).toBe("sent");
    expect(second?.tick).toBe("failed");
  });

  it("connectStream closes a prior stream before opening a new one, and the EventSource's onerror handler never throws", async () => {
    createWidgetSessionMock.mockResolvedValue({
      sessionToken: "tok",
      conversationId: "conv1",
      channel: { capabilities: {}, config: {}, languages: ["en"], hidePoweredBy: false },
      resumeFromSequence: 0,
    });
    const { useWidgetStore } = await import("./store.js");
    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });
    const firstSource = openWidgetStreamMock.mock.results[0]?.value as { close: ReturnType<typeof vi.fn>; onerror: () => void };

    await useWidgetStore.getState().bootstrap({ tenantId: "acme", channelId: "wc_1" });

    expect(firstSource.close).toHaveBeenCalled();
    expect(() => firstSource.onerror()).not.toThrow();
  });

  it("D6 edge case: a customer message replayed under an already-rendered real id with no clientMessageId match is a no-op, not a duplicate", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({
      messages: [
        {
          id: "already-here",
          sequence: 1,
          sender: "Customer",
          contentType: "Text",
          payload: { contentType: "Text", text: "hi" },
          createdAt: new Date().toISOString(),
        },
      ],
    });

    useWidgetStore.getState().handleStreamEvent("message", {
      message: {
        id: "already-here",
        conversationId: "conv1",
        // A different sequence than the one already rendered — bypasses the
        // top-level sequence dedup so this test actually reaches the id-fallback
        // branch, not the sequence check.
        sequence: 2,
        sender: "Customer",
        contentType: "Text",
        payload: { contentType: "Text", text: "hi" },
        confidenceScore: null,
        createdAt: new Date().toISOString(),
        // No clientMessageId — this message predates D6, or arrived via a path
        // that never set one.
      },
    });

    expect(useWidgetStore.getState().messages).toHaveLength(1);
  });

  it("D11: dropping a queued message beyond the 20-message cap marks its own bubble 'dropped', distinct from 'queued'/'sent'", async () => {
    const { useWidgetStore } = await import("./store.js");
    useWidgetStore.setState({ sessionToken: "tok", isOnline: false, messages: [], offlineQueue: [] });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 21; i++) {
      await useWidgetStore.getState().send("Text", { contentType: "Text", text: `msg ${i}` });
    }

    const messages = useWidgetStore.getState().messages;
    // The very first message sent is the one evicted (oldest-dropped).
    const firstBubble = messages.find((m) => m.payload.contentType === "Text" && m.payload.text === "msg 0");
    expect(firstBubble?.tick).toBe("dropped");
    // The still-queued ones remain "queued", not "dropped".
    const stillQueued = messages.find((m) => m.payload.contentType === "Text" && m.payload.text === "msg 1");
    expect(stillQueued?.tick).toBe("queued");
  });
});
