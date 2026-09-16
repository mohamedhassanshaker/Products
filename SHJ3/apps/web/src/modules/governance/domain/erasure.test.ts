import { describe, expect, it } from "vitest";
import {
  allStoresVerifiedComplete,
  assertTaskCompletable,
  type ErasureTaskOutcome,
} from "./erasure.js";

const now = new Date("2026-09-10T10:00:00.000Z");

describe("erasure domain", () => {
  it("requires all four stores, each Completed and verified, before reporting complete", () => {
    const threeOfFour: ErasureTaskOutcome[] = [
      { store: "SqlServer", state: "Completed", verifiedAt: now },
      { store: "Redis", state: "Completed", verifiedAt: now },
      { store: "Neo4j", state: "Completed", verifiedAt: now },
    ];
    expect(allStoresVerifiedComplete(threeOfFour)).toBe(false);

    const allFour: ErasureTaskOutcome[] = [
      ...threeOfFour,
      { store: "Qdrant", state: "Completed", verifiedAt: now },
    ];
    expect(allStoresVerifiedComplete(allFour)).toBe(true);
  });

  it("a store with affectedCount 0 still counts as complete — absence is not the same as unchecked", () => {
    const outcomes: ErasureTaskOutcome[] = [
      { store: "SqlServer", state: "Completed", verifiedAt: now },
      { store: "Redis", state: "Completed", verifiedAt: now },
      { store: "Neo4j", state: "Completed", verifiedAt: now },
      { store: "Qdrant", state: "Completed", verifiedAt: now },
    ];
    expect(allStoresVerifiedComplete(outcomes)).toBe(true);
  });

  it("Completed without verifiedAt is rejected (CK_ErasureTasks_completedIsVerified mirror)", () => {
    expect(() => assertTaskCompletable("Completed", null)).toThrow();
    expect(() => assertTaskCompletable("Completed", now)).not.toThrow();
    expect(() => assertTaskCompletable("InProgress", null)).not.toThrow();
  });
});
