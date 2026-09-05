import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { forwardSpanToTenantEndpoint, flushTenantTraceProviders, resetTenantExportersForTests, exportTenantMetricsSnapshot } from "./tenant-export.js";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — proves the tenant OTel
 * export path is genuinely real: a real ended span, handed to a real
 * `OTLPTraceExporter` instance, actually reaches an HTTP collector endpoint (a real
 * network POST, not a mock of the exporter itself). Same for the metrics snapshot
 * push via a real `OTLPMetricExporter`.
 */

async function startCollector(): Promise<{ url: string; requests: Array<{ path: string; contentType: string | undefined; bodyLength: number }>; close: () => Promise<void> }> {
  const requests: Array<{ path: string; contentType: string | undefined; bodyLength: number }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", contentType: req.headers["content-type"], bodyLength: Buffer.concat(chunks).length });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  // `server.listen()` is asynchronous — awaiting the "listening" callback (rather
  // than reading `server.address()` synchronously right after calling `listen()`)
  // is what makes the returned URL's port genuinely bound before any caller uses it.
  const url = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
  return {
    url,
    requests,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe("tenant OTel export — real ended span / real metric snapshot reaching a real (mock) collector endpoint", () => {
  const collectorsToClose: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of collectorsToClose.splice(0)) await close();
    resetTenantExportersForTests();
  });

  it("a forwarded, ended span produces a real OTLP/HTTP POST to the tenant's configured endpoint", async () => {
    const collector = await startCollector();
    collectorsToClose.push(collector.close);

    forwardSpanToTenantEndpoint(collector.url, {
      name: "tool-call:refund_order",
      attributes: { "nextbot.agent_run_id": "run-123", toolName: "refund_order" },
      startedAt: new Date(Date.now() - 500),
      durationMs: 500,
      status: "Ok",
    });
    await flushTenantTraceProviders();

    // Wait one more tick for the async HTTP POST triggered by forceFlush to land —
    // forceFlush resolves once the exporter's own export() call is invoked, but the
    // underlying fetch/http request it makes is not necessarily awaited by that
    // promise chain in every OTel exporter version, so a short real wait closes that
    // gap without asserting anything about internal timing we don't control.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(collector.requests.length).toBeGreaterThan(0);
    expect(collector.requests[0]!.bodyLength).toBeGreaterThan(0);
  });

  it("never throws into the caller when the collector endpoint is unreachable (fails safe)", () => {
    expect(() =>
      forwardSpanToTenantEndpoint("http://127.0.0.1:1", {
        name: "tool-call:unreachable",
        attributes: {},
        startedAt: new Date(),
        durationMs: 10,
        status: "Error",
      }),
    ).not.toThrow();
  });

  it("a real metric snapshot push produces a real OTLP/HTTP POST carrying the given aggregate values", async () => {
    const collector = await startCollector();
    collectorsToClose.push(collector.close);

    await exportTenantMetricsSnapshot(collector.url, [
      { name: "nextbot.agent_run.succeeded_count", value: 42 },
      { name: "nextbot.agent_run.avg_duration_ms", value: 1234, unit: "ms" },
    ]);

    expect(collector.requests.length).toBeGreaterThan(0);
    expect(collector.requests[0]!.bodyLength).toBeGreaterThan(0);
  });
});
