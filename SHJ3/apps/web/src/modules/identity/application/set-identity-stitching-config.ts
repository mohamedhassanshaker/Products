/**
 * Set B11 tab 5's stitching config — `PUT /verification/stitching` (api.md
 * §6.10). `CK_IdentityStitchingConfigs_neverStitchCoherent` is the real
 * enforcement of "stitch on, key = never" being incoherent.
 */

import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type {
  ConversationMemoryScope,
  IdentityStitchingConfigRepository,
  SetStitchingConfigResult,
  StitchingKey,
} from "../ports/identity-stitching-config-repository.js";

export interface SetIdentityStitchingConfigDeps {
  readonly config: IdentityStitchingConfigRepository;
  readonly audit: AuditSink;
}

export class SetIdentityStitchingConfig {
  constructor(private readonly deps: SetIdentityStitchingConfigDeps) {}

  async execute(input: {
    readonly stitchAcrossChannels: boolean;
    readonly stitchingKey: StitchingKey;
    readonly conversationMemoryScope: ConversationMemoryScope;
    readonly actor: Principal;
    readonly now: Date;
  }): Promise<SetStitchingConfigResult> {
    const before = await this.deps.config.get();
    const result = await this.deps.config.set({
      stitchAcrossChannels: input.stitchAcrossChannels,
      stitchingKey: input.stitchingKey,
      conversationMemoryScope: input.conversationMemoryScope,
      now: input.now,
    });

    if (result.ok) {
      await this.deps.audit.record({
        actor: { kind: "Principal", principal: input.actor },
        action: "identity.stitching_config_changed",
        target: { kind: "IdentityStitchingConfig", labelSnapshot: "Identity stitching" },
        summary: `Changed identity stitching: ${before.stitchingKey} -> ${input.stitchingKey}`,
        before,
        after: result.config,
      });
    }

    return result;
  }
}
