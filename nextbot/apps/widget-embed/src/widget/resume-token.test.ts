// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadResumeToken, saveResumeToken } from "./resume-token.js";

describe("resume-token (D12 — client-side session-resumption persistence)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns undefined when nothing has been saved yet", () => {
    expect(loadResumeToken({ tenantId: "acme", channelId: "wc_1" })).toBeUndefined();
  });

  it("round-trips a saved token for the same tenant+channel", () => {
    saveResumeToken({ tenantId: "acme", channelId: "wc_1" }, "tok-123");
    expect(loadResumeToken({ tenantId: "acme", channelId: "wc_1" })).toBe("tok-123");
  });

  it("scopes storage per tenant+channel — a different channel never resumes another channel's conversation", () => {
    saveResumeToken({ tenantId: "acme", channelId: "wc_1" }, "tok-for-wc1");
    expect(loadResumeToken({ tenantId: "acme", channelId: "wc_2" })).toBeUndefined();
    expect(loadResumeToken({ tenantId: "other-tenant", channelId: "wc_1" })).toBeUndefined();
  });

  it("loadResumeToken never throws when localStorage access fails (e.g. private-browsing restrictions)", () => {
    vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => loadResumeToken({ tenantId: "acme", channelId: "wc_1" })).not.toThrow();
    expect(loadResumeToken({ tenantId: "acme", channelId: "wc_1" })).toBeUndefined();
  });

  it("saveResumeToken never throws when localStorage access fails", () => {
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => saveResumeToken({ tenantId: "acme", channelId: "wc_1" }, "tok")).not.toThrow();
  });
});
