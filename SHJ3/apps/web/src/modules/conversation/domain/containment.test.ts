import { describe, expect, it } from "vitest";
import { containmentClearedBy } from "./containment.js";

describe("containmentClearedBy", () => {
  it("is true for Escalated — the one outcome that means real human involvement", () => {
    expect(containmentClearedBy("Escalated")).toBe(true);
  });

  it("is false for every other real outcome — callers must leave `wasContained` untouched, never set it back to true", () => {
    expect(containmentClearedBy("Resolved")).toBe(false);
    expect(containmentClearedBy("Abandoned")).toBe(false);
    expect(containmentClearedBy("Active")).toBe(false);
  });
});
