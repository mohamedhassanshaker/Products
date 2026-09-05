import { describe, expect, it } from "vitest";
import { evaluateGuardrails, type StubGuardrailRule } from "./guardrail-eval.js";

describe("evaluateGuardrails (LLD §6.2 step 3 — PreToolCall short-circuit)", () => {
  it("Allows with no rules configured (this phase's default)", () => {
    expect(evaluateGuardrails([], { toolName: "delete_account", args: {} })).toEqual({ effect: "Allow" });
  });

  it("Allows a tool call that matches no rule", () => {
    const rules: StubGuardrailRule[] = [{ id: "r1", toolName: "delete_account", effect: "BlockToolCall", reason: "never allowed" }];
    expect(evaluateGuardrails(rules, { toolName: "get_order", args: {} })).toEqual({ effect: "Allow" });
  });

  it("BlockToolCall short-circuits before any tool_call row would be created", () => {
    const rules: StubGuardrailRule[] = [{ id: "r1", toolName: "delete_account", effect: "BlockToolCall", reason: "never allowed" }];
    expect(evaluateGuardrails(rules, { toolName: "delete_account", args: {} })).toEqual({ effect: "BlockToolCall", reason: "never allowed" });
  });

  it("EscalateToHuman is distinguishable from BlockToolCall", () => {
    const rules: StubGuardrailRule[] = [{ id: "r1", toolName: "issue_refund", effect: "EscalateToHuman", reason: "requires human review" }];
    expect(evaluateGuardrails(rules, { toolName: "issue_refund", args: {} })).toEqual({ effect: "EscalateToHuman", reason: "requires human review" });
  });

  it("first matching rule wins, in array order", () => {
    const rules: StubGuardrailRule[] = [
      { id: "r1", toolName: "x", effect: "BlockToolCall", reason: "first" },
      { id: "r2", toolName: "x", effect: "EscalateToHuman", reason: "second" },
    ];
    expect(evaluateGuardrails(rules, { toolName: "x", args: {} })).toEqual({ effect: "BlockToolCall", reason: "first" });
  });
});
