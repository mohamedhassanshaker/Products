import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../domain/ports';
import { toTenantDto } from './tenant-dto';

/**
 * Reads a single tenant. Unknown *or* unassigned ids both surface as
 * `404 TENANT_NOT_FOUND` (LLD §5.1 cross-tenant rule) — never `403` here.
 */
@Injectable()
export class GetTenantUseCase {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort) {}

  /**
   * @param actor - Authenticated admin
   * @param id - Tenant id
   */
  async execute(actor: AdminActor, id: string) {
    const record = await this.tenants.findById(id);
    if (!record || !canAccessTenant(actor, record.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    return toTenantDto(record);
  }
}
