import type { SessionStatus } from './session';

/**
 * Internal lifecycle events (LLD §8.1/§8.3). The LiveKit webhook
 * (`participant_joined`/`room_finished`) and the public end-call fast path
 * both funnel into the same transition table via `ApplySessionEventUseCase`,
 * so there is exactly one writer of `Session.status` (LLD §8.1).
 */
export type SessionEvent = 'active' | 'degraded' | 'failed' | 'ended' | 'abandoned';

/** Statuses that can never transition again once reached (FR-TRANSPORT-4). */
const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set(['ended', 'failed', 'abandoned']);

/**
 * Explicit transition table (LLD §8.1). Returns the next status, or `null`
 * when the transition is illegal — illegal transitions are **no-ops**, not
 * errors: a duplicate end-call keeps `ended`, and a late `failed` after
 * `ended` is dropped (FR-TRANSPORT-4).
 * @param current - `Session.status` before the event
 * @param event - Incoming lifecycle event
 */
export function nextStatus(current: SessionStatus, event: SessionEvent): SessionStatus | null {
  if (TERMINAL_STATUSES.has(current)) {
    return null;
  }

  switch (event) {
    case 'active':
      // First user join. Re-applying while already active is a legal no-op
      // at the status level (joinedAt is only set once by the caller).
      return current === 'pending' || current === 'active' ? 'active' : null;
    case 'degraded':
      // Avatar/LLM impairment with the session kept alive (FR-LLM-2/FR-AVATAR-5).
      return current === 'pending' || current === 'active' || current === 'degraded' ? 'degraded' : null;
    case 'failed':
      return 'failed';
    case 'ended':
      return 'ended';
    case 'abandoned':
      // Only a `pending` (never-joined) session can be abandoned by the
      // 15-minute sweeper (FR-AUTH-4).
      return current === 'pending' ? 'abandoned' : null;
    default:
      return null;
  }
}

/** @param status - Candidate status */
export function isTerminalStatus(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
