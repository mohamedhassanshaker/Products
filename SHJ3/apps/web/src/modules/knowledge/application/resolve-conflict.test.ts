import { describe, expect, it } from "vitest";
import { ResolveConflict } from "./resolve-conflict.js";
import { FakeConflictRepository, sourceConflictRowFixture } from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("resolving a source conflict — 'Make authoritative' (FR-KNOW-20)", () => {
  it("marks a side authoritative regardless of the tenant's default policy — a human choosing a side is always allowed", async () => {
    const conflicts = new FakeConflictRepository();
    // AlwaysAskAdmin is the strictest policy for AUTOMATIC resolution — proves this use
    // case never reads it, since it never gates a human's own choice (FR-KNOW-19/20/22).
    conflicts.seed(
      sourceConflictRowFixture({ id: "c1", policyAtDetection: "AlwaysAskAdmin", status: "Open" }),
    );

    const result = await new ResolveConflict({ conflicts }).execute({
      conflictId: "c1",
      authoritativeSide: "B",
      resolvedByStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conflict.status).toBe("Resolved");
    expect(result.conflict.authoritativeSide).toBe("B");
    expect(result.conflict.resolvedByStaffUserId).toBe("usr_admin");
  });

  it("refuses to resolve a conflict that is not Open", async () => {
    const conflicts = new FakeConflictRepository();
    conflicts.seed(sourceConflictRowFixture({ id: "c1", status: "Ignored" }));
    const result = await new ResolveConflict({ conflicts }).execute({
      conflictId: "c1",
      authoritativeSide: "A",
      resolvedByStaffUserId: "usr_admin",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "knowledge.conflict_not_open" });
  });
});
