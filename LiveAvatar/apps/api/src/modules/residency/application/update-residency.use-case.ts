import { Inject, Injectable } from '@nestjs/common';
import type { UpdateResidencyRequest, UpdateResidencyResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigRepositoryPort } from '../../deployment-config';
import { PROVIDER_DEFINITION_REPOSITORY, type ProviderDefinitionRepositoryPort } from '../../providers';
import { RESIDENCY_POLICY_REPOSITORY, type ResidencyPolicyRepositoryPort } from '../domain/ports';

/**
 * `PUT /tenants/{id}/residency` (FR-PRIV-1). This is the operator control
 * surface for the residency policy the agent already enforces at runtime
 * (`residency/filter.py`, Phase 4) — this use case only manages the policy
 * record and its publish gate, it never re-implements enforcement logic.
 */
@Injectable()
export class UpdateResidencyUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
    @Inject(PROVIDER_DEFINITION_REPOSITORY) private readonly definitions: ProviderDefinitionRepositoryPort,
    @Inject(RESIDENCY_POLICY_REPOSITORY) private readonly residency: ResidencyPolicyRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path `:id`
   * @param input - `{send_to_remote_llm, retain_transcripts_days(1-730), recordings_enabled}`
   * @param ifMatch - Required `If-Match` header value (ISO `updated_at`)
   */
  async execute(
    actor: AdminActor,
    tenantId: string,
    input: UpdateResidencyRequest,
    ifMatch: string,
  ): Promise<UpdateResidencyResponse> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }

    if (input.retain_transcripts_days < 1 || input.retain_transcripts_days > 730) {
      throw AppError.badRequest('CONFIG_RETENTION_INVALID');
    }

    if (input.send_to_remote_llm === 'none') {
      const publishedUsesRemoteLlm = await this.publishedConfigUsesRemoteLlm(tenantId);
      if (publishedUsesRemoteLlm) {
        throw new AppError('CONFIG_RESIDENCY_BLOCKS_LLM', 422);
      }
    }

    const ifMatchDate = new Date(ifMatch);
    if (Number.isNaN(ifMatchDate.getTime())) {
      throw AppError.conflict('CONFIG_CONFLICT');
    }

    const result = await this.residency.update(
      tenantId,
      {
        sendToRemoteLlm: input.send_to_remote_llm,
        retainTranscriptsDays: input.retain_transcripts_days,
        recordingsEnabled: input.recordings_enabled,
      },
      ifMatchDate,
    );
    if (result === 'missing') {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (result === 'conflict') {
      throw AppError.conflict('CONFIG_CONFLICT');
    }

    return {
      send_to_remote_llm: result.sendToRemoteLlm,
      retain_transcripts_days: result.retainTranscriptsDays,
      recordings_enabled: result.recordingsEnabled,
      updated_at: result.updatedAt.toISOString(),
      // FR-PRIV-1: the recording pipeline is a P2 non-goal (BL-031) — save
      // still succeeds, but the operator is told nothing will actually be
      // captured, rather than silently implying otherwise.
      warnings: result.recordingsEnabled ? ['RECORDINGS_NOT_IMPLEMENTED'] : [],
    };
  }

  /**
   * True when the tenant's *published* config resolves an LLM provider whose
   * catalog `hosting` is `remote` (FR-PRIV-1's publish-gate check).
   */
  private async publishedConfigUsesRemoteLlm(tenantId: string): Promise<boolean> {
    const config = await this.configs.findByTenantId(tenantId);
    if (!config || config.status !== 'published' || !config.providers.llm) {
      return false;
    }
    const definition = await this.definitions.findByKey(config.providers.llm);
    return definition?.hosting === 'remote';
  }
}
