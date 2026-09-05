import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { SubAgentPersonaResponse } from '@liveavatar/contracts';
import { InternalTokenGuard } from '../../../common/auth/internal-token.guard';
import { GetSubAgentPersonaUseCase } from '../../deployment-config';

/**
 * Agent-facing `/internal/tenants/*` surface (Phase 15, BL-058) —
 * `X-Internal-Token`-guarded exactly like `SkillsInternalController`/
 * `HitlInternalController`, kept as its own controller so this one
 * agent-facing route stays grouped with its own concern rather than
 * bloating an existing controller.
 *
 * This is the lazy half of Sub-agent delegation: called only once a
 * `subagent`-type graph node's trigger actually fires (never eagerly),
 * mirroring `SkillsInternalController`'s own "lazy, only-once-triggered"
 * precedent exactly.
 */
@Controller('internal/tenants')
@UseGuards(InternalTokenGuard)
export class SubAgentInternalController {
  constructor(private readonly getSubAgentPersona: GetSubAgentPersonaUseCase) {}

  /** `GET /internal/tenants/{id}/subagent-persona`. */
  @Get(':id/subagent-persona')
  persona(@Param('id') tenantId: string): Promise<SubAgentPersonaResponse> {
    return this.getSubAgentPersona.execute(tenantId);
  }
}
