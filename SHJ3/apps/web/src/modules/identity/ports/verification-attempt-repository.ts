/**
 * `VerificationAttempts` — every step-up attempt, successful or not.
 * Append-only (`DENY UPDATE, DELETE` grant, §1.4) — this port offers no update
 * or delete method, matching the grant rather than merely agreeing with it.
 */

import type { RequiredAssuranceLevel } from "../../tools/domain/tool-catalog.js";
import type { StepUpAction } from "../domain/step-up.js";

export const VERIFICATION_ATTEMPT_RESULTS = [
  "Success",
  "Failed",
  "Expired",
  "Cancelled",
  "RateLimited",
] as const;
export type VerificationAttemptResult = (typeof VERIFICATION_ATTEMPT_RESULTS)[number];

export interface VerificationAttemptRow {
  readonly id: string;
  readonly conversationId: string | null;
  readonly citizenIdentityId: string | null;
  readonly providerKey: string;
  readonly actionKey: StepUpAction | null;
  readonly requiredAssurance: RequiredAssuranceLevel | null;
  readonly result: VerificationAttemptResult;
  readonly failureReason: string | null;
  readonly attemptedAt: Date;
}

export interface VerificationAttemptRepository {
  record(input: {
    readonly conversationId: string | null;
    readonly citizenIdentityId: string | null;
    readonly providerKey: string;
    readonly actionKey: StepUpAction | null;
    readonly requiredAssurance: RequiredAssuranceLevel | null;
    readonly result: VerificationAttemptResult;
    readonly failureReason: string | null;
    readonly now: Date;
  }): Promise<VerificationAttemptRow>;

  /** Brute-force detection (`IX_VerificationAttempts_result_attemptedAt`) — recent failures for one conversation. */
  countRecentFailures(conversationId: string, sinceInclusive: Date): Promise<number>;
}
