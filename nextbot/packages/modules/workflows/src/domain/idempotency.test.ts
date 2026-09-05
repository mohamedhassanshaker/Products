import { describe, expect, it } from "vitest";
import { compensationIdempotencyKey, computeIdempotencyKey, type IdempotencyContext } from "./idempotency.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-04) — unit coverage for the
 * property the whole crash-resume guarantee rests on.
 *
 * LLD §14.6.2: "a crash mid-node re-executes at most one node — and every
 * write-classified node carries an idempotency key (FR-WF-04), so re-execution is safe."
 * That second clause is only true if a re-execution produces the **byte-identical** key.
 * A key derived from `crypto.randomUUID()` at dispatch time would be a different key on
 * the retry, the downstream tool would see a brand-new request, and the write would be
 * applied twice.
 *
 * So determinism is not a nice property here — it is the safety property, and it is
 * tested first and hardest.
 */

const base: IdempotencyContext = {
  runId: "11111111-1111-4111-8111-111111111111",
  nodeId: "issue_refund",
  iteration: 0,
  args: { amount: 100, currency: "USD" },
};

describe("computeIdempotencyKey — determinism (the crash-resume safety property)", () => {
  it.each(["RunScopedUuid", "DerivedFromArgs", "CallerSupplied"] as const)("%s produces the identical key for the identical context, every time", (strategy) => {
    const first = computeIdempotencyKey(strategy, { ...base, argPath: "orderId" });
    for (let i = 0; i < 25; i += 1) {
      expect(computeIdempotencyKey(strategy, { ...base, argPath: "orderId" })).toBe(first);
    }
  });

  it("produces a canonical v4-shaped UUID, because tool_call.idempotency_key is a uuid column", () => {
    const key = computeIdempotencyKey("RunScopedUuid", base);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("computeIdempotencyKey — the key must DIFFER where a collision would lose data", () => {
  it("differs per loop iteration — otherwise iteration 2 would be deduplicated against iteration 1 and silently skipped", () => {
    const first = computeIdempotencyKey("RunScopedUuid", { ...base, iteration: 1 });
    const second = computeIdempotencyKey("RunScopedUuid", { ...base, iteration: 2 });
    expect(first).not.toBe(second);
  });

  it("differs per node — two write nodes in the same run are two distinct writes", () => {
    expect(computeIdempotencyKey("RunScopedUuid", base)).not.toBe(computeIdempotencyKey("RunScopedUuid", { ...base, nodeId: "charge_card" }));
  });

  it("differs per run — the same graph executed twice is two distinct writes", () => {
    const other = { ...base, runId: "22222222-2222-4222-8222-222222222222" };
    expect(computeIdempotencyKey("RunScopedUuid", base)).not.toBe(computeIdempotencyKey("RunScopedUuid", other));
  });
});

describe("computeIdempotencyKey — DerivedFromArgs", () => {
  it("is insensitive to key ORDER, so a rebuilt args map still deduplicates", () => {
    const a = computeIdempotencyKey("DerivedFromArgs", { ...base, args: { amount: 100, currency: "USD" } });
    const b = computeIdempotencyKey("DerivedFromArgs", { ...base, args: { currency: "USD", amount: 100 } });
    expect(a).toBe(b);
  });

  it("is sensitive to args VALUES — a different payload is a different write", () => {
    const a = computeIdempotencyKey("DerivedFromArgs", { ...base, args: { amount: 100 } });
    const b = computeIdempotencyKey("DerivedFromArgs", { ...base, args: { amount: 101 } });
    expect(a).not.toBe(b);
  });

  it("canonicalizes nested objects and arrays at every depth", () => {
    const a = computeIdempotencyKey("DerivedFromArgs", { ...base, args: { o: { x: 1, y: [1, { b: 2, a: 1 }] } } });
    const b = computeIdempotencyKey("DerivedFromArgs", { ...base, args: { o: { y: [1, { a: 1, b: 2 }], x: 1 } } });
    expect(a).toBe(b);
  });
});

describe("computeIdempotencyKey — CallerSupplied", () => {
  it("keys off the value at the declared argPath", () => {
    const a = computeIdempotencyKey("CallerSupplied", { ...base, args: { orderId: "ORD-1" }, argPath: "orderId" });
    const b = computeIdempotencyKey("CallerSupplied", { ...base, args: { orderId: "ORD-2" }, argPath: "orderId" });
    expect(a).not.toBe(b);
  });

  it("reads a nested and a `$.`-prefixed path identically", () => {
    const nested = computeIdempotencyKey("CallerSupplied", { ...base, args: { order: { id: "ORD-1" } }, argPath: "order.id" });
    const prefixed = computeIdempotencyKey("CallerSupplied", { ...base, args: { order: { id: "ORD-1" } }, argPath: "$.order.id" });
    expect(nested).toBe(prefixed);
  });

  it("falls back to the DETERMINISTIC RunScopedUuid derivation when the path does not resolve — never to a random key", () => {
    const missing = computeIdempotencyKey("CallerSupplied", { ...base, args: {}, argPath: "orderId" });
    expect(missing).toBe(computeIdempotencyKey("RunScopedUuid", base));
  });

  it("cannot be steered onto a prototype member by a crafted argPath", () => {
    const viaProto = computeIdempotencyKey("CallerSupplied", { ...base, args: {}, argPath: "__proto__.constructor" });
    // Resolves to nothing and falls back — never reaches a host object.
    expect(viaProto).toBe(computeIdempotencyKey("RunScopedUuid", base));
  });
});

describe("compensationIdempotencyKey", () => {
  it("is deterministic, so a crash DURING the unwind cannot double-apply a compensating write", () => {
    const forward = computeIdempotencyKey("RunScopedUuid", base);
    expect(compensationIdempotencyKey(forward)).toBe(compensationIdempotencyKey(forward));
  });

  it("differs from the forward key it undoes — a refund is not the charge", () => {
    const forward = computeIdempotencyKey("RunScopedUuid", base);
    expect(compensationIdempotencyKey(forward)).not.toBe(forward);
  });

  it("is UUID-shaped, like the forward key", () => {
    expect(compensationIdempotencyKey(computeIdempotencyKey("RunScopedUuid", base))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
