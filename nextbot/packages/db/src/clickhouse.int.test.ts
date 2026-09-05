import { afterEach, describe, expect, it } from "vitest";
import { insertAgentRunSpans, queryAgentRunSpans, _resetClickHouseForTests } from "./clickhouse.js";

/**
 * Real round trip against `compose.test.yml`'s ephemeral `clickhouse-test` service
 * (Phase 13, BL-06) — the first real ClickHouse read/write test in this codebase.
 */
describe("clickhouse.ts (integration, real ClickHouse)", () => {
  afterEach(async () => {
    await _resetClickHouseForTests();
  });

  it("writes and reads back agent_run_span rows, tenant-scoped and time-ordered", async () => {
    const tenantId = "11111111-1111-7111-8111-111111111111";
    const runId = `run-${Date.now()}`;

    await insertAgentRunSpans({ tenantId }, [
      {
        agentRunId: runId,
        traceId: "trace-abc",
        spanId: "span-2",
        parentSpanId: "span-1",
        name: "tool_call:get_order",
        kind: "ToolCall",
        attributes: { toolName: "get_order" },
        status: "Ok",
        startedAt: new Date(Date.now() + 10),
        durationMs: 55,
      },
      {
        agentRunId: runId,
        traceId: "trace-abc",
        spanId: "span-1",
        parentSpanId: null,
        name: "model_call:goal_selection",
        kind: "ModelCall",
        attributes: { route: "reasoning.planner" },
        status: "Ok",
        startedAt: new Date(),
        durationMs: 120,
      },
    ]);

    const spans = await queryAgentRunSpans({ tenantId }, runId);
    expect(spans).toHaveLength(2);
    // Ordered oldest-first (started_at ASC) regardless of insert order.
    expect(spans.map((s) => s.spanId)).toEqual(["span-1", "span-2"]);
    expect(spans[0]!.kind).toBe("ModelCall");
    expect(spans[1]!.kind).toBe("ToolCall");
    expect(spans.every((s) => s.tenantId === tenantId)).toBe(true);
  });

  it("tenant isolation: a run's spans are invisible under a different tenantId", async () => {
    const tenantA = "22222222-2222-7222-8222-222222222222";
    const tenantB = "33333333-3333-7333-8333-333333333333";
    const runId = `run-${Date.now()}-iso`;

    await insertAgentRunSpans({ tenantId: tenantA }, [
      {
        agentRunId: runId,
        traceId: "trace-iso",
        spanId: "span-1",
        parentSpanId: null,
        name: "agent_run",
        kind: "GraphNode",
        attributes: {},
        status: "Ok",
        startedAt: new Date(),
        durationMs: 1,
      },
    ]);

    const asOwner = await queryAgentRunSpans({ tenantId: tenantA }, runId);
    const asOther = await queryAgentRunSpans({ tenantId: tenantB }, runId);
    expect(asOwner).toHaveLength(1);
    expect(asOther).toHaveLength(0);
  });

  it("returns an empty array (not an error) for a run with no spans yet", async () => {
    const spans = await queryAgentRunSpans({ tenantId: "44444444-4444-7444-8444-444444444444" }, "no-such-run");
    expect(spans).toEqual([]);
  });
});
