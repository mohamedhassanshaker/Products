import { describe, expect, it } from "vitest";
import { ASSURANCE_LEVELS, type AssuranceLevel } from "../../iam/domain/assurance.js";
import {
  REQUIRED_ASSURANCE_LEVELS,
  type RequiredAssuranceLevel,
} from "../../tools/domain/tool-catalog.js";
import {
  assuranceToRequiredLevel,
  requiredLevelToAssurance,
  satisfiesRequiredAssurance,
} from "./assurance-mapping.js";

/**
 * The reconciliation B-5 flagged as missing and B-8 closes: `FlowNodes.
 * requiredAssurance`/`ToolBindings.requiredAssurance`'s persisted enum vs.
 * `Principal.assurance`'s `L0`-`L3` rank. Covers `tasks/todo.md`'s B-5
 * review, judgment call 3.
 */
describe("the requiredAssurance <-> AssuranceLevel bijection", () => {
  it("maps every persisted enum value to its own distinct rank", () => {
    expect(requiredLevelToAssurance("Anonymous")).toBe("L0");
    expect(requiredLevelToAssurance("Verified")).toBe("L1");
    expect(requiredLevelToAssurance("VerifiedPlusOtp")).toBe("L2");
    expect(requiredLevelToAssurance("VerifiedPlusDocument")).toBe("L3");
  });

  it("is a true bijection — round-tripping every level is lossless", () => {
    for (const level of ASSURANCE_LEVELS) {
      expect(requiredLevelToAssurance(assuranceToRequiredLevel(level))).toBe(level);
    }
    for (const required of REQUIRED_ASSURANCE_LEVELS) {
      expect(assuranceToRequiredLevel(requiredLevelToAssurance(required))).toBe(required);
    }
  });

  it("both enums have the same length — a mismatch here would mean the bijection is incomplete", () => {
    expect(REQUIRED_ASSURANCE_LEVELS.length).toBe(ASSURANCE_LEVELS.length);
  });
});

describe("satisfiesRequiredAssurance", () => {
  it("null means no override configured — gates nothing", () => {
    expect(satisfiesRequiredAssurance("L0", null)).toBe(true);
  });

  it.each([
    ["L0", "Anonymous", true],
    ["L0", "Verified", false],
    ["L1", "Verified", true],
    ["L1", "VerifiedPlusOtp", false],
    ["L2", "VerifiedPlusOtp", true],
    ["L2", "VerifiedPlusDocument", false],
    ["L3", "VerifiedPlusDocument", true],
    // A held level strictly above the required one still satisfies — this is
    // a rank comparison, never equality (the classic bug this guards against).
    ["L3", "Anonymous", true],
  ] satisfies [AssuranceLevel, RequiredAssuranceLevel, boolean][])(
    "held=%s required=%s -> %s",
    (held, required, expected) => {
      expect(satisfiesRequiredAssurance(held, required)).toBe(expected);
    },
  );
});
