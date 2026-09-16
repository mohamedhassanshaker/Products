import { describe, expect, it } from "vitest";
import {
  ConditionSyntaxError,
  describe as describeCondition,
  evaluate,
  parse,
  resolveFieldSpec,
  validate,
  type ConditionContext,
  type ConditionNodeSnapshot,
} from "./pipeline-condition.js";

function ctx(overrides: Partial<ConditionContext> = {}): ConditionContext {
  const lastReply: ConditionNodeSnapshot = {
    text: "hello world",
    confidence: 0.42,
    status: "Ok",
    agentId: "agt_1",
  };
  return {
    iteration: 1,
    hopCount: 2,
    groundingConfidence: 0.4,
    costTokens: 100,
    costMicroAed: 5000,
    branchCostTokens: 50,
    degraded: false,
    usedFallbackModel: false,
    lastReply,
    nodeOutputs: {},
    ...overrides,
  };
}

describe("parse", () => {
  it("parses a single comparison", () => {
    const ast = parse("iteration < 3");
    expect(ast.orGroups).toEqual([[{ field: "iteration", operator: "<", value: 3 }]]);
  });

  it("binds and tighter than or", () => {
    const ast = parse("iteration < 3 and hopCount < 5 or degraded == true");
    expect(ast.orGroups).toHaveLength(2);
    expect(ast.orGroups[0]).toHaveLength(2);
    expect(ast.orGroups[1]).toHaveLength(1);
  });

  it("parses a string literal", () => {
    expect(parse("lastReply.status == 'Ok'").orGroups[0]?.[0]?.value).toBe("Ok");
  });

  it("parses the contains operator", () => {
    expect(parse("lastReply.text contains 'refund'").orGroups[0]?.[0]?.operator).toBe("contains");
  });

  it("parses a boolean literal", () => {
    expect(parse("degraded == false").orGroups[0]?.[0]?.value).toBe(false);
  });

  it("parses a templated node field", () => {
    expect(parse("node.triage.confidence >= 0.5").orGroups[0]?.[0]?.field).toBe("node.triage.confidence");
  });

  it("rejects an empty expression", () => {
    expect(() => parse("")).toThrow(ConditionSyntaxError);
    try {
      parse("");
    } catch (error) {
      expect((error as ConditionSyntaxError).issue.code).toBe("condition.condition_empty");
    }
  });

  it("rejects an expression over the length limit", () => {
    try {
      parse(`iteration < ${"9".repeat(500)}`);
      throw new Error("expected ConditionSyntaxError");
    } catch (error) {
      expect((error as ConditionSyntaxError).issue.code).toBe("condition.too_long");
    }
  });

  it("rejects more than eight predicates", () => {
    const comparisons: string[] = [];
    for (let i = 0; i < 9; i++) comparisons.push(`hopCount < ${i}`);
    const expr = comparisons.join(" and ");
    try {
      parse(expr);
      throw new Error("expected ConditionSyntaxError");
    } catch (error) {
      expect((error as ConditionSyntaxError).issue.code).toBe("condition.too_many_terms");
    }
  });

  it("rejects a missing operator", () => {
    try {
      parse("iteration 3");
      throw new Error("expected ConditionSyntaxError");
    } catch (error) {
      expect((error as ConditionSyntaxError).issue.code).toBe("condition.syntax_error");
    }
  });

  it("rejects trailing garbage", () => {
    try {
      parse("iteration < 3 banana");
      throw new Error("expected ConditionSyntaxError");
    } catch (error) {
      expect((error as ConditionSyntaxError).issue.code).toBe("condition.syntax_error");
    }
  });

  it("rejects an unexpected character", () => {
    try {
      parse("iteration < 3 & hopCount < 2");
      throw new Error("expected ConditionSyntaxError");
    } catch (error) {
      expect((error as ConditionSyntaxError).issue.code).toBe("condition.syntax_error");
    }
  });
});

describe("validate", () => {
  it("accepts a known field with a compatible operator", () => {
    expect(validate("groundingConfidence < 0.6")).toEqual([]);
  });

  it("rejects an unknown field", () => {
    expect(validate("madeUpField < 3").map((i) => i.code)).toEqual(["condition.unknown_field"]);
  });

  it("rejects an unknown templated node key", () => {
    const issues = validate("node.unknown.confidence >= 0.5", new Set(["triage"]));
    expect(issues.map((i) => i.code)).toEqual(["condition.unknown_field"]);
  });

  it("accepts a known templated node key", () => {
    expect(validate("node.triage.confidence >= 0.5", new Set(["triage"]))).toEqual([]);
  });

  it("rejects contains on a numeric field", () => {
    const codes = validate("hopCount contains '3'").map((i) => i.code);
    expect(codes).toContain("condition.operator_not_allowed");
  });

  it("rejects a numeric operator on a text field", () => {
    const codes = validate("lastReply.text < 3").map((i) => i.code);
    expect(codes).toContain("condition.operator_not_allowed");
  });

  it("rejects a type mismatch: number field, string literal", () => {
    expect(validate("groundingConfidence == 'high'").map((i) => i.code)).toEqual(["condition.type_mismatch"]);
  });

  it("rejects a type mismatch: boolean field, number literal", () => {
    expect(validate("degraded == 1").map((i) => i.code)).toEqual(["condition.type_mismatch"]);
  });

  it("short-circuits a syntax error to one issue", () => {
    const issues = validate("");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("condition.condition_empty");
  });
});

describe("resolveFieldSpec", () => {
  it("resolves a flat field", () => {
    expect(resolveFieldSpec("iteration", undefined)).toBeDefined();
  });

  it("resolves a dotted lastReply field", () => {
    expect(resolveFieldSpec("lastReply.confidence", undefined)).toBeDefined();
  });

  it("returns undefined for an unknown field", () => {
    expect(resolveFieldSpec("notAField", undefined)).toBeUndefined();
  });

  it("requires a known node key when a set is supplied", () => {
    expect(resolveFieldSpec("node.x.confidence", new Set(["y"]))).toBeUndefined();
    expect(resolveFieldSpec("node.x.confidence", new Set(["x"]))).toBeDefined();
  });

  it("accepts any node key when no known-key set is supplied", () => {
    expect(resolveFieldSpec("node.anything.confidence", undefined)).toBeDefined();
  });
});

describe("evaluate", () => {
  it("evaluates a true predicate", () => {
    expect(evaluate(parse("iteration < 3"), ctx({ iteration: 1 }))).toBe(true);
  });

  it("evaluates a false predicate", () => {
    expect(evaluate(parse("iteration < 3"), ctx({ iteration: 5 }))).toBe(false);
  });

  it("or is true if either group is true", () => {
    const ast = parse("iteration > 100 or hopCount < 5");
    expect(evaluate(ast, ctx({ iteration: 1, hopCount: 2 }))).toBe(true);
  });

  it("and requires every predicate in the group", () => {
    const ast = parse("iteration < 3 and hopCount < 1");
    expect(evaluate(ast, ctx({ iteration: 1, hopCount: 2 }))).toBe(false);
  });

  it("contains matches on lastReply.text", () => {
    expect(evaluate(parse("lastReply.text contains 'world'"), ctx())).toBe(true);
  });

  it("an unresolvable field evaluates false, not an error", () => {
    expect(evaluate(parse("groundingConfidence < 0.6"), ctx({ groundingConfidence: null }))).toBe(false);
  });

  it("no lastReply yet evaluates false", () => {
    expect(evaluate(parse("lastReply.confidence >= 0.5"), ctx({ lastReply: null }))).toBe(false);
  });

  it("a templated node field reads nodeOutputs", () => {
    const ast = parse("node.triage.confidence >= 0.5");
    const context = ctx({
      nodeOutputs: { triage: { text: "t", confidence: 0.9, status: "Ok", agentId: "a" } },
    });
    expect(evaluate(ast, context)).toBe(true);
  });

  it("an unknown templated node key at runtime evaluates false", () => {
    expect(evaluate(parse("node.missing.confidence >= 0.5"), ctx({ nodeOutputs: {} }))).toBe(false);
  });
});

describe("describe", () => {
  it("round-trips a simple predicate", () => {
    expect(describeCondition(parse("iteration < 3"))).toBe("iteration < 3");
  });

  it("normalizes whitespace", () => {
    expect(describeCondition(parse("iteration<3"))).toBe(describeCondition(parse("iteration   <   3")));
  });

  it("renders and/or structure", () => {
    const text = describeCondition(parse("iteration < 3 and hopCount < 5 or degraded == true"));
    expect(text).toBe("iteration < 3 and hopCount < 5 or degraded == true");
  });
});
