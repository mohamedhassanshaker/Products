import { describe, expect, it } from "vitest";
import { MAX_TURN_CONTENT_LENGTH, validatePostTurnInput } from "./turn-input.js";

describe("validatePostTurnInput", () => {
  it("accepts a well-formed input", () => {
    expect(
      validatePostTurnInput({ content: "Pay SEWA Bills", inputMode: "chip", clientTurnId: "ct_1" }),
    ).toEqual([]);
  });

  it("rejects empty content", () => {
    const errors = validatePostTurnInput({ content: "", inputMode: "text", clientTurnId: "ct_1" });
    expect(errors).toContainEqual(
      expect.objectContaining({ pointer: "/content", code: "field.required" }),
    );
  });

  it("rejects content over the max length", () => {
    const errors = validatePostTurnInput({
      content: "a".repeat(MAX_TURN_CONTENT_LENGTH + 1),
      inputMode: "text",
      clientTurnId: "ct_1",
    });
    expect(errors).toContainEqual(
      expect.objectContaining({ pointer: "/content", code: "string.max" }),
    );
  });

  it("rejects an unknown inputMode", () => {
    const errors = validatePostTurnInput({
      content: "hi",
      inputMode: "carrier_pigeon",
      clientTurnId: "ct_1",
    });
    expect(errors).toContainEqual(
      expect.objectContaining({ pointer: "/inputMode", code: "enum.invalid" }),
    );
  });

  it("rejects a missing clientTurnId", () => {
    const errors = validatePostTurnInput({ content: "hi", inputMode: "text", clientTurnId: "" });
    expect(errors).toContainEqual(expect.objectContaining({ pointer: "/clientTurnId" }));
  });

  it("is exhaustive, not fail-fast", () => {
    const errors = validatePostTurnInput({ content: "", inputMode: "bad", clientTurnId: "" });
    expect(errors.length).toBe(3);
  });
});
