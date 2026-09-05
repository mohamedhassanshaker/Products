import { Injectable, Logger } from '@nestjs/common';
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
  TokenVerifier,
  WebhookReceiver,
} from 'livekit-server-sdk';
import type {
  CreateRoomOutcome,
  LiveKitClientPort,
  LiveKitWebhookEvent,
  RoomTokenGrant,
  VerifiedRoomToken,
} from '../domain/ports';
import { ROOM_EMPTY_TIMEOUT_SECONDS, ROOM_MAX_PARTICIPANTS } from '../domain/room';

/**
 * The ONLY file in `apps/api` allowed to import `livekit-server-sdk` (LLD
 * §3.4 boundary grep, enforced by the `import/no-restricted-paths` zone
 * added in this phase). Wraps room management, token minting/verification,
 * explicit agent dispatch, and webhook signature verification behind
 * `LiveKitClientPort` so every use case depends on the port, never the SDK.
 */
@Injectable()
export class LiveKitClientAdapter implements LiveKitClientPort {
  private readonly logger = new Logger(LiveKitClientAdapter.name);
  private readonly rooms: RoomServiceClient;
  private readonly dispatch: AgentDispatchClient;
  private readonly tokenVerifier: TokenVerifier;
  private readonly webhookReceiver: WebhookReceiver;

  constructor() {
    const url = requireEnv('LIVEKIT_URL');
    const apiKey = requireEnv('LIVEKIT_API_KEY');
    const apiSecret = requireEnv('LIVEKIT_API_SECRET');

    this.rooms = new RoomServiceClient(url, apiKey, apiSecret);
    this.dispatch = new AgentDispatchClient(url, apiKey, apiSecret);
    this.tokenVerifier = new TokenVerifier(apiKey, apiSecret);
    this.webhookReceiver = new WebhookReceiver(apiKey, apiSecret);
  }

  /** @inheritdoc */
  async checkReachable(): Promise<boolean> {
    try {
      await this.rooms.listRooms();
      return true;
    } catch (err) {
      this.logger.warn({ err }, 'LiveKit reachability probe failed');
      return false;
    }
  }

  /** @inheritdoc */
  async createRoom(input: { roomName: string; metadata: Record<string, unknown> }): Promise<CreateRoomOutcome> {
    try {
      await this.rooms.createRoom({
        name: input.roomName,
        emptyTimeout: ROOM_EMPTY_TIMEOUT_SECONDS,
        maxParticipants: ROOM_MAX_PARTICIPANTS,
        metadata: JSON.stringify(input.metadata),
      });
      return { kind: 'created' };
    } catch (err) {
      // LiveKit's REST error surface does not reliably distinguish "server
      // unreachable" from "rejected/at capacity" beyond message text, so this
      // conservatively treats any thrown connection error as unavailable and
      // any explicit HTTP 4xx-shaped rejection as a capacity refusal.
      const status = extractHttpStatus(err);
      if (status !== null && status >= 400 && status < 500) {
        return { kind: 'capacity' };
      }
      this.logger.error({ err }, 'LiveKit createRoom failed');
      return { kind: 'unavailable' };
    }
  }

  /** @inheritdoc */
  async deleteRoom(roomName: string): Promise<void> {
    try {
      await this.rooms.deleteRoom(roomName);
    } catch (err) {
      // Best-effort: a missing/already-gone room must never fail the caller
      // (sweeper, end-call fast path, webhook handler are all idempotent).
      this.logger.warn({ err, roomName }, 'LiveKit deleteRoom failed (ignored)');
    }
  }

  /** @inheritdoc */
  async mintToken(grant: RoomTokenGrant): Promise<string> {
    const at = new AccessToken(requireEnv('LIVEKIT_API_KEY'), requireEnv('LIVEKIT_API_SECRET'), {
      identity: grant.identity,
      ttl: grant.ttlSeconds,
    });
    at.addGrant({
      roomJoin: true,
      room: grant.roomName,
      canPublish: grant.canPublish,
      canSubscribe: grant.canSubscribe,
    });
    // `AccessToken.toJwt()` is async in SDK v2.
    return at.toJwt();
  }

  /** @inheritdoc */
  async verifyToken(token: string): Promise<VerifiedRoomToken | null> {
    try {
      const claims = await this.tokenVerifier.verify(token);
      const room = claims.video?.room;
      if (!claims.sub || !room) {
        return null;
      }
      return { identity: claims.sub, roomName: room };
    } catch (err) {
      this.logger.warn({ err }, 'LiveKit token verification failed');
      return null;
    }
  }

  /** @inheritdoc */
  async createAgentDispatch(input: {
    roomName: string;
    agentName: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.dispatch.createDispatch(input.roomName, input.agentName, {
        metadata: JSON.stringify(input.metadata),
      });
    } catch (err) {
      // Fire-and-forget by design (LLD §8.3 step 7 note + Phase 3 backlog:
      // "agent may be a stub"). No worker is registered before Phase 4, so a
      // dispatch failure here must never fail token issuance.
      this.logger.warn({ err, roomName: input.roomName }, 'Agent dispatch failed (non-fatal)');
    }
  }

  /** @inheritdoc */
  async verifyWebhook(body: string, authHeader: string): Promise<LiveKitWebhookEvent | null> {
    try {
      // `WebhookReceiver.receive()` is async in livekit-server-sdk@2.17.0 —
      // it MUST be awaited so a rejected promise (invalid/forged signature)
      // is actually caught here rather than becoming an unhandled rejection
      // that can crash the internal (:8081) process (QA D-1, Phase 3 retry).
      const event = await this.webhookReceiver.receive(body, authHeader);
      return event as unknown as LiveKitWebhookEvent;
    } catch (err) {
      this.logger.warn({ err }, 'LiveKit webhook signature verification failed');
      return null;
    }
  }
}

/**
 * Extracts an HTTP-like status code from an SDK error, if present.
 * @param err - Thrown value from the SDK client
 */
function extractHttpStatus(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === 'number' ? status : null;
  }
  return null;
}

/**
 * Reads a required LiveKit env var, failing fast with a clear message rather
 * than constructing an SDK client against `undefined`.
 * @param name - Env var name
 */
function requireEnv(name: 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
