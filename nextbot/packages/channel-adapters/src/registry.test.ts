import { describe, expect, it } from "vitest";
import { getChannelAdapter, ChannelAdapterNotImplementedError } from "./registry.js";
import { whatsAppAdapter } from "./whatsapp/adapter.js";

describe("channel adapter registry (LLD §8 — 'the only switch in the codebase')", () => {
  it("resolves the WhatsApp adapter", () => {
    expect(getChannelAdapter("WhatsApp")).toBe(whatsAppAdapter);
  });

  it("throws a typed error for a channel type with no adapter implemented yet", () => {
    expect(() => getChannelAdapter("Messenger")).toThrow(ChannelAdapterNotImplementedError);
    expect(() => getChannelAdapter("Instagram")).toThrow(/is implemented yet/);
  });
});
