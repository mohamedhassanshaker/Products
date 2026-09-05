import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * E11 (LLD §14.2.4) — "The evaluator itself throws -> Callers must use
 * evaluateOrDeny(), which catches, logs at `error`, emits
 * `guardrail.evaluator_error`, and returns Deny(EVALUATOR_ERROR)."
 *
 * `evaluate()` never throws for a merely-malformed input (that's a real
 * `Deny(SCOPE_MALFORMED)` result, asserted in `intersect.test.ts`) — this test
 * exercises the genuinely-exceptional path (a bug inside the evaluator itself)
 * by mocking `../domain/intersect.js`'s `evaluate` to throw, which is the
 * correct, narrow use of a mock here: forcing a branch real input can't reach.
 */
vi.mock("../domain/intersect.js", () => ({
  evaluate: vi.fn(() => {
    throw new Error("simulated evaluator bug");
  }),
}));

vi.mock("@nextbot/db", () => ({
  withTenant: vi.fn(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn({ insert: () => ({ values: async () => undefined }) })),
  schema: { domainEvent: {} },
  generateId: () => "00000000-0000-4000-8000-000000000000",
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("evaluateOrDeny() — E11 fail-closed wrapper", () => {
  it("returns Deny(EVALUATOR_ERROR) with an empty trace and a valid scopeHash when evaluate() throws", async () => {
    const { evaluateOrDeny } = await import("./evaluate-or-deny.js");
    const ctx = { tenantId: "11111111-1111-4111-8111-111111111111", region: "US" as const, environment: "Sandbox" as const };
    const result = await evaluateOrDeny(ctx, { anything: "goes, this input is never actually parsed since evaluate() is mocked" });
    expect(result.decision).toBe("Deny");
    expect(result.denyReason).toBe("EVALUATOR_ERROR");
    expect(result.denyDetail).toContain("simulated evaluator bug");
    expect(result.trace).toEqual([]);
    expect(typeof result.scopeHash).toBe("string");
  });

  it("never throws into the caller even if writing the audit-trail domain event itself fails (a disk-full/DB-unavailable error must not mask the fail-closed Deny)", async () => {
    vi.doMock("@nextbot/db", () => ({
      withTenant: vi.fn(async () => {
        throw new Error("db unavailable");
      }),
      schema: { domainEvent: {} },
      generateId: () => "00000000-0000-4000-8000-000000000000",
    }));
    vi.resetModules();
    const { evaluateOrDeny } = await import("./evaluate-or-deny.js");
    const ctx = { tenantId: "11111111-1111-4111-8111-111111111111", region: "US" as const, environment: "Sandbox" as const };
    await expect(evaluateOrDeny(ctx, {})).resolves.toMatchObject({ decision: "Deny", denyReason: "EVALUATOR_ERROR" });
  });
});
