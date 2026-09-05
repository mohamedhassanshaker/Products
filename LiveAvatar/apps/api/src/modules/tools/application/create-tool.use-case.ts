import { Inject, Injectable } from '@nestjs/common';
import type { CreateToolRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../domain/ports';
import { assertToolName, assertToolUrl, assertCredentialPresence, deriveApiRef } from '../domain/validation';
import { toToolDto } from './tool-dto';

/** `POST /tenants/:id/tools` (BL-033). */
@Injectable()
export class CreateToolUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly tools: ToolDefinitionRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param input - Create-tool request body
   */
  async execute(actor: AdminActor, tenantId: string, input: CreateToolRequest) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }

    const name = assertToolName(input.name);
    const url = assertToolUrl(input.url);
    const credentialRef = input.credential_ref ?? null;
    const requiresCredential = input.requires_credential ?? false;
    assertCredentialPresence(requiresCredential, credentialRef);

    const apiRef = (input.api_ref ?? deriveApiRef(name)).trim();
    if (apiRef.length < 1 || apiRef.length > 64) {
      throw AppError.badRequest('TOOL_NAME_REQUIRED');
    }
    const existing = await this.tools.findByApiRef(tenantId, apiRef);
    if (existing) {
      throw AppError.conflict('TOOL_API_REF_EXISTS');
    }

    const created = await this.tools.create({
      tenantId,
      apiRef,
      name,
      description: input.description ?? null,
      method: input.method,
      url,
      credentialRef,
      requiresCredential,
      argsSchema: input.args_schema ?? {},
      enabled: input.enabled ?? true,
      consequential: input.consequential ?? false,
      autonomousUseAckText: input.autonomous_use_ack_text ?? null,
      lane: input.lane ?? 'foreground',
      perSessionCap: input.per_session_cap ?? null,
      perTurnCap: input.per_turn_cap ?? null,
      timeoutMs: input.timeout_ms ?? 10000,
    });
    return toToolDto(created);
  }
}
