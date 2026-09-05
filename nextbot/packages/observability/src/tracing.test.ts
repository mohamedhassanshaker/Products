import { afterEach, describe, expect, it } from "vitest";
import { endSpanError, endSpanOk, initTracing, resetTracingForTests, shutdownTracing, startSpan, traceIdOf } from "./tracing.js";

describe("@nextbot/observability tracing (FR-AGT-09 — OTel SDK/exporter plumbing)", () => {
  afterEach(async () => {
    await shutdownTracing();
    resetTracingForTests();
  });

  it("initTracing() is idempotent — calling it twice does not throw or double-register", () => {
    expect(() => {
      initTracing("test-service");
      initTracing("test-service");
    }).not.toThrow();
  });

  it("startSpan() produces a span with a genuine 32-hex-char OTel trace id", () => {
    initTracing("test-service");
    const span = startSpan("agent_run.turn", { tenantId: "t1", agentRunId: "r1" });
    const traceId = traceIdOf(span);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    endSpanOk(span);
  });

  it("endSpanError() does not throw when given an error message", () => {
    initTracing("test-service");
    const span = startSpan("agent_run.turn", {});
    expect(() => endSpanError(span, "boom")).not.toThrow();
  });

  it("shutdownTracing() resolves cleanly even when tracing was never initialized", async () => {
    await expect(shutdownTracing()).resolves.toBeUndefined();
  });
});
