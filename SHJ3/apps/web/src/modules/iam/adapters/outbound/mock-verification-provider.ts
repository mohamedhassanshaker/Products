/**
 * `MockVerificationProvider` — a fixture, not a stub.
 *
 * ADR-0006 rule 5 is the load-bearing claim of that ADR, and this file is where
 * it is honoured or not: **the step-up tests written against this adapter are the
 * tests that will validate `UaePassProvider`, unchanged.** That is the mechanism
 * by which "local now, real later" avoids becoming a rewrite of the most
 * consequential logic in the system.
 *
 * For that to hold, this adapter has to be honest about the *shape* of a national
 * identity provider rather than convenient:
 *
 *  - It implements **all four** levels including `L3`, which currently gates
 *    nothing (RISK-006) and is reserved for kiosk document journeys. A fixture
 *    missing its top rung would need every test rewritten when kiosks land.
 *  - Challenges are issued, stored and completed, so a test exercises the same
 *    two-step flow a UAE PASS redirect requires. A stub returning a level from
 *    `verify()` with no prior `challenge()` would let the *application* forget the
 *    first step, and nothing would catch it until UAE PASS was connected.
 *  - Assurance carries an expiry, so decay is exercised. api.md §9.9: a payment
 *    two hours later re-challenges.
 *  - Failure is reachable. A fixture that only succeeds tests only the happy path,
 *    and the step-up rules exist for the unhappy one.
 *
 * ## Drivable to any state
 *
 * `driveTo`, `rejectNext`, `setOwnership` and `expireAssurance` let a test put the
 * provider wherever it needs to be, with no clock manipulation and no reaching
 * inside. The setters are the fixture's public interface and the reason it is a
 * class rather than a frozen object.
 *
 * ## It cannot boot in production
 *
 * ADR-0006 rule 6 is enforced twice, on purpose. `platform/config.ts` refuses the
 * *process*, which is the guarantee. `createMockVerificationProvider` refuses the
 * *object*, which is the belt: any future wiring that constructs this adapter
 * directly — a script, a seeding job, a route that hard-codes it — fails in
 * production too, without anyone having to remember that the config check exists.
 */

import { randomUUID } from "node:crypto";
import type { Clock } from "../../../platform/ports/provisioning.js";
import type { Shj3Config } from "../../../platform/config.js";
import { ASSURANCE_LEVELS, type AssuranceLevel } from "../../domain/assurance.js";
import type {
  AccountRef,
  AssuranceResult,
  OwnershipResult,
  VerificationChallenge,
  VerificationProvider,
  VerificationRequest,
  VerificationResponse,
  VerifiedIdentity,
} from "../../ports/verification-provider.js";

/**
 * How long a verification lasts. Deliberately short and deliberately the same
 * order of magnitude UAE PASS uses, so a test that passes here does not start
 * failing on decay when the real adapter arrives.
 */
export const MOCK_ASSURANCE_LIFETIME_SECONDS = 15 * 60;

const CHALLENGE_LIFETIME_SECONDS = 5 * 60;

/**
 * The fixed OTP a test types. A constant rather than a random value the test has
 * to read back, because "the code is 000000" makes a test readable and there is
 * nothing to protect: this adapter never runs anywhere that matters.
 */
export const MOCK_OTP_CODE = "000000";

/**
 * A plausible verified identity.
 *
 * The Emirates ID arrives **already hashed** — this fixture never holds a raw
 * one, because the port's contract is that a raw national identifier never enters
 * the application (api.md §12 invariant 4). Getting that right in the mock is
 * what stops a test being written that depends on the raw value being available.
 *
 * **A bare 64-character hex digest, no `sha256:` prefix.** `CitizenIdentities.
 * emiratesIdHash` is `CHAR(64)` and `CK_CitizenIdentities_noPlaintextId`
 * requires `LEN(emiratesIdHash) = 64` exactly (`prisma/sql/001_constraints.sql`)
 * — a prefixed value is 71 characters and overflows the column outright. This
 * had never been caught before B-8: no earlier wave's test actually persisted
 * a `VerifiedIdentity` to a real `CitizenIdentities` row, so nothing had ever
 * exercised this exact write path against the real, fixed-width column until
 * B-8's `CompleteVerification` did, live, against the real SQL Server
 * container — the same "correct for the shapes its callers have actually
 * given it" class of gap this project's own `tasks/lessons.md` already names
 * repeatedly. Fixed at the root, in the one place this value is defined.
 */
export const MOCK_IDENTITY: VerifiedIdentity = {
  emiratesIdHash: "9f2c4e1a7b3d8f60c5a19e4b72d0f83c6ea45b19d7c308f21b6e94a0d5c73128",
  verifiedName: "Sara Al Mazrouei",
  mobileMasked: "+9715****4471",
};

/** Which challenge kind a target level and channel imply, mirroring a real provider. */
function challengeKindFor(request: VerificationRequest): "redirect" | "otp" | "document_scan" {
  if (request.targetLevel === "L3") return "document_scan";
  if (request.channel === "whatsapp") return "otp";
  return request.targetLevel === "L2" ? "otp" : "redirect";
}

interface PendingChallenge {
  readonly id: string;
  readonly targetLevel: AssuranceLevel;
  readonly kind: "redirect" | "otp" | "document_scan";
  readonly expiresAt: Date;
}

export interface MockVerificationProviderDeps {
  readonly clock: Clock;
}

export class MockVerificationProvider implements VerificationProvider {
  private readonly pending = new Map<string, PendingChallenge>();

  /** Set by `rejectNext`. Consumed by the next `verify`, so a test drives one failure at a time. */
  private nextRejection: "wrong_code" | "provider_unavailable" | null = null;

  /** Overridden by `driveTo`: the level `verify` grants regardless of what was requested. */
  private forcedLevel: AssuranceLevel | null = null;

  private ownership: OwnershipResult = { matched: true, reason: "matched" };

  private lifetimeSeconds = MOCK_ASSURANCE_LIFETIME_SECONDS;

  constructor(private readonly deps: MockVerificationProviderDeps) {}

  // ---------------------------------------------------------------- fixture ---

  /**
   * Force the level the next successful `verify` grants.
   *
   * The case worth having: a real provider can return *less* than was asked for —
   * UAE PASS returning an identity but no OTP — and application code that assumes
   * it got what it requested is the bug this exists to catch. Pass `null` to go
   * back to honouring the request.
   */
  driveTo(level: AssuranceLevel | null): void {
    this.forcedLevel = level;
  }

  /** Make the next `verify` fail. `provider_unavailable` is the outage, not a wrong code. */
  rejectNext(reason: "wrong_code" | "provider_unavailable" = "wrong_code"): void {
    this.nextRejection = reason;
  }

  setOwnership(result: OwnershipResult): void {
    this.ownership = result;
  }

  /**
   * Shorten the assurance lifetime so a test can reach decay without waiting.
   *
   * Zero produces an already-expired result, which is how the "a payment two
   * hours later re-challenges" rule is exercised in milliseconds.
   */
  setAssuranceLifetime(seconds: number): void {
    this.lifetimeSeconds = seconds;
  }

  /** Back to defaults. Called between tests so state cannot leak across them. */
  reset(): void {
    this.pending.clear();
    this.nextRejection = null;
    this.forcedLevel = null;
    this.ownership = { matched: true, reason: "matched" };
    this.lifetimeSeconds = MOCK_ASSURANCE_LIFETIME_SECONDS;
  }

  // ----------------------------------------------------------------- port -----

  async challenge(request: VerificationRequest): Promise<VerificationChallenge> {
    const now = this.deps.clock.now();
    const kind = challengeKindFor(request);
    const expiresAt = new Date(now.getTime() + CHALLENGE_LIFETIME_SECONDS * 1_000);

    const challenge: PendingChallenge = {
      id: `mockchal_${randomUUID()}`,
      targetLevel: request.targetLevel,
      kind,
      expiresAt,
    };
    this.pending.set(challenge.id, challenge);

    return {
      challengeId: challenge.id,
      kind,
      // A real redirect target, shaped like UAE PASS's, so a surface that renders
      // it is exercised. Never followed by anything.
      redirectUrl:
        kind === "redirect"
          ? `https://mock-verification.invalid/authorize?challenge=${challenge.id}`
          : null,
      expiresAt,
    };
  }

  async verify(challengeId: string, response: VerificationResponse): Promise<AssuranceResult> {
    const now = this.deps.clock.now();
    const challenge = this.pending.get(challengeId);

    // Single use, whatever the outcome — matching a real provider, whose
    // authorization codes are also one-shot.
    this.pending.delete(challengeId);

    const rejection = this.nextRejection;
    this.nextRejection = null;

    if (!challenge || now.getTime() >= challenge.expiresAt.getTime() || rejection !== null) {
      return this.failure(now);
    }

    // The response kind must match what was asked for. A test that completes a
    // redirect challenge with an OTP code has found a real application bug, and a
    // lenient mock would hide it.
    if (!responseMatchesKind(challenge.kind, response)) return this.failure(now);

    if (challenge.kind === "otp" && response.kind === "otp" && response.code !== MOCK_OTP_CODE) {
      return this.failure(now);
    }

    const level = this.forcedLevel ?? challenge.targetLevel;

    return {
      level,
      // `L0` needs no identity, and returning one anyway would let application
      // code read a verified name it has no right to at that level.
      identity: level === "L0" ? null : MOCK_IDENTITY,
      verifiedAt: now,
      expiresAt: new Date(now.getTime() + this.lifetimeSeconds * 1_000),
    };
  }

  async confirmAccountOwnership(
    identity: VerifiedIdentity,
    account: AccountRef,
  ): Promise<OwnershipResult> {
    // Both arguments are ignored, and that is the honest behaviour for a mock:
    // there is no directory to resolve against. What the fixture *does* give a
    // test is control over the answer, which is what B11 tab 1's toggle needs.
    void identity;
    void account;
    return this.ownership;
  }

  supportedLevels(): readonly AssuranceLevel[] {
    // All four. See the module note: a fixture that supports three is a fixture
    // whose tests do not carry over.
    return ASSURANCE_LEVELS;
  }

  /** Every failure is `L0` with no identity — nothing partial, nothing half-verified. */
  private failure(now: Date): AssuranceResult {
    return { level: "L0", identity: null, verifiedAt: now, expiresAt: now };
  }
}

function responseMatchesKind(
  kind: PendingChallenge["kind"],
  response: VerificationResponse,
): boolean {
  if (kind === "otp") return response.kind === "otp";
  if (kind === "redirect") return response.kind === "callback";
  return response.kind === "document";
}

/**
 * Construct the mock, refusing in production.
 *
 * ADR-0006 rule 6's second line of defence. `platform/config.ts` already stops
 * the process; this stops the object, so a script or a route that constructs the
 * adapter directly cannot reach a production runtime by bypassing boot
 * validation. There is deliberately no override parameter.
 */
export function createMockVerificationProvider(
  config: Shj3Config,
  deps: MockVerificationProviderDeps,
): MockVerificationProvider {
  if (config.environment === "production") {
    throw new Error(
      "MockVerificationProvider cannot be constructed in production (ADR-0006 rule 6). " +
        "It grants any assurance level on request, which in front of the payment endpoints " +
        "is an unauthenticated payment path. Configure SHJ3_VERIFICATION_ADAPTER to a real adapter.",
    );
  }
  return new MockVerificationProvider(deps);
}
