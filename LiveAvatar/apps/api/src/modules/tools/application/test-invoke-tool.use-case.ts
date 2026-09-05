import { Inject, Injectable } from '@nestjs/common';
import type { TestInvokeToolRequest, TestInvokeToolResultDto } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { TOOL_DEFINITION_REPOSITORY, TOOL_INVOKER, type ToolDefinitionRepositoryPort, type ToolInvokerPort } from '../domain/ports';
import { toTestInvokeResultDto } from './tool-dto';

/**
 * `POST /tenants/:id/tools/:toolId/test-invoke` (BL-033). A tool call
 * failure (timeout/HTTP error) is a normal `200` response from this
 * endpoint with `ok: false` — matching `ToolExecutor`'s "a tool failure
 * never aborts the conversation" semantics, so a failed test isn't
 * conflated with a genuine API-level error.
 */
@Injectable()
export class TestInvokeToolUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly tools: ToolDefinitionRepositoryPort,
    @Inject(TOOL_INVOKER) private readonly invoker: ToolInvokerPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param toolId - Tool id
   * @param input - Optional sample arguments
   */
  async execute(
    actor: AdminActor,
    tenantId: string,
    toolId: string,
    input: TestInvokeToolRequest,
  ): Promise<TestInvokeToolResultDto> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const tool = await this.tools.findById(tenantId, toolId);
    if (!tool) {
      throw AppError.notFound('TOOL_NOT_FOUND');
    }
    const result = await this.invoker.invoke(tool, input.arguments ?? {});
    return toTestInvokeResultDto(result);
  }
}
