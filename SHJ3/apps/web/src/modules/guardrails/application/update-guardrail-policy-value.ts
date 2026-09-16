/**
 * Screen 3, "Global policies" tab — edit an UNLOCKED policy's real `defaultValueJson`.
 *
 * This is the one place the task brief's non-negotiable proof lives on the application
 * side: `"invalid_value"` is checked here, independent of the UI, before the repository is
 * ever called, and `"policy_locked"`/`"policy_not_found"` come back from the repository's
 * own real, live re-check against `platform.OverridablePolicies` (see that port's doc
 * comment) — never a value trusted from an earlier read. Calling `execute()` directly,
 * bypassing every React component this screen renders, refuses a locked policy exactly as
 * reliably as the UI does, because both paths call the identical repository method.
 */

import { isValidPolicyValueJsonText } from "../domain/policy-value.js";
import type { PolicyCatalogueRepository } from "../ports/policy-catalogue-repository.js";

export type UpdateGuardrailPolicyValueResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "policy_locked" | "policy_not_found" | "invalid_value" };

export interface UpdateGuardrailPolicyValueInput {
  readonly policyKey: string;
  /** Already-encoded `{"value": <scalar>}` — see `domain/policy-value.ts`'s `encode*`
   *  helpers for the typed editors, or a hand-typed JSON textarea for the `Enum`/fallback
   *  case. Either way this is the exact string that will be persisted verbatim. */
  readonly defaultValueJson: string;
  readonly now: Date;
}

export class UpdateGuardrailPolicyValue {
  constructor(private readonly deps: { readonly policies: PolicyCatalogueRepository }) {}

  async execute(input: UpdateGuardrailPolicyValueInput): Promise<UpdateGuardrailPolicyValueResult> {
    // Re-validated here, server-side, regardless of whether the caller is this screen's
    // own dialog (which already validates client-side) or a direct call — matching
    // `CK_Policies_defaultValueJson_isJson`'s own real shape rule (this module's `domain/
    // policy-value.ts` doc comment).
    if (!isValidPolicyValueJsonText(input.defaultValueJson)) {
      return { ok: false, reason: "invalid_value" };
    }

    return this.deps.policies.updateDefaultValue({
      policyKey: input.policyKey,
      defaultValueJson: input.defaultValueJson,
      now: input.now,
    });
  }
}
