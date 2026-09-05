import { describe, expect, it } from "vitest";
import { evaluateExpression } from "./expression-evaluator.js";

describe("evaluateExpression (restricted CEL-subset, LLD §3.6)", () => {
  it("supports > >= < <= == != on numeric args", () => {
    expect(evaluateExpression("args.amount > 5000", { amount: 5001 })).toBe(true);
    expect(evaluateExpression("args.amount > 5000", { amount: 5000 })).toBe(false);
    expect(evaluateExpression("args.amount >= 5000", { amount: 5000 })).toBe(true);
    expect(evaluateExpression("args.amount < 5000", { amount: 100 })).toBe(true);
    expect(evaluateExpression("args.amount <= 5000", { amount: 5000 })).toBe(true);
    expect(evaluateExpression("args.amount == 5000", { amount: 5000 })).toBe(true);
    expect(evaluateExpression("args.amount != 5000", { amount: 1 })).toBe(true);
  });

  it("supports quoted string literal equality on nested paths", () => {
    expect(evaluateExpression('args.customer.tier == "gold"', { customer: { tier: "gold" } })).toBe(true);
    expect(evaluateExpression('args.customer.tier == "gold"', { customer: { tier: "silver" } })).toBe(false);
  });

  it("fails closed (false) when the referenced property is missing", () => {
    expect(evaluateExpression("args.amount > 5000", {})).toBe(false);
    expect(evaluateExpression("args.amount > 5000", undefined)).toBe(false);
  });

  it("fails closed (false) on an unsupported/malformed expression rather than throwing", () => {
    expect(evaluateExpression("1 + 1", { amount: 1 })).toBe(false);
    expect(evaluateExpression("args.amount; process.exit(1)", { amount: 1 })).toBe(false);
    expect(() => evaluateExpression("`${process.env.SECRET}`", {})).not.toThrow();
  });
});
