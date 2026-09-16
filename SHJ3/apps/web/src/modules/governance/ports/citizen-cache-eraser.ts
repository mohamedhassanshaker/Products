/**
 * The Redis half of a 4-store erasure. Real and exercisable from `apps/web` (unlike
 * Neo4j/Qdrant — see `ports/graph-vector-erasure-verifier.ts`'s module comment): Redis is
 * reachable from the web tier via `getTenantCache()` (ADR-0002 rule 3), and
 * `Conversations.redisSessionKey` gives a real, citizen-scoped key to erase — the exact
 * live session-state key `apps/ai`'s flow engine writes per conversation
 * (`conv:{conversationId}` / `conv:{conversationId}:slots`, confirmed convention).
 */

export interface CitizenCacheErasureResult {
  readonly affectedCount: number;
  readonly verificationQuery: string;
}

export interface CitizenCacheEraser {
  /** Deletes and verifies (`get` returns null after `del`) every session/slot key for the
   *  given conversation ids — the ids `CitizenDataEraser.erase()` just delinked. */
  eraseConversationKeys(conversationIds: readonly string[]): Promise<CitizenCacheErasureResult>;
}
