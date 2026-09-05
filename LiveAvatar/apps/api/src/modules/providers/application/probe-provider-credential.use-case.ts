import { Inject, Injectable } from '@nestjs/common';
import type { ProbeResultDto } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import {
  PROBE_RATE_LIMITER,
  PROBE_STRATEGY,
  PROVIDER_CREDENTIAL_REPOSITORY,
  type ProbeRateLimiterPort,
  type ProbeStrategyPort,
  type ProviderCredentialRepositoryPort,
} from '../domain/ports';

/**
 * `POST /tenants/:id/provider-credentials/:credId/probe` (FR-PROVIDER-3).
 * Always `200` — even `unreachable` is a successful *check*, not an HTTP
 * failure. The `provider-probe` BullMQ job (LLD §8.7/§8.8) calls the same
 * strategy on a schedule; this use case is the on-demand "Test connection"
 * path Screen 4 drives directly.
 */
@Injectable()
export class ProbeProviderCredentialUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(PROVIDER_CREDENTIAL_REPOSITORY) private readonly credentials: ProviderCredentialRepositoryPort,
    @Inject(PROBE_STRATEGY) private readonly strategy: ProbeStrategyPort,
    @Inject(PROBE_RATE_LIMITER) private readonly rateLimiter: ProbeRateLimiterPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param credId - Credential id
   */
  async execute(actor: AdminActor, tenantId: string, credId: string): Promise<ProbeResultDto> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const credential = await this.credentials.findById(tenantId, credId);
    if (!credential) {
      throw AppError.notFound('PROVIDER_UNKNOWN');
    }

    const allowed = await this.rateLimiter.tryConsume(tenantId);
    if (!allowed) {
      throw AppError.tooMany('PROVIDER_PROBE_RATE_LIMITED');
    }

    const outcome = await this.strategy.probe(credential);
    const probedAt = new Date();
    await this.credentials.recordProbeResult(tenantId, credId, {
      status: outcome.status,
      error: outcome.message ?? null,
      probedAt,
    });

    return {
      status: outcome.status,
      error_code: outcome.errorCode,
      message: outcome.message,
      probed_at: probedAt.toISOString(),
    };
  }
}
