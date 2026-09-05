import { describe, expect, it } from "vitest";
import { backendTimeoutFallback, goalNotUnderstoodFallback, toolCallFailureFallback, humanHandoffFallback } from "./fallback-messages.js";

describe("FR-AI-05 fallback messages — three fixed classes", () => {
  it("backendTimeoutFallback carries the BackendTimeout reason", () => {
    expect(backendTimeoutFallback()).toMatchObject({ contentType: "Error", reason: "BackendTimeout" });
  });

  it("goalNotUnderstoodFallback carries the GoalNotUnderstood reason and passes through chips", () => {
    const chips = [{ id: "a", label: "Option A" }];
    expect(goalNotUnderstoodFallback(chips)).toMatchObject({ contentType: "Error", reason: "GoalNotUnderstood", chips });
  });

  it("toolCallFailureFallback carries the ToolCallFailure reason", () => {
    expect(toolCallFailureFallback()).toMatchObject({ contentType: "Error", reason: "ToolCallFailure" });
  });

  it("humanHandoffFallback (A.2.11, Phase 16/BL-09) carries the exact required copy", () => {
    expect(humanHandoffFallback()).toEqual({
      contentType: "Text",
      text: "I'm connecting you with a support agent. Please hold on…",
    });
  });
});
