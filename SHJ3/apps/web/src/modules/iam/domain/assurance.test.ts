import { describe, expect, it } from "vitest";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import {
  ANONYMOUS_ASSURANCE,
  ASSURANCE_LABELS,
  ASSURANCE_LEVELS,
  AssuranceInsufficientError,
  assuranceRank,
  effectiveAssurance,
  isAssuranceLevel,
  satisfiesAssurance,
  strongestAssurance,
  type AssuranceLevel,
} from "./assurance.js";

/**
 * The assurance ladder.
 *
 * These are the comparisons that gate payments (B11 tab 2), so the monotonicity
 * property is asserted across the whole ladder rather than at a few sample
 * points — an off-by-one at one rung would be a payment authorised at the wrong
 * level, and only an exhaustive check catches it.
 *
 * Covers RISK-006, FR-VERI-09 and ADR-0006 rule 5.
 */

describe("the ladder", () => {
  it("has exactly the four levels RISK-006 settled on", () => {
    expect(ASSURANCE_LEVELS).toEqual(["L0", "L1", "L2", "L3"]);
  });

  it("agrees with Principal.assurance", () => {
    // A compile-time assertion, not a runtime one: if the two unions diverge,
    // this assignment stops type-checking and the build fails before any test
    // runs. `Principal` is what feature modules read, so a ladder that does not
    // match it would be a ladder nothing consults.
    const held: Principal["assurance"] = "L3";
    const level: AssuranceLevel = held;
    expect(ASSURANCE_LEVELS).toContain(level);
  });

  it("names every level, so an operator-facing message never renders a code alone", () => {
    for (const level of ASSURANCE_LEVELS) {
      expect(ASSURANCE_LABELS[level].length).toBeGreaterThan(0);
    }
    expect(ASSURANCE_LABELS.L3).toContain("document");
  });

  it("ranks in declaration order", () => {
    ASSURANCE_LEVELS.forEach((level, index) => {
      expect(assuranceRank(level)).toBe(index);
    });
  });

  it("starts anonymous", () => {
    expect(ANONYMOUS_ASSURANCE).toBe("L0");
    expect(assuranceRank(ANONYMOUS_ASSURANCE)).toBe(0);
  });

  it("rejects a level that is not on it", () => {
    expect(isAssuranceLevel("L4")).toBe(false);
    expect(isAssuranceLevel("verified")).toBe(false);
    expect(isAssuranceLevel("")).toBe(false);
    // Throwing rather than ranking an unknown level as -1: a -1 would compare as
    // weaker than anonymous and hide the bug behind a plausible denial.
    expect(() => assuranceRank("L9" as AssuranceLevel)).toThrow(/assurance ladder/);
  });
});

describe("monotonicity", () => {
  it("satisfies every level at or below the held one, across the whole ladder", () => {
    for (const held of ASSURANCE_LEVELS) {
      for (const required of ASSURANCE_LEVELS) {
        expect(satisfiesAssurance(held, required)).toBe(
          assuranceRank(held) >= assuranceRank(required),
        );
      }
    }
  });

  it("is a rank comparison and not an equality test", () => {
    // The classic bug: `held === required` would refuse an L1 action to a
    // citizen who has reached L2, and the product would grow "or higher"
    // special cases until one was written wrong.
    expect(satisfiesAssurance("L2", "L1")).toBe(true);
    expect(satisfiesAssurance("L3", "L0")).toBe(true);
  });

  it("refuses a step up that has not happened", () => {
    expect(satisfiesAssurance("L1", "L2")).toBe(false);
    expect(satisfiesAssurance("L0", "L1")).toBe(false);
  });

  it("lets L0 through an L0 gate — anonymous is a legitimate state, not an error", () => {
    // B11 tab 2 allows "view bill balance" anonymously.
    expect(satisfiesAssurance("L0", "L0")).toBe(true);
  });

  it("gates nothing at L3 today, and still ranks it highest", () => {
    // RISK-006: L3 is reserved for kiosk document journeys. It is in the ladder
    // so the mock covers all four and the step-up suite carries over unchanged.
    expect(assuranceRank("L3")).toBe(ASSURANCE_LEVELS.length - 1);
    expect(satisfiesAssurance("L3", "L2")).toBe(true);
  });
});

describe("strongestAssurance", () => {
  it("never lowers a level", () => {
    // An OTP challenge completing after an identity verification must not
    // downgrade the session, which a plain assignment would do.
    expect(strongestAssurance("L2", "L1")).toBe("L2");
    expect(strongestAssurance("L1", "L2")).toBe("L2");
  });

  it("is idempotent", () => {
    for (const level of ASSURANCE_LEVELS) {
      expect(strongestAssurance(level, level)).toBe(level);
    }
  });
});

describe("decay", () => {
  const verifiedAt = new Date("2026-09-08T09:00:00.000Z");
  const expiresAt = new Date("2026-09-08T09:15:00.000Z");
  const held = { level: "L2" as AssuranceLevel, verifiedAt, expiresAt };

  it("holds the level until it expires", () => {
    expect(effectiveAssurance(held, new Date("2026-09-08T09:14:59.000Z"))).toBe("L2");
  });

  it("drops to anonymous at the expiry, not after it", () => {
    expect(effectiveAssurance(held, expiresAt)).toBe("L0");
  });

  it("re-challenges a payment attempted two hours later", () => {
    // api.md §9.9's example, which is the reason assurance carries an expiry at
    // all: one OTP must not become a month of payment authority inside a 30-day
    // citizen session.
    const twoHoursLater = new Date(verifiedAt.getTime() + 2 * 60 * 60 * 1_000);
    expect(satisfiesAssurance(effectiveAssurance(held, twoHoursLater), "L2")).toBe(false);
  });

  it("treats an absent verification as anonymous", () => {
    expect(effectiveAssurance(null, verifiedAt)).toBe("L0");
  });
});

describe("AssuranceInsufficientError", () => {
  it("names what is required so the client knows which challenge to start", () => {
    const error = new AssuranceInsufficientError("L2", "payments.initiate");
    expect(error.required).toBe("L2");
    expect(error.message).toContain("L2");
    expect(error.message).toContain("payments.initiate");
  });

  it("does not disclose the level currently held", () => {
    const error = new AssuranceInsufficientError("L2", "payments.initiate");
    expect(error.message).not.toMatch(/\bL0\b|\bL1\b|currently|you have/i);
  });
});
