/** Provider category (spec FR-PROVIDER-1). */
export type ProviderCategory = 'transport' | 'stt' | 'llm' | 'tts' | 'avatar';

/** Where the provider's workload runs (FR-PROVIDER-6). */
export type ProviderHosting = 'self_hosted' | 'remote';

/** Latest probe status (FR-PROVIDER-3). */
export type ProbeStatus = 'healthy' | 'degraded' | 'unreachable' | 'unknown';

/** Catalog entry as the application layer sees it. */
export interface ProviderDefinitionRecord {
  key: string;
  category: ProviderCategory;
  displayName: string;
  hosting: ProviderHosting;
  interfaceName: string;
  requiresCredential: boolean;
  enabled: boolean;
  featureGaps: string | null;
}

/** Tenant-scoped connection to a catalog entry. */
export interface ProviderCredentialRecord {
  id: string;
  tenantId: string;
  providerKey: string;
  displayLabel: string;
  endpointUrl: string;
  credentialRef: string | null;
  extra: Record<string, unknown>;
  lastProbeStatus: ProbeStatus;
  lastProbeAt: Date | null;
  lastProbeError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Rate limit budget for probes (FR-PROVIDER-3). */
export const PROBE_RATE_LIMIT_PER_MINUTE = 30;
