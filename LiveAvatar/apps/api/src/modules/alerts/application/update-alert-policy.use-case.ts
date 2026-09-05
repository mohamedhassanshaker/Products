import { Inject, Injectable } from '@nestjs/common';
import type { UpdateAlertPolicyRequest, AlertPolicyResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigRepositoryPort } from '../../deployment-config';
import { ALERT_POLICY_REPOSITORY, type AlertPolicyRepositoryPort } from '../domain/ports';

/**
 * `PUT /tenants/{id}/alert-policy` (FR-ALERT-1, Screen 7).
 *
 * **Scope decision, flagged for the orchestrator/architect**: LLD §5.6 says
 * this route writes `AlertPolicy` *and* the same `DeploymentConfig`'s
 * `llm.fallback` block in one transaction. `docs/design/UX_GUIDELINES.md`
 * §16.9 resolved the resulting product conflict (Screen 7's brief vs. the
 * pre-existing Agent Builder §10.5 decision that fallback-LLM *identity* is
 * Agent-Builder-owned) by keeping `llm_fallback` **read-only** on Screen 7.
 * Consistent with that, this use case validates `retry_max_attempts`/
 * `retry_backoff_ms`/`degraded_mode_message` and persists them to
 * `AlertPolicy` only; an `llm_fallback` value in the request body is
 * accepted (so the wire contract matches LLD §5.6 exactly) but never
 * mutates `DeploymentConfig` — changing fallback identity still requires
 * publishing through Agent Builder, so there is exactly one writer of that
 * YAML, never two code paths racing to regenerate it.
 */
@Injectable()
export class UpdateAlertPolicyUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(ALERT_POLICY_REPOSITORY) private readonly alertPolicy: AlertPolicyRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path `:id`
   * @param input - `{retry_max_attempts(1-5), retry_backoff_ms[], degraded_mode_message(1-500), llm_fallback?}`
   * @param ifMatch - Required `If-Match` header value (ISO `updated_at`)
   */
  async execute(
    actor: AdminActor,
    tenantId: string,
    input: UpdateAlertPolicyRequest,
    ifMatch: string,
  ): Promise<AlertPolicyResponse> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }

    if (
      input.retry_max_attempts < 1 ||
      input.retry_max_attempts > 5 ||
      input.retry_backoff_ms.length !== input.retry_max_attempts
    ) {
      throw AppError.badRequest('CONFIG_RETRY_INVALID');
    }

    if (input.llm_fallback) {
      // Phase 9 (BL-035): primary leg now lives on the first `llm`-type
      // `reasoning.graph[]` node.
      const config = await this.configs.findByTenantId(tenantId);
      const primaryNode = config?.structured.reasoning?.graph.find((n) => n.type === 'llm');
      const primary = primaryNode && primaryNode.type === 'llm' ? primaryNode : undefined;
      if (primary && primary.provider === input.llm_fallback.provider && primary.model === input.llm_fallback.model) {
        throw new AppError('CONFIG_FALLBACK_IDENTICAL', 422);
      }
    }

    const ifMatchDate = new Date(ifMatch);
    if (Number.isNaN(ifMatchDate.getTime())) {
      throw AppError.conflict('CONFIG_CONFLICT');
    }

    const result = await this.alertPolicy.update(
      tenantId,
      {
        retryMaxAttempts: input.retry_max_attempts,
        retryBackoffMs: input.retry_backoff_ms,
        degradedModeMessage: input.degraded_mode_message,
      },
      ifMatchDate,
    );
    if (result === 'missing') {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (result === 'conflict') {
      throw AppError.conflict('CONFIG_CONFLICT');
    }

    const config = await this.configs.findByTenantId(tenantId);
    const primaryLlmNode = config?.structured.reasoning?.graph.find((n) => n.type === 'llm');
    const fallback = primaryLlmNode && primaryLlmNode.type === 'llm' ? primaryLlmNode.fallback : undefined;
    return {
      retry_max_attempts: result.retryMaxAttempts,
      retry_backoff_ms: result.retryBackoffMs,
      degraded_mode_message: result.degradedModeMessage,
      llm_fallback: fallback?.provider && fallback.model ? { provider: fallback.provider, model: fallback.model, credential_ref: fallback.credential_ref } : null,
      updated_at: result.updatedAt.toISOString(),
    };
  }
}
