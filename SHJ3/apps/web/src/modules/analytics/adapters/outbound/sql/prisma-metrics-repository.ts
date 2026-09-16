import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { humanizeIntentKey } from "../../../domain/intent-label.js";
import { utcDateFromKey, utcDayBounds } from "../../../domain/date-range.js";
import type {
  ConversationMetricsDailyRow,
  IntentMetricsDailyRow,
  MetricsRepository,
  RawChannelDayAggregate,
  RawIntentDayAggregate,
} from "../../../ports/metrics-repository.js";

/**
 * The "real GROUP BY" half of the rollup gap (see `ComputeDailyMetrics`'s own doc
 * comment for the full honest-scope explanation): rather than a single cross-table SQL
 * aggregate — awkward to express through Prisma once `Conversations` /
 * `ConversationTurns` / `MessageFeedback` / `OrchestrationTraceSteps` all need to be
 * joined and then grouped by *different* keys (channel here, intent in the sibling
 * method) — this fetches the day's real rows once per source table and aggregates them
 * in JavaScript, keyed by `conversationId`. Honest and correct at the per-day, per-tenant
 * scale this module actually runs at (one calendar day's conversations, never the whole
 * table); a future optimisation could push this into raw SQL if volumes ever justify it,
 * without changing this port's contract.
 */
export class PrismaMetricsRepository implements MetricsRepository {
  async aggregateConversationsForDate(dateKey: string): Promise<readonly RawChannelDayAggregate[]> {
    const db = getTenantDb("analytics daily conversation aggregate");
    const { start, end } = utcDayBounds(dateKey);

    const conversations = await db.conversation.findMany({
      where: { startedAt: { gte: start, lt: end } },
      select: { id: true, channelKey: true, outcome: true, wasContained: true, turnCount: true },
    });
    if (conversations.length === 0) return [];

    const conversationIds = conversations.map((c) => c.id);
    const channelOf = new Map(conversations.map((c) => [c.id, c.channelKey]));

    const [feedback, toolSteps, firstAssistantTurns] = await Promise.all([
      db.messageFeedback.findMany({
        where: { turn: { conversationId: { in: conversationIds } } },
        select: { rating: true, turn: { select: { conversationId: true } } },
      }),
      db.orchestrationTraceStep.findMany({
        where: { kind: "ToolCall", trace: { conversationId: { in: conversationIds } } },
        select: { status: true, trace: { select: { conversationId: true } } },
      }),
      db.conversationTurn.findMany({
        where: {
          conversationId: { in: conversationIds },
          role: "Assistant",
          latencyMs: { not: null },
        },
        select: { conversationId: true, ordinal: true, latencyMs: true },
        orderBy: { ordinal: "asc" },
      }),
    ]);

    // First (lowest-ordinal) Assistant turn per conversation, for avgFirstResponseMs.
    const firstResponseMsByConversation = new Map<string, number>();
    for (const turn of firstAssistantTurns) {
      if (!firstResponseMsByConversation.has(turn.conversationId) && turn.latencyMs !== null) {
        firstResponseMsByConversation.set(turn.conversationId, turn.latencyMs);
      }
    }

    interface Accumulator {
      conversationCount: number;
      containedCount: number;
      deflectedCount: number;
      escalatedCount: number;
      abandonedCount: number;
      turnCount: number;
      toolCallCount: number;
      toolErrorCount: number;
      thumbsUpCount: number;
      thumbsDownCount: number;
      firstResponseMsSamples: number[];
    }
    const byChannel = new Map<string, Accumulator>();
    function acc(channelKey: string): Accumulator {
      let entry = byChannel.get(channelKey);
      if (!entry) {
        entry = {
          conversationCount: 0,
          containedCount: 0,
          deflectedCount: 0,
          escalatedCount: 0,
          abandonedCount: 0,
          turnCount: 0,
          toolCallCount: 0,
          toolErrorCount: 0,
          thumbsUpCount: 0,
          thumbsDownCount: 0,
          firstResponseMsSamples: [],
        };
        byChannel.set(channelKey, entry);
      }
      return entry;
    }

    for (const conversation of conversations) {
      const entry = acc(conversation.channelKey);
      entry.conversationCount += 1;
      if (conversation.wasContained) entry.containedCount += 1;
      if (conversation.outcome === "Resolved") entry.deflectedCount += 1;
      if (conversation.outcome === "Escalated") entry.escalatedCount += 1;
      if (conversation.outcome === "Abandoned") entry.abandonedCount += 1;
      entry.turnCount += conversation.turnCount;
      const firstResponseMs = firstResponseMsByConversation.get(conversation.id);
      if (firstResponseMs !== undefined) entry.firstResponseMsSamples.push(firstResponseMs);
    }
    for (const step of toolSteps) {
      const channelKey = channelOf.get(step.trace.conversationId);
      if (!channelKey) continue;
      const entry = acc(channelKey);
      entry.toolCallCount += 1;
      if (step.status === "Failed" || step.status === "Timeout") entry.toolErrorCount += 1;
    }
    for (const row of feedback) {
      const channelKey = channelOf.get(row.turn.conversationId);
      if (!channelKey) continue;
      const entry = acc(channelKey);
      if (row.rating === "Up") entry.thumbsUpCount += 1;
      if (row.rating === "Down") entry.thumbsDownCount += 1;
    }

    return [...byChannel.entries()].map(([channelKey, entry]) => ({
      channelKey,
      conversationCount: entry.conversationCount,
      containedCount: entry.containedCount,
      deflectedCount: entry.deflectedCount,
      escalatedCount: entry.escalatedCount,
      abandonedCount: entry.abandonedCount,
      turnCount: entry.turnCount,
      toolCallCount: entry.toolCallCount,
      toolErrorCount: entry.toolErrorCount,
      thumbsUpCount: entry.thumbsUpCount,
      thumbsDownCount: entry.thumbsDownCount,
      avgFirstResponseMs:
        entry.firstResponseMsSamples.length > 0
          ? Math.round(
              entry.firstResponseMsSamples.reduce((sum, ms) => sum + ms, 0) /
                entry.firstResponseMsSamples.length,
            )
          : null,
    }));
  }

  async aggregateIntentsForDate(dateKey: string): Promise<readonly RawIntentDayAggregate[]> {
    const db = getTenantDb("analytics daily intent aggregate");
    const { start, end } = utcDayBounds(dateKey);

    const conversations = await db.conversation.findMany({
      where: { startedAt: { gte: start, lt: end } },
      select: { intentKey: true, outcome: true },
    });
    if (conversations.length === 0) return [];

    interface Accumulator {
      intentKey: string;
      conversationCount: number;
      escalatedCount: number;
      resolvedCount: number;
    }
    const byIntent = new Map<string, Accumulator>();
    for (const conversation of conversations) {
      const intentKey = conversation.intentKey ?? "unclassified";
      let entry = byIntent.get(intentKey);
      if (!entry) {
        entry = { intentKey, conversationCount: 0, escalatedCount: 0, resolvedCount: 0 };
        byIntent.set(intentKey, entry);
      }
      entry.conversationCount += 1;
      if (conversation.outcome === "Escalated") entry.escalatedCount += 1;
      if (conversation.outcome === "Resolved") entry.resolvedCount += 1;
    }

    return [...byIntent.values()].map((entry) => ({
      intentKey: entry.intentKey,
      intentLabel: humanizeIntentKey(entry.intentKey === "unclassified" ? null : entry.intentKey),
      conversationCount: entry.conversationCount,
      escalatedCount: entry.escalatedCount,
      resolvedCount: entry.resolvedCount,
    }));
  }

  async upsertConversationMetrics(row: ConversationMetricsDailyRow, now: Date): Promise<void> {
    const db = getTenantDb("analytics conversation metrics upsert");
    const metricDate = utcDateFromKey(row.metricDate);
    const data = {
      conversationCount: row.conversationCount,
      containedCount: row.containedCount,
      deflectedCount: row.deflectedCount,
      escalatedCount: row.escalatedCount,
      abandonedCount: row.abandonedCount,
      turnCount: row.turnCount,
      toolCallCount: row.toolCallCount,
      toolErrorCount: row.toolErrorCount,
      thumbsUpCount: row.thumbsUpCount,
      thumbsDownCount: row.thumbsDownCount,
      avgFirstResponseMs: row.avgFirstResponseMs,
    };
    // Not `db.conversationMetricsDaily.upsert()`: Prisma's generated `WhereUniqueInput`
    // types a compound unique key's own nullable member (`agentId`) as plain `string`,
    // never `string | null` (confirmed directly in `prisma/generated/tenant-client/
    // index.d.ts`) — a real generator limitation for a nullable column inside a compound
    // unique index, not something this adapter can satisfy while this rollup always
    // writes `agentId: null`. `findFirst` + `create`/`update` has no such restriction
    // (ordinary `where` filters accept `null` freely) and is still race-safe in practice:
    // this method only ever runs from an on-demand, single-caller rollup computation,
    // never concurrently for the same key.
    const existing = await db.conversationMetricsDaily.findFirst({
      where: { metricDate, channelKey: row.channelKey, agentId: null },
      select: { id: true },
    });
    if (existing) {
      await db.conversationMetricsDaily.update({ where: { id: existing.id }, data });
    } else {
      await db.conversationMetricsDaily.create({
        data: {
          id: newUlid(now),
          metricDate,
          channelKey: row.channelKey,
          agentId: null,
          createdAt: now,
          ...data,
        },
      });
    }
  }

  async upsertIntentMetrics(row: IntentMetricsDailyRow, now: Date): Promise<void> {
    const db = getTenantDb("analytics intent metrics upsert");
    const metricDate = utcDateFromKey(row.metricDate);
    const data = {
      intentLabel: row.intentLabel,
      conversationCount: row.conversationCount,
      escalatedCount: row.escalatedCount,
      resolvedCount: row.resolvedCount,
    };
    await db.intentMetricsDaily.upsert({
      where: { metricDate_intentKey: { metricDate, intentKey: row.intentKey } },
      create: { id: newUlid(now), metricDate, intentKey: row.intentKey, createdAt: now, ...data },
      update: data,
    });
  }

  async listRolledUpDates(dateKeys: readonly string[]): Promise<ReadonlySet<string>> {
    const db = getTenantDb("analytics rolled-up dates check");
    const rows = await db.conversationMetricsDaily.findMany({
      where: { metricDate: { in: dateKeys.map(utcDateFromKey) } },
      select: { metricDate: true },
      distinct: ["metricDate"],
    });
    return new Set(rows.map((row) => row.metricDate.toISOString().slice(0, 10)));
  }

  async listConversationMetrics(
    dateKeys: readonly string[],
  ): Promise<readonly ConversationMetricsDailyRow[]> {
    const db = getTenantDb("analytics conversation metrics read");
    const rows = await db.conversationMetricsDaily.findMany({
      where: { metricDate: { in: dateKeys.map(utcDateFromKey) }, agentId: null },
    });
    return rows.map((row) => ({
      metricDate: row.metricDate.toISOString().slice(0, 10),
      channelKey: row.channelKey,
      conversationCount: row.conversationCount,
      containedCount: row.containedCount,
      deflectedCount: row.deflectedCount,
      escalatedCount: row.escalatedCount,
      abandonedCount: row.abandonedCount,
      turnCount: row.turnCount,
      toolCallCount: row.toolCallCount,
      toolErrorCount: row.toolErrorCount,
      thumbsUpCount: row.thumbsUpCount,
      thumbsDownCount: row.thumbsDownCount,
      avgFirstResponseMs: row.avgFirstResponseMs,
    }));
  }

  async listIntentMetrics(dateKeys: readonly string[]): Promise<readonly IntentMetricsDailyRow[]> {
    const db = getTenantDb("analytics intent metrics read");
    const rows = await db.intentMetricsDaily.findMany({
      where: { metricDate: { in: dateKeys.map(utcDateFromKey) } },
    });
    return rows.map((row) => ({
      metricDate: row.metricDate.toISOString().slice(0, 10),
      intentKey: row.intentKey,
      intentLabel: row.intentLabel,
      conversationCount: row.conversationCount,
      escalatedCount: row.escalatedCount,
      resolvedCount: row.resolvedCount,
    }));
  }
}
