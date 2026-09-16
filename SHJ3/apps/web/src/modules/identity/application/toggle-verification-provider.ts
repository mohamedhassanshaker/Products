/**
 * Toggle a B11 tab 1 verification provider on/off — `PATCH /verification/
 * providers/{id}` (api.md §6.10). Disabling the last provider a live,
 * enabled step-up rule still needs is refused (`identity.provider_still_
 * required`) rather than silently leaving a rule that can never be satisfied.
 */

import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type {
  ToggleProviderResult,
  VerificationProviderKey,
  VerificationProviderRegistry,
} from "../ports/verification-provider-registry.js";

export interface ToggleVerificationProviderDeps {
  readonly providers: VerificationProviderRegistry;
  readonly audit: AuditSink;
}

export class ToggleVerificationProvider {
  constructor(private readonly deps: ToggleVerificationProviderDeps) {}

  async execute(input: {
    readonly key: VerificationProviderKey;
    readonly isEnabled: boolean;
    readonly actor: Principal;
    readonly now: Date;
  }): Promise<ToggleProviderResult> {
    const result = await this.deps.providers.setEnabled({
      key: input.key,
      isEnabled: input.isEnabled,
      now: input.now,
    });

    if (result.ok) {
      await this.deps.audit.record({
        actor: { kind: "Principal", principal: input.actor },
        action: "identity.verification_provider_toggled",
        target: { kind: "VerificationProvider", id: result.provider.id, labelSnapshot: input.key },
        summary: `${input.isEnabled ? "Enabled" : "Disabled"} verification provider: ${input.key}`,
        after: { isEnabled: input.isEnabled },
      });
    }

    return result;
  }
}
