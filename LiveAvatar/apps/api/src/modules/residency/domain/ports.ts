/** `DataResidencyPolicy` aggregate as the application layer sees it (FR-PRIV-1). */
export interface ResidencyPolicyRecord {
  tenantId: string;
  sendToRemoteLlm: 'prompt_text_only' | 'prompt_and_transcript' | 'none';
  retainTranscriptsDays: number;
  recordingsEnabled: boolean;
  updatedAt: Date;
}

/** `DataResidencyPolicy` persistence. One row per tenant (Phase 1 creates it with defaults). */
export interface ResidencyPolicyRepositoryPort {
  findByTenantId(tenantId: string): Promise<ResidencyPolicyRecord | null>;
  update(
    tenantId: string,
    input: { sendToRemoteLlm: string; retainTranscriptsDays: number; recordingsEnabled: boolean },
    ifMatch: Date,
  ): Promise<ResidencyPolicyRecord | 'conflict' | 'missing'>;
}

export const RESIDENCY_POLICY_REPOSITORY = Symbol('RESIDENCY_POLICY_REPOSITORY');
