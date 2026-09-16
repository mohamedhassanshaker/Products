import { describe, expect, it } from "vitest";
import { classifyFeedbackRootCause } from "./feedback-root-cause.js";

describe("classifyFeedbackRootCause", () => {
  it("a refused turn is GuardrailRefusal regardless of anything else", () => {
    expect(
      classifyFeedbackRootCause({
        wasRefused: true,
        hasFailedToolCall: true,
        groundingConfidence: 0.9,
      }),
    ).toBe("GuardrailRefusal");
  });

  it("a failed tool call (not refused) is ToolFailure", () => {
    expect(
      classifyFeedbackRootCause({
        wasRefused: false,
        hasFailedToolCall: true,
        groundingConfidence: 0.9,
      }),
    ).toBe("ToolFailure");
  });

  it("no grounding signal at all is MissingKnowledge", () => {
    expect(
      classifyFeedbackRootCause({
        wasRefused: false,
        hasFailedToolCall: false,
        groundingConfidence: null,
      }),
    ).toBe("MissingKnowledge");
  });

  it("low grounding confidence is MissingKnowledge", () => {
    expect(
      classifyFeedbackRootCause({
        wasRefused: false,
        hasFailedToolCall: false,
        groundingConfidence: 0.2,
      }),
    ).toBe("MissingKnowledge");
  });

  it("high grounding confidence with no other signal falls to Other — StaleSource is never inferred", () => {
    expect(
      classifyFeedbackRootCause({
        wasRefused: false,
        hasFailedToolCall: false,
        groundingConfidence: 0.95,
      }),
    ).toBe("Other");
  });
});
