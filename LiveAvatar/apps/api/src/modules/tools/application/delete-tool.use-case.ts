import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../domain/ports';

/**
 * `DELETE /tenants/:id/tools/:toolId` (BL-033). Deliberately does not block
 * deleting a tool still referenced by `agent.tools[]` in a published config
 * (unlike `DeleteProviderCredentialUseCase`'s in-use guard) — the existing
 * `toolRefsKnownRule` Gate-B check already catches a dangling `api_ref` the
 * next time that config is validated/published, which is sufficient for this
 * phase's scope; see `docs/plans/agent-builder-v2-plan.md` Phase 8 result
 * notes for this as a documented follow-up rather than a silent gap.
 */
@Injectable()
export class DeleteToolUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly tools: ToolDefinitionRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param toolId - Tool id
   */
  async execute(actor: AdminActor, tenantId: string, toolId: string): Promise<void> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const existing = await this.tools.findById(tenantId, toolId);
    if (!existing) {
      throw AppError.notFound('TOOL_NOT_FOUND');
    }
    const deleted = await this.tools.delete(tenantId, toolId);
    if (!deleted) {
      throw AppError.notFound('TOOL_NOT_FOUND');
    }
  }
}
