import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../domain/ports';
import { assertTenantStatus } from '../domain/validation';
import { toTenantDto } from './tenant-dto';

/**
 * Pauses/activates a tenant (FR-TENANT-4). Same-status requests are a `200`
 * no-op (idempotent). Paused tenants keep in-flight sessions untouched and
 * still allow Agent Builder edits — only new conversation tokens are refused,
 * which is enforced in the (Phase 3) transport module, not here.
 *
 * Unknown *or* unassigned ids both surface as `404 TENANT_NOT_FOUND`
 * (FR-TENANT-5 / HLD §7 layer 3) — never `403`, so existence isn't leaked.
 */
@Injectable()
export class ChangeTenantStatusUseCase {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort) {}

  /**
   * @param actor - Authenticated admin
   * @param id - Tenant id
   * @param input - `{ status }`
   */
  async execute(actor: AdminActor, id: string, input: { status: unknown }) {
    const status = assertTenantStatus(input.status);
    const existing = await this.tenants.findById(id);
    if (!existing || !canAccessTenant(actor, existing.id)) {
      // Combined into a single 404 branch deliberately: separating "doesn't
      // exist" from "exists but not yours" into 404 vs 403 is a tenant-
      // existence enumeration oracle (FR-TENANT-5). See class doc comment.
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (existing.status === status) {
      return toTenantDto(existing);
    }
    const updated = await this.tenants.updateStatus(id, status);
    if (!updated) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    return toTenantDto(updated);
  }
}
