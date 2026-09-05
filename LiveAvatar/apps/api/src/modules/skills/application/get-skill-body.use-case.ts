import { Inject, Injectable } from '@nestjs/common';
import type { SkillBodyResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../../tools';
import { SKILL_REPOSITORY, type SkillRepositoryPort } from '../domain/ports';

/**
 * `GET /internal/skills/{id}/versions/{version}/body` (Phase 13,
 * `ARCHITECTURE_NOTES.md` §5.3) — the lazy body fetch, agent-facing only.
 *
 * `version` here is always a concrete, already-resolved number — the
 * caller (the agent's Skill node executor) only ever knows the version
 * `GetRuntimeConfigUseCase` handed it at session-start (which already
 * resolved any `"latest"` reference), so there is no `"latest"` case to
 * handle here at all.
 *
 * Security note (defense-in-depth, not the primary boundary — that's
 * `InternalTokenGuard`): `tenantId` for the tool-definitions enrichment is
 * always read from the *resolved skill row itself*, never from a
 * caller-supplied parameter — this route takes no tenant id at all, so a
 * cross-tenant tool-definition leak is not structurally possible (mirrors
 * `GetRuntimeConfigUseCase`'s own trust boundary: the path id is the only
 * input, everything else is resolved server-side from it).
 */
@Injectable()
export class GetSkillBodyUseCase {
  constructor(
    @Inject(SKILL_REPOSITORY) private readonly skills: SkillRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly toolDefinitions: ToolDefinitionRepositoryPort,
  ) {}

  async execute(skillId: string, version: number): Promise<SkillBodyResponse> {
    const body = await this.skills.findPublishedVersionBody(skillId, version);
    if (!body) {
      throw AppError.notFound('SKILL_VERSION_NOT_FOUND');
    }

    const toolRecords = body.tools.length
      ? await this.toolDefinitions.listEnabledByApiRefs(body.tenantId, body.tools)
      : [];

    return {
      id: body.skillId,
      version: body.versionNumber,
      name: body.name,
      description: body.description,
      instructions: body.instructions,
      trigger_mode: body.triggerMode,
      tool_definitions: toolRecords.map((t) => ({
        api_ref: t.apiRef,
        name: t.name,
        description: t.description ?? undefined,
        method: t.method,
        url: t.url,
        credential_ref: t.credentialRef ?? undefined,
        args_schema: t.argsSchema,
      })),
      knowledge_filters: {
        source_refs: body.knowledgeFilters.sourceRefs,
        top_k: body.knowledgeFilters.topK,
        min_score: body.knowledgeFilters.minScore,
      },
      budget_ms: body.budgetMs,
    };
  }
}
