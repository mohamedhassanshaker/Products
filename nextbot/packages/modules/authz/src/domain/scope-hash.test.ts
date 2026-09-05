import { describe, expect, it } from "vitest";
import { canonicalize, hashScopeInput } from "./scope-hash.js";
import { evaluate } from "./intersect.js";

describe("scope-hash", () => {
  it("canonicalize sorts object keys recursively so key order never affects the hash", () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("hashScopeInput is deterministic for the same canonical value", () => {
    expect(hashScopeInput({ a: 1, b: 2 })).toBe(hashScopeInput({ b: 2, a: 1 }));
  });

  it("evaluate() still returns a valid Deny(SCOPE_MALFORMED) scopeHash even for an input that cannot itself be hashed (e.g. a circular reference) — safeHash()'s fallback path", () => {
    const circular: Record<string, unknown> = { garbage: true };
    circular.self = circular;
    const result = evaluate(circular);
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("SCOPE_MALFORMED");
    expect(result.scopeHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
