/** The real `TurnCoordination` — see the port's own doc comment for what each mechanism does and does not guarantee. `getTenantCache()` throughout, so every key lives inside the calling tenant's own Redis prefix (ADR-0002 rule 3) — never a raw client here. */

import { getTenantCache } from "../../../../platform/adapters/outbound/cache/tenant-cache.js";
import type { TurnCoordination } from "../../../ports/turn-coordination.js";

const LOCK_TTL_SECONDS = 120; // longer than the AI-hop timeout (ai-client.ts's own 120s default) so a slow-but-alive turn is never pre-empted by its own lock's expiry.
const DEDUPE_TTL_SECONDS = 15 * 60; // long enough to cover a realistic client retry window, short enough not to accumulate forever.
const REPLAY_BUFFER_TTL_SECONDS = 5 * 60; // api.md §5.3: "Buffered events are kept in Redis for 5 minutes."
const REPLAY_BUFFER_MAX_FRAMES = 500; // a bounded cap — see the port's own doc comment on this being a documented trim, not unbounded history.
const FEEDBACK_WINDOW_TTL_SECONDS = 1; // domain/feedback.ts's fixed-window guard.

function lockKey(conversationId: string): string {
  return `turn-lock:${conversationId}`;
}
function dedupeKey(conversationId: string, clientTurnId: string): string {
  return `turn-dedupe:${conversationId}:${clientTurnId}`;
}
function replayKey(turnId: string): string {
  return `turn-replay:${turnId}`;
}
function feedbackWindowKey(turnId: string): string {
  return `feedback-window:${turnId}`;
}
function rateKey(conversationId: string): string {
  return `turn-rate:${conversationId}`;
}

export class RedisTurnCoordination implements TurnCoordination {
  async acquireTurnLock(conversationId: string): Promise<boolean> {
    return getTenantCache("turn lock acquire").setIfAbsent(
      lockKey(conversationId),
      "1",
      LOCK_TTL_SECONDS,
    );
  }

  async releaseTurnLock(conversationId: string): Promise<void> {
    await getTenantCache("turn lock release").del(lockKey(conversationId));
  }

  async findDedupedTurn(conversationId: string, clientTurnId: string): Promise<string | null> {
    return getTenantCache("turn dedupe read").get(dedupeKey(conversationId, clientTurnId));
  }

  async rememberClientTurnId(
    conversationId: string,
    clientTurnId: string,
    turnId: string,
  ): Promise<void> {
    await getTenantCache("turn dedupe write").set(
      dedupeKey(conversationId, clientTurnId),
      turnId,
      DEDUPE_TTL_SECONDS,
    );
  }

  async bufferFrame(turnId: string, rawFrame: string): Promise<void> {
    const cache = getTenantCache("turn replay buffer append");
    await cache.pushQueue(replayKey(turnId), rawFrame);
    await cache.expire(replayKey(turnId), REPLAY_BUFFER_TTL_SECONDS);
  }

  async replayFramesAfter(turnId: string, afterEventId: number): Promise<readonly string[]> {
    const cache = getTenantCache("turn replay buffer read");
    // `popQueue` is this project's own narrow `TenantCache` surface (no
    // non-destructive range read is exposed) — read-and-requeue keeps replay
    // idempotent across more than one reattach within the buffer's TTL.
    const frames = await cache.popQueue(replayKey(turnId), REPLAY_BUFFER_MAX_FRAMES);
    for (const frame of frames) await cache.pushQueue(replayKey(turnId), frame);
    if (frames.length > 0) await cache.expire(replayKey(turnId), REPLAY_BUFFER_TTL_SECONDS);
    return frames.filter((frame) => frameIdAfter(frame, afterEventId));
  }

  async incrementFeedbackSubmissionCount(turnId: string): Promise<number> {
    const cache = getTenantCache("feedback double-click guard");
    const count = await cache.incr(feedbackWindowKey(turnId));
    if (count === 1) await cache.expire(feedbackWindowKey(turnId), FEEDBACK_WINDOW_TTL_SECONDS);
    return count;
  }

  async incrementTurnRateCount(conversationId: string, windowSeconds: number): Promise<number> {
    const cache = getTenantCache("turn rate limit");
    const count = await cache.incr(rateKey(conversationId));
    if (count === 1) await cache.expire(rateKey(conversationId), windowSeconds);
    return count;
  }
}

/** Parses the `id: N` line out of an already-encoded raw SSE frame to compare against `afterEventId` — avoids a second, parallel "frame" representation just for replay filtering. */
function frameIdAfter(rawFrame: string, afterEventId: number): boolean {
  const match = /^id: (\d+)$/m.exec(rawFrame);
  if (!match || !match[1]) return true; // no id — forward it rather than silently drop it
  return Number(match[1]) > afterEventId;
}
