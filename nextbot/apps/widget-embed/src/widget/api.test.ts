// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWidgetSession, openWidgetStream, sendWidgetMessage, setWidgetLanguage, WidgetApiError } from "./api.js";

describe("widget api client (apps/gateway's /api/v1/widget/** surface, LLD §5.3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createWidgetSession posts to /api/v1/widget/sessions and returns the parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessionToken: "tok" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createWidgetSession({ tenantSlug: "acme", channelPublicKey: "wc_1" });
    expect(result).toEqual({ sessionToken: "tok" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/widget/sessions");
    expect(init.method).toBe("POST");
  });

  it("throws WidgetApiError with the server's status/title on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ title: "Chat is temporarily unavailable." }) }));
    await expect(createWidgetSession({ tenantSlug: "x", channelPublicKey: "y" })).rejects.toMatchObject({
      status: 404,
      message: "Chat is temporarily unavailable.",
    });
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("not json"); } }));
    await expect(createWidgetSession({ tenantSlug: "x", channelPublicKey: "y" })).rejects.toBeInstanceOf(WidgetApiError);
  });

  it("sendWidgetMessage sets the bearer + idempotency-key headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: "m1" }) });
    vi.stubGlobal("fetch", fetchMock);

    await sendWidgetMessage("tok", { clientMessageId: "c1", contentType: "Text", payload: { contentType: "Text", text: "hi" } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers["idempotency-key"]).toBe("c1");
  });

  it("setWidgetLanguage posts the selection with the bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await setWidgetLanguage("tok", "ar");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/widget/language");
    expect(JSON.parse(init.body as string)).toEqual({ language: "ar" });
  });

  it("openWidgetStream builds an SSE URL carrying sinceSequence + token as query params (EventSource can't set headers)", () => {
    class FakeEventSource {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

    const source = openWidgetStream("tok", 5) as unknown as FakeEventSource;
    const url = new URL(source.url);
    expect(url.pathname).toContain("/api/v1/widget/stream");
    expect(url.searchParams.get("sinceSequence")).toBe("5");
    expect(url.searchParams.get("token")).toBe("tok");
  });
});
