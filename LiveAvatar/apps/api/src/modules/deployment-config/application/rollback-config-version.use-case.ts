import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import {
  CONFIG_VERSION_REPOSITORY,
  DEPLOYMENT_CONFIG_REPOSITORY,
  type ConfigVersionRepositoryPort,
  type DeploymentConfigProviders,
  type DeploymentConfigRepositoryPort,
} from '../domain/ports';
import { findLlmNodes, parseAgentConfigYaml, type PartialAgentConfig } from '../domain/agent-config';
import { toDeploymentConfigDto } from './config-dto';

/**
 * `POST /tenants/:id/config/versions/:versionNumber/rollback` (Phase 9,
 * BL-035). Creates a new **draft** prefilled from the target version's
 * `yamlText` and marks that version `rolled_back` — it **never
 * auto-publishes**; the admin must still hit Publish through the normal
 * Gate A/B path (`ARCHITECTURE_NOTES.md` §2, mirrors this project's own
 * "new commit, not amend" git discipline). The draft's
 * `pendingRollbackFromVersionId` is set so the *next* publish correctly
 * records `rolledBackFrom` on the resulting new `ConfigVersion` row (see
 * `domain/ports.ts`'s `DeploymentConfigRecord` docstring).
 */
@Injectable()
export class RollbackConfigVersionUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
    @Inject(CONFIG_VERSION_REPOSITORY) private readonly versions: ConfigVersionRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, versionNumber: number) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    const target = await this.versions.findByTenantAndVersion(tenantId, versionNumber);
    if (!target) {
      throw AppError.notFound('CONFIG_VERSION_NOT_FOUND');
    }
    const current = await this.configs.findByTenantId(tenantId);
    if (!current) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }

    const parsed = parseAgentConfigYaml(target.yamlText) as PartialAgentConfig;
    const [primaryLlmNode] = findLlmNodes(parsed.reasoning);
    const providers: DeploymentConfigProviders = {
      transport: parsed.transport?.provider ?? null,
      stt: parsed.stt?.provider ?? null,
      llm: primaryLlmNode?.provider ?? null,
      llmFallback: primaryLlmNode?.fallback?.provider ?? null,
      tts: parsed.tts?.provider ?? null,
      avatar: parsed.avatar?.provider ?? null,
    };

    const result = await this.configs.save(
      tenantId,
      {
        yamlText: target.yamlText,
        status: 'draft',
        providers,
        updatedBy: actor.id,
        pendingRollbackFromVersionId: target.id,
      },
      current.updatedAt,
    );
    if (result === 'missing') {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (result === 'conflict') {
      throw AppError.conflict('CONFIG_CONFLICT');
    }
    await this.versions.markRolledBack(tenantId, versionNumber);
    return { config: toDeploymentConfigDto(result) };
  }
}
