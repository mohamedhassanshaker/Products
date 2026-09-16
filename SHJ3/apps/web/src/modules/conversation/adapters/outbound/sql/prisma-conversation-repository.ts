/** The real `ConversationRepository` — reads/writes `Conversations`, reads `ConversationTurns`/`ConversationSlots` (both AI-written; see the port's own doc comment). */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { containmentClearedBy } from "../../../domain/containment.js";
import type {
  ConversationRepository,
  ConversationRow,
  ConversationSlotRow,
  ConversationTurnRow,
  NewConversationInput,
} from "../../../ports/conversation-repository.js";

export class PrismaConversationRepository implements ConversationRepository {
  async create(input: NewConversationInput): Promise<ConversationRow> {
    const created = await getTenantDb().conversation.create({
      data: {
        id: newUlid(input.startedAt),
        channelKey: input.channelKey,
        localeCode: input.localeCode,
        outcome: "Active",
        wasContained: true,
        turnCount: 0,
        startedAt: input.startedAt,
        lastTurnAt: input.startedAt,
        piiMaskApplied: true,
        retentionExpiresAt: input.retentionExpiresAt,
        createdAt: input.startedAt,
      },
    });
    return toConversationRow(created);
  }

  async findById(conversationId: string): Promise<ConversationRow | null> {
    const row = await getTenantDb().conversation.findUnique({ where: { id: conversationId } });
    return row ? toConversationRow(row) : null;
  }

  async listTurnsAfter(
    conversationId: string,
    afterOrdinal: number,
    limit: number,
  ): Promise<readonly ConversationTurnRow[]> {
    const rows = await getTenantDb().conversationTurn.findMany({
      where: { conversationId, ordinal: { gt: afterOrdinal } },
      orderBy: { ordinal: "asc" },
      take: limit + 1,
    });
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      ordinal: row.ordinal,
      role: row.role,
      contentMasked: row.contentMasked,
      contentFormat: row.contentFormat,
      createdAt: row.createdAt,
      wasRefused: row.wasRefused,
      refusalReason: row.refusalReason,
    }));
  }

  async listPendingSlots(conversationId: string): Promise<readonly ConversationSlotRow[]> {
    const rows = await getTenantDb().conversationSlot.findMany({
      where: { conversationId, status: "Pending" },
    });
    return rows.map((row) => ({
      name: row.name,
      valueMasked: row.valueMasked,
      status: row.status,
      requiredAssurance: row.requiredAssurance,
    }));
  }

  async findTurnConversationId(turnId: string): Promise<string | null> {
    const row = await getTenantDb().conversationTurn.findUnique({
      where: { id: turnId },
      select: { conversationId: true },
    });
    return row?.conversationId ?? null;
  }

  async close(conversationId: string, outcome: string, endedAt: Date): Promise<void> {
    await getTenantDb().conversation.updateMany({
      where: { id: conversationId, endedAt: null },
      // `wasContained` is cleared in the SAME update as `outcome` — never a separate
      // follow-up write — so a conversation can never be read back mid-transition with the
      // two columns disagreeing (see `containmentClearedBy`'s own doc comment for the real
      // bug this fixes). Monotonic: only ever included to set `false`, never to resurrect
      // `true` for an outcome (e.g. `Resolved`, once its ticket is itself resolved) that
      // doesn't itself prove no human was ever involved.
      data: { outcome, endedAt, ...(containmentClearedBy(outcome) ? { wasContained: false } : {}) },
    });
  }

  async markEscalated(conversationId: string, now: Date): Promise<void> {
    await getTenantDb().conversation.updateMany({
      where: { id: conversationId, endedAt: null },
      data: { outcome: "Escalated", wasContained: false, updatedAt: now },
    });
  }

  async appendHumanAgentTurn(input: {
    readonly conversationId: string;
    readonly contentMasked: string;
    readonly contentFormat: string;
    readonly now: Date;
  }): Promise<ConversationTurnRow> {
    const db = getTenantDb();
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      select: { localeCode: true },
    });
    const top = await db.conversationTurn.findFirst({
      where: { conversationId: input.conversationId },
      orderBy: { ordinal: "desc" },
      select: { ordinal: true },
    });
    const ordinal = (top?.ordinal ?? 0) + 1;

    const created = await db.conversationTurn.create({
      data: {
        id: newUlid(input.now),
        conversationId: input.conversationId,
        ordinal,
        role: "HumanAgent",
        contentMasked: input.contentMasked,
        contentFormat: input.contentFormat,
        localeCode: conversation.localeCode,
        wasRefused: false,
        createdAt: input.now,
      },
    });
    // Nothing else bumps these two columns for this write path (this method's own
    // doc comment on the port: shj3_ai's citizen<->assistant path never updates them
    // either — a pre-existing gap, not one this method silently inherits for its own
    // writes).
    await db.conversation.update({
      where: { id: input.conversationId },
      data: { turnCount: { increment: 1 }, lastTurnAt: input.now },
    });

    return {
      id: created.id,
      conversationId: created.conversationId,
      ordinal: created.ordinal,
      role: created.role,
      contentMasked: created.contentMasked,
      contentFormat: created.contentFormat,
      createdAt: created.createdAt,
      wasRefused: created.wasRefused,
      refusalReason: created.refusalReason,
    };
  }
}

function toConversationRow(row: {
  id: string;
  channelKey: string;
  localeCode: string;
  outcome: string;
  turnCount: number;
  startedAt: Date;
  lastTurnAt: Date;
  endedAt: Date | null;
}): ConversationRow {
  return {
    id: row.id,
    channelKey: row.channelKey,
    localeCode: row.localeCode,
    outcome: row.outcome,
    turnCount: row.turnCount,
    startedAt: row.startedAt,
    lastTurnAt: row.lastTurnAt,
    endedAt: row.endedAt,
  };
}
