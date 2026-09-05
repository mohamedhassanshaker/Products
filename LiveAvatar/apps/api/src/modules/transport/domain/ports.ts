/**
 * LiveKit-facing capability port (FR-TRANSPORT-1/3, LLD §8.3). This is the
 * only surface any other module may depend on for real-time transport — the
 * concrete `livekit-server-sdk` client lives behind
 * `infrastructure/livekit-client.adapter.ts`, the single file anywhere in
 * `apps/api` allowed to import that package (LLD §3.4 boundary grep).
 */

/** Grants attached to a minted room-scoped JWT. */
export interface RoomTokenGrant {
  roomName: string;
  identity: string;
  canPublish: boolean;
  canSubscribe: boolean;
  /** Token lifetime in seconds. */
  ttlSeconds: number;
}

/** Outcome of a room-creation attempt (FR-TRANSPORT-1). */
export type CreateRoomOutcome =
  | { kind: 'created' }
  | { kind: 'unavailable' }
  | { kind: 'capacity' };

/** A verified room token's claims, or `null` when the signature/claims are invalid. */
export interface VerifiedRoomToken {
  identity: string;
  roomName: string;
}

export interface LiveKitClientPort {
  /**
   * Server-side reachability probe (FR-CALL-1 preflight). Does not require a
   * room to exist.
   */
  checkReachable(): Promise<boolean>;

  /**
   * Creates a LiveKit room with the metadata + capacity/empty-timeout rules
   * from LLD §8.3 step 5.
   */
  createRoom(input: {
    roomName: string;
    metadata: Record<string, unknown>;
  }): Promise<CreateRoomOutcome>;

  /** Best-effort room deletion (sweeper / end-call fast path). Never throws. */
  deleteRoom(roomName: string): Promise<void>;

  /** Mints a signed room-scoped JWT for the given grant. */
  mintToken(grant: RoomTokenGrant): Promise<string>;

  /**
   * Verifies a browser-presented token's signature and claims, returning its
   * identity/room or `null` if invalid/expired/wrong-audience
   * (FR-AUTH-5 / the `/public/sessions/{id}/end` auth check).
   */
  verifyToken(token: string): Promise<VerifiedRoomToken | null>;

  /**
   * Explicit agent dispatch (LLD §8.3 step 7). Automatic dispatch is
   * disabled platform-wide; this call queues a dispatch request that a
   * running `avatar-agent` worker would pick up. No worker exists before
   * Phase 4 — the call is fire-and-forget and must never fail token issuance
   * (agent may be a stub, per the Phase 3 backlog exit condition).
   */
  createAgentDispatch(input: {
    roomName: string;
    agentName: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;

  /** Verifies a LiveKit webhook envelope's signature and decodes its event. */
  verifyWebhook(body: string, authHeader: string): Promise<LiveKitWebhookEvent | null>;
}

/** Minimal shape of the LiveKit webhook events this phase acts on. */
export interface LiveKitWebhookEvent {
  event: string;
  room?: { name?: string };
  participant?: { identity?: string };
}

export const LIVEKIT_CLIENT = Symbol('LIVEKIT_CLIENT');
