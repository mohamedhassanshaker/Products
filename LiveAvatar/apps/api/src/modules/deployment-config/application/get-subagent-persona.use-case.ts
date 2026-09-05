import { Inject, Injectable } from '@nestjs/common';
import type { SubAgentPersonaResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../../tools';
import { DEPLOYMENT_CONFIG_REPOSITORY, type DeploymentConfigRepositoryPort } from '../domain/ports';

/**
 * `GET /internal/tenants/{id}/subagent-persona` (Phase 15, BL-058) — the
 * agent-facing lazy fetch a `subagent`-type node's executor calls once it
 * actually fires (mirrors `GetSkillBodyUseCase`'s "lazy, only-once-triggered"
 * shape). Resolves only a **published** target config's system prompt +
 * enabled tool definitions — v1 delegation is one bounded LLM turn, never a
 * nested graph invocation (see `SubAgentNodeSchema`'s doc comment), so
 * nothing more than a single turn needs travels over this endpoint.
 */
@Injectable()
export class GetSubAgentPersonaUseCase {
  constructor(
    @Inject(DEPLOYMENT_CONFIG_REPOSITORY) private readonly configs: DeploymentConfigRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly toolDefinitions: ToolDefinitionRepositoryPort,
  ) {}

  async execute(targetTenantId: string): Promise<SubAgentPersonaResponse> {
    const config = await this.configs.findByTenantId(targetTenantId);
    if (!config || config.status !== 'published') {
      throw AppError.notFound('CONFIG_SUBAGENT_TENANT_UNKNOWN');
    }

    const structured = config.structured;
    const enabledApiRefs = (structured.agent?.tools ?? []).filter((t) => t.enabled !== false).map((t) => t.api_ref);
    const toolDefinitionRecords = enabledApiRefs.length
      ? await this.toolDefinitions.listEnabledByApiRefs(targetTenantId, enabledApiRefs)
      : [];

    return {
      tenant_id: targetTenantId,
      system_prompt: structured.agent?.system_prompt ?? '',
      tool_definitions: toolDefinitionRecords.map((record) => ({
        api_ref: record.apiRef,
        name: record.name,
        description: record.description ?? undefined,
        method: record.method,
        url: record.url,
        credential_ref: record.credentialRef ?? undefined,
        args_schema: record.argsSchema,
      })),
    };
  }
}
