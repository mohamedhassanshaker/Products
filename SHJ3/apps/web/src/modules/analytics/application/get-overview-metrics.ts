import { DATE_RANGE_KEYS, datesInRange, type DateRangeKey } from "../domain/date-range.js";
import type {
  ConversationMetricsDailyRow,
  IntentMetricsDailyRow,
  MetricsRepository,
} from "../ports/metrics-repository.js";
import type { ComputeDailyMetrics } from "./compute-daily-metrics.js";

/** B1 tab 1's KPI grid row — rates computed on read, per the schema's own rule ("a
 *  stored containmentRate... is a third fact that can disagree with the first two"). A
 *  `null` rate means the denominator was zero for that range (no conversations / no tool
 *  calls at all), not zero — the UI renders that as "—", not "0%". */
export interface KpiRow {
  readonly conversationCount: number;
  readonly containmentRate: number | null;
  readonly deflectionRate: number | null;
  readonly toolErrorRate: number | null;
}

export interface ChannelSplitRow {
  readonly channelKey: string;
  readonly conversationCount: number;
}

export interface TopIntentRow {
  readonly intentKey: string;
  readonly intentLabel: string;
  readonly conversationCount: number;
}

export interface OverviewMetricsResult {
  /** All three ranges, always — the wireframe's KPI table shows `Today` / `Last 7 days`
   *  / `Last 30 days` as three permanent columns of one table, not three states of a
   *  single-range view. */
  readonly kpiGrid: Readonly<Record<DateRangeKey, KpiRow>>;
  /** Scoped to `dateRange` — the wireframe's "Date range... switching re-renders" panels. */
  readonly channelSplit: readonly ChannelSplitRow[];
  readonly topIntents: readonly TopIntentRow[];
}

const TOP_INTENTS_LIMIT = 5;

function sum<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function toKpiRow(
  rows: readonly ConversationMetricsDailyRow[],
  dateKeys: readonly string[],
): KpiRow {
  const dateSet = new Set(dateKeys);
  const scoped = rows.filter((row) => dateSet.has(row.metricDate));
  const conversationCount = sum(scoped, (row) => row.conversationCount);
  return {
    conversationCount,
    containmentRate: rate(
      sum(scoped, (row) => row.containedCount),
      conversationCount,
    ),
    deflectionRate: rate(
      sum(scoped, (row) => row.deflectedCount),
      conversationCount,
    ),
    toolErrorRate: rate(
      sum(scoped, (row) => row.toolErrorCount),
      sum(scoped, (row) => row.toolCallCount),
    ),
  };
}

function toChannelSplit(
  rows: readonly ConversationMetricsDailyRow[],
  dateKeys: readonly string[],
): readonly ChannelSplitRow[] {
  const dateSet = new Set(dateKeys);
  const byChannel = new Map<string, number>();
  for (const row of rows) {
    if (!dateSet.has(row.metricDate)) continue;
    byChannel.set(row.channelKey, (byChannel.get(row.channelKey) ?? 0) + row.conversationCount);
  }
  return [...byChannel.entries()]
    .map(([channelKey, conversationCount]) => ({ channelKey, conversationCount }))
    .sort((a, b) => b.conversationCount - a.conversationCount);
}

function toTopIntents(
  rows: readonly IntentMetricsDailyRow[],
  dateKeys: readonly string[],
): readonly TopIntentRow[] {
  const dateSet = new Set(dateKeys);
  const byIntent = new Map<string, { intentLabel: string; conversationCount: number }>();
  for (const row of rows) {
    if (!dateSet.has(row.metricDate)) continue;
    const existing = byIntent.get(row.intentKey);
    byIntent.set(row.intentKey, {
      intentLabel: row.intentLabel,
      conversationCount: (existing?.conversationCount ?? 0) + row.conversationCount,
    });
  }
  return [...byIntent.entries()]
    .map(([intentKey, entry]) => ({ intentKey, ...entry }))
    .sort((a, b) => b.conversationCount - a.conversationCount)
    .slice(0, TOP_INTENTS_LIMIT);
}

/**
 * B1 tab 1 in full. Ensures every UTC date the widest range (`Last 30 days`) needs has a
 * real rollup — computing any missing one on the spot via `ComputeDailyMetrics` — then
 * reads that same 30-day window once and slices it three ways for the KPI grid (`Today`/
 * `Last 7 days`/`Last 30 days` are nested subsets of the 30-day window, so one fetch
 * covers all three) plus once more for the caller-selected `dateRange`'s channel split
 * and top-intents panels.
 */
export class GetOverviewMetrics {
  constructor(
    private readonly deps: {
      readonly metrics: MetricsRepository;
      readonly computeDailyMetrics: ComputeDailyMetrics;
    },
  ) {}

  async execute(input: {
    readonly dateRange: DateRangeKey;
    readonly now: Date;
  }): Promise<OverviewMetricsResult> {
    const widestDates = datesInRange("Last 30 days", input.now);
    const rolledUp = await this.deps.metrics.listRolledUpDates(widestDates);
    const missingDates = widestDates.filter((dateKey) => !rolledUp.has(dateKey));
    if (missingDates.length > 0) {
      await Promise.all(
        missingDates.map((dateKey) => this.deps.computeDailyMetrics.execute(dateKey, input.now)),
      );
    }

    const [conversationRows, intentRows] = await Promise.all([
      this.deps.metrics.listConversationMetrics(widestDates),
      this.deps.metrics.listIntentMetrics(widestDates),
    ]);

    const kpiGrid = Object.fromEntries(
      DATE_RANGE_KEYS.map((key) => [key, toKpiRow(conversationRows, datesInRange(key, input.now))]),
    ) as Record<DateRangeKey, KpiRow>;

    const selectedDates = datesInRange(input.dateRange, input.now);
    return {
      kpiGrid,
      channelSplit: toChannelSplit(conversationRows, selectedDates),
      topIntents: toTopIntents(intentRows, selectedDates),
    };
  }
}
