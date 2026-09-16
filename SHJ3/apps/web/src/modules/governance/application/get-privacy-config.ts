import { DEFAULT_DATA_RESIDENCY, DEFAULT_TRANSCRIPT_RETENTION } from "../domain/privacy.js";
import type {
  PrivacyConfigRepository,
  PrivacyConfigRow,
} from "../ports/privacy-config-repository.js";

/** A tenant that has never saved a privacy config yet — the real documented defaults
 *  (FR-GOV-23/25), never a thrown error, so B14 tab 4 is usable before the first save. */
export interface DefaultPrivacyConfig {
  readonly usingDefaults: true;
  readonly consentLedgerEnabled: boolean;
  readonly honourErasureRequests: boolean;
  readonly transcriptRetention: PrivacyConfigRow["transcriptRetention"];
  readonly dataResidency: PrivacyConfigRow["dataResidency"];
}

export type GetPrivacyConfigResult =
  (PrivacyConfigRow & { readonly usingDefaults: false }) | DefaultPrivacyConfig;

/** B14 tab 4's privacy tab — read side. `UpdatePrivacyConfig`'s upsert persists a real
 *  row on first save. */
export class GetPrivacyConfig {
  constructor(private readonly deps: { readonly privacyConfig: PrivacyConfigRepository }) {}

  async execute(): Promise<GetPrivacyConfigResult> {
    const row = await this.deps.privacyConfig.get();
    if (row) return { ...row, usingDefaults: false };
    return {
      usingDefaults: true,
      consentLedgerEnabled: true,
      honourErasureRequests: true,
      transcriptRetention: DEFAULT_TRANSCRIPT_RETENTION,
      dataResidency: DEFAULT_DATA_RESIDENCY,
    };
  }
}
