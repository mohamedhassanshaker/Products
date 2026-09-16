import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { humanizeIntentKey } from "../../../domain/intent-label.js";
import type {
  ConversationExplorerRepository,
  ConversationListRow,
  ConversationOutcomeFilter,
  GoldenCaseSeed,
  TranscriptTurnRow,
} from "../../../ports/conversation-explorer-repository.js";

const TRANSCRIPT_LIMIT = 500;

function toRating(rating: string | null | undefined): "Up" | "Down" | null {
  return rating === "Up" || rating === "Down" ? rating : null;
}

export class PrismaConversationExplorerRepository implements ConversationExplorerRepository {
  async list(
    filter: ConversationOutcomeFilter,
    limit: number,
  ): Promise<readonly ConversationListRow[]> {
    const db = getTenantDb("conversation explorer list");
    const conversations = await db.conversation.findMany({
      where: filter === "All" ? {} : { outcome: filter },
      orderBy: { lastTurnAt: "desc" },
      take: limit,
      select: {
        id: true,
        channelKey: true,
        intentKey: true,
        outcome: true,
        lastTurnAt: true,
        citizenIdentityId: true,
      },
    });
    if (conversations.length === 0) return [];

    const conversationIds = conversations.map((c) => c.id);
    const identityIds = [
      ...new Set(
        conversations.map((c) => c.citizenIdentityId).filter((id): id is string => id !== null),
      ),
    ];

    const [identities, feedbackRows] = await Promise.all([
      identityIds.length > 0
        ? db.citizenIdentity.findMany({
            where: { id: { in: identityIds } },
            select: { id: true, displayNameMasked: true },
          })
        : Promise.resolve([]),
      db.messageFeedback.findMany({
        where: { turn: { conversationId: { in: conversationIds } } },
        select: { rating: true, updatedAt: true, turn: { select: { conversationId: true } } },
        orderBy: { updatedAt: "asc" },
      }),
    ]);

    const displayNameByIdentity = new Map(identities.map((i) => [i.id, i.displayNameMasked]));
    // Last write wins because the feedback rows are fetched oldest-first — the wireframe's
    // list shows one rating per conversation, taken as "the most recently submitted one".
    const latestRatingByConversation = new Map<string, "Up" | "Down">();
    for (const row of feedbackRows) {
      const rating = toRating(row.rating);
      if (rating) latestRatingByConversation.set(row.turn.conversationId, rating);
    }

    return conversations.map((conversation) => ({
      id: conversation.id,
      displayUserMasked: conversation.citizenIdentityId
        ? (displayNameByIdentity.get(conversation.citizenIdentityId) ?? null)
        : null,
      channelKey: conversation.channelKey,
      intentLabel: humanizeIntentKey(conversation.intentKey),
      outcome: conversation.outcome,
      rating: latestRatingByConversation.get(conversation.id) ?? null,
      lastTurnAt: conversation.lastTurnAt,
    }));
  }

  async getTranscript(conversationId: string): Promise<readonly TranscriptTurnRow[] | null> {
    const db = getTenantDb("conversation explorer transcript");
    const exists = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!exists) return null;

    const turns = await db.conversationTurn.findMany({
      where: { conversationId },
      orderBy: { ordinal: "asc" },
      take: TRANSCRIPT_LIMIT,
      include: { feedback: { select: { rating: true } } },
    });

    return turns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      contentMasked: turn.contentMasked,
      contentFormat: turn.contentFormat,
      createdAt: turn.createdAt,
      rating: toRating(turn.feedback?.rating),
    }));
  }

  async findGoldenCaseSeed(conversationId: string): Promise<GoldenCaseSeed | null> {
    const db = getTenantDb("conversation explorer golden case seed");
    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { localeCode: true },
    });
    if (!conversation) return null;

    const turns = await db.conversationTurn.findMany({
      where: { conversationId },
      orderBy: { ordinal: "asc" },
      select: { ordinal: true, role: true, contentMasked: true },
    });

    // "The interaction being flagged" is anchored on the *first* citizen turn — the
    // opener — paired with the first assistant turn that answers it (see
    // `AddConversationToGoldenSet`'s own doc comment for why this pairing, not the
    // conversation's most recent exchange, is the defensible one).
    const firstCitizenTurn = turns.find((t) => t.role === "Citizen");
    if (!firstCitizenTurn) return null;
    const answeringTurn = turns.find(
      (t) => t.ordinal > firstCitizenTurn.ordinal && t.role === "Assistant",
    );
    if (!answeringTurn) return null;

    return {
      localeCode: conversation.localeCode,
      promptText: firstCitizenTurn.contentMasked,
      actualResponseText: answeringTurn.contentMasked,
    };
  }
}
