import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — unit-level proof of
 * this file's own wiring: `startTurnRun` resolves the tenant's OTel export endpoint
 * ONCE (not re-queried per child span) and caches it on the handle; `recordTurnSpan`
 * forwards a mirrored span only when that endpoint is present, and never when it
 * isn't (the overwhelmingly common case — opt-in, default disabled). The real,
 * non-mocked proof that a forwarded span actually reaches a real collector lives in
 * `@nextbot/observability`'s own `tenant-export.int.test.ts`; this test is scoped to
 * THIS file's own conditional-forwarding logic, with the DB/OTel-SDK boundary faked
 * per this project's "unit tests use fakes for anything crossing a boundary" rule.
 */

const startAgentRunMock = vi.fn();
const completeAgentRunMock = vi.fn();
const forwardSpanToTenantEndpointMock = vi.fn();
const getEffectiveOtelExportEndpointMock = vi.fn();
const insertAgentRunSpansMock = vi.fn();

vi.mock("@nextbot/agent-platform", () => ({
  startAgentRun: (...args: unknown[]) => startAgentRunMock(...args),
  completeAgentRun: (...args: unknown[]) => completeAgentRunMock(...args),
}));
vi.mock("@nextbot/telemetry-export", () => ({
  getEffectiveOtelExportEndpoint: (...args: unknown[]) => getEffectiveOtelExportEndpointMock(...args),
}));
vi.mock("@nextbot/db/clickhouse", () => ({
  insertAgentRunSpans: (...args: unknown[]) => insertAgentRunSpansMock(...args),
}));
vi.mock("@nextbot/observability", () => ({
  startSpan: () => ({ spanContext: () => ({ spanId: "fake-span-id" }) }),
  endSpanOk: vi.fn(),
  endSpanError: vi.fn(),
  forwardSpanToTenantEndpoint: (...args: unknown[]) => forwardSpanToTenantEndpointMock(...args),
}));

const ctx = { tenantId: "tenant-1", region: "US" as const, environment: "Sandbox" as const };

describe("agent-run-tracing.ts — tenant OTel export wiring (unit, boundaries faked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startAgentRunMock.mockResolvedValue({ run: { id: "run-1", otelTraceId: "trace-1" }, span: { spanContext: () => ({ spanId: "root-span-id" }) } });
  });

  it("resolves the tenant's OTel export endpoint ONCE, at startTurnRun, and caches it on the handle", async () => {
    getEffectiveOtelExportEndpointMock.mockResolvedValue("https://collector.example.com");
    const { startTurnRun } = await import("./agent-run-tracing.js");

    const handle = await startTurnRun(ctx, { agentDefinitionVersionId: "v1", trigger: "CustomerMessage" });

    expect(getEffectiveOtelExportEndpointMock).toHaveBeenCalledTimes(1);
    expect(handle.otelExportEndpoint).toBe("https://collector.example.com");
  });

  it("recordTurnSpan forwards a mirrored span when the handle carries a configured endpoint", async () => {
    getEffectiveOtelExportEndpointMock.mockResolvedValue("https://collector.example.com");
    const { startTurnRun, recordTurnSpan } = await import("./agent-run-tracing.js");
    const handle = await startTurnRun(ctx, { agentDefinitionVersionId: "v1", trigger: "CustomerMessage" });

    await recordTurnSpan(ctx, handle, { kind: "ToolCall", name: "tool-call:refund_order", attributes: { toolName: "refund_order" }, startedAt: new Date(), durationMs: 42, status: "Ok" });

    expect(forwardSpanToTenantEndpointMock).toHaveBeenCalledTimes(1);
    expect(forwardSpanToTenantEndpointMock).toHaveBeenCalledWith(
      "https://collector.example.com",
      expect.objectContaining({ name: "tool-call:refund_order", durationMs: 42, status: "Ok" }),
    );
    // Additive, never a replacement: the existing ClickHouse write still happens.
    expect(insertAgentRunSpansMock).toHaveBeenCalledTimes(1);
  });

  it("recordTurnSpan does NOT forward anything when the tenant has no OTel export configured (the default, overwhelmingly common case)", async () => {
    getEffectiveOtelExportEndpointMock.mockResolvedValue(null);
    const { startTurnRun, recordTurnSpan } = await import("./agent-run-tracing.js");
    const handle = await startTurnRun(ctx, { agentDefinitionVersionId: "v1", trigger: "CustomerMessage" });
    expect(handle.otelExportEndpoint).toBeNull();

    await recordTurnSpan(ctx, handle, { kind: "ModelCall", name: "model-call", attributes: {}, startedAt: new Date(), durationMs: 10, status: "Ok" });

    expect(forwardSpanToTenantEndpointMock).not.toHaveBeenCalled();
    // Still writes to ClickHouse — disabling tenant export changes nothing about the
    // existing in-console trace experience.
    expect(insertAgentRunSpansMock).toHaveBeenCalledTimes(1);
  });
});
