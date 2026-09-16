/**
 * `VerificationProvider` — the citizen assurance port.
 *
 * The second of ADR-0006's two ports, and the one whose absence would block the
 * most valuable logic in the system. B11 tab 2's step-up rules gate payments;
 * UAE PASS is a procurement dependency with a long lead time (RISK-004). Without
 * a port there would be nothing to build those rules against, and they would
 * arrive untested at the same moment as real money.
 *
 * ## What makes the mock worth having
 *
 * ADR-0006 rule 5: `MockVerificationProvider` is a first-class test fixture, not
 * a stub. It implements all four levels and is drivable to any state, so the
 * step-up suite written against it is the suite that will validate
 * `UaePassProvider` **unchanged**. That is the whole mechanism by which this ADR
 * avoids the usual trap — and it only works if this interface is honest about the
 * shape of a real national identity provider rather than about what a mock finds
 * convenient. Hence the redirect flow, the decaying assurance and the separate
 * ownership check, none of which a stub would need.
 *
 * ## Two things this port refuses to carry
 *
 *  1. **A raw Emirates ID.** It arrives already hashed (api.md §12 invariant 4,
 *     FR-VERI-09). The contract is that a raw national identifier never enters
 *     the application, so there is no field it could enter through.
 *  2. **A vendor error.** UAE PASS failures become SHJ3 reasons from the closed
 *     vocabulary below (api.md §12 invariant 6), so no caller can fingerprint the
 *     identity provider and adding one never adds a reason token.
 *
 * ## The mock cannot run in production
 *
 * ADR-0006 rule 6. Adapter selection is environment configuration and the process
 * refuses to boot if the mock is selected while the environment is production —
 * enforced in `platform/config.ts` and again in the mock's own factory. A mocked
 * verification path in front of real payments is the worst failure this system
 * could have, so it is prevented at startup rather than by policy.
 */

import type { AssuranceLevel } from "../domain/assurance.js";

/**
 * Which journey the citizen is in. Present because it changes what a *real*
 * provider can offer: a kiosk can scan a document and reach `L3`, a WhatsApp
 * conversation cannot follow a redirect, and a widget can do both.
 */
export type VerificationChannel = "widget" | "whatsapp" | "kiosk" | "voice";

export interface VerificationRequest {
  /** The citizen session being stepped up. Never a citizen-supplied identifier. */
  readonly sessionId: string;
  readonly targetLevel: AssuranceLevel;
  readonly channel: VerificationChannel;
  readonly locale: "en" | "ar";
}

/**
 * How the citizen is asked to prove something.
 *
 * `redirect` is UAE PASS, `otp` is the SMS fallback, `document_scan` is the kiosk
 * path to `L3`. The kind is returned rather than assumed so the surface renders
 * the right thing without knowing which adapter is configured.
 */
export interface VerificationChallenge {
  readonly challengeId: string;
  readonly kind: "redirect" | "otp" | "document_scan";
  /** The UAE PASS authorisation URL. Null for an in-band challenge. */
  readonly redirectUrl: string | null;
  readonly expiresAt: Date;
}

export type VerificationResponse =
  | { readonly kind: "otp"; readonly code: string }
  | { readonly kind: "callback"; readonly authorizationCode: string }
  | { readonly kind: "document"; readonly scanReference: string };

/**
 * The verified attributes. Note what is here and what is not: a hash, a name and
 * a masked mobile, which is everything B11 needs to link a utility account and
 * nothing that could reconstruct the national identifier.
 */
export interface VerifiedIdentity {
  readonly emiratesIdHash: string;
  readonly verifiedName: string;
  /** Already masked, e.g. `+9715****1234`. The unmasked value never reaches the application. */
  readonly mobileMasked: string;
}

export interface AssuranceResult {
  readonly level: AssuranceLevel;
  /** Null when the challenge failed, or when the level reached needs no identity (`L0`). */
  readonly identity: VerifiedIdentity | null;
  readonly verifiedAt: Date;
  /** Assurance decays — a payment two hours later re-challenges (api.md §9.9). */
  readonly expiresAt: Date;
}

export interface AccountRef {
  readonly accountNumber: string;
  /** `electricity`, `water`, `library` — which service directory to resolve against. */
  readonly serviceKind: string;
}

/**
 * B11 tab 1's account-ownership check.
 *
 * `unavailable` is distinct from `not_matched` on purpose: the directory being
 * down must not read as "this account is not yours", or an outage silently
 * becomes a denial the citizen cannot appeal. The caller fails closed either way,
 * but only one of the two is worth paging someone about.
 */
export interface OwnershipResult {
  readonly matched: boolean;
  readonly reason: "matched" | "not_matched" | "unavailable";
}

export interface VerificationProvider {
  challenge(request: VerificationRequest): Promise<VerificationChallenge>;

  /**
   * Complete a challenge. Returns the achieved level, which may be lower than
   * the level requested — and callers must compare ranks rather than assume they
   * got what they asked for.
   */
  verify(challengeId: string, response: VerificationResponse): Promise<AssuranceResult>;

  confirmAccountOwnership(
    identity: VerifiedIdentity,
    account: AccountRef,
  ): Promise<OwnershipResult>;

  /**
   * Which rungs this adapter can actually reach.
   *
   * The OTP-only adapter cannot reach `L1`, and no adapter but a kiosk reaches
   * `L3`. Declaring it means a step-up rule requiring an unreachable level fails
   * at configuration time in B11 rather than in front of a citizen.
   */
  supportedLevels(): readonly AssuranceLevel[];
}
