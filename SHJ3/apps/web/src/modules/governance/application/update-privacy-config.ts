import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import {
  isValidDataResidency,
  isValidTranscriptRetention,
  type DataResidency,
  type TranscriptRetention,
} from "../domain/privacy.js";
import type {
  PrivacyConfigRepository,
  PrivacyConfigRow,
} from "../ports/privacy-config-repository.js";

export class InvalidPrivacyConfigValueError extends Error {
  readonly code = "governance.invalid_privacy_config_value";
  constructor(field: string, value: string) {
    super(`"${value}" is not a valid value for ${field}.`);
    this.name = "InvalidPrivacyConfigValueError";
  }
}

export interface UpdatePrivacyConfigInput {
  readonly consentLedgerEnabled: boolean;
  readonly honourErasureRequests: boolean;
  readonly transcriptRetention: string;
  readonly dataResidency: string;
  readonly actor: Principal;
  readonly now: Date;
}

/**
 * B14 tab 4's privacy tab — write side. No DB trigger writes an audit entry for a plain
 * `PrivacyConfigs` update (only `PromotionRequests` decisions and `TranscriptExports`
 * inserts have their own dedicated audit-writing triggers), so this use case calls
 * `AuditSink.record(...)` directly — reusing `modules/platform/ports/provisioning.ts`'s
 * already-built, already-tested port (`TenantAuditSink`) rather than duplicating it.
 */
export class UpdatePrivacyConfig {
  constructor(
    private readonly deps: {
      readonly privacyConfig: PrivacyConfigRepository;
      readonly audit: AuditSink;
    },
  ) {}

  async execute(input: UpdatePrivacyConfigInput): Promise<PrivacyConfigRow> {
    if (!isValidTranscriptRetention(input.transcriptRetention)) {
      throw new InvalidPrivacyConfigValueError("transcriptRetention", input.transcriptRetention);
    }
    if (!isValidDataResidency(input.dataResidency)) {
      throw new InvalidPrivacyConfigValueError("dataResidency", input.dataResidency);
    }
    const transcriptRetention: TranscriptRetention = input.transcriptRetention;
    const dataResidency: DataResidency = input.dataResidency;

    const before = await this.deps.privacyConfig.get();
    const after = await this.deps.privacyConfig.update({
      consentLedgerEnabled: input.consentLedgerEnabled,
      honourErasureRequests: input.honourErasureRequests,
      transcriptRetention,
      dataResidency,
      updatedByStaffUserId: input.actor.id,
      now: input.now,
    });

    await this.deps.audit.record({
      actor: { kind: "Principal", principal: input.actor },
      action: "governance.privacy_config_updated",
      target: { kind: "PrivacyConfig", id: after.id, labelSnapshot: "Privacy & data settings" },
      summary: `Updated privacy & data settings (retention: ${after.transcriptRetention}, residency: ${after.dataResidency})`,
      before,
      after,
    });

    return after;
  }
}
