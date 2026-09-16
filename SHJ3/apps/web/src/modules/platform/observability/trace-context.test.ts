import { afterEach, describe, expect, it } from "vitest";
import { resetTracingForTesting, startTracing } from "./tracing.js";
import { extractTraceId, injectTraceparent } from "./trace-context.js";

/**
 * The property that matters is not "a header gets set" — it is "the id that goes out on
 * `injectTraceparent` is the same id `extractTraceId` reads back", because that is what
 * makes a trace begun at shj3-web the same trace `shj3-ai` continues (architecture.md
 * §10, deployment.md §13.1). `ai-client.test.ts` already proves the AI client calls this
 * module; the round-trip test below is what proves the module itself is correct.
 */

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

// The registered propagator is what does the real work here (see the module docstring's
// case for using @opentelemetry/api over a hand-rolled parser), so it has to be started
// before either function is exercised directly — production gets this from the lazy
// self-heal inside extractTraceId/injectTraceparent, which this also incidentally proves.
afterEach(() => {
  resetTracingForTesting();
});

describe("round trip", () => {
  it("extracts exactly the trace id that was injected", () => {
    startTracing();
    const carrier: Record<string, string> = {};

    injectTraceparent(TRACE_ID, carrier);
    const extracted = extractTraceId(carrier);

    expect(extracted).toBe(TRACE_ID);
  });

  it("round-trips without startTracing() having been called first", () => {
    // Neither function may depend on the app's boot sequence having run.
    const carrier: Record<string, string> = {};

    injectTraceparent(TRACE_ID, carrier);
    expect(extractTraceId(carrier)).toBe(TRACE_ID);
  });
});

describe("injectTraceparent", () => {
  it("writes a well-formed W3C traceparent, sampled, carrying the trace id verbatim", () => {
    const carrier: Record<string, string> = {};
    injectTraceparent(TRACE_ID, carrier);
    // The span id is derived from the same hex material as the trace id (see
    // trace-context.ts's toSpanContext) — the last 16 of its 32 hex characters.
    expect(carrier.traceparent).toBe(`00-${TRACE_ID}-${TRACE_ID.slice(-16)}-01`);
  });

  it("normalises a non-hex trace id into a valid traceparent instead of dropping it", () => {
    // A ULID request id is not hex. The library propagator refuses to emit a header for
    // an invalid span context (see the module docstring) — this is the defensive path
    // that keeps a hop from going out with no traceparent at all.
    const carrier: Record<string, string> = {};
    injectTraceparent("01JBQ7X2K9ZZZZZZZZZZZZZZZZ", carrier);
    expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("mutates the carrier in place rather than requiring a return value", () => {
    const carrier: Record<string, string> = { "x-request-id": TRACE_ID };
    injectTraceparent(TRACE_ID, carrier);
    expect(carrier["x-request-id"]).toBe(TRACE_ID);
    expect(carrier.traceparent).toBeDefined();
  });
});

describe("extractTraceId", () => {
  it("returns undefined when there is no traceparent header", () => {
    expect(extractTraceId({})).toBeUndefined();
  });

  it("returns undefined for a malformed traceparent rather than throwing", () => {
    expect(extractTraceId({ traceparent: "not-a-traceparent" })).toBeUndefined();
  });

  it("returns undefined for the reserved all-zero trace id", () => {
    expect(
      extractTraceId({ traceparent: "00-00000000000000000000000000000000-00f067aa0ba902b7-01" }),
    ).toBeUndefined();
  });

  it("reads a real inbound traceparent, unrelated to injectTraceparent", () => {
    expect(extractTraceId({ traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-01` })).toBe(TRACE_ID);
  });
});
