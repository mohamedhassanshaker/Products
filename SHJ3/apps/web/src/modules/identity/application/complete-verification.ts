/**
 * Complete a step-up challenge — `POST .../verification/challenges/{cid}/verify`
 * (api.md §4.2). Real orchestration, unlike `BeginVerification`'s passthrough:
 *
 *  1. Call `VerificationProvider.verify()` — the port never raises for a wrong
 *     code or an unavailable provider, it returns a `L0`/no-identity result
 *     (`iam/adapters/outbound/mock-verification-provider.ts`'s own doc comment:
 *     "every failure is L0 with no identity").
 *  2. **Never lower assurance.** `strongestAssurance(held, achieved)`
 *     (`iam/domain/assurance.ts`) — a session already at `L2` that completes a
 *     weaker challenge (a real provider can return less than was asked for)
 *     must not regress, matching that module's own doc comment on exactly this
 *     hazard.
 *  3. **Dedupe by Emirates ID hash before creating a row.** `UQ_
 *     CitizenIdentities_emiratesIdHash` is a real unique index: the same
 *     real person verifying from a second, independent anonymous session
 *     (`existingCitizenIdentityId === null` — no prior link, a perfectly
 *     ordinary case, not just a test artifact) must resolve to their
 *     already-existing row, never attempt a second `CitizenIdentities` insert
 *     with the identical hash. Found live, against the real constraint,
 *     the first time this use case verified the same mock identity from two
 *     independent sessions in a row — `CitizenIdentityRepository.
 *     findByEmiratesIdHash` already existed on the port for exactly this and
 *     had simply never been called from here.
 *  4. Persist the result to `CitizenIdentities`, translated back to the
 *     persisted `RequiredAssuranceLevel` enum via `assuranceToRequiredLevel`
 *     (never the raw `L0`–`L3` value — `CK_CitizenIdentities_assuranceLevel`'s
 *     closed vocabulary is the enum, not the rank).
 *  5. Record the attempt (`VerificationAttempts`, append-only) — `Success` when
 *     the achieved level actually satisfies what was asked for, `Failed`
 *     otherwise, so a session that "succeeded" at a lower level than requested
 *     is honestly logged as a failed step-up rather than a successful one.
 */

import {
  satisfiesAssurance,
  strongestAssurance,
  type AssuranceLevel,
} from "../../iam/domain/assurance.js";
import type {
  VerificationProvider,
  VerificationResponse,
} from "../../iam/ports/verification-provider.js";
import { assuranceToRequiredLevel, requiredLevelToAssurance } from "../domain/assurance-mapping.js";
import type { StepUpAction } from "../domain/step-up.js";
import type {
  CitizenIdentityRepository,
  CitizenIdentityRow,
} from "../ports/citizen-identity-repository.js";
import type { VerificationAttemptRepository } from "../ports/verification-attempt-repository.js";

export interface CompleteVerificationInput {
  readonly challengeId: string;
  readonly response: VerificationResponse;
  readonly targetLevel: AssuranceLevel;
  readonly conversationId: string | null;
  /** `null` for a session that has never verified before — a fresh identity row is minted. */
  readonly existingCitizenIdentityId: string | null;
  readonly existingHeldAssurance: AssuranceLevel;
  readonly action: StepUpAction | null;
  readonly providerKey: string;
}

export interface CompleteVerificationResult {
  readonly citizenIdentity: CitizenIdentityRow;
  /** The session's new held level — always `>=` `existingHeldAssurance` (rule 2 above). */
  readonly heldAssurance: AssuranceLevel;
  readonly succeeded: boolean;
}

export interface CompleteVerificationDeps {
  readonly provider: VerificationProvider;
  readonly citizenIdentities: CitizenIdentityRepository;
  readonly attempts: VerificationAttemptRepository;
  readonly clock: { now(): Date };
}

export class CompleteVerification {
  constructor(private readonly deps: CompleteVerificationDeps) {}

  async execute(input: CompleteVerificationInput): Promise<CompleteVerificationResult> {
    const { provider, citizenIdentities, attempts, clock } = this.deps;
    const now = clock.now();

    const result = await provider.verify(input.challengeId, input.response);

    // Resolve which row this attempt affects. A session with no linked
    // identity yet still might resolve to an ALREADY-EXISTING real-world
    // identity the moment a real hash comes back (see rule 3 above) — the
    // hash is authoritative when present, since it never lies about who this
    // is, even when the calling session had no prior link recorded.
    let resolvedCitizenIdentityId = input.existingCitizenIdentityId;
    let priorHeldAssurance = input.existingHeldAssurance;
    if (resolvedCitizenIdentityId === null && result.identity !== null) {
      const existingByHash = await citizenIdentities.findByEmiratesIdHash(
        result.identity.emiratesIdHash,
      );
      if (existingByHash !== null) {
        resolvedCitizenIdentityId = existingByHash.id;
        priorHeldAssurance = strongestAssurance(
          priorHeldAssurance,
          requiredLevelToAssurance(existingByHash.assuranceLevel),
        );
      }
    }

    const heldAssurance = strongestAssurance(priorHeldAssurance, result.level);
    // "Succeeded" is about THIS attempt alone — did the level it just achieved
    // satisfy what it was asked for? Comparing against `heldAssurance` instead
    // would be wrong: a rejected attempt achieves `L0`, and `L0` trivially
    // "equals" a fresh session's own pre-existing `L0` held level, which would
    // wrongly report a rejected OTP as a success. `existingHeldAssurance` is
    // deliberately not part of this comparison either — a session already
    // holding L2 from an earlier challenge, that this attempt then fails,
    // still failed *this* attempt (recorded honestly below), even though
    // `heldAssurance` correctly stays at L2 per rule 2's own non-regression guarantee.
    const succeeded = satisfiesAssurance(result.level, input.targetLevel);

    const citizenIdentity = await citizenIdentities.recordVerification({
      citizenIdentityId: resolvedCitizenIdentityId,
      assuranceLevel: assuranceToRequiredLevel(heldAssurance),
      emiratesIdHash: result.identity?.emiratesIdHash ?? null,
      mobileHash: null, // the port returns a masked mobile only (§12 invariant 4) — no hash to store from it
      displayNameMasked: result.identity?.verifiedName ?? null,
      verifiedByProviderKey: result.identity !== null ? input.providerKey : null,
      verifiedAt: result.identity !== null ? result.verifiedAt : null,
      verificationExpiresAt: result.identity !== null ? result.expiresAt : null,
      now,
    });

    await attempts.record({
      conversationId: input.conversationId,
      citizenIdentityId: citizenIdentity.id,
      providerKey: input.providerKey,
      actionKey: input.action,
      requiredAssurance: assuranceToRequiredLevel(input.targetLevel),
      result: succeeded ? "Success" : "Failed",
      failureReason: succeeded ? null : "assurance_below_target",
      now,
    });

    return { citizenIdentity, heldAssurance, succeeded };
  }
}
