import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigProviders, type DeploymentConfigRepositoryPort } from '../domain/ports';
import { findLlmNodes, stringifyAgentConfig } from '../domain/agent-config';
import { ValidateConfigUseCase } from './validate-config.use-case';
import { toDeploymentConfigDto } from './config-dto';

/**
 * `PUT /tenants/:id/config` (FR-CONFIG-3). Draft persists through Gate B
 * (`422`) failures; publishing must clear both gates. Publishing also
 * regenerates the canonical YAML from the structured form so a hand-edited
 * document is normalized on write (LLD §8.2).
 */
@Injectable()
export class SaveConfigUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
    private readonly validator: ValidateConfigUseCase,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param input - Raw YAML or structured body + `save_as`
   * @param ifMatch - Required `If-Match` header value (ISO `updated_at`)
   */
  async execute(
    actor: AdminActor,
    tenantId: string,
    input: { yaml_text?: string; config?: unknown; save_as: 'draft' | 'published' },
    ifMatch: string,
  ) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }

    const raw = this.validator.parseInput(input);
    const gateA = this.validator.runSchemaGate(raw);
    if (!gateA.schemaValid) {
      // Draft or published: a malformed/secret-bearing document is never
      // persisted (LLD §5.5 "Draft saves persist through 422 but not 400").
      const first = gateA.errors[0];
      throw AppError.badRequest(first.code, { errors: gateA.errors });
    }

    // Server-owned fields (FR-CONFIG-2): always reasserted from the tenant
    // row regardless of what the caller sent.
    gateA.config.deployment = { ...gateA.config.deployment, tenant_id: tenant.id, name: gateA.config.deployment?.name ?? tenant.name };
    gateA.config.transport = { ...gateA.config.transport, room_namespace: tenant.slug };

    if (input.save_as === 'published') {
      const combinationErrors = await this.validator.runCombinationGate(tenantId, gateA.config);
      // Phase 12b (BL-045/047) — a `severity: 'warning'` error (V-9 today)
      // must not block publish; every other Gate B rule still omits
      // `severity` and blocks unconditionally, unchanged.
      const blocking = combinationErrors.filter((e) => e.severity !== 'warning');
      if (blocking.length > 0) {
        throw new AppError(blocking[0].code, 422, { errors: blocking });
      }
    }

    const ifMatchDate = new Date(ifMatch);
    if (Number.isNaN(ifMatchDate.getTime())) {
      throw AppError.conflict('CONFIG_CONFLICT');
    }

    const [primaryLlmNode] = findLlmNodes(gateA.config.reasoning);
    const providers: DeploymentConfigProviders = {
      transport: gateA.config.transport?.provider ?? null,
      stt: gateA.config.stt?.provider ?? null,
      llm: primaryLlmNode?.provider ?? null,
      llmFallback: primaryLlmNode?.fallback?.provider ?? null,
      tts: gateA.config.tts?.provider ?? null,
      avatar: gateA.config.avatar?.provider ?? null,
    };

    const yamlText = stringifyAgentConfig(gateA.config);
    const now = new Date();
    // Phase 9 (BL-035, `ARCHITECTURE_NOTES.md` §2): only a **publish**
    // writes a `ConfigVersion` row — draft saves behave exactly as before,
    // no snapshot noise on autosave. `createVersion` is applied by the
    // repository in the *same* Prisma transaction as the `DeploymentConfig`
    // update (see `PrismaDeploymentConfigRepository.save`), so a publish
    // can never leave the pointer row and the version-history row
    // disagreeing.
    const result = await this.configs.save(
      tenantId,
      {
        yamlText,
        status: input.save_as,
        providers,
        updatedBy: actor.id,
        publishedAt: input.save_as === 'published' ? now : undefined,
        createVersion: input.save_as === 'published' ? { publishedAt: now, createdBy: actor.id } : undefined,
      },
      ifMatchDate,
    );
    if (result === 'missing') {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (result === 'conflict') {
      throw AppError.conflict('CONFIG_CONFLICT');
    }
    return toDeploymentConfigDto(result);
  }
}
