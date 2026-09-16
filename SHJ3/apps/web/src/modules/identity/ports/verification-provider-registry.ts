/**
 * `VerificationProviders` — B11 tab 1's three rows (`UaePass` | `OtpSms` |
 * `EmiratesIdScan`), each declaring which assurance level it produces.
 *
 * Not to be confused with `iam/ports/verification-provider.ts`'s
 * `VerificationProvider` — that is the runtime port a session actually calls to
 * raise assurance; this is the B11 tab 1 *registry* of which providers are
 * configured and enabled, the config surface a `Super Admin` edits.
 */

import type { RequiredAssuranceLevel } from "../../tools/domain/tool-catalog.js";

export const VERIFICATION_PROVIDER_KEYS = ["UaePass", "OtpSms", "EmiratesIdScan"] as const;
export type VerificationProviderKey = (typeof VERIFICATION_PROVIDER_KEYS)[number];

export interface VerificationProviderRow {
  readonly id: string;
  readonly key: VerificationProviderKey;
  readonly name: string;
  readonly providerType: "NationalDigitalIdentity" | "PossessionFactor" | "DocumentCheck";
  readonly note: string | null;
  readonly isEnabled: boolean;
  readonly ordinal: number;
  readonly providesAssurance: RequiredAssuranceLevel;
}

export type ToggleProviderResult =
  | { readonly ok: true; readonly provider: VerificationProviderRow }
  | {
      readonly ok: false;
      /** Disabling the last enabled provider a live step-up rule still needs. */
      readonly reason: "identity.provider_still_required";
    };

export interface VerificationProviderRegistry {
  list(): Promise<readonly VerificationProviderRow[]>;
  setEnabled(input: {
    readonly key: VerificationProviderKey;
    readonly isEnabled: boolean;
    readonly now: Date;
  }): Promise<ToggleProviderResult>;
}
