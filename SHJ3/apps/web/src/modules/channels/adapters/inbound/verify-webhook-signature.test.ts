import { describe, expect, it } from "vitest";
import {
  computeHmacSha256Hex,
  timingSafeEqualStrings,
  verifyHubVerifyToken,
  verifyMetaSignatureHeader,
} from "./verify-webhook-signature.js";

describe("timingSafeEqualStrings", () => {
  it("is true for identical strings", () => {
    expect(timingSafeEqualStrings("abc", "abc")).toBe(true);
  });

  it("is false for different strings of the same length", () => {
    expect(timingSafeEqualStrings("abc", "abd")).toBe(false);
  });

  it("is false, not throwing, for different lengths", () => {
    expect(() => timingSafeEqualStrings("abc", "abcd")).not.toThrow();
    expect(timingSafeEqualStrings("abc", "abcd")).toBe(false);
  });
});

describe("verifyMetaSignatureHeader", () => {
  const appSecret = "test-app-secret";
  const body = Buffer.from(JSON.stringify({ hello: "world" }));

  it("accepts the correct signature over the exact raw bytes", () => {
    const signature = `sha256=${computeHmacSha256Hex(appSecret, body)}`;
    expect(verifyMetaSignatureHeader(signature, body, appSecret)).toBe(true);
  });

  it("rejects a signature computed over different bytes (a re-serialized body)", () => {
    const reSerialized = Buffer.from(JSON.stringify({ hello: "world " })); // trailing space
    const signature = `sha256=${computeHmacSha256Hex(appSecret, reSerialized)}`;
    expect(verifyMetaSignatureHeader(signature, body, appSecret)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyMetaSignatureHeader(undefined, body, appSecret)).toBe(false);
    expect(verifyMetaSignatureHeader(null, body, appSecret)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const hex = computeHmacSha256Hex(appSecret, body);
    expect(verifyMetaSignatureHeader(hex, body, appSecret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const signature = `sha256=${computeHmacSha256Hex("wrong-secret", body)}`;
    expect(verifyMetaSignatureHeader(signature, body, appSecret)).toBe(false);
  });

  it("rejects a tampered payload signed with a different secret entirely, without throwing", () => {
    expect(() =>
      verifyMetaSignatureHeader("sha256=not-even-hex-length", body, appSecret),
    ).not.toThrow();
    expect(verifyMetaSignatureHeader("sha256=not-even-hex-length", body, appSecret)).toBe(false);
  });
});

describe("verifyHubVerifyToken", () => {
  it("accepts the matching token", () => {
    expect(verifyHubVerifyToken("real-token", "real-token")).toBe(true);
  });

  it("rejects a mismatched token", () => {
    expect(verifyHubVerifyToken("wrong-token", "real-token")).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(verifyHubVerifyToken(null, "real-token")).toBe(false);
  });
});
