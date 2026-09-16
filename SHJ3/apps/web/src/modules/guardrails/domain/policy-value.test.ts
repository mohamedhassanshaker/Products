import { describe, expect, it } from "vitest";
import {
  encodeBooleanValue,
  encodeThresholdValue,
  hasTypedEditor,
  isValidPolicyValueJsonText,
  parseThresholdInput,
  unwrapPolicyValue,
} from "./policy-value.js";

describe("hasTypedEditor", () => {
  it("is true only for Boolean and Threshold", () => {
    expect(hasTypedEditor("Boolean")).toBe(true);
    expect(hasTypedEditor("Threshold")).toBe(true);
    expect(hasTypedEditor("Enum")).toBe(false);
    expect(hasTypedEditor("SomeFutureKind")).toBe(false);
  });
});

describe("unwrapPolicyValue", () => {
  it("reads the value out of the real {value: ...} wrapper", () => {
    expect(unwrapPolicyValue(JSON.stringify({ value: true }))).toBe(true);
    expect(unwrapPolicyValue(JSON.stringify({ value: 0.6 }))).toBe(0.6);
  });

  it("returns undefined for malformed JSON, a bare scalar, or a missing key", () => {
    expect(unwrapPolicyValue("not json")).toBeUndefined();
    expect(unwrapPolicyValue("true")).toBeUndefined();
    expect(unwrapPolicyValue(JSON.stringify({ other: 1 }))).toBeUndefined();
    expect(unwrapPolicyValue(JSON.stringify([1, 2]))).toBeUndefined();
  });
});

describe("encodeBooleanValue / encodeThresholdValue", () => {
  it("wrap the scalar in the real, ISJSON-accepted object shape", () => {
    expect(encodeBooleanValue(true)).toBe('{"value":true}');
    expect(encodeThresholdValue(0.75)).toBe('{"value":0.75}');
  });
});

describe("parseThresholdInput", () => {
  it("parses a finite number", () => {
    expect(parseThresholdInput("0.6")).toBe(0.6);
    expect(parseThresholdInput("  1  ")).toBe(1);
  });

  it("refuses blank text rather than coercing it to zero", () => {
    expect(parseThresholdInput("")).toBeNull();
    expect(parseThresholdInput("   ")).toBeNull();
  });

  it("refuses non-numeric text", () => {
    expect(parseThresholdInput("abc")).toBeNull();
    expect(parseThresholdInput("NaN")).toBeNull();
  });
});

describe("isValidPolicyValueJsonText", () => {
  it("accepts a real JSON object or array", () => {
    expect(isValidPolicyValueJsonText('{"value": "In"}')).toBe(true);
    expect(isValidPolicyValueJsonText('["a", "b"]')).toBe(true);
  });

  it("rejects malformed JSON and a bare scalar — matching SQL Server's own ISJSON() rule", () => {
    expect(isValidPolicyValueJsonText("not json")).toBe(false);
    expect(isValidPolicyValueJsonText("true")).toBe(false);
    expect(isValidPolicyValueJsonText("0.6")).toBe(false);
    expect(isValidPolicyValueJsonText("null")).toBe(false);
  });
});
