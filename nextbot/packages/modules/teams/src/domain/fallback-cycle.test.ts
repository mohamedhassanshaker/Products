import { describe, expect, it } from "vitest";
import { TeamFallbackCycleError, type TeamMemberSpec } from "@nextbot/contracts";
import { assertNoFallbackCycle } from "./fallback-cycle.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-10, LLD §14.7.2) — a real
 * cycle-detection walk, not a `fallback !== self` check (which the DB CHECK already
 * covers and which a two-node cycle trivially passes).
 */
function member(key: string, fallback?: string): TeamMemberSpec {
  return {
    key,
    agent: `${key}_agent@1.0.0`,
    delegationTier: "Tier1",
    invokeWhen: `the request is about ${key}`,
    ...(fallback ? { fallbackAction: "Member" as const, fallbackMemberKey: fallback } : { fallbackAction: "Escalate" as const }),
  };
}

describe("assertNoFallbackCycle (FR-ORC-10)", () => {
  it("accepts members with no fallbacks at all", () => {
    expect(() => assertNoFallbackCycle([member("billing"), member("shipping")])).not.toThrow();
  });

  it("accepts a chain that terminates in an Escalate", () => {
    expect(() => assertNoFallbackCycle([member("billing", "refunds"), member("refunds", "finance"), member("finance")])).not.toThrow();
  });

  it("accepts a diamond (two members falling back to the same terminating member)", () => {
    expect(() => assertNoFallbackCycle([member("a", "c"), member("b", "c"), member("c")])).not.toThrow();
  });

  it("rejects a two-node cycle — the case a `fallback <> self` CHECK cannot catch", () => {
    expect(() => assertNoFallbackCycle([member("a", "b"), member("b", "a")])).toThrow(TeamFallbackCycleError);
  });

  it("rejects a three-node cycle and names the exact cycle path", () => {
    try {
      assertNoFallbackCycle([member("a", "b"), member("b", "c"), member("c", "a")]);
      throw new Error("expected a TeamFallbackCycleError");
    } catch (err) {
      expect(err).toBeInstanceOf(TeamFallbackCycleError);
      expect((err as TeamFallbackCycleError).message).toContain("a -> b -> c -> a");
      expect((err as TeamFallbackCycleError).code).toBe("TEAM_FALLBACK_CYCLE");
      expect((err as TeamFallbackCycleError).httpStatus).toBe(422);
    }
  });

  it("rejects a cycle reachable only through a non-cyclic prefix, reporting the CYCLE not the walk", () => {
    try {
      assertNoFallbackCycle([member("entry", "a"), member("a", "b"), member("b", "a")]);
      throw new Error("expected a TeamFallbackCycleError");
    } catch (err) {
      expect((err as TeamFallbackCycleError).message).toContain("a -> b -> a");
      expect((err as TeamFallbackCycleError).message).not.toContain("entry");
    }
  });

  it("does not treat a dangling fallbackMemberKey as a cycle (that is a separate, separately-reported error)", () => {
    expect(() => assertNoFallbackCycle([member("a", "does_not_exist")])).not.toThrow();
  });

  it("ignores a fallbackMemberKey on a member whose fallbackAction is Escalate", () => {
    const escalatingWithStaleKey: TeamMemberSpec = {
      key: "a",
      agent: "a_agent@1.0.0",
      delegationTier: "Tier1",
      invokeWhen: "anything",
      fallbackAction: "Escalate",
      fallbackMemberKey: "b",
    };
    const b: TeamMemberSpec = { ...escalatingWithStaleKey, key: "b", fallbackMemberKey: "a" };
    expect(() => assertNoFallbackCycle([escalatingWithStaleKey, b])).not.toThrow();
  });
});
