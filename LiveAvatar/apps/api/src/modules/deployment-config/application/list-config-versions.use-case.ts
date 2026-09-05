import { Inject, Injectable } from '@nestjs/common';
import type { ConfigVersionSummaryDto } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { CONFIG_VERSION_REPOSITORY, type ConfigVersionRepositoryPort } from '../domain/ports';

/**
 * `GET /tenants/:id/config/versions` (Phase 9, BL-035). Read-only —
 * `ConfigVersion` rows are append-only, written only by `SaveConfigUseCase`
 * on publish.
 */
@Injectable()
export class ListConfigVersionsUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(CONFIG_VERSION_REPOSITORY) private readonly versions: ConfigVersionRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string): Promise<{ versions: ConfigVersionSummaryDto[] }> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    const rows = await this.versions.listByTenantId(tenantId);
    const byId = new Map(rows.map((r) => [r.id, r.versionNumber]));
    return {
      versions: rows.map((r) => ({
        version_number: r.versionNumber,
        status: r.status,
        published_at: r.publishedAt.toISOString(),
        created_by: r.createdBy,
        rolled_back_from: r.rolledBackFrom ? (byId.get(r.rolledBackFrom) ?? null) : null,
      })),
    };
  }
}
