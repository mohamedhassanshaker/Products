import { describe, expect, it } from "vitest";
import { FakeMetricsRepository } from "../testing/fakes.js";
import { ComputeDailyMetrics } from "./compute-daily-metrics.js";
import { GetOverviewMetrics } from "./get-overview-metrics.js";

const now = new Date("2026-09-10T12:00:00.000Z");

function seedDay(metrics: FakeMetricsRepository, dateKey: string, conversationCount: number) {
  metrics.seedRawChannelDay(dateKey, [
    {
      channelKey: "WebWidget",
      conversationCount,
      containedCount: Math.round(conversationCount * 0.8),
      deflectedCount: Math.round(conversationCount * 0.6),
      escalatedCount: Math.round(conversationCount * 0.2),
      abandonedCount: 0,
      turnCount: conversationCount * 4,
      toolCallCount: conversationCount,
      toolErrorCount: Math.round(conversationCount * 0.1),
      thumbsUpCount: 0,
      thumbsDownCount: 0,
      avgFirstResponseMs: 900,
    },
  ]);
  metrics.seedRawIntentDay(dateKey, [
    {
      intentKey: "pay_utilities_bill",
      intentLabel: "Pay utilities bill",
      conversationCount,
      escalatedCount: 0,
      resolvedCount: conversationCount,
    },
  ]);
}

describe("GetOverviewMetrics", () => {
  it("computes missing rollups on read, then reads them back for all three KPI ranges", async () => {
    const metrics = new FakeMetricsRepository();
    seedDay(metrics, "2026-09-10", 10); // today only — the other 29 days have no source data at all

    const result = await new GetOverviewMetrics({
      metrics,
      computeDailyMetrics: new ComputeDailyMetrics({ metrics }),
    }).execute({ dateRange: "Today", now });

    expect(result.kpiGrid.Today.conversationCount).toBe(10);
    expect(result.kpiGrid["Last 7 days"].conversationCount).toBe(10);
    expect(result.kpiGrid["Last 30 days"].conversationCount).toBe(10);
    expect(result.kpiGrid.Today.containmentRate).toBeCloseTo(0.8);
  });

  it("does not recompute a date that already has a rollup", async () => {
    const metrics = new FakeMetricsRepository();
    seedDay(metrics, "2026-09-10", 10);
    const computeDailyMetrics = new ComputeDailyMetrics({ metrics });
    await computeDailyMetrics.execute("2026-09-10", now);

    // Mutate the rollup directly (bypassing the raw source) to prove a second
    // GetOverviewMetrics call reads the existing rollup rather than recomputing it.
    await metrics.upsertConversationMetrics(
      {
        metricDate: "2026-09-10",
        channelKey: "WebWidget",
        conversationCount: 999,
        containedCount: 999,
        deflectedCount: 0,
        escalatedCount: 0,
        abandonedCount: 0,
        turnCount: 0,
        toolCallCount: 0,
        toolErrorCount: 0,
        thumbsUpCount: 0,
        thumbsDownCount: 0,
        avgFirstResponseMs: null,
      },
      now,
    );

    const result = await new GetOverviewMetrics({ metrics, computeDailyMetrics }).execute({
      dateRange: "Today",
      now,
    });
    expect(result.kpiGrid.Today.conversationCount).toBe(999);
  });

  it("returns null rates rather than 0 when there is no data at all", async () => {
    const metrics = new FakeMetricsRepository();
    const result = await new GetOverviewMetrics({
      metrics,
      computeDailyMetrics: new ComputeDailyMetrics({ metrics }),
    }).execute({ dateRange: "Today", now });

    expect(result.kpiGrid.Today.conversationCount).toBe(0);
    expect(result.kpiGrid.Today.containmentRate).toBeNull();
    expect(result.channelSplit).toEqual([]);
    expect(result.topIntents).toEqual([]);
  });

  it("channel split and top intents are scoped to the selected dateRange, not the full 30 days", async () => {
    const metrics = new FakeMetricsRepository();
    seedDay(metrics, "2026-09-01", 100); // outside "Today" and "Last 7 days"
    seedDay(metrics, "2026-09-10", 10);

    const result = await new GetOverviewMetrics({
      metrics,
      computeDailyMetrics: new ComputeDailyMetrics({ metrics }),
    }).execute({ dateRange: "Today", now });

    expect(result.channelSplit).toEqual([{ channelKey: "WebWidget", conversationCount: 10 }]);
    expect(result.topIntents[0]?.conversationCount).toBe(10);
    // But the 30-day KPI column does include the 2026-09-01 data.
    expect(result.kpiGrid["Last 30 days"].conversationCount).toBe(110);
  });
});
