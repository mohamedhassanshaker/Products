/**
 * Toggle B11 tab 1's account-ownership check — `PUT /verification/
 * ownership-check` (api.md §6.10). `CK_VerificationConfigs_disableNeedsReason`
 * is the real enforcement; this use case's own validation exists so a rejected
 * disable never reaches the audit log as if it had happened.
 */

import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type {
  VerificationConfigRepository,
  VerificationConfigRow,
} from "../ports/verification-config-repository.js";

export type SetAccountOwnershipCheckResult =
  | { readonly ok: true; readonly config: VerificationConfigRow }
  | { readonly ok: false; readonly reason: "identity.disable_requires_reason" };

export interface SetAccountOwnershipCheckDeps {
  readonly config: VerificationConfigRepository;
  readonly audit: AuditSink;
}

export class SetAccountOwnershipCheck {
  constructor(private readonly deps: SetAccountOwnershipCheckDeps) {}

  async execute(input: {
    readonly enabled: boolean;
    readonly reason: string | null;
    readonly actor: Principal;
    readonly now: Date;
  }): Promise<SetAccountOwnershipCheckResult> {
    if (!input.enabled && (!input.reason || input.reason.trim().length === 0)) {
      return { ok: false, reason: "identity.disable_requires_reason" };
    }

    const before = await this.deps.config.get();
    const config = await this.deps.config.setAccountOwnershipCheck({
      enabled: input.enabled,
      reason: input.enabled ? null : input.reason,
      actorStaffUserId: input.actor.id,
      now: input.now,
    });

    // B11 tab 1's own rule: the disabled state always has a name and a stated
    // justification attached, in the audit log as well as on the row itself.
    await this.deps.audit.record({
      actor: { kind: "Principal", principal: input.actor },
      action: "identity.account_ownership_check_changed",
      target: { kind: "VerificationConfig", labelSnapshot: "Account ownership check" },
      summary: input.enabled
        ? "Enabled the account-ownership check"
        : `Disabled the account-ownership check: ${input.reason}`,
      before: { accountOwnershipCheckEnabled: before.accountOwnershipCheckEnabled },
      after: { accountOwnershipCheckEnabled: input.enabled, reason: input.reason },
    });

    return { ok: true, config };
  }
}
