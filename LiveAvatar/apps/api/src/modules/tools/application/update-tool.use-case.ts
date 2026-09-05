import { Inject, Injectable } from '@nestjs/common';
import type { UpdateToolRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort, type UpdateToolDefinitionInput } from '../domain/ports';
import { assertToolName, assertToolUrl, assertCredentialPresence } from '../domain/validation';
import { toToolDto } from './tool-dto';

/** `PATCH /tenants/:id/tools/:toolId` (BL-033). `api_ref` is immutable. */
@Injectable()
export class UpdateToolUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly tools: ToolDefinitionRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path tenant id
   * @param toolId - Tool id
   * @param input - Partial fields
   * @param ifMatch - Required `If-Match` header value (ISO `updated_at`)
   */
  async execute(actor: AdminActor, tenantId: string, toolId: string, input: UpdateToolRequest, ifMatch: string) {
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

    const patch: UpdateToolDefinitionInput = {};
    if (input.name !== undefined) {
      patch.name = assertToolName(input.name);
    }
    if (input.description !== undefined) {
      patch.description = input.description;
    }
    if (input.method !== undefined) {
      patch.method = input.method;
    }
    if (input.url !== undefined) {
      patch.url = assertToolUrl(input.url);
    }
    if (input.credential_ref !== undefined) {
      patch.credentialRef = input.credential_ref;
    }
    if (input.requires_credential !== undefined) {
      patch.requiresCredential = input.requires_credential;
    }
    if (input.args_schema !== undefined) {
      patch.argsSchema = input.args_schema;
    }
    if (input.enabled !== undefined) {
      patch.enabled = input.enabled;
    }
    if (input.consequential !== undefined) {
      patch.consequential = input.consequential;
    }
    if (input.autonomous_use_ack_text !== undefined) {
      patch.autonomousUseAckText = input.autonomous_use_ack_text;
    }
    if (input.lane !== undefined) {
      patch.lane = input.lane;
    }
    if (input.per_session_cap !== undefined) {
      patch.perSessionCap = input.per_session_cap;
    }
    if (input.per_turn_cap !== undefined) {
      patch.perTurnCap = input.per_turn_cap;
    }
    if (input.timeout_ms !== undefined) {
      patch.timeoutMs = input.timeout_ms;
    }

    const resultingRequiresCredential = patch.requiresCredential ?? existing.requiresCredential;
    const resultingCredentialRef = patch.credentialRef !== undefined ? patch.credentialRef : existing.credentialRef;
    assertCredentialPresence(resultingRequiresCredential, resultingCredentialRef);

    const ifMatchDate = new Date(ifMatch);
    if (Number.isNaN(ifMatchDate.getTime())) {
      throw AppError.conflict('CONFIG_CONFLICT');
    }

    const result = await this.tools.update(tenantId, toolId, patch, ifMatchDate);
    if (result === 'missing') {
      throw AppError.notFound('TOOL_NOT_FOUND');
    }
    if (result === 'conflict') {
      throw AppError.conflict('CONFIG_CONFLICT');
    }
    return toToolDto(result);
  }
}
