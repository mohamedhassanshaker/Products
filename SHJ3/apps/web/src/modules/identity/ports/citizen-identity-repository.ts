/**
 * `CitizenIdentities` — a citizen, at the assurance level actually achieved.
 * Only hashes and masks (`docs/data-model.md` §4.11) — this port's shape is the
 * same discipline `iam/ports/verification-provider.ts` documents for
 * `VerifiedIdentity`: a raw Emirates ID never has a field to enter through.
 *
 * `assuranceLevel` is stored as the persisted `RequiredAssuranceLevel` enum
 * (`CK_CitizenIdentities_assuranceLevel`), not the `L0`–`L3` rank — callers
 * needing the rank (the step-up gate, `Principal.assurance`) go through
 * `domain/assurance-mapping.ts`'s `requiredLevelToAssurance`.
 */

import type { RequiredAssuranceLevel } from "../../tools/domain/tool-catalog.js";

export interface CitizenIdentityRow {
  readonly id: string;
  readonly assuranceLevel: RequiredAssuranceLevel;
  readonly emiratesIdHash: string | null;
  readonly mobileHash: string | null;
  readonly displayNameMasked: string | null;
  readonly verifiedByProviderKey: string | null;
  readonly verifiedAt: Date | null;
  readonly verificationExpiresAt: Date | null;
  readonly erasedAt: Date | null;
}

export interface CitizenIdentityRepository {
  findById(id: string): Promise<CitizenIdentityRow | null>;

  /** `UQ_CitizenIdentities_emiratesIdHash ... WHERE erasedAt IS NULL` — the real join key for "have we seen this person before." */
  findByEmiratesIdHash(emiratesIdHash: string): Promise<CitizenIdentityRow | null>;

  /**
   * Create a fresh `Anonymous` identity row, or raise an existing one's
   * assurance. `CompleteVerification` (application layer) is the only caller —
   * this port does not itself decide whether a new verification should
   * *replace* or *strengthen* an existing record; it just persists whatever the
   * use case decided (`strongestAssurance`'s job, upstream).
   */
  recordVerification(input: {
    readonly citizenIdentityId: string | null;
    readonly assuranceLevel: RequiredAssuranceLevel;
    readonly emiratesIdHash: string | null;
    readonly mobileHash: string | null;
    readonly displayNameMasked: string | null;
    readonly verifiedByProviderKey: string | null;
    readonly verifiedAt: Date | null;
    readonly verificationExpiresAt: Date | null;
    readonly now: Date;
  }): Promise<CitizenIdentityRow>;
}
