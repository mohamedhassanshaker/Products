import { describe, expect, it } from "vitest";
import { applyMapping, evaluateCondition, isParseableCondition, isPath, resolvePath, toJsonValue } from "./expression.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.3) — unit coverage for the
 * two authored expression languages.
 *
 * Two categories of assertion matter most here and are tested hardest:
 *
 *  1. **Fail-closed.** An unparseable `when` must evaluate `false`, never `true` and
 *     never throw. A Router whose branches all evaluate false falls through to its
 *     REQUIRED `default` (V11), so a malformed condition degrades to the authored
 *     default path — but a `true` would silently take a branch the author never meant,
 *     and a throw would take down a pump tick for every other run in the tenant.
 *  2. **No host reach.** These expressions come from a `workflow_version` row. They are
 *     never `eval`'d, and no crafted path may reach a prototype member, a function, or
 *     anything outside the run's own variables.
 */

const root = {
  variables: {
    tier: "gold",
    amount: 250,
    active: true,
    empty: "",
    zero: 0,
    items: [{ id: "a" }, { id: "b" }],
    nested: { deep: { value: "found" } },
    nothing: null,
  },
};

describe("resolvePath", () => {
  it("resolves dotted paths and numeric array indices", () => {
    expect(resolvePath("$.variables.tier", root)).toBe("gold");
    expect(resolvePath("$.variables.nested.deep.value", root)).toBe("found");
    expect(resolvePath("$.variables.items.1.id", root)).toBe("b");
  });

  it("returns undefined for a missing segment rather than throwing", () => {
    expect(resolvePath("$.variables.missing", root)).toBeUndefined();
    expect(resolvePath("$.variables.nested.absent.value", root)).toBeUndefined();
    expect(resolvePath("$.variables.items.9.id", root)).toBeUndefined();
    expect(resolvePath("$.variables.nothing.anything", root)).toBeUndefined();
  });

  it("returns undefined for a non-`$.` value — the path/literal distinction is syntactic", () => {
    expect(resolvePath("tier", root)).toBeUndefined();
    expect(isPath("$.variables.x")).toBe(true);
    expect(isPath("literal text")).toBe(false);
  });

  it("cannot reach a prototype member", () => {
    expect(resolvePath("$.variables.__proto__", root)).toBeUndefined();
    expect(resolvePath("$.variables.constructor", root)).toBeUndefined();
    expect(resolvePath("$.variables.tier.toString", root)).toBeUndefined();
  });

  it("rejects a non-integer array index", () => {
    expect(resolvePath("$.variables.items.length", root)).toBeUndefined();
  });
});

describe("applyMapping", () => {
  it("resolves `$.` values and passes literals through", () => {
    expect(applyMapping({ a: "$.variables.tier", b: "a literal" }, root)).toEqual({ a: "gold", b: "a literal" });
  });

  it("keeps an unresolved key present with value null, rather than dropping it", () => {
    // An absent key and a key that resolved to nothing are genuinely different to a
    // downstream tool schema; dropping it would make a mapping typo look deliberate.
    expect(applyMapping({ a: "$.variables.missing" }, root)).toEqual({ a: null });
  });

  it("carries nested structures through intact", () => {
    expect(applyMapping({ o: "$.variables.nested" }, root)).toEqual({ o: { deep: { value: "found" } } });
  });
});

describe("toJsonValue", () => {
  it("normalizes undefined, non-finite numbers, functions and symbols to null", () => {
    expect(toJsonValue(undefined)).toBeNull();
    expect(toJsonValue(Number.NaN)).toBeNull();
    expect(toJsonValue(Infinity)).toBeNull();
    expect(toJsonValue(() => 1)).toBeNull();
    expect(toJsonValue(Symbol("x"))).toBeNull();
  });

  it("renders a Date as its ISO string, so a checkpoint stays JSON-round-trippable", () => {
    expect(toJsonValue(new Date("2026-08-30T00:00:00.000Z"))).toBe("2026-08-30T00:00:00.000Z");
  });

  it("recurses through arrays and objects", () => {
    expect(toJsonValue({ a: [1, undefined, { b: Number.NaN }] })).toEqual({ a: [1, null, { b: null }] });
  });
});

describe("evaluateCondition — the CEL subset", () => {
  it.each([
    ['$.variables.tier == "gold"', true],
    ["$.variables.tier == 'silver'", false],
    ['$.variables.tier != "silver"', true],
    ["$.variables.amount > 100", true],
    ["$.variables.amount >= 250", true],
    ["$.variables.amount < 100", false],
    ["$.variables.amount <= 250", true],
    ["$.variables.active", true],
    ["!$.variables.active", false],
    ["$.variables.missing", false],
    ['$.variables.tier == "gold" && $.variables.amount > 100', true],
    ['$.variables.tier == "gold" && $.variables.amount > 1000', false],
    ['$.variables.tier == "bronze" || $.variables.amount > 100', true],
    ['($.variables.tier == "bronze" || $.variables.amount > 100) && $.variables.active', true],
    ["true", true],
    ["false", false],
  ])("evaluates %s to %s", (expression, expected) => {
    expect(evaluateCondition(expression, root)).toBe(expected);
  });

  it("uses CEL-ish truthiness, not JavaScript's — an empty string and 0 are falsy, a non-empty array is truthy", () => {
    expect(evaluateCondition("$.variables.empty", root)).toBe(false);
    expect(evaluateCondition("$.variables.zero", root)).toBe(false);
    expect(evaluateCondition("$.variables.items", root)).toBe(true);
    expect(evaluateCondition("$.variables.nothing", root)).toBe(false);
  });

  it("compares strictly — no type coercion between a number and its string form", () => {
    expect(evaluateCondition('$.variables.amount == "250"', root)).toBe(false);
    expect(evaluateCondition("$.variables.amount == 250", root)).toBe(true);
  });

  it("yields false (not a type error) when operands are incomparable", () => {
    expect(evaluateCondition("$.variables.nested > 5", root)).toBe(false);
  });
});

describe("evaluateCondition — FAIL-CLOSED on anything outside the grammar", () => {
  it.each([
    "",
    "   ",
    "$.variables.tier ==",
    "&& $.variables.tier",
    "(unbalanced",
    "$.variables.tier == 'unterminated",
    "$.variables.tier == 'gold' extra",
    // Deliberately hostile: none of these may execute, and none may throw.
    "process.exit(1)",
    "require('fs')",
    "globalThis.foo = 1",
    "constructor.constructor('return 1')()",
    "$.variables.tier.constructor",
    "1; console.log('x')",
  ])("returns false for %j without throwing", (expression) => {
    expect(() => evaluateCondition(expression, root)).not.toThrow();
    expect(evaluateCondition(expression, root)).toBe(false);
  });

  it("treats a bare identifier as unparseable — there are no reachable names in this grammar", () => {
    expect(isParseableCondition("tier")).toBe(false);
    expect(isParseableCondition("undefined")).toBe(false);
    expect(isParseableCondition("true")).toBe(true);
  });
});
