import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commandMock = vi.fn().mockResolvedValue(undefined);
const insertMock = vi.fn().mockResolvedValue(undefined);
const queryMock = vi.fn();
const closeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@clickhouse/client", () => ({
  createClient: () => ({ command: commandMock, insert: insertMock, query: queryMock, close: closeMock }),
}));

describe("clickhouse.ts (unit, mocked client)", () => {
  beforeEach(() => {
    vi.resetModules();
    commandMock.mockClear();
    insertMock.mockClear();
    queryMock.mockClear();
    process.env.NEXTBOT_DB_ENV = "test";
    process.env.CLICKHOUSE_TEST_URL = "http://fake:fake@localhost:1/nextbot_test";
  });
  afterEach(async () => {
    const mod = await import("./clickhouse.js");
    await mod._resetClickHouseForTests();
    delete process.env.CLICKHOUSE_TEST_URL;
  });

  it("throws ClickHouseUnavailableError (not a silent empty read) when unconfigured", async () => {
    delete process.env.CLICKHOUSE_TEST_URL;
    const { queryAgentRunSpans, ClickHouseUnavailableError } = await import("./clickhouse.js");
    await expect(queryAgentRunSpans({ tenantId: "t1" }, "run-1")).rejects.toBeInstanceOf(ClickHouseUnavailableError);
  });

  it("insertAgentRunSpans forces tenantId from ctx, never trusting the row's own field, and is a no-op for an empty batch", async () => {
    const { insertAgentRunSpans } = await import("./clickhouse.js");
    await insertAgentRunSpans({ tenantId: "t1" }, []);
    expect(insertMock).not.toHaveBeenCalled();

    await insertAgentRunSpans({ tenantId: "t1" }, [
      {
        agentRunId: "run-1",
        traceId: "trace-1",
        spanId: "span-1",
        parentSpanId: null,
        name: "agent_run",
        kind: "ModelCall",
        attributes: {},
        status: "Ok",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        durationMs: 12,
      },
    ]);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const call = insertMock.mock.calls[0]?.[0];
    expect(call?.values[0].tenant_id).toBe("t1");
  });

  it("insertAgentRunSpans fails safe: a ClickHouse write error is logged, never thrown into the caller", async () => {
    insertMock.mockRejectedValueOnce(new Error("connection refused"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { insertAgentRunSpans } = await import("./clickhouse.js");
    await expect(
      insertAgentRunSpans({ tenantId: "t1" }, [
        {
          agentRunId: "run-1",
          traceId: "trace-1",
          spanId: "span-1",
          parentSpanId: null,
          name: "agent_run",
          kind: "ModelCall",
          attributes: {},
          status: "Ok",
          startedAt: new Date(),
          durationMs: 1,
        },
      ]),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("queryAgentRunSpans maps ClickHouse rows back to AgentRunSpanRow, tenant-scoped in the query params", async () => {
    queryMock.mockResolvedValueOnce({
      json: async () => [
        {
          tenant_id: "t1",
          agent_run_id: "run-1",
          trace_id: "trace-1",
          span_id: "span-1",
          parent_span_id: null,
          name: "agent_run",
          kind: "ModelCall",
          attributes: { tool: "get_order" },
          status: "Ok",
          started_at: "2026-01-01 00:00:00.000",
          duration_ms: 42,
        },
      ],
    });
    const { queryAgentRunSpans } = await import("./clickhouse.js");
    const rows = await queryAgentRunSpans({ tenantId: "t1" }, "run-1");
    expect(rows).toEqual([
      {
        tenantId: "t1",
        agentRunId: "run-1",
        traceId: "trace-1",
        spanId: "span-1",
        parentSpanId: null,
        name: "agent_run",
        kind: "ModelCall",
        attributes: { tool: "get_order" },
        status: "Ok",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        durationMs: 42,
      },
    ]);
    expect(queryMock.mock.calls[0]?.[0].query_params).toEqual({ tenantId: "t1", agentRunId: "run-1" });
  });

  it("queryAgentRunSpans wraps a query failure in ClickHouseUnavailableError", async () => {
    queryMock.mockRejectedValueOnce(new Error("timeout"));
    const { queryAgentRunSpans, ClickHouseUnavailableError } = await import("./clickhouse.js");
    await expect(queryAgentRunSpans({ tenantId: "t1" }, "run-1")).rejects.toBeInstanceOf(ClickHouseUnavailableError);
  });
});
