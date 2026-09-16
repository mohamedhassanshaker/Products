import { describe, expect, it } from "vitest";
import { FakeMetricsRepository } from "../testing/fakes.js";
import { ComputeDailyMetrics } from "./compute-daily-metrics.js";

const now = new Date("2026-09-10T12:00:00.000Z");

describe("ComputeDailyMetrics", () => {
  it("writes one ConversationMetricsDaily row per channel and one IntentMetricsDaily row per intent", async () => {
    const metrics = new FakeMetricsRepository();
    metrics.seedRawChannelDay("2026-09-10", [
      {
        channelKey: "WebWidget",
        conversationCount: 10,
        containedCount: 7,
        deflectedCount: 6,
        escalatedCount: 2,
        abandonedCount: 2,
        turnCount: 40,
        toolCallCount: 5,
        toolErrorCount: 1,
        thumbsUpCount: 4,
        thumbsDownCount: 1,
        avgFirstResponseMs: 850,
      },
    ]);
    metrics.seedRawIntentDay("2026-09-10", [
      {
        intentKey: "pay_utilities_bill",
        intentLabel: "Pay utilities bill",
        conversationCount: 10,
        escalatedCount: 2,
        resolvedCount: 6,
      },
    ]);

    await new ComputeDailyMetrics({ metrics }).execute("2026-09-10", now);

    const conversationRows = await metrics.listConversationMetrics(["2026-09-10"]);
    expect(conversationRows).toEqual([
      expect.objectContaining({
        metricDate: "2026-09-10",
        channelKey: "WebWidget",
        conversationCount: 10,
        containedCount: 7,
      }),
    ]);

    const intentRows = await metrics.listIntentMetrics(["2026-09-10"]);
    expect(intentRows).toEqual([
      expect.objectContaining({ metricDate: "2026-09-10", intentKey: "pay_utilities_bill" }),
    ]);
  });

  it("is idempotent — re-running for the same date replaces rather than doubles the row", async () => {
    const metrics = new FakeMetricsRepository();
    metrics.seedRawChannelDay("2026-09-10", [
      {
        channelKey: "WebWidget",
        conversationCount: 10,
        containedCount: 7,
        deflectedCount: 6,
        escalatedCount: 2,
        abandonedCount: 2,
        turnCount: 40,
        toolCallCount: 5,
        toolErrorCount: 1,
        thumbsUpCount: 4,
        thumbsDownCount: 1,
        avgFirstResponseMs: 850,
      },
    ]);
    metrics.seedRawIntentDay("2026-09-10", []);

    const useCase = new ComputeDailyMetrics({ metrics });
    await useCase.execute("2026-09-10", now);
    await useCase.execute("2026-09-10", now);

    const rows = await metrics.listConversationMetrics(["2026-09-10"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.conversationCount).toBe(10);
  });

  it("writes nothing for a date with no real conversations", async () => {
    const metrics = new FakeMetricsRepository();
    await new ComputeDailyMetrics({ metrics }).execute("2026-01-01", now);
    expect(await metrics.listConversationMetrics(["2026-01-01"])).toEqual([]);
  });
});
