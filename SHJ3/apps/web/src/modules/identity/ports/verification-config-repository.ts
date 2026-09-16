/**
 * `VerificationConfigs` — the singleton row holding B11 tab 1's account-ownership
 * toggle, "the single most consequential toggle in the prototype" (data-model.md
 * §4.11). `CK_VerificationConfigs_disableNeedsReason` makes disabling it silently
 * unrepresentable — a reason and an attributed actor are required columns the
 * moment the flag goes to `false`, not an application-layer nicety.
 */

export interface VerificationConfigRow {
  readonly accountOwnershipCheckEnabled: boolean;
  readonly ownershipCheckDisabledReason: string | null;
  readonly ownershipCheckLastChangedByStaffUserId: string | null;
  readonly ownershipCheckLastChangedAt: Date | null;
  readonly otpLengthDigits: number;
  readonly otpTtlSeconds: number;
  readonly otpMaxAttempts: number;
}

export interface VerificationConfigRepository {
  /** Always returns a row — a fresh tenant is seeded with the check enabled by default. */
  get(): Promise<VerificationConfigRow>;

  setAccountOwnershipCheck(input: {
    readonly enabled: boolean;
    /** Required by `CK_VerificationConfigs_disableNeedsReason` when `enabled` is `false`. */
    readonly reason: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<VerificationConfigRow>;
}
