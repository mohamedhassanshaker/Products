import { Inject, Injectable } from '@nestjs/common';
import type { ResidencyResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { RESIDENCY_POLICY_REPOSITORY, type ResidencyPolicyRepositoryPort } from '../domain/ports';

/** `GET /tenants/{id}/residency` (FR-PRIV-1, Screen 8). */
@Injectable()
export class GetResidencyUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(RESIDENCY_POLICY_REPOSITORY) private readonly residency: ResidencyPolicyRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path `:id`
   */
  async execute(actor: AdminActor, tenantId: string): Promise<ResidencyResponse> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    const policy = await this.residency.findByTenantId(tenantId);
    if (!policy) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    return {
      send_to_remote_llm: policy.sendToRemoteLlm,
      retain_transcripts_days: policy.retainTranscriptsDays,
      recordings_enabled: policy.recordingsEnabled,
      updated_at: policy.updatedAt.toISOString(),
    };
  }
}
