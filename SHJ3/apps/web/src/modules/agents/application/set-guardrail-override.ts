/**
 * Set (or replace) one guardrail override for an agent — B3 step 7's toggle/threshold
 * controls.
 *
 * Must check `isLocked` before writing, here — not only inside the repository — because
 * `PolicyOverrideRepository.setOverride`'s own doc comment says so explicitly: "Rejected by
 * the caller (not this port) before ever reaching here if the policy is locked... matching
 * `docs/api.md`'s `409 governance.policy_locked`." A locked policy (`mask_pii_in_transcripts`,
 * which has no `platform.OverridablePolicies` row at all) and an unknown policy key fail the
 * same way: there is nothing in the catalogue this agent is allowed to override.
 */

import type { PolicyOverrideRepository } from "../ports/policy-override-repository.js";

export interface SetGuardrailOverrideInput {
  readonly agentId: string;
  readonly policyKey: string;
  readonly mode: "Value" | "Disabled";
  readonly valueJson: string | null;
  readonly reason: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type SetGuardrailOverrideResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "governance.policy_locked" };

export interface SetGuardrailOverrideDeps {
  readonly policies: PolicyOverrideRepository;
}

export class SetGuardrailOverride {
  constructor(private readonly deps: SetGuardrailOverrideDeps) {}

  async execute(input: SetGuardrailOverrideInput): Promise<SetGuardrailOverrideResult> {
    const [policy] = await this.deps.policies.listGuardrailPolicies([input.policyKey]);
    if (!policy || policy.isLocked) {
      return { ok: false, reason: "governance.policy_locked" };
    }

    await this.deps.policies.setOverride({
      agentId: input.agentId,
      policyKey: input.policyKey,
      mode: input.mode,
      valueJson: input.valueJson,
      reason: input.reason,
      actorStaffUserId: input.actorStaffUserId,
      now: input.now,
    });
    return { ok: true };
  }
}
