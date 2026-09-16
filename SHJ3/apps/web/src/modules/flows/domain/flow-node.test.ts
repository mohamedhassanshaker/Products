import { describe, expect, it } from "vitest";
import { validateFlowNodeFields, type FlowNodeFields } from "./flow-node.js";

/** A fully-empty base — every test overrides just the fields relevant to the rule it exercises. */
function emptyFields(type: FlowNodeFields["type"]): FlowNodeFields {
  return {
    type,
    title: "A node",
    canvasX: 0,
    canvasY: 0,
    messageText: null,
    quickActionSetKey: null,
    slotName: null,
    optionSourceKind: null,
    optionSourceRef: null,
    staticOptionsJson: null,
    toolBindingId: null,
    retryCount: null,
    retryOnTimeout: null,
    timeoutMs: null,
    onFailureNodeId: null,
    handoverReason: null,
    confidenceThreshold: null,
    conditionExpression: null,
    requiredAssurance: null,
  };
}

describe("validateFlowNodeFields — CK_FlowNodes_* completeness rules", () => {
  it("rejects a Message node with no messageText (CK_FlowNodes_messageFields)", () => {
    const errors = validateFlowNodeFields(emptyFields("Message"));
    expect(errors.some((e) => e.includes("message text"))).toBe(true);
  });

  it("accepts a complete Message node", () => {
    const errors = validateFlowNodeFields({ ...emptyFields("Message"), messageText: "Hello" });
    expect(errors).toHaveLength(0);
  });

  it("rejects a Question node missing slotName or optionSourceKind (CK_FlowNodes_questionFields)", () => {
    const errors = validateFlowNodeFields(emptyFields("Question"));
    expect(errors.some((e) => e.includes("slot name"))).toBe(true);
    expect(errors.some((e) => e.includes("option source"))).toBe(true);
  });

  it("accepts a complete Question node", () => {
    const errors = validateFlowNodeFields({
      ...emptyFields("Question"),
      slotName: "account_number",
      optionSourceKind: "Static",
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects a ToolCall node missing any of toolBindingId/retryCount/onFailureNodeId (CK_FlowNodes_toolCallFields) — the exact shape B7's retry contract requires all three together", () => {
    const missingAll = validateFlowNodeFields(emptyFields("ToolCall"));
    expect(missingAll).toEqual(
      expect.arrayContaining([
        expect.stringContaining("bound tool"),
        expect.stringContaining("retry count"),
        expect.stringContaining("failure path"),
      ]),
    );

    const missingOnlyFailurePath = validateFlowNodeFields({
      ...emptyFields("ToolCall"),
      toolBindingId: "toolbinding_1",
      retryCount: 1,
    });
    expect(missingOnlyFailurePath).toEqual([
      "A Tool call node needs a failure path (which node to move to on failure).",
    ]);
  });

  it("accepts a complete ToolCall node", () => {
    const errors = validateFlowNodeFields({
      ...emptyFields("ToolCall"),
      toolBindingId: "toolbinding_1",
      retryCount: 1,
      onFailureNodeId: "flownode_fallback",
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects retryCount outside 0..3 (CK_FlowNodes_retryBounded)", () => {
    const tooHigh = validateFlowNodeFields({
      ...emptyFields("ToolCall"),
      toolBindingId: "toolbinding_1",
      retryCount: 4,
      onFailureNodeId: "flownode_fallback",
    });
    expect(tooHigh.some((e) => e.includes("Retry count"))).toBe(true);

    const negative = validateFlowNodeFields({
      ...emptyFields("ToolCall"),
      toolBindingId: "toolbinding_1",
      retryCount: -1,
      onFailureNodeId: "flownode_fallback",
    });
    expect(negative.some((e) => e.includes("Retry count"))).toBe(true);
  });

  it("rejects a Handover node with no handoverReason (CK_FlowNodes_handoverFields)", () => {
    const errors = validateFlowNodeFields(emptyFields("Handover"));
    expect(errors).toEqual(["A Handover node needs a reason (Tool failure or Low confidence)."]);
  });

  it("accepts a complete Handover node", () => {
    const errors = validateFlowNodeFields({
      ...emptyFields("Handover"),
      handoverReason: "ToolFailure",
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects a Condition node with no conditionExpression (CK_FlowNodes_conditionFields)", () => {
    const errors = validateFlowNodeFields(emptyFields("Condition"));
    expect(errors).toEqual(["A Condition node needs a condition expression."]);
  });

  it("accepts a complete Condition node", () => {
    const errors = validateFlowNodeFields({
      ...emptyFields("Condition"),
      conditionExpression: "slots.account_status == 'active'",
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects malformed staticOptionsJson (CK_FlowNodes_staticOptionsJson_isJson)", () => {
    const errors = validateFlowNodeFields({
      ...emptyFields("Question"),
      slotName: "preferred_channel",
      optionSourceKind: "Static",
      staticOptionsJson: "{not valid json",
    });
    expect(errors.some((e) => e.includes("valid JSON"))).toBe(true);
  });

  it("rejects a node with a blank title regardless of type", () => {
    const errors = validateFlowNodeFields({
      ...emptyFields("Message"),
      title: "   ",
      messageText: "Hi",
    });
    expect(errors.some((e) => e.includes("title"))).toBe(true);
  });
});
