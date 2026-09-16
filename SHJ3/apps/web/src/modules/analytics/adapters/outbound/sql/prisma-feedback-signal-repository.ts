import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  DownvotedTurnSignal,
  FeedbackSignalRepository,
  RefusedTurnSignal,
} from "../../../ports/feedback-signal-repository.js";

/** The nearest `Citizen` turn strictly before `ordinal`, from a list already sorted
 *  ascending by ordinal — shared by both methods below. */
function precedingCitizenText(
  citizenTurns: readonly { ordinal: number; contentMasked: string }[],
  beforeOrdinal: number,
): string {
  let text = "";
  for (const turn of citizenTurns) {
    if (turn.ordinal >= beforeOrdinal) break;
    text = turn.contentMasked;
  }
  return text;
}

export class PrismaFeedbackSignalRepository implements FeedbackSignalRepository {
  async listDownvotedTurns(since: Date): Promise<readonly DownvotedTurnSignal[]> {
    const db = getTenantDb("feedback signal downvoted turns");
    const feedbackRows = await db.messageFeedback.findMany({
      where: { rating: "Down", updatedAt: { gte: since } },
      select: {
        turnId: true,
        updatedAt: true,
        turn: {
          select: {
            conversationId: true,
            ordinal: true,
            wasRefused: true,
            trace: {
              select: {
                groundingConfidence: true,
                steps: { where: { kind: "ToolCall" }, select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (feedbackRows.length === 0) return [];

    const conversationIds = [...new Set(feedbackRows.map((row) => row.turn.conversationId))];
    const citizenTurnsByConversation = await this.citizenTurnsByConversation(db, conversationIds);

    return feedbackRows.map((row) => ({
      turnId: row.turnId,
      conversationId: row.turn.conversationId,
      questionText: precedingCitizenText(
        citizenTurnsByConversation.get(row.turn.conversationId) ?? [],
        row.turn.ordinal,
      ),
      wasRefused: row.turn.wasRefused,
      hasFailedToolCall: (row.turn.trace?.steps ?? []).some(
        (step) => step.status === "Failed" || step.status === "Timeout",
      ),
      groundingConfidence: row.turn.trace?.groundingConfidence?.toNumber() ?? null,
      feedbackUpdatedAt: row.updatedAt,
    }));
  }

  async listRefusedTurns(since: Date): Promise<readonly RefusedTurnSignal[]> {
    const db = getTenantDb("feedback signal refused turns");
    const refusedTurns = await db.conversationTurn.findMany({
      where: { role: "Assistant", wasRefused: true, createdAt: { gte: since } },
      select: { id: true, conversationId: true, ordinal: true, createdAt: true },
    });
    if (refusedTurns.length === 0) return [];

    const conversationIds = [...new Set(refusedTurns.map((turn) => turn.conversationId))];
    const citizenTurnsByConversation = await this.citizenTurnsByConversation(db, conversationIds);

    return refusedTurns.map((turn) => ({
      turnId: turn.id,
      conversationId: turn.conversationId,
      questionText: precedingCitizenText(
        citizenTurnsByConversation.get(turn.conversationId) ?? [],
        turn.ordinal,
      ),
      refusedAt: turn.createdAt,
    }));
  }

  private async citizenTurnsByConversation(
    db: ReturnType<typeof getTenantDb>,
    conversationIds: readonly string[],
  ): Promise<Map<string, { ordinal: number; contentMasked: string }[]>> {
    const citizenTurns = await db.conversationTurn.findMany({
      where: { conversationId: { in: [...conversationIds] }, role: "Citizen" },
      select: { conversationId: true, ordinal: true, contentMasked: true },
      orderBy: { ordinal: "asc" },
    });
    const byConversation = new Map<string, { ordinal: number; contentMasked: string }[]>();
    for (const turn of citizenTurns) {
      const list = byConversation.get(turn.conversationId) ?? [];
      list.push({ ordinal: turn.ordinal, contentMasked: turn.contentMasked });
      byConversation.set(turn.conversationId, list);
    }
    return byConversation;
  }
}
