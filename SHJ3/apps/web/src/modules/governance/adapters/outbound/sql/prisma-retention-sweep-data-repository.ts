import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  RetentionCandidateConversation,
  RetentionSweepDataRepository,
} from "../../../ports/retention-sweep-repository.js";

const OPERATION = "governance retention sweep";
const BATCH_LIMIT_DEFAULT = 500;

export class PrismaRetentionSweepDataRepository implements RetentionSweepDataRepository {
  async findConversationsPastRetention(
    now: Date,
    limit: number = BATCH_LIMIT_DEFAULT,
  ): Promise<readonly RetentionCandidateConversation[]> {
    const rows = await getTenantDb(OPERATION).conversation.findMany({
      where: { retentionExpiresAt: { lte: now }, erasedAt: null },
      orderBy: { retentionExpiresAt: "asc" },
      take: limit,
      select: { id: true, redisSessionKey: true },
    });
    return rows;
  }

  async deleteTurns(conversationId: string): Promise<number> {
    const result = await getTenantDb(OPERATION).conversationTurn.deleteMany({
      where: { conversationId },
    });
    return result.count;
  }

  /**
   * Steps are deleted explicitly, before their parent trace, rather than assumed to
   * cascade — this wave did not re-verify `OrchestrationTraceStep.traceId`'s own
   * `onDelete` behaviour, and an unverified cascade assumption is exactly the kind of
   * "should work" reasoning this project's own `tasks/lessons.md` warns against trusting
   * without a live check. Explicit is one extra query and never wrong either way.
   */
  async deleteTraces(conversationId: string): Promise<number> {
    const db = getTenantDb(OPERATION);
    const traces = await db.orchestrationTrace.findMany({
      where: { conversationId },
      select: { id: true },
    });
    if (traces.length === 0) return 0;
    const traceIds = traces.map((trace) => trace.id);
    await db.orchestrationTraceStep.deleteMany({ where: { traceId: { in: traceIds } } });
    const result = await db.orchestrationTrace.deleteMany({ where: { conversationId } });
    return result.count;
  }

  async nullTransactionLinks(conversationId: string): Promise<number> {
    const result = await getTenantDb(OPERATION).transaction.updateMany({
      where: { conversationId },
      data: { conversationId: null },
    });
    return result.count;
  }

  async markConversationErased(conversationId: string, now: Date): Promise<void> {
    await getTenantDb(OPERATION).conversation.update({
      where: { id: conversationId },
      data: { erasedAt: now, updatedAt: now },
    });
  }
}
