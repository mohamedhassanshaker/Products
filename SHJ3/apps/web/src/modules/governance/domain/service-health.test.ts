import { describe, expect, it } from "vitest";
import { deriveHealthStatus, errorRateOf, p95 } from "./service-health.js";

describe("service-health domain", () => {
  it("derives Degraded when error rate exceeds the global 5% threshold", () => {
    expect(deriveHealthStatus({ errorRate: 0.061, p95LatencyMs: 100, targetKey: null })).toBe(
      "Degraded",
    );
  });

  it("derives Degraded when p95 latency exceeds a named target's own budget", () => {
    expect(
      deriveHealthStatus({ errorRate: 0.001, p95LatencyMs: 1840, targetKey: "sewa-bill-api" }),
    ).toBe("Degraded");
  });

  it("derives Healthy within both thresholds using the global default budget", () => {
    expect(deriveHealthStatus({ errorRate: 0.002, p95LatencyMs: 240, targetKey: null })).toBe(
      "Healthy",
    );
  });

  it("uses the wireframe's named MCP tool budget (300ms), not the global default", () => {
    expect(deriveHealthStatus({ errorRate: 0, p95LatencyMs: 310, targetKey: "mcp-tool" })).toBe(
      "Degraded",
    );
    expect(deriveHealthStatus({ errorRate: 0, p95LatencyMs: 290, targetKey: "mcp-tool" })).toBe(
      "Healthy",
    );
  });

  it("p95 returns 0 for an empty sample rather than NaN", () => {
    expect(p95([])).toBe(0);
  });

  it("p95 is nearest-rank over a real sample", () => {
    expect(p95([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000])).toBe(1000);
  });

  it("errorRateOf returns 0 for an empty total rather than dividing by zero", () => {
    expect(errorRateOf(0, 0)).toBe(0);
  });
});
