import { describe, expect, it } from "vitest";
import { allowedTeamVersionTransitions, canPromoteTeamVersion, type TeamPromotionCheckInput } from "./team-promotion-policy.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-11, LLD §14.7.2) — the team
 * version promotion ladder, and specifically the whole-topology sandbox gate.
 */
const AUTHOR = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "22222222-2222-2222-2222-222222222222";

function input(overrides: Partial<TeamPromotionCheckInput>): TeamPromotionCheckInput {
  return {
    currentStatus: "Draft",
    targetStatus: "EvalGated",
    createdByUserId: AUTHOR,
    actingUserId: REVIEWER,
    sandboxCoverage: null,
    hasActiveTraffic: false,
    ...overrides,
  };
}

describe("canPromoteTeamVersion — the ladder", () => {
  it("walks Draft -> EvalGated -> HumanReview", () => {
    expect(canPromoteTeamVersion(input({ currentStatus: "Draft", targetStatus: "EvalGated" })).allowed).toBe(true);
    expect(canPromoteTeamVersion(input({ currentStatus: "EvalGated", targetStatus: "HumanReview" })).allowed).toBe(true);
  });

  it("refuses to skip a rung", () => {
    const result = canPromoteTeamVersion(input({ currentStatus: "Draft", targetStatus: "Production" }));
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("must be 'Approved' first") });
  });

  it("refuses a no-op transition", () => {
    expect(canPromoteTeamVersion(input({ currentStatus: "Draft", targetStatus: "Draft" })).allowed).toBe(false);
  });

  it("refuses to promote a Deprecated version at all", () => {
    expect(canPromoteTeamVersion(input({ currentStatus: "Deprecated", targetStatus: "Draft" })).allowed).toBe(false);
  });

  it("allows Deprecated from any non-terminal status when there is no active traffic", () => {
    expect(canPromoteTeamVersion(input({ currentStatus: "Production", targetStatus: "Deprecated" })).allowed).toBe(true);
  });

  it("blocks Deprecated while the version still serves traffic", () => {
    expect(canPromoteTeamVersion(input({ currentStatus: "Production", targetStatus: "Deprecated", hasActiveTraffic: true })).allowed).toBe(false);
  });
});

describe("canPromoteTeamVersion — FR-ORC-11's whole-topology sandbox gate on Approved", () => {
  const approving = { currentStatus: "HumanReview" as const, targetStatus: "Approved" as const };

  it("refuses Approved when NO sandbox run is recorded", () => {
    const result = canPromoteTeamVersion(input({ ...approving, sandboxCoverage: null }));
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("no sandbox run recorded") });
  });

  it("refuses Approved for a SUPERVISOR-ONLY sandbox run (every member missing) — FR-ORC-11's exact wording", () => {
    const result = canPromoteTeamVersion(input({ ...approving, sandboxCoverage: { runId: "run-1", missingMemberKeys: ["billing", "shipping"] } }));
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("billing, shipping") });
    expect(result).toMatchObject({ reason: expect.stringContaining("supervisor-only run does not satisfy") });
  });

  it("refuses Approved when even ONE member was never exercised", () => {
    expect(canPromoteTeamVersion(input({ ...approving, sandboxCoverage: { runId: "run-1", missingMemberKeys: ["shipping"] } })).allowed).toBe(false);
  });

  it("allows Approved once the sandbox run covered EVERY member", () => {
    expect(canPromoteTeamVersion(input({ ...approving, sandboxCoverage: { runId: "run-1", missingMemberKeys: [] } })).allowed).toBe(true);
  });

  it("still enforces four-eyes: the author may not approve their own team version", () => {
    const result = canPromoteTeamVersion(
      input({ ...approving, actingUserId: AUTHOR, sandboxCoverage: { runId: "run-1", missingMemberKeys: [] } }),
    );
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("someone other than its author") });
  });

  it("does NOT apply the sandbox gate to the earlier rungs — only Approved is gated", () => {
    expect(canPromoteTeamVersion(input({ currentStatus: "Draft", targetStatus: "EvalGated", sandboxCoverage: null })).allowed).toBe(true);
    expect(canPromoteTeamVersion(input({ currentStatus: "EvalGated", targetStatus: "HumanReview", sandboxCoverage: null })).allowed).toBe(true);
  });
});

describe("allowedTeamVersionTransitions", () => {
  it("reflects the SAME gate state the enforcement uses — Approved is absent without sandbox coverage", () => {
    const targets = allowedTeamVersionTransitions(input({ currentStatus: "HumanReview", sandboxCoverage: null }));
    expect(targets).not.toContain("Approved");
    expect(targets).toContain("Deprecated");
  });

  it("includes Approved once coverage is complete", () => {
    const targets = allowedTeamVersionTransitions(input({ currentStatus: "HumanReview", sandboxCoverage: { runId: "r", missingMemberKeys: [] } }));
    expect(targets).toContain("Approved");
  });
});
