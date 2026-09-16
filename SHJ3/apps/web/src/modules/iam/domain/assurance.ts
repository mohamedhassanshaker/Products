/**
 * The citizen assurance ladder.
 *
 * B11 tab 2's step-up rules are the most consequential logic in the system —
 * they are what stands between an anonymous chat message and a payment. This
 * module is the ladder itself: four levels, a rank, and a comparison. Nothing
 * else.
 *
 * ## Why four levels and not three
 *
 * RISK-006 settled on four (ADR-0006, api.md §9.9). `L3` is document-verified —
 * an Emirates ID scan at a kiosk — and **currently gates nothing**: every rule in
 * B11 tab 2 tops out at `L2`. It exists in the ladder anyway for two reasons that
 * are worth stating, because a level that gates nothing looks like dead code:
 *
 *  1. The mock verification adapter must implement all four (ADR-0006 rule 5),
 *     so that the step-up suite written today validates `UaePassProvider`
 *     unchanged. A ladder missing its top rung would need every test rewritten
 *     when kiosk journeys land.
 *  2. Adding a rung *above* the highest gate is additive. Inserting one *below*
 *     an existing gate silently lowers it. Getting the ladder complete before any
 *     rule references it is the cheap moment.
 *
 * ## Monotonicity is the whole contract
 *
 * Each level satisfies every level below it, and gating is a rank comparison
 * rather than an equality test. An equality test is the classic bug here: a
 * citizen who reached `L2` would be refused an `L1` action, so the product would
 * grow a set of "or higher" special cases and one of them would eventually be
 * written as `===`.
 *
 * This module holds no vendor imports and no I/O (architecture.md §4). Gating
 * reads a level and never how it was established, which is what makes the mock
 * and the real UAE PASS adapter indistinguishable to a feature module.
 */

/**
 * The ladder, in ascending order. **Order is the rank** — `assuranceRank` reads
 * the index, so reordering this array silently re-grades every gate in B11.
 */
export const ASSURANCE_LEVELS = ["L0", "L1", "L2", "L3"] as const;

export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number];

/**
 * Human-readable names, for error `meta` and the B11 admin screens.
 *
 * The wire vocabulary is the `L0`–`L3` code, not the label: labels are what an
 * operator reads and are therefore subject to wording changes, while a gate is
 * matched against the code. api.md §3.3 sketches an older label set that predates
 * RISK-006's four-level decision; these are the current names, and they match
 * `Principal.assurance`'s documentation in `platform/tenancy/tenant-context.ts`.
 */
export const ASSURANCE_LABELS: Readonly<Record<AssuranceLevel, string>> = {
  L0: "anonymous",
  L1: "verified identity",
  L2: "verified identity plus OTP",
  L3: "document-verified",
};

/** The lowest rung. An anonymous citizen holds this and it is not an error state. */
export const ANONYMOUS_ASSURANCE: AssuranceLevel = "L0";

export function isAssuranceLevel(value: string): value is AssuranceLevel {
  return (ASSURANCE_LEVELS as readonly string[]).includes(value);
}

/**
 * Position on the ladder. Higher is stronger.
 *
 * Throws on an unknown level rather than returning `-1`. A `-1` would compare as
 * "weaker than anonymous" and therefore fail closed for a *read* — but it would
 * also make an unknown level indistinguishable from a deliberate `L0`, which
 * hides the bug. An unrecognised level in a session record means the record was
 * written by code that no longer matches this ladder, and that is a programming
 * error, not an authorization outcome.
 */
export function assuranceRank(level: AssuranceLevel): number {
  const rank = ASSURANCE_LEVELS.indexOf(level);
  if (rank < 0) {
    throw new Error(
      `"${level}" is not a level on the assurance ladder. Expected one of ${ASSURANCE_LEVELS.join(", ")}.`,
    );
  }
  return rank;
}

/**
 * The gate. `true` when `held` is at least `required`.
 *
 * This is the only comparison any step-up rule may use. Two-argument order is
 * (held, required) to read as "does what they have satisfy what we need".
 */
export function satisfiesAssurance(held: AssuranceLevel, required: AssuranceLevel): boolean {
  return assuranceRank(held) >= assuranceRank(required);
}

/**
 * The stronger of two levels.
 *
 * Used when a verification result arrives for a session that already holds a
 * level: a completed OTP challenge must never *lower* assurance, which is what a
 * plain assignment would do if challenges complete out of order.
 */
export function strongestAssurance(a: AssuranceLevel, b: AssuranceLevel): AssuranceLevel {
  return assuranceRank(a) >= assuranceRank(b) ? a : b;
}

/**
 * Assurance decays, so a level is only meaningful with its expiry.
 *
 * api.md §9.9: "a payment two hours later re-challenges". Verification proves
 * something about a moment, not about a session, and a 30-day citizen session
 * outliving its verification by 29 days would turn one OTP into a month of
 * payment authority.
 */
export interface HeldAssurance {
  readonly level: AssuranceLevel;
  readonly verifiedAt: Date;
  /** Exclusive: a level is spent the instant the clock reaches this. */
  readonly expiresAt: Date;
}

/**
 * Decay the held level to `L0` once it expires.
 *
 * Returns a level rather than a boolean so callers cannot forget to apply the
 * decay: there is no way to read the level past its expiry.
 */
export function effectiveAssurance(held: HeldAssurance | null, now: Date): AssuranceLevel {
  if (!held) return ANONYMOUS_ASSURANCE;
  return now.getTime() < held.expiresAt.getTime() ? held.level : ANONYMOUS_ASSURANCE;
}

/**
 * Raised when an action needs more assurance than the caller holds.
 *
 * Carries `required` and deliberately not `held`. api.md §3.5 returns
 * `meta.required` so the client knows which challenge to start; telling a caller
 * what level they currently hold adds nothing they can act on and is one more
 * fact leaked to a hostile citizen surface.
 *
 * The runtime treats this as a **pause, not a failure** (api.md §3.5): the turn
 * emits `step_up_required` and the tool call is never attempted.
 */
export class AssuranceInsufficientError extends Error {
  constructor(
    readonly required: AssuranceLevel,
    readonly operation: string,
  ) {
    super(
      `"${operation}" requires assurance ${required} (${ASSURANCE_LABELS[required]}). ` +
        "Complete a step-up challenge and retry.",
    );
    this.name = "AssuranceInsufficientError";
  }
}
