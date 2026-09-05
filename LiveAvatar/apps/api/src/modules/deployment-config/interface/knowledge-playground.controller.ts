import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  RunRetrievalPlaygroundRequestSchema,
  type RunRetrievalPlaygroundRequest,
  type RunRetrievalPlaygroundResponseDto,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { RunRetrievalPlaygroundUseCase } from '../application/run-retrieval-playground.use-case';

/**
 * Retrieval playground HTTP surface (Phase 12b, BL-045/047/048, R-R9/UC-R1).
 * Nested under `/tenants/:id` like every other admin route so the global
 * `TenantContextInterceptor` scopes correctly. A dedicated route, not part
 * of `KnowledgeSourcesController` (a different sub-resource) or the Phase 9
 * generic test-call harness (see the plan doc's "Decisions made this phase"
 * #8 for why a real retrieval run needs its own endpoint).
 */
@Controller('tenants/:id/knowledge/playground')
@UseGuards(AdminJwtGuard, RolesGuard)
export class KnowledgePlaygroundController {
  constructor(private readonly runPlayground: RunRetrievalPlaygroundUseCase) {}

  /** POST /api/tenants/:id/knowledge/playground/run */
  @Post('run')
  @HttpCode(200)
  async run(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Body(new TypeBoxValidationPipe(RunRetrievalPlaygroundRequestSchema, 'KNOWLEDGE_SOURCE_NOT_FOUND'))
    body: RunRetrievalPlaygroundRequest,
  ): Promise<RunRetrievalPlaygroundResponseDto> {
    return this.runPlayground.execute(actor, tenantId, body);
  }
}
