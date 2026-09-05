import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  AlertRequestSchema,
  GpuHeartbeatRequestSchema,
  HopBatchRequestSchema,
  SessionEventRequestSchema,
  SummaryRequestSchema,
  UtteranceBatchRequestSchema,
  type AgentRuntimeConfigDto,
  type AlertRequest,
  type GpuHeartbeatRequest,
  type HopBatchRequest,
  type SessionEventRequest,
  type SummaryRequest,
  type UtteranceBatchRequest,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { InternalTokenGuard } from '../../../common/auth/internal-token.guard';
import { AppError } from '../../../common/errors/app-error';
import {
  ApplySessionEventUseCase,
  GetRuntimeConfigUseCase,
  RecordAlertUseCase,
  RecordHopsUseCase,
  RecordUtterancesUseCase,
  SESSION_REPOSITORY,
  SetSessionSummaryUseCase,
  type SessionEvent,
  type SessionRepositoryPort,
} from '../../sessions';
import { RecordGpuHeartbeatUseCase } from '../../gpu';

/**
 * Agent-facing `/internal` surface (LLD §5.9, Phase 4/BL-013..017). Every
 * route here is guarded by `InternalTokenGuard` (`X-Internal-Token`) —
 * distinct from `InternalController`'s LiveKit webhook route, which
 * authenticates via LiveKit's own HMAC signature instead (no shared bearer
 * token exists to check there). This is the deferred general
 * `X-Internal-Token` rule Phase 3's decision log flagged as "no route
 * needs it yet" — this phase's routes are the ones that do.
 */
@Controller('internal')
@UseGuards(InternalTokenGuard)
export class AgentInternalController {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    private readonly getRuntimeConfig: GetRuntimeConfigUseCase,
    private readonly applyEvent: ApplySessionEventUseCase,
    private readonly recordUtterances: RecordUtterancesUseCase,
    private readonly recordHops: RecordHopsUseCase,
    private readonly setSummary: SetSessionSummaryUseCase,
    private readonly recordAlert: RecordAlertUseCase,
    private readonly recordGpuHeartbeat: RecordGpuHeartbeatUseCase,
  ) {}

  /** `GET /internal/sessions/{id}/runtime-config` (LLD §6.3). */
  @Get('sessions/:id/runtime-config')
  async runtimeConfig(@Param('id') id: string): Promise<AgentRuntimeConfigDto> {
    return this.getRuntimeConfig.execute(id);
  }

  /**
   * `POST /internal/sessions/{id}/events` (LLD §8.1's transition table).
   * `joined` is the agent-side equivalent of the LiveKit webhook's
   * `participant_joined` and maps to the same `active` domain event —
   * there is exactly one writer of `Session.status`
   * (`ApplySessionEventUseCase`), regardless of which caller reached it.
   */
  @Post('sessions/:id/events')
  @HttpCode(204)
  async event(
    @Param('id') id: string,
    @Body(new TypeBoxValidationPipe(SessionEventRequestSchema, 'INTERNAL_PAYLOAD_INVALID')) body: SessionEventRequest,
  ): Promise<void> {
    const session = await this.sessions.findById(id);
    if (!session) {
      throw AppError.notFound('SESSION_NOT_FOUND');
    }
    const domainEvent: SessionEvent = body.type === 'joined' ? 'active' : body.type;
    await this.applyEvent.execute(session, domainEvent, body.error_code);
  }

  /** `POST /internal/sessions/{id}/utterances` (FR-CALL-3, FR-SESS-1). */
  @Post('sessions/:id/utterances')
  @HttpCode(204)
  async utterances(
    @Param('id') id: string,
    @Body(new TypeBoxValidationPipe(UtteranceBatchRequestSchema, 'INTERNAL_PAYLOAD_INVALID')) body: UtteranceBatchRequest,
  ): Promise<void> {
    await this.recordUtterances.execute(id, body);
  }

  /** `POST /internal/sessions/{id}/hops` (NFR-1). */
  @Post('sessions/:id/hops')
  @HttpCode(204)
  async hops(
    @Param('id') id: string,
    @Body(new TypeBoxValidationPipe(HopBatchRequestSchema, 'INTERNAL_PAYLOAD_INVALID')) body: HopBatchRequest,
  ): Promise<void> {
    await this.recordHops.execute(id, body);
  }

  /** `POST /internal/sessions/{id}/summary` (FR-CALL-4, HLD §7.3). */
  @Post('sessions/:id/summary')
  @HttpCode(204)
  async summary(
    @Param('id') id: string,
    @Body(new TypeBoxValidationPipe(SummaryRequestSchema, 'INTERNAL_PAYLOAD_INVALID')) body: SummaryRequest,
  ): Promise<void> {
    await this.setSummary.execute(id, body);
  }

  /** `POST /internal/alerts` (FR-ALERT-1..3). */
  @Post('alerts')
  @HttpCode(204)
  async alert(
    @Body(new TypeBoxValidationPipe(AlertRequestSchema, 'INTERNAL_PAYLOAD_INVALID')) body: AlertRequest,
  ): Promise<void> {
    await this.recordAlert.execute(body);
  }

  /** `POST /internal/gpu-heartbeats` (FR-GPU-3). */
  @Post('gpu-heartbeats')
  @HttpCode(204)
  async gpuHeartbeat(
    @Body(new TypeBoxValidationPipe(GpuHeartbeatRequestSchema, 'GPU_HEARTBEAT_INVALID')) body: GpuHeartbeatRequest,
  ): Promise<void> {
    await this.recordGpuHeartbeat.execute(body);
  }
}
