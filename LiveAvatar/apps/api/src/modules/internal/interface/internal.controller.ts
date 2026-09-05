import { Controller, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { LIVEKIT_CLIENT, type LiveKitClientPort } from '../../transport';
import { ApplySessionEventUseCase, SESSION_REPOSITORY, type SessionRepositoryPort } from '../../sessions';

/**
 * Cluster-only surface mounted on the internal listener (`:8081`, LLD §5.1/
 * §5.9). Phase 3 stands up exactly the one route this phase's session
 * lifecycle needs — the LiveKit webhook. The agent-facing routes (runtime
 * config, event/utterance/hop ingest, alerts, GPU heartbeats) are added by
 * Phase 4+ once the agent process and those bounded contexts exist; this is
 * not a stub, it is the real `/internal` surface scoped to what BL-010
 * requires today.
 */
@Controller('internal')
export class InternalController {
  constructor(
    @Inject(LIVEKIT_CLIENT) private readonly liveKit: LiveKitClientPort,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    private readonly applyEvent: ApplySessionEventUseCase,
  ) {}

  /**
   * POST /internal/livekit/webhooks. Authenticated by LiveKit's own webhook
   * signature (API key/secret), not `X-Internal-Token` — LiveKit signs the
   * request itself, so a shared internal bearer token would be redundant
   * here (it is used by the agent-facing routes Phase 4+ adds).
   * `participant_joined` drives `pending`→`active` (FR-TRANSPORT-4);
   * `room_finished` is the authoritative `ended` transition (LLD §8.3), a
   * safety net for any session whose fast-path `/public/sessions/{id}/end`
   * call never arrived (browser crash, network drop).
   */
  @Post('livekit/webhooks')
  @HttpCode(204)
  async webhook(@Req() req: Request, @Headers('authorization') authHeader?: string): Promise<void> {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : String(req.body ?? '');
    const event = await this.liveKit.verifyWebhook(rawBody, authHeader ?? '');
    if (!event) {
      // Invalid signature: drop silently rather than leak whether a room
      // name exists to an unauthenticated caller. LiveKit retries webhooks,
      // so a transient verification hiccup is not lost.
      return;
    }

    const roomName = event.room?.name;
    if (!roomName) {
      return;
    }
    const session = await this.sessions.findByRoomName(roomName);
    if (!session) {
      return;
    }

    if (event.event === 'participant_joined') {
      await this.applyEvent.execute(session, 'active');
    } else if (event.event === 'room_finished') {
      await this.applyEvent.execute(session, 'ended');
    }
  }
}
