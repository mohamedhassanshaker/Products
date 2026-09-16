import { describe, expect, it } from "vitest";
import { extractPhoneNumberId } from "./extract-whatsapp-metadata.js";

describe("extractPhoneNumberId", () => {
  it("extracts a real Meta webhook payload's phone_number_id", () => {
    const payload = {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "123456789" } } }] }],
    };
    expect(extractPhoneNumberId(payload)).toBe("123456789");
  });

  it("returns null for a payload missing the field, without throwing", () => {
    expect(extractPhoneNumberId({})).toBeNull();
    expect(extractPhoneNumberId({ entry: [] })).toBeNull();
    expect(extractPhoneNumberId({ entry: [{ changes: [{ value: {} }] }] })).toBeNull();
  });

  it("returns null, not throwing, for non-object input", () => {
    expect(extractPhoneNumberId(null)).toBeNull();
    expect(extractPhoneNumberId("not an object")).toBeNull();
    expect(extractPhoneNumberId(42)).toBeNull();
  });
});
