import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../domain/ports';
import { toToolDto } from './tool-dto';

/** `GET /tenants/:id/tools` (BL-033) — the registry list (Tools tab, table view). */
@Injectable()
export class ListToolsUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly tools: ToolDefinitionRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   */
  async execute(actor: AdminActor, tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const rows = await this.tools.listByTenant(tenantId);
    return { items: rows.map(toToolDto) };
  }
}
