import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../domain/ports';
import { assertTenantName } from '../domain/validation';
import { toTenantDto } from './tenant-dto';

/**
 * Renames a tenant (FR-TENANT-1). Slug is immutable — any `slug` key present
 * in the body is rejected regardless of value. Unknown *or* unassigned ids
 * both surface as `404 TENANT_NOT_FOUND` (FR-TENANT-5 / HLD §7 layer 3:
 * "cross-tenant id lookups return 404 ... never 403 — so existence is not
 * leaked") — never `403` here, matching every other tenant-scoped route.
 */
@Injectable()
export class UpdateTenantUseCase {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort) {}

  /**
   * @param actor - Authenticated admin
   * @param id - Tenant id
   * @param input - Partial body (name only) plus raw body for slug-presence check
   * @param ifMatch - Required `If-Match` header value (ISO `updated_at`)
   */
  async execute(
    actor: AdminActor,
    id: string,
    input: { name?: string; slug?: string },
    ifMatch: string,
  ) {
    if (input.slug !== undefined) {
      throw AppError.badRequest('TENANT_SLUG_IMMUTABLE');
    }
    const existing = await this.tenants.findById(id);
    if (!existing || !canAccessTenant(actor, existing.id)) {
      // Combined into a single 404 branch deliberately: separating "doesn't
      // exist" from "exists but not yours" into 404 vs 403 is a tenant-
      // existence enumeration oracle (FR-TENANT-5). See class doc comment.
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    const name = input.name !== undefined ? assertTenantName(input.name) : existing.name;

    const ifMatchDate = new Date(ifMatch);
    if (Number.isNaN(ifMatchDate.getTime())) {
      throw AppError.conflict('TENANT_CONFLICT');
    }

    const result = await this.tenants.updateName(id, name, ifMatchDate);
    if (result === 'missing') {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (result === 'conflict') {
      throw AppError.conflict('TENANT_CONFLICT');
    }
    return toTenantDto(result);
  }
}
