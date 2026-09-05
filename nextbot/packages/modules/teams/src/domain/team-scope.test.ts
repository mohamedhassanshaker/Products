import { describe, expect, it } from "vitest";
import type { TeamLimits } from "@nextbot/contracts";
import { composeTeamMemberScope, composeTeamVersionScope } from "./team-scope.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-07) — the projection that
 * makes FR-ORC-07's run-level ceilings the PHASE 6 EVALUATOR's own step-2 budget
 * check rather than a second, independently-derived comparison. If this projection
 * were wrong or missing, the executor would silently have no ceilings at all, so
 * these assertions are load-bearing.
 */
const LIMITS: TeamLimits = {
  maxDepth: 3,
  maxFanOut: 2,
  maxDelegations: 6,
  runBudget: { usd: 1.5, seconds: 90 },
  thrashWindow: { repeats: 2, similarityThreshold: 0.9 },
};

describe("composeTeamVersionScope", () => {
  it("projects every FR-ORC-07 ceiling onto the evaluator's own `budget` dimension", () => {
    const scope = composeTeamVersionScope({ teamVersionId: "tv-1", teamLabel: "support_team@1", limits: LIMITS, spec: undefined });
    expect(scope.budget).toEqual({ maxDepth: 3, maxFanOut: 2, maxDelegations: 6, usdPerTurn: 1.5, seconds: 90 });
  });

  it("declares origin 'TeamVersion' with the real row id and a human-readable label", () => {
    const scope = composeTeamVersionScope({ teamVersionId: "tv-1", teamLabel: "support_team@1", limits: LIMITS, spec: undefined });
    expect(scope.origin).toBe("TeamVersion");
    expect(scope.originId).toBe("tv-1");
    expect(scope.originLabel).toBe("support_team@1");
  });

  it("OMITS every dimension the author did not declare (E3's lattice top), never defaults one", () => {
    const scope = composeTeamVersionScope({ teamVersionId: "tv-1", teamLabel: "t@1", limits: LIMITS, spec: undefined });
    expect("toolIds" in scope).toBe(false);
    expect("capabilityGroupIds" in scope).toBe(false);
    expect("rwClasses" in scope).toBe(false);
    expect("autonomyCeiling" in scope).toBe(false);
    expect("trustLevel" in scope).toBe(false);
  });

  it("carries a declared dimension through verbatim, including an EMPTY toolIds array (a real, severe restriction — not 'undeclared')", () => {
    const scope = composeTeamVersionScope({ teamVersionId: "tv-1", teamLabel: "t@1", limits: LIMITS, spec: { toolIds: [] } });
    expect(scope.toolIds).toEqual([]);
  });

  it("does NOT project thrashWindow — it is not a lattice dimension and stays the executor's own guard", () => {
    const scope = composeTeamVersionScope({ teamVersionId: "tv-1", teamLabel: "t@1", limits: LIMITS, spec: undefined });
    expect(JSON.stringify(scope)).not.toContain("thrash");
  });
});

describe("composeTeamMemberScope", () => {
  it("declares origin 'TeamMember' with the real member id", () => {
    const scope = composeTeamMemberScope({ memberId: "m-1", memberLabel: "support_team@1/billing", spec: { toolIds: ["11111111-1111-1111-1111-111111111111"] } });
    expect(scope.origin).toBe("TeamMember");
    expect(scope.originId).toBe("m-1");
    expect(scope.toolIds).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  it("carries NO budget of its own — FR-ORC-07's ceilings are explicitly RUN-level, not per-member", () => {
    const scope = composeTeamMemberScope({ memberId: "m-1", memberLabel: "t@1/billing", spec: undefined });
    expect(scope.budget).toBeUndefined();
  });
});
