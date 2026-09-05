import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../domain/ports';
import { TENANT_LIMIT } from '../domain/tenant';
import { assertTenantName, assertTenantSlug } from '../domain/validation';
import { toTenantDto } from './tenant-dto';

/**
 * Creates a tenant plus its default config/residency/alert-policy rows in one
 * transaction, with `room_namespace = slug` (FR-TENANT-1, FR-TENANT-3).
 *
 * The 500-tenant platform limit (FR-TENANT-1) is enforced here rather than as
 * a DB constraint because the spec expresses it as a request-time validation
 * error (`TENANT_LIMIT_REACHED`), not a hard schema invariant.
 */
@Injectable()
export class CreateTenantUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * @param input - name, slug, optional initial status
   */
  async execute(input: { name: string; slug: string; status?: 'active' | 'paused' }) {
    const name = assertTenantName(input.name);
    const slug = assertTenantSlug(input.slug);

    const count = await this.tenants.count();
    if (count >= TENANT_LIMIT) {
      throw AppError.badRequest('TENANT_LIMIT_REACHED');
    }

    const existing = await this.tenants.findBySlug(slug);
    if (existing) {
      throw AppError.conflict('TENANT_SLUG_EXISTS');
    }

    // withBypass: tenant + its child defaults are created before any
    // TenantContext scope exists for this brand-new id.
    const record = await this.prisma.transaction(async (tx) => {
      const row = await tx.tenant.create({
        data: {
          name,
          slug,
          status: input.status ?? 'active',
          roomNamespace: slug,
        },
      });
      await tx.dataResidencyPolicy.create({ data: { tenantId: row.id } });
      await tx.alertPolicy.create({ data: { tenantId: row.id } });
      await tx.deploymentConfig.create({
        data: {
          tenantId: row.id,
          yamlText: '',
          status: 'draft',
        },
      });
      return row;
    });

    // Re-read through the repository so the response shape (provider stack
    // summary, etc.) is computed the same way as every other tenant read.
    const created = await this.tenants.findById(record.id);
    if (!created) {
      throw AppError.badRequest('TENANT_NAME_INVALID');
    }
    return toTenantDto(created);
  }
}
