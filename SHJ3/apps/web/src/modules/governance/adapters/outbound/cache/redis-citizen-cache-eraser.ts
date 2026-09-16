import { getTenantCache } from "../../../../platform/adapters/outbound/cache/tenant-cache.js";
import type {
  CitizenCacheEraser,
  CitizenCacheErasureResult,
} from "../../../ports/citizen-cache-eraser.js";

const OPERATION = "governance citizen erasure (redis)";

/** Real, live Redis erasure — reachable from `apps/web` via `getTenantCache()` (unlike
 *  Neo4j/Qdrant). Deletes `conv:{conversationId}` / `conv:{conversationId}:slots` for
 *  every conversation id the SQL eraser just delinked, and verifies each is genuinely
 *  gone (`get` returns `null`) rather than trusting the delete count alone. */
export class RedisCitizenCacheEraser implements CitizenCacheEraser {
  async eraseConversationKeys(
    conversationIds: readonly string[],
  ): Promise<CitizenCacheErasureResult> {
    if (conversationIds.length === 0) {
      return {
        affectedCount: 0,
        verificationQuery: "no conversations to erase — nothing to delete",
      };
    }

    const cache = getTenantCache(OPERATION);
    const keys = conversationIds.flatMap((id) => [`conv:${id}`, `conv:${id}:slots`]);
    const deletedCount = await cache.del(...keys);

    const stillPresent: string[] = [];
    for (const key of keys) {
      const value = await cache.get(key);
      if (value !== null) stillPresent.push(key);
    }

    return {
      affectedCount: deletedCount,
      verificationQuery:
        `DEL ${keys.join(" ")} ; GET each key to confirm null -- ${deletedCount} key(s) deleted, ` +
        `${stillPresent.length} still present after verification` +
        (stillPresent.length > 0 ? ` (${stillPresent.join(", ")})` : ""),
    };
  }
}
