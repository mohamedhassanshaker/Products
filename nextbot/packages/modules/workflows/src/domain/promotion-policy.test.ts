import { describe, expect, it } from "vitest";
import { allowedWorkflowVersionTransitions, canPromoteWorkflowVersion, type WorkflowPromotionCheckInput } from "./promotion-policy.js";

const base: WorkflowPromotionCheckInput = {
  currentStatus: "Draft",
  targetStatus: "EvalGated",
  versionId: "version-1",
  createdByUserId: "user-1",
  actingUserId: "user-2",
  lastEvalRun: null,
  yamlHash: "hash-a",
  sandboxRunId: "run-1",
  // Target Architecture Blueprint Phase 16 (BL-47b) — the sandbox gate is now the FULL
  // LLD §14.6.1 check (Phase 15 could only test `sandboxRunId !== null`, because
  // `workflow_run` did not exist yet). The default here is a run that PASSES every
  // sub-check, so each `Approved` case below can fail exactly one of them in isolation.
  sandboxRun: { workflowVersionId: "version-1", state: "Succeeded", coveredNodeIds: ["trigger_1", "end_1"] },
  reachableNodeIds: ["trigger_1", "end_1"],
  hasActiveTraffic: false,
};

describe("canPromoteWorkflowVersion (LLD §14.6.1 promotion-policy state machine)", () => {
  it("Draft -> EvalGated is always allowed", () => {
    expect(canPromoteWorkflowVersion(base)).toEqual({ allowed: true });
  });

  it("rejects a transition to the same status", () => {
    expect(canPromoteWorkflowVersion({ ...base, currentStatus: "Draft", targetStatus: "Draft" }).allowed).toBe(false);
  });

  it("rejects skipping a status (Draft -> HumanReview)", () => {
    const result = canPromoteWorkflowVersion({ ...base, currentStatus: "Draft", targetStatus: "HumanReview" });
    expect(result).toEqual({ allowed: false, reason: "Cannot promote to 'HumanReview' from 'Draft' — must be 'EvalGated' first." });
  });

  describe("EvalGated -> HumanReview", () => {
    const input: WorkflowPromotionCheckInput = { ...base, currentStatus: "EvalGated", targetStatus: "HumanReview" };

    it("rejects when no eval run has been submitted", () => {
      expect(canPromoteWorkflowVersion({ ...input, lastEvalRun: null }).allowed).toBe(false);
    });

    it("rejects when the eval run's artifactHash is stale", () => {
      const result = canPromoteWorkflowVersion({ ...input, lastEvalRun: { status: "Passed", artifactHash: "stale-hash" } });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/changed since its last eval run/);
    });

    it("rejects when the eval run failed", () => {
      const result = canPromoteWorkflowVersion({ ...input, lastEvalRun: { status: "Failed", artifactHash: "hash-a" } });
      expect(result.allowed).toBe(false);
    });

    it("allows when the eval run passed against the current hash", () => {
      expect(canPromoteWorkflowVersion({ ...input, lastEvalRun: { status: "Passed", artifactHash: "hash-a" } })).toEqual({ allowed: true });
    });
  });

  describe("HumanReview -> Approved", () => {
    const input: WorkflowPromotionCheckInput = {
      ...base,
      currentStatus: "HumanReview",
      targetStatus: "Approved",
      lastEvalRun: { status: "Passed", artifactHash: "hash-a" },
    };

    it("rejects when the acting user is the same as the creator (no self-approval)", () => {
      const result = canPromoteWorkflowVersion({ ...input, createdByUserId: "user-1", actingUserId: "user-1" });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/reviewer approving this version must be different/);
    });

    it("allows when the acting user differs from the creator AND a sandbox run is recorded", () => {
      expect(canPromoteWorkflowVersion({ ...input, createdByUserId: "user-1", actingUserId: "user-2", sandboxRunId: "run-1" })).toEqual({ allowed: true });
    });

    it("allows a null (system/webhook merge) acting user, treated as distinct from the creator", () => {
      expect(canPromoteWorkflowVersion({ ...input, createdByUserId: "user-1", actingUserId: null })).toEqual({ allowed: true });
    });

    it("rejects when the eval gate is no longer green", () => {
      expect(canPromoteWorkflowVersion({ ...input, lastEvalRun: { status: "Failed", artifactHash: "hash-a" } }).allowed).toBe(false);
    });

    // LLD §14.6.1's own addition over the agent-version ladder — see this rule's
    // own dedicated describe block below, isolated from every other condition.
    describe("sandbox-run gate (LLD §14.6.1 — genuinely unreachable until Phase 16 populates it for real)", () => {
      it("rejects when no sandbox run is recorded, even though every other condition passes", () => {
        const result = canPromoteWorkflowVersion({ ...input, sandboxRunId: null });
        expect(result.allowed).toBe(false);
        if (!result.allowed) expect(result.reason).toMatch(/sandbox run/i);
      });

      it("allows once a sandbox run id is recorded, with every other condition unchanged", () => {
        expect(canPromoteWorkflowVersion({ ...input, sandboxRunId: "run-1" })).toEqual({ allowed: true });
      });
    });
  });

  describe("Approved -> Production", () => {
    it("is unconditional once the predecessor state matches (no graphType/lastSandboxTestAt equivalent exists for a workflow version)", () => {
      expect(canPromoteWorkflowVersion({ ...base, currentStatus: "Approved", targetStatus: "Production" })).toEqual({ allowed: true });
    });
  });

  describe("any -> Deprecated", () => {
    it("allows deprecating a version with no active traffic, from any status", () => {
      for (const currentStatus of ["Draft", "EvalGated", "HumanReview", "Approved", "Production"] as const) {
        expect(canPromoteWorkflowVersion({ ...base, currentStatus, targetStatus: "Deprecated", hasActiveTraffic: false })).toEqual({ allowed: true });
      }
    });

    it("rejects deprecating a version that still has active traffic", () => {
      const result = canPromoteWorkflowVersion({ ...base, currentStatus: "Production", targetStatus: "Deprecated", hasActiveTraffic: true });
      expect(result.allowed).toBe(false);
    });

    it("rejects deprecating an already-deprecated version", () => {
      expect(canPromoteWorkflowVersion({ ...base, currentStatus: "Deprecated", targetStatus: "Deprecated" }).allowed).toBe(false);
    });
  });
});

describe("allowedWorkflowVersionTransitions (backs the console's allowedTransitions hint)", () => {
  it("returns only EvalGated + Deprecated for a fresh Draft version", () => {
    expect(allowedWorkflowVersionTransitions({ ...base, currentStatus: "Draft" })).toEqual(["EvalGated", "Deprecated"]);
  });

  it("returns only HumanReview + Deprecated for an EvalGated version whose eval run passed", () => {
    const result = allowedWorkflowVersionTransitions({
      ...base,
      currentStatus: "EvalGated",
      lastEvalRun: { status: "Passed", artifactHash: "hash-a" },
    });
    expect(result).toEqual(["HumanReview", "Deprecated"]);
  });

  it("returns nothing but Deprecated for a HumanReview version with no sandbox run recorded (the phase's own disclosed boundary)", () => {
    const result = allowedWorkflowVersionTransitions({
      ...base,
      currentStatus: "HumanReview",
      lastEvalRun: { status: "Passed", artifactHash: "hash-a" },
      sandboxRunId: null,
    });
    expect(result).toEqual(["Deprecated"]);
  });
});
