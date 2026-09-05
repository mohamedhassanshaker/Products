import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, generateId, withTenant, type TenantContext } from "@nextbot/db";
import { getToolHealthSummaries } from "./tool-call-health.js";

let ctx: TenantContext;
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
});

/**
 * Regression test for QA fix UI-D4 — proves the tool-level health table's
 * aggregation is built against real `tool_call` data (call volume, error rate,
 * last error message, 30d uptime), not a display-only stub.
 *
 * Deliberately inserts the `channel`/`conversation` fixture rows directly via
 * `@nextbot/db`'s schema rather than importing `@nextbot/channels`/
 * `@nextbot/conversations`: `approvals`'s LLD §2.3 allow-list is
 * `["orchestration", "conversations", "iam"]` only — `channels` is not on it
 * (not even transitively via `conversations`), so this test must not cross that
 * boundary either, same rule any production code in this module has to follow.
 */
describe("getToolHealthSummaries (QA fix UI-D4, real Postgres)", () => {
  it("aggregates call volume, error rate, and last error message per tool, sorted by error rate desc", async () => {
    ctx = await createFixtureTenant();
    const channelId = generateId();
    const conversationId = generateId();
    await withTenant(ctx, async (db) => {
      await db.insert(schema.channel).values({
        id: channelId,
        tenantId: ctx.tenantId,
        type: "WebWidget",
        name: "Web Widget",
        environment: "Sandbox",
        config: { allowedOrigins: ["https://example.com"] },
        publicKey: generateId(),
      });
      await db.insert(schema.conversation).values({
        id: conversationId,
        tenantId: ctx.tenantId,
        channelId,
        language: "en",
      });
    });

    const toolIdHigh = generateId();
    const toolIdLow = generateId();

    await withTenant(ctx, async (db) => {
      // High-error-rate tool: 1 success, 1 failure (50% error rate).
      await db.insert(schema.toolCall).values([
        {
          id: generateId(),
          tenantId: ctx.tenantId,
          conversationId,
          toolId: toolIdHigh,
          toolName: "flaky_tool",
          approvalTier: "Tier1",
          status: "Succeeded",
          inputArgs: {},
          idempotencyKey: generateId(),
        },
        {
          id: generateId(),
          tenantId: ctx.tenantId,
          conversationId,
          toolId: toolIdHigh,
          toolName: "flaky_tool",
          approvalTier: "Tier1",
          status: "Failed",
          errorMessage: "upstream timeout",
          inputArgs: {},
          idempotencyKey: generateId(),
        },
        // Low-error-rate tool: 1 success only.
        {
          id: generateId(),
          tenantId: ctx.tenantId,
          conversationId,
          toolId: toolIdLow,
          toolName: "reliable_tool",
          approvalTier: "Tier1",
          status: "Succeeded",
          inputArgs: {},
          idempotencyKey: generateId(),
        },
      ]);
    });

    const summaries = await getToolHealthSummaries(ctx);
    expect(summaries.length).toBe(2);
    // Sorted by error rate descending — the flaky tool must be first.
    const [high, low] = summaries;
    expect(high!.toolId).toBe(toolIdHigh);
    expect(high!.errorRatePct).toBe(50);
    expect(high!.lastErrorMessage).toBe("upstream timeout");
    expect(high!.callVolume).toBe(2);
    expect(low!.toolId).toBe(toolIdLow);
    expect(low!.errorRatePct).toBe(0);
    expect(low!.uptime30dPct).toBe(100);
  });

  it("returns an empty list for a tenant with no tool calls", async () => {
    ctx = await createFixtureTenant();
    expect(await getToolHealthSummaries(ctx)).toEqual([]);
  });
});
