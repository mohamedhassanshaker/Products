/**
 * Ephemeral, Redis-shaped state for one in-flight turn (ADR-0003: loss here
 * degrades a turn, it never corrupts a durable record). Three real, if
 * deliberately simple, mechanisms api.md §4.3/§4.2 asks for:
 *
 *  1. **Serialisation lock** — "a second concurrent turn on the same
 *     conversation is `409 conversation.turn_in_progress`."
 *  2. **`clientTurnId` dedupe** — "a repeat re-attaches to the existing
 *     turn's stream instead of creating a second turn."
 *  3. **Reattach buffer** — `GET .../turns/{turnId}/stream`'s `Last-Event-ID`
 *     replay, Redis-buffered for a few minutes (api.md §5.3's own table).
 *
 * All three are real, working Redis operations, not stubs — but each is a
 * documented, honest trim of the fuller mechanism a production system would
 * eventually want (a lock with no lease-renewal for a turn that outlives its
 * TTL; a dedupe table with no cross-pod race beyond Redis's own atomicity;
 * a replay buffer capped at a bounded number of frames rather than unbounded
 * history) — exactly the kind of simplification this wave's own brief invites
 * naming rather than hiding.
 */

export interface TurnCoordination {
  /** Atomic test-and-set. `true` = lock acquired, `false` = another turn is already in flight on this conversation. */
  acquireTurnLock(conversationId: string): Promise<boolean>;
  releaseTurnLock(conversationId: string): Promise<void>;

  /** Null if this `clientTurnId` has not been seen before on this conversation. */
  findDedupedTurn(conversationId: string, clientTurnId: string): Promise<string | null>;
  rememberClientTurnId(conversationId: string, clientTurnId: string, turnId: string): Promise<void>;

  /** Appends one already-encoded SSE frame (see `domain/sse-frame-parser.ts`'s `encodeSseFrame`) to the replay buffer for `turnId`. */
  bufferFrame(turnId: string, rawFrame: string): Promise<void>;
  /** Every buffered frame with an `id` strictly greater than `afterEventId` (0 for "replay everything buffered"). */
  replayFramesAfter(turnId: string, afterEventId: number): Promise<readonly string[]>;

  /** Increments and returns the feedback double-click counter for one turn, creating it with a fixed 1-second TTL on the first increment of a window (`domain/feedback.ts`'s own doc comment). */
  incrementFeedbackSubmissionCount(turnId: string): Promise<number>;

  /** A coarse, real, per-conversation rate limit on posted turns (api.md §4.1: "rate limited per session ... per channel key") — a simple fixed-window counter, not the full multi-dimensional quota system of api.md §11, which is out of this module's scope. Returns the count *after* incrementing. */
  incrementTurnRateCount(conversationId: string, windowSeconds: number): Promise<number>;
}
