import type {
  ProbeStatus,
  ProviderCategory,
  ProviderCredentialRecord,
  ProviderDefinitionRecord,
} from './provider';

/** Catalog persistence (FR-PROVIDER-1). */
export interface ProviderDefinitionRepositoryPort {
  list(filter: { category?: ProviderCategory; enabled?: boolean }): Promise<ProviderDefinitionRecord[]>;
  findByKey(key: string): Promise<ProviderDefinitionRecord | null>;
  countEnabledInCategory(category: ProviderCategory): Promise<number>;
  setEnabled(key: string, enabled: boolean): Promise<ProviderDefinitionRecord | null>;
}

export const PROVIDER_DEFINITION_REPOSITORY = Symbol('PROVIDER_DEFINITION_REPOSITORY');

/** Per-tenant credential persistence (FR-PROVIDER-2/3). */
export interface ProviderCredentialRepositoryPort {
  create(input: {
    tenantId: string;
    providerKey: string;
    displayLabel: string;
    endpointUrl: string;
    credentialRef: string | null;
    extra: Record<string, unknown>;
  }): Promise<ProviderCredentialRecord>;
  findById(tenantId: string, id: string): Promise<ProviderCredentialRecord | null>;
  findByLabel(
    tenantId: string,
    providerKey: string,
    displayLabel: string,
  ): Promise<ProviderCredentialRecord | null>;
  list(tenantId: string, filter: { category?: ProviderCategory; providerKey?: string }): Promise<
    ProviderCredentialRecord[]
  >;
  listAllActive(): Promise<ProviderCredentialRecord[]>;
  update(
    tenantId: string,
    id: string,
    input: Partial<{
      endpointUrl: string;
      credentialRef: string | null;
      displayLabel: string;
      extra: Record<string, unknown>;
    }>,
    ifMatch: Date,
  ): Promise<ProviderCredentialRecord | 'conflict' | 'missing'>;
  delete(tenantId: string, id: string): Promise<boolean>;
  recordProbeResult(
    tenantId: string,
    id: string,
    result: { status: ProbeStatus; error: string | null; probedAt: Date },
  ): Promise<void>;
}

export const PROVIDER_CREDENTIAL_REPOSITORY = Symbol('PROVIDER_CREDENTIAL_REPOSITORY');

/** One probe attempt result (FR-PROVIDER-3). */
export interface ProbeOutcome {
  status: ProbeStatus;
  errorCode?: string;
  message?: string;
}

/** Category-generic connection probe (HTTP HEAD/GET, 5s timeout). */
export interface ProbeStrategyPort {
  probe(credential: ProviderCredentialRecord): Promise<ProbeOutcome>;
}

export const PROBE_STRATEGY = Symbol('PROBE_STRATEGY');

/** 30 probes / tenant / minute (FR-PROVIDER-3). */
export interface ProbeRateLimiterPort {
  /** @returns true when the caller is within budget (and consumes one unit) */
  tryConsume(tenantId: string): Promise<boolean>;
}

export const PROBE_RATE_LIMITER = Symbol('PROBE_RATE_LIMITER');

/**
 * Read-only check against the sibling `deployment-config` module's data,
 * used only to block deleting a credential a **published** config depends on
 * (FR-PROVIDER-2's "would break a published config" rule). Implemented in
 * `providers/infrastructure` as a direct Prisma read of the denormalized
 * `DeploymentConfig` provider columns — deliberately not a cross-module class
 * import (LLD §3.1 barrel-only rule), just a shared-table read the way
 * `PrismaTenantRepository` already reads `DeploymentConfig` for its list
 * summary.
 */
export interface PublishedConfigLookupPort {
  isProviderInUse(tenantId: string, providerKey: string): Promise<boolean>;
}

export const PUBLISHED_CONFIG_LOOKUP = Symbol('PUBLISHED_CONFIG_LOOKUP');
