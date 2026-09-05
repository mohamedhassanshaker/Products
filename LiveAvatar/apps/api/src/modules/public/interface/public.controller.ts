import { Body, Controller, Get, HttpCode, Headers, Param, Post } from '@nestjs/common';
import {
  PublicFeedbackRequestSchema,
  PublicSessionCreateRequestSchema,
  PublicSessionEndRequestSchema,
  type PublicFeedbackRequest,
  type PublicSessionCreateRequest,
  type PublicSessionEndRequest,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import {
  GetPreflightUseCase,
  IssueConversationTokenUseCase,
  EndSessionUseCase,
  GetSessionSummaryUseCase,
  SubmitFeedbackUseCase,
} from '../../sessions';

/**
 * Unauthenticated end-user surface (FR-CALL-1, FR-AUTH-4, FR-TRANSPORT-4).
 * No `AdminJwtGuard` anywhere on this controller by design — end users have
 * no accounts (LLD §3.1 "public — interface-only module; composes other
 * modules' application ports"). This file holds no business logic of its
 * own; every route is a thin adapter onto a `sessions` module use case.
 */
@Controller('public')
export class PublicController {
  constructor(
    private readonly getPreflight: GetPreflightUseCase,
    private readonly issueToken: IssueConversationTokenUseCase,
    private readonly endSession: EndSessionUseCase,
    private readonly getSummary: GetSessionSummaryUseCase,
    private readonly submitFeedback: SubmitFeedbackUseCase,
  ) {}

  /** GET /api/public/deployments/:slug/preflight */
  @Get('deployments/:slug/preflight')
  preflight(@Param('slug') slug: string) {
    return this.getPreflight.execute(slug);
  }

  /** POST /api/public/sessions — the only legal way a conversation token is minted. */
  @Post('sessions')
  createSession(
    @Body(new TypeBoxValidationPipe(PublicSessionCreateRequestSchema, 'DISPLAY_NAME_INVALID'))
    body: PublicSessionCreateRequest,
  ) {
    return this.issueToken.execute(body);
  }

  /** POST /api/public/sessions/:id/end */
  @Post('sessions/:id/end')
  end(
    @Param('id') sessionId: string,
    @Body(new TypeBoxValidationPipe(PublicSessionEndRequestSchema, 'AUTH_TOKEN_REQUIRED'))
    body: PublicSessionEndRequest,
  ) {
    return this.endSession.execute(sessionId, body.token);
  }

  /** GET /api/public/sessions/:id/summary (FR-CALL-4, Screen 11). */
  @Get('sessions/:id/summary')
  summary(@Param('id') sessionId: string, @Headers('x-summary-token') token?: string) {
    return this.getSummary.execute(sessionId, token);
  }

  /** POST /api/public/sessions/:id/feedback (FR-CALL-4). The only end-user write path. */
  @Post('sessions/:id/feedback')
  @HttpCode(201)
  async feedback(
    @Param('id') sessionId: string,
    @Headers('x-summary-token') token: string | undefined,
    @Body(new TypeBoxValidationPipe(PublicFeedbackRequestSchema, 'FEEDBACK_INVALID')) body: PublicFeedbackRequest,
  ) {
    await this.submitFeedback.execute(sessionId, token, body);
  }
}
