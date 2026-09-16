/** `AgentPresence` — one row per staff user, created lazily on first read (a live agent
 *  who has never toggled status yet is `Offline` with default capacity, never a missing
 *  row the UI has to special-case). */

import type { PresenceStatus } from "../domain/presence.js";

export interface AgentPresenceRow {
  readonly staffUserId: string;
  readonly status: PresenceStatus;
  readonly statusChangedAt: Date;
  readonly activeTicketCount: number;
  readonly maxConcurrentTickets: number;
  readonly lastHeartbeatAt: Date;
}

const DEFAULT_MAX_CONCURRENT_TICKETS = 5;

export { DEFAULT_MAX_CONCURRENT_TICKETS };

export interface AgentPresenceRepository {
  /** Creates a default (`Offline`, 0 active, default capacity) row on first read —
   *  never returns null, matching `HandoverConfigRepository`'s own singleton-with-
   *  fallback convention elsewhere in this codebase. */
  getOrCreate(staffUserId: string, now: Date): Promise<AgentPresenceRow>;

  /** Sets `status` (+`statusChangedAt`) and `lastHeartbeatAt`. Never touches
   *  `activeTicketCount` — draining held tickets on the way to `Offline` is
   *  `SetAgentPresence`'s own multi-step job, not this single method's. */
  setStatus(staffUserId: string, status: PresenceStatus, now: Date): Promise<void>;

  /** +1/-1 on `activeTicketCount`, clamped by the caller's own capacity check
   *  before calling (`CK_AgentPresence_capacity`) — this method trusts the caller. */
  adjustActiveCount(staffUserId: string, delta: 1 | -1): Promise<void>;

  /** The full roster, most-recently-changed first — B8's own "who else is online"
   *  context, and what a supervisor would want listed first. */
  list(): Promise<readonly AgentPresenceRow[]>;
}
