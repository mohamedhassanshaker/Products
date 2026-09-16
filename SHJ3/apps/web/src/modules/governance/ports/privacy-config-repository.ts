import type { DataResidency, TranscriptRetention } from "../domain/privacy.js";

export interface PrivacyConfigRow {
  readonly id: string;
  readonly consentLedgerEnabled: boolean;
  readonly honourErasureRequests: boolean;
  readonly transcriptRetention: TranscriptRetention;
  readonly dataResidency: DataResidency;
  readonly updatedByStaffUserId: string;
  readonly updatedAt: Date;
}

export interface UpdatePrivacyConfigInput {
  readonly consentLedgerEnabled: boolean;
  readonly honourErasureRequests: boolean;
  readonly transcriptRetention: TranscriptRetention;
  readonly dataResidency: DataResidency;
  readonly updatedByStaffUserId: string;
  readonly now: Date;
}

/** Singleton (`singletonKey = 1`) — get/update only, no create/delete surface. */
export interface PrivacyConfigRepository {
  get(): Promise<PrivacyConfigRow | null>;
  update(input: UpdatePrivacyConfigInput): Promise<PrivacyConfigRow>;
}
