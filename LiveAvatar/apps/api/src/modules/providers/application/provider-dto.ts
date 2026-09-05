import type { ProviderDefinitionDto, ProviderCredentialDto } from '@liveavatar/contracts';
import type { ProviderCredentialRecord, ProviderDefinitionRecord } from '../domain/provider';

/** Maps a catalog record to its wire DTO. */
export function toProviderDefinitionDto(record: ProviderDefinitionRecord): ProviderDefinitionDto {
  return {
    key: record.key,
    category: record.category,
    display_name: record.displayName,
    hosting: record.hosting,
    interface_name: record.interfaceName,
    requires_credential: record.requiresCredential,
    enabled: record.enabled,
    feature_gaps: record.featureGaps,
  };
}

/**
 * Maps a credential record to its wire DTO. `has_secret` is derived, never
 * the value itself; `credential_ref` (the reference, not the secret) is
 * still returned so the UI can show which secret-store key is bound
 * (FR-PROVIDER-2).
 * @param record - Persisted credential
 */
export function toProviderCredentialDto(record: ProviderCredentialRecord): ProviderCredentialDto {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    provider_key: record.providerKey,
    display_label: record.displayLabel,
    endpoint_url: record.endpointUrl,
    credential_ref: record.credentialRef,
    has_secret: Boolean(record.credentialRef),
    extra: record.extra,
    last_probe_status: record.lastProbeStatus,
    last_probe_at: record.lastProbeAt ? record.lastProbeAt.toISOString() : null,
    last_probe_error: record.lastProbeError,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
