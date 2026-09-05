import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROBE_STRATEGY,
  PROVIDER_CREDENTIAL_REPOSITORY,
  type ProbeStrategyPort,
  type ProviderCredentialRepositoryPort,
} from '../../providers';

/**
 * Re-probes every credential of every active tenant (LLD §8.7/§8.8's
 * `provider-probe` job body). Runs with the tenant-guard bypassed (via the
 * repository's `listAllActive`) since it must see every tenant, not one.
 * Each credential's failure is isolated so one bad endpoint cannot abort the
 * sweep for the rest (fail-safe per the project's logging/job conventions).
 */
@Injectable()
export class RunProviderProbeSweepUseCase {
  private readonly logger = new Logger(RunProviderProbeSweepUseCase.name);

  constructor(
    @Inject(PROVIDER_CREDENTIAL_REPOSITORY) private readonly credentials: ProviderCredentialRepositoryPort,
    @Inject(PROBE_STRATEGY) private readonly strategy: ProbeStrategyPort,
  ) {}

  /** Probes every active tenant's credentials once. */
  async execute(): Promise<{ probed: number; failed: number }> {
    const rows = await this.credentials.listAllActive();
    let failed = 0;
    for (const credential of rows) {
      try {
        const outcome = await this.strategy.probe(credential);
        await this.credentials.recordProbeResult(credential.tenantId, credential.id, {
          status: outcome.status,
          error: outcome.message ?? null,
          probedAt: new Date(),
        });
      } catch (err) {
        failed += 1;
        this.logger.warn({ err, credentialId: credential.id }, 'provider-probe sweep: one credential failed');
      }
    }
    return { probed: rows.length, failed };
  }
}
