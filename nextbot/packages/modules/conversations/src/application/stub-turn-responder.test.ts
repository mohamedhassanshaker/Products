import { describe, expect, it } from "vitest";
import { generateStubAiReply, generatePlaceholderRunId } from "./stub-turn-responder.js";

describe("generateStubAiReply (Phase 7 placeholder — replaced by orchestration in Phase 12)", () => {
  it("acknowledges a Text message generically", () => {
    const reply = generateStubAiReply({ contentType: "Text", text: "hello" });
    expect(reply.contentType).toBe("Text");
    expect((reply as { text: string }).text).toMatch(/placeholder/i);
  });

  it("names the selected quick-reply chip", () => {
    const reply = generateStubAiReply({
      contentType: "QuickReply",
      chips: [{ id: "a", label: "Check Status" }],
      selectedChipId: "a",
    });
    expect((reply as { text: string }).text).toContain("Check Status");
  });

  it("names the selected list item", () => {
    const reply = generateStubAiReply({
      contentType: "List",
      items: [{ id: "x", label: "Savings Account" }],
      selectedItemId: "x",
    });
    expect((reply as { text: string }).text).toContain("Savings Account");
  });

  it("reports the number of submitted form fields", () => {
    const reply = generateStubAiReply({
      contentType: "Form",
      fields: [{ name: "email", label: "Email", type: "email" }],
      submitLabel: "Submit",
      values: { email: "a@b.com" },
    });
    expect((reply as { text: string }).text).toContain("1 field");
  });

  it("falls back to the generic acknowledgement for an unmatched chip/item id", () => {
    const reply = generateStubAiReply({ contentType: "QuickReply", chips: [{ id: "a", label: "X" }], selectedChipId: "not-found" });
    expect((reply as { text: string }).text).toMatch(/received your message/i);
  });
});

describe("generatePlaceholderRunId", () => {
  it("returns a fresh id on every call", () => {
    expect(generatePlaceholderRunId()).not.toBe(generatePlaceholderRunId());
  });
});
