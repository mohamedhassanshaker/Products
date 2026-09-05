/**
 * Room naming + timing constants shared by every LiveKit-facing use case
 * (FR-TRANSPORT-1, LLD §8.3).
 */

/** LiveKit room `empty_timeout` — auto-delete 15 minutes after the last leave. */
export const ROOM_EMPTY_TIMEOUT_SECONDS = 900;

/** LiveKit room `max_participants` — browser user + agent + one spare slot. */
export const ROOM_MAX_PARTICIPANTS = 3;

/** Default/maximum session duration, also the token TTL ceiling (FR-AUTH-4). */
export const DEFAULT_MAX_DURATION_SECONDS = 7200;

/** Explicit-dispatch agent name (LLD §8.3 step 7), overridable via `AGENT_NAME`. */
export const DEFAULT_AGENT_NAME = 'avatar-agent';

/**
 * Builds the LiveKit room name for a session: `{room_namespace}_{session_id}`
 * (FR-TRANSPORT-1). `room_namespace` is the tenant's slug (Phase 1).
 * @param roomNamespace - Tenant's `room_namespace` column
 * @param sessionId - Session UUID
 */
export function buildRoomName(roomNamespace: string, sessionId: string): string {
  return `${roomNamespace}_${sessionId}`;
}

/**
 * Room-scoped participant identity for the end user (FR-AUTH-4).
 * @param sessionId - Session UUID
 */
export function userIdentity(sessionId: string): string {
  return `user_${sessionId}`;
}

/**
 * Room-scoped participant identity for the agent process (FR-AUTH-4,
 * publish-only, never sent to the browser).
 * @param sessionId - Session UUID
 */
export function agentIdentity(sessionId: string): string {
  return `agent_${sessionId}`;
}

/**
 * Token TTL is the lesser of 2 hours and the session's configured max
 * duration (FR-AUTH-4).
 * @param maxDurationSeconds - `Session.maxDurationSeconds`
 */
export function tokenTtlSeconds(maxDurationSeconds: number): number {
  return Math.min(DEFAULT_MAX_DURATION_SECONDS, maxDurationSeconds);
}
