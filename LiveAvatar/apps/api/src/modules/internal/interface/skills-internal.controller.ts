import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { SkillBodyResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { InternalTokenGuard } from '../../../common/auth/internal-token.guard';
import { GetSkillBodyUseCase } from '../../skills';

/**
 * Agent-facing `/internal/skills/*` surface (Phase 13, BL-049/050/051;
 * `ARCHITECTURE_NOTES.md` §5.3) — `X-Internal-Token`-guarded exactly like
 * `AgentInternalController`/`KnowledgeInternalController`, kept as its own
 * controller so the `skills` bounded context's one agent-facing route
 * stays grouped with its own module, mirroring the existing
 * split-by-concern precedent.
 *
 * This is the **lazy** half of R-S1's progressive disclosure: called only
 * once a `skill`-type graph node's trigger actually fires (never eagerly
 * for every attached skill), and cached in-process by the calling Python
 * session for the rest of that session once fetched — see the plan doc's
 * Phase 13 section.
 */
@Controller('internal/skills')
@UseGuards(InternalTokenGuard)
export class SkillsInternalController {
  constructor(private readonly getSkillBody: GetSkillBodyUseCase) {}

  /**
   * `GET /internal/skills/{id}/versions/{version}/body`. `version` is
   * parsed manually (not `ParseIntPipe`) to keep this route's error shape
   * consistent with the rest of this codebase's `AppError`/
   * `AppExceptionFilter` envelope — mirrors
   * `DeploymentConfigController.rollbackConfigVersion`'s own
   * `Number(versionNumber)` precedent for a numeric path segment.
   */
  @Get(':id/versions/:version/body')
  async body(@Param('id') skillId: string, @Param('version') version: string): Promise<SkillBodyResponse> {
    const versionNumber = Number(version);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw AppError.notFound('SKILL_VERSION_NOT_FOUND');
    }
    return this.getSkillBody.execute(skillId, versionNumber);
  }
}
