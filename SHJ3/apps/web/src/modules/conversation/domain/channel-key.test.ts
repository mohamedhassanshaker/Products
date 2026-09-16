import { describe, expect, it } from "vitest";
import { formatChannelKey, InvalidChannelKeyError, parseChannelKey } from "./channel-key.js";

describe("parseChannelKey", () => {
  it("parses a well-formed web widget key", () => {
    expect(parseChannelKey("sewa.WebWidget")).toEqual({ tenant: "sewa", channelKind: "WebWidget" });
  });

  it("parses a well-formed WhatsApp key", () => {
    expect(parseChannelKey("sewa.WhatsApp")).toEqual({ tenant: "sewa", channelKind: "WhatsApp" });
  });

  it("rejects a non-string input", () => {
    expect(() => parseChannelKey(undefined)).toThrow(InvalidChannelKeyError);
    expect(() => parseChannelKey(42)).toThrow(InvalidChannelKeyError);
  });

  it("rejects an empty string", () => {
    expect(() => parseChannelKey("")).toThrow(InvalidChannelKeyError);
  });

  it("rejects a key with no dot", () => {
    expect(() => parseChannelKey("sewa")).toThrow(InvalidChannelKeyError);
  });

  it("rejects a key with an empty tenant segment", () => {
    expect(() => parseChannelKey(".WebWidget")).toThrow(InvalidChannelKeyError);
  });

  it("rejects a key with an empty channel-kind segment", () => {
    expect(() => parseChannelKey("sewa.")).toThrow(InvalidChannelKeyError);
  });

  it("rejects a key with three segments", () => {
    expect(() => parseChannelKey("sewa.Web.Widget")).toThrow(InvalidChannelKeyError);
  });

  it("rejects an invalid tenant slug shape", () => {
    expect(() => parseChannelKey("SEWA.WebWidget")).toThrow(InvalidChannelKeyError);
    expect(() => parseChannelKey("1sewa.WebWidget")).toThrow(InvalidChannelKeyError);
  });

  it("rejects a reserved tenant name", () => {
    expect(() => parseChannelKey("platform.WebWidget")).toThrow(InvalidChannelKeyError);
  });

  it("rejects an unknown channel kind", () => {
    expect(() => parseChannelKey("sewa.MobileApp")).toThrow(InvalidChannelKeyError);
    expect(() => parseChannelKey("sewa.KioskIvr")).toThrow(InvalidChannelKeyError);
    expect(() => parseChannelKey("sewa.WEBWIDGET")).toThrow(InvalidChannelKeyError);
  });
});

describe("formatChannelKey", () => {
  it("is the inverse of parseChannelKey", () => {
    const formatted = formatChannelKey("sewa" as never, "WebWidget");
    expect(formatted).toBe("sewa.WebWidget");
    expect(parseChannelKey(formatted)).toEqual({ tenant: "sewa", channelKind: "WebWidget" });
  });
});
