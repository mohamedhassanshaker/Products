import { Inject, Injectable } from '@nestjs/common';
import type { ConfigVersionDiffResponseDto } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { CONFIG_VERSION_REPOSITORY, type ConfigVersionRepositoryPort } from '../domain/ports';
import { diffLines } from '../domain/text-diff';

/**
 * `GET /tenants/:id/config/versions/diff?from=N&to=M` (Phase 9, BL-035).
 * Diff computed at read time from the two versions' `yamlText` — no stored
 * diff, no second representation to keep in sync
 * (`ARCHITECTURE_NOTES.md` §2). Backend capability only — the diff **UI**
 * is deferred (BL-078).
 */
@Injectable()
export class GetConfigVersionDiffUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(CONFIG_VERSION_REPOSITORY) private readonly versions: ConfigVersionRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, from: number, to: number): Promise<ConfigVersionDiffResponseDto> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    const [fromVersion, toVersion] = await Promise.all([
      this.versions.findByTenantAndVersion(tenantId, from),
      this.versions.findByTenantAndVersion(tenantId, to),
    ]);
    if (!fromVersion || !toVersion) {
      throw AppError.notFound('CONFIG_VERSION_NOT_FOUND');
    }
    return { from, to, lines: diffLines(fromVersion.yamlText, toVersion.yamlText) };
  }
}
