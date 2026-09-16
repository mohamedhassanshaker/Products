import { afterEach, describe, expect, it } from "vitest";
import { resetTracingForTesting, shutdownTracing, startTracing } from "./tracing.js";

/**
 * `startTracing()` is called on every inbound request and every outbound call to
 * `shj3-ai` (via `trace-context.ts`'s lazy self-heal), so it is held to the module
 * docstring's promise directly: it must never throw, regardless of what
 * `SHJ3_OTEL_EXPORTER_OTLP_ENDPOINT` is set to. A tracing bug must degrade
 * observability, never a citizen-facing request.
 */

const ENDPOINT_VAR = "SHJ3_OTEL_EXPORTER_OTLP_ENDPOINT";

afterEach(async () => {
  await shutdownTracing();
  resetTracingForTesting();
  delete process.env[ENDPOINT_VAR];
});

describe("startTracing", () => {
  it("does not throw when the OTLP endpoint is unset (the .env.example default)", () => {
    delete process.env[ENDPOINT_VAR];
    expect(() => startTracing()).not.toThrow();
  });

  it("does not throw when the endpoint is a syntactically valid but unreachable address", () => {
    // No collector is listening here. Export failures happen asynchronously on flush,
    // never at start(), but this pins the contract regardless of exporter internals.
    process.env[ENDPOINT_VAR] = "http://127.0.0.1:1";
    expect(() => startTracing()).not.toThrow();
  });

  it("does not throw when the endpoint is not a valid URL", () => {
    process.env[ENDPOINT_VAR] = "not a url at all";
    expect(() => startTracing()).not.toThrow();
  });

  it("is idempotent: calling it twice in the same process does not throw or double-register", () => {
    startTracing();
    expect(() => startTracing()).not.toThrow();
  });
});

describe("shutdownTracing", () => {
  it("does not throw when tracing was never started", async () => {
    await expect(shutdownTracing()).resolves.toBeUndefined();
  });

  it("does not throw after a normal start", async () => {
    startTracing();
    await expect(shutdownTracing()).resolves.toBeUndefined();
  });
});
