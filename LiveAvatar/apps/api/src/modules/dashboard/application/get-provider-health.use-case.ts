import { Inject, Injectable } from '@nestjs/common';
import type { ProviderHealthResponse } from '@liveavatar/contracts';
import {
  PROVIDER_CREDENTIAL_REPOSITORY,
  PROVIDER_DEFINITION_REPOSITORY,
  type ProviderCategory,
  type ProviderCredentialRecord,
  type ProviderCredentialRepositoryPort,
  type ProviderDefinitionRepositoryPort,
} from '../../providers';

/** A cell/row's aggregated color (FR-DASH-2). */
type HealthState = 'green' | 'amber' | 'red' | 'gray';

/** Worse-wins ordering for aggregating multiple credentials into one state (FR-DASH-2). */
const SEVERITY: Record<HealthState, number> = { red: 3, amber: 2, gray: 1, green: 0 };

/** A probe older than this is treated as unknown/gray (FR-DASH-2). */
const STALE_AFTER_MS = 5 * 60 * 1000;

const CATEGORIES: ProviderCategory[] = ['transport', 'stt', 'llm', 'tts', 'avatar'];

/**
 * `GET /dashboard/provider-health` (FR-DASH-2, Screen 1). Cross-tenant by
 * design — LLD §5.7 names no `tenant_id` filter for this endpoint, unlike
 * `/dashboard/summary`.
 */
@Injectable()
export class GetProviderHealthUseCase {
  constructor(
    @Inject(PROVIDER_DEFINITION_REPOSITORY) private readonly definitions: ProviderDefinitionRepositoryPort,
    @Inject(PROVIDER_CREDENTIAL_REPOSITORY) private readonly credentials: ProviderCredentialRepositoryPort,
  ) {}

  async execute(): Promise<ProviderHealthResponse> {
    const [allDefinitions, allCredentials] = await Promise.all([
      this.definitions.list({}),
      this.credentials.listAllActive(),
    ]);

    const definitionByKey = new Map(allDefinitions.map((d) => [d.key, d]));
    const credentialsByProviderKey = new Map<string, ProviderCredentialRecord[]>();
    for (const cred of allCredentials) {
      const list = credentialsByProviderKey.get(cred.providerKey) ?? [];
      list.push(cred);
      credentialsByProviderKey.set(cred.providerKey, list);
    }

    const categories = CATEGORIES.map((category) => {
      const providerKeysInCategory = allDefinitions.filter((d) => d.category === category).map((d) => d.key);
      const providers = providerKeysInCategory
        .filter((key) => (credentialsByProviderKey.get(key) ?? []).length > 0)
        .map((key) => {
          const creds = credentialsByProviderKey.get(key) ?? [];
          const states = creds.map((c) => this.credentialState(c));
          const state = this.worstState(states);
          const lastProbeAt = creds
            .map((c) => c.lastProbeAt)
            .filter((d): d is Date => d !== null)
            .sort((a, b) => b.getTime() - a.getTime())[0];
          return {
            key,
            label: definitionByKey.get(key)?.displayName ?? key,
            state,
            last_probe_at: lastProbeAt ? lastProbeAt.toISOString() : null,
          };
        });
      return {
        category,
        state: providers.length > 0 ? this.worstState(providers.map((p) => p.state)) : ('gray' as HealthState),
        providers,
      };
    });

    return { categories };
  }

  /** @param cred - Credential row */
  private credentialState(cred: ProviderCredentialRecord): HealthState {
    if (!cred.lastProbeAt || Date.now() - cred.lastProbeAt.getTime() > STALE_AFTER_MS) {
      return 'gray';
    }
    switch (cred.lastProbeStatus) {
      case 'healthy':
        return 'green';
      case 'degraded':
        return 'amber';
      case 'unreachable':
        return 'red';
      default:
        return 'gray';
    }
  }

  /** @param states - Non-empty list of states to reduce to the worst one */
  private worstState(states: HealthState[]): HealthState {
    return states.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst), 'green' as HealthState);
  }
}
