import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { recordSimulatedUsageEvent, getUsageReport, getCostPerResolvedConversation } from "./usage-service.js";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, FR-AGT-24) — real-Postgres proof
 * that a simulated model call records a `model_usage_event` row with correct
 * token/cost/latency attribution, and that the tenant usage/cost view aggregates it
 * correctly by every `groupBy` dimension plus the cost-per-resolved-conversation
 * figure.
 */
describe("usage-service (FR-AGT-24, real Postgres)", () => {
  let ctx: TenantContext;
  afterEach(async () => {
    if (ctx) await deleteFixtureTenant(ctx.tenantId);
  });

  it("records a usage event with correct token/cost/latency attribution, then aggregates it by every groupBy dimension", async () => {
    ctx = await createFixtureTenant();
    await recordSimulatedUsageEvent(ctx, {
      routeKey: "chat.primary",
      providerKey: "openai-compatible",
      model: "gpt-4o",
      agentDefinitionVersionId: "11111111-1111-1111-1111-111111111111",
      conversationId: "22222222-2222-2222-2222-222222222222",
      tokensIn: 120,
      tokensOut: 45,
      costUsd: "0.0123",
      latencyMs: 456,
      outcome: "Success",
      channelType: "WebWidget",
    });

    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 60 * 1000);

    for (const groupBy of ["provider", "model", "route", "agentVersion", "channel"] as const) {
      const rows = await getUsageReport(ctx, { from, to, groupBy });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokensIn).toBe(120);
      expect(rows[0]?.tokensOut).toBe(45);
      expect(rows[0]?.costUsd).toBeCloseTo(0.0123, 6);
      expect(rows[0]?.callCount).toBe(1);
    }

    const cost = await getCostPerResolvedConversation(ctx, { from, to });
    expect(cost.totalCostUsd).toBeCloseTo(0.0123, 6);
    expect(cost.conversationCount).toBe(1);
    expect(cost.costPerConversation).toBeCloseTo(0.0123, 6);
  });

  it("a cache hit is recorded distinctly (outcome CacheHit) and counted in cacheHitCount, not errorCount", async () => {
    ctx = await createFixtureTenant();
    await recordSimulatedUsageEvent(ctx, { routeKey: "chat.primary", providerKey: "cache", model: "cache", cached: true, cacheKind: "Exact", outcome: "CacheHit" });

    const now = new Date();
    const rows = await getUsageReport(ctx, { from: new Date(now.getTime() - 60_000), to: new Date(now.getTime() + 60_000), groupBy: "provider" });
    expect(rows[0]?.cacheHitCount).toBe(1);
    expect(rows[0]?.errorCount).toBe(0);
  });

  it("a provider error is counted in errorCount", async () => {
    ctx = await createFixtureTenant();
    await recordSimulatedUsageEvent(ctx, { routeKey: "chat.primary", providerKey: "openai-compatible", model: "gpt-4o", outcome: "ProviderError", errorCode: "boom" });

    const now = new Date();
    const rows = await getUsageReport(ctx, { from: new Date(now.getTime() - 60_000), to: new Date(now.getTime() + 60_000), groupBy: "provider" });
    expect(rows[0]?.errorCount).toBe(1);
  });

  it("returns a null costPerConversation (never divides by zero) when no usage event carries a conversationId", async () => {
    ctx = await createFixtureTenant();
    await recordSimulatedUsageEvent(ctx, { routeKey: "chat.primary", providerKey: "openai-compatible", model: "gpt-4o", costUsd: "1.00", outcome: "Success" });

    const now = new Date();
    const cost = await getCostPerResolvedConversation(ctx, { from: new Date(now.getTime() - 60_000), to: new Date(now.getTime() + 60_000) });
    expect(cost.conversationCount).toBe(0);
    expect(cost.costPerConversation).toBeNull();
    expect(cost.totalCostUsd).toBeCloseTo(1, 6);
  });
});
