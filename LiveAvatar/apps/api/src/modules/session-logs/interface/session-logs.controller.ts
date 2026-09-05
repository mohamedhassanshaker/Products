import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ListSessionsQuerySchema, type ListSessionsQuery } from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { ListSessionsUseCase } from '../application/list-sessions.use-case';
import { GetSessionUseCase } from '../application/get-session.use-case';
import { GetTranscriptUseCase } from '../application/get-transcript.use-case';
import { GetHopsUseCase } from '../application/get-hops.use-case';

/** Admin Session Logs surface (LLD §5.7, Screen 5). */
@Controller('sessions')
@UseGuards(AdminJwtGuard, RolesGuard)
export class SessionLogsController {
  constructor(
    private readonly listSessions: ListSessionsUseCase,
    private readonly getSession: GetSessionUseCase,
    private readonly getTranscript: GetTranscriptUseCase,
    private readonly getHops: GetHopsUseCase,
  ) {}

  /** GET /api/sessions */
  @Get()
  list(
    @CurrentUser() actor: AdminActor,
    @Query(new TypeBoxValidationPipe(ListSessionsQuerySchema, 'SESS_QUERY_TOO_LONG')) query: ListSessionsQuery,
  ) {
    return this.listSessions.execute(actor, query);
  }

  /** GET /api/sessions/:id */
  @Get(':id')
  detail(@CurrentUser() actor: AdminActor, @Param('id') id: string) {
    return this.getSession.execute(actor, id);
  }

  /** GET /api/sessions/:id/transcript */
  @Get(':id/transcript')
  transcript(@CurrentUser() actor: AdminActor, @Param('id') id: string) {
    return this.getTranscript.execute(actor, id);
  }

  /** GET /api/sessions/:id/hops */
  @Get(':id/hops')
  hops(@CurrentUser() actor: AdminActor, @Param('id') id: string) {
    return this.getHops.execute(actor, id);
  }
}
