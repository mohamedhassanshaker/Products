import { describe, expect, it } from "vitest";
import { allowedTransitions, canPromote, type PromotionCheckInput } from "./promotion-policy.js";

const base: PromotionCheckInput = {
  currentStatus: "Draft",
  targetStatus: "EvalGated",
  createdByUserId: "user-1",
  actingUserId: "user-2",
  lastEvalRun: null,
  definitionHash: "hash-a",
  graphType: "ADK",
  installedGraphTypes: ["ADK", "CustomFSM"],
  hasActiveTraffic: false,
  // Phase 7 (client-feedback-batch item 6) — defaults to "already sandbox-tested"
  // so every pre-existing test above (none of which is about this gate) keeps
  // testing exactly the condition it already tests, isolated from this new one.
  // The `Approved -> Production` describe block below overrides this explicitly in
  // both directions.
  lastSandboxTestAt: new Date("2026-01-01T00:00:00Z"),
};

describe("canPromote (LLD §3.10 promotion-policy state machine)", () => {
  it("Draft -> EvalGated is always allowed", () => {
    expect(canPromote(base)).toEqual({ allowed: true });
  });

  it("rejects a transition to the same status", () => {
    expect(canPromote({ ...base, currentStatus: "Draft", targetStatus: "Draft" }).allowed).toBe(false);
  });

  it("rejects skipping a status (Draft -> HumanReview)", () => {
    const result = canPromote({ ...base, currentStatus: "Draft", targetStatus: "HumanReview" });
    expect(result).toEqual({ allowed: false, reason: "Cannot promote to 'HumanReview' from 'Draft' — must be 'EvalGated' first." });
  });

  describe("EvalGated -> HumanReview", () => {
    const input: PromotionCheckInput = { ...base, currentStatus: "EvalGated", targetStatus: "HumanReview" };

    it("rejects when no eval run has been submitted", () => {
      expect(canPromote({ ...input, lastEvalRun: null }).allowed).toBe(false);
    });

    it("rejects when the eval run's definitionHash is stale", () => {
      const result = canPromote({ ...input, lastEvalRun: { status: "Passed", definitionHash: "stale-hash" } });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/changed since its last eval run/);
    });

    it("rejects when the eval run failed", () => {
      const result = canPromote({ ...input, lastEvalRun: { status: "Failed", definitionHash: "hash-a" } });
      expect(result.allowed).toBe(false);
    });

    it("allows when the eval run passed against the current hash", () => {
      expect(canPromote({ ...input, lastEvalRun: { status: "Passed", definitionHash: "hash-a" } })).toEqual({ allowed: true });
    });
  });

  describe("HumanReview -> Approved", () => {
    const input: PromotionCheckInput = {
      ...base,
      currentStatus: "HumanReview",
      targetStatus: "Approved",
      lastEvalRun: { status: "Passed", definitionHash: "hash-a" },
    };

    it("rejects when the acting user is the same as the creator (no self-approval)", () => {
      const result = canPromote({ ...input, createdByUserId: "user-1", actingUserId: "user-1" });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/reviewer approving this version must be different/);
    });

    it("allows when the acting user differs from the creator", () => {
      expect(canPromote({ ...input, createdByUserId: "user-1", actingUserId: "user-2" })).toEqual({ allowed: true });
    });

    it("allows a null (system/webhook merge) acting user, treated as distinct from the creator", () => {
      expect(canPromote({ ...input, createdByUserId: "user-1", actingUserId: null })).toEqual({ allowed: true });
    });

    it("rejects when the eval gate is no longer green", () => {
      expect(canPromote({ ...input, lastEvalRun: { status: "Failed", definitionHash: "hash-a" } }).allowed).toBe(false);
    });
  });

  describe("Approved -> Production", () => {
    const input: PromotionCheckInput = {
      ...base,
      currentStatus: "Approved",
      targetStatus: "Production",
      lastEvalRun: { status: "Passed", definitionHash: "hash-a" },
    };

    it("rejects an uninstalled graph type (GRAPH_TYPE_NOT_INSTALLED)", () => {
      const result = canPromote({ ...input, graphType: "LangGraph" });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/not installed/);
    });

    it("allows an installed graph type", () => {
      expect(canPromote({ ...input, graphType: "ADK" })).toEqual({ allowed: true });
    });

    // Phase 7 (client-feedback-batch item 6) — isolated from every other Approved ->
    // Production condition above: both cases here pass every other check (installed
    // graph type, passing eval gate) and differ *only* on `lastSandboxTestAt`.
    describe("sandbox-test gate", () => {
      it("rejects when no real sandbox test has ever completed against this version, even though every other condition passes", () => {
        const result = canPromote({ ...input, lastSandboxTestAt: null });
        expect(result.allowed).toBe(false);
        if (!result.allowed) expect(result.reason).toMatch(/sandbox test/i);
      });

      it("allows once a real sandbox test has completed, with every other condition unchanged", () => {
        expect(canPromote({ ...input, lastSandboxTestAt: new Date("2026-01-01T00:00:00Z") })).toEqual({ allowed: true });
      });
    });
  });

  describe("any -> Deprecated", () => {
    it("allows deprecating a version with no active traffic, from any status", () => {
      for (const currentStatus of ["Draft", "EvalGated", "HumanReview", "Approved", "Production"] as const) {
        expect(canPromote({ ...base, currentStatus, targetStatus: "Deprecated", hasActiveTraffic: false })).toEqual({ allowed: true });
      }
    });

    it("rejects deprecating a version that still has active traffic", () => {
      const result = canPromote({ ...base, currentStatus: "Production", targetStatus: "Deprecated", hasActiveTraffic: true });
      expect(result.allowed).toBe(false);
    });

    it("rejects deprecating an already-deprecated version", () => {
      expect(canPromote({ ...base, currentStatus: "Deprecated", targetStatus: "Deprecated" }).allowed).toBe(false);
    });
  });
});

describe("allowedTransitions (backs the console's _allowedTransitions hint)", () => {
  it("returns only EvalGated for a fresh Draft version", () => {
    expect(allowedTransitions({ ...base, currentStatus: "Draft" })).toEqual(["EvalGated", "Deprecated"]);
  });

  it("returns only HumanReview + Deprecated for an EvalGated version whose eval run passed", () => {
    const result = allowedTransitions({
      ...base,
      currentStatus: "EvalGated",
      lastEvalRun: { status: "Passed", definitionHash: "hash-a" },
    });
    expect(result).toEqual(["HumanReview", "Deprecated"]);
  });

  it("returns nothing but Deprecated for an EvalGated version with no passing eval run", () => {
    expect(allowedTransitions({ ...base, currentStatus: "EvalGated", lastEvalRun: null })).toEqual(["Deprecated"]);
  });
});
