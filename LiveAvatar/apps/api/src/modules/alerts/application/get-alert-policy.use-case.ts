import { Inject, Injectable } from '@nestjs/common';
import type { AlertPolicyResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigRepositoryPort } from '../../deployment-config';
import { ALERT_POLICY_REPOSITORY, type AlertPolicyRepositoryPort } from '../domain/ports';

/** `GET /tenants/{id}/alert-policy` (FR-ALERT-1, Screen 7). */
@Injectable()
export class GetAlertPolicyUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(ALERT_POLICY_REPOSITORY) private readonly alertPolicy: AlertPolicyRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path `:id`
   */
  async execute(actor: AdminActor, tenantId: string): Promise<AlertPolicyResponse> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    const policy = await this.alertPolicy.findByTenantId(tenantId);
    if (!policy) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    // Phase 9 (BL-035): the primary/fallback pair now lives on the first
    // `llm`-type `reasoning.graph[]` node instead of a top-level `llm` block.
    const config = await this.configs.findByTenantId(tenantId);
    const primaryLlmNode = config?.structured.reasoning?.graph.find((n) => n.type === 'llm');
    const fallback = primaryLlmNode && primaryLlmNode.type === 'llm' ? primaryLlmNode.fallback : undefined;

    return {
      retry_max_attempts: policy.retryMaxAttempts,
      retry_backoff_ms: policy.retryBackoffMs,
      degraded_mode_message: policy.degradedModeMessage,
      // Read-only here — identity is Agent-Builder-owned (see
      // `UpdateAlertPolicyUseCase`'s docstring); this is a display-only
      // projection of the same `DeploymentConfig` Agent Builder writes.
      llm_fallback: fallback?.provider && fallback.model ? { provider: fallback.provider, model: fallback.model, credential_ref: fallback.credential_ref } : null,
      updated_at: policy.updatedAt.toISOString(),
    };
  }
}
