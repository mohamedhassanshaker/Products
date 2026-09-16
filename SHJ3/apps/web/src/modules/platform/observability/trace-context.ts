/**
 * W3C `traceparent` extraction and injection, via `@opentelemetry/api`.
 *
 * architecture.md §10 and deployment.md §13.1: one trace id spans web → ai →
 * tool call. This module is where that contract is implemented for the web
 * tier's two ends of the hop:
 *
 *  - **Inbound** (`extractTraceId`): the auth middleware
 *    (`modules/iam/adapters/inbound/auth-middleware.ts`) calls this to read
 *    an inbound `traceparent`, falling back to a freshly minted root trace
 *    when one is absent or invalid.
 *  - **Outbound** (`injectTraceparent`): the AI client
 *    (`modules/platform/adapters/outbound/ai-client.ts`) calls this to carry
 *    the bound trace id onto the request that continues it into `shj3-ai`.
 *
 * ## Why `@opentelemetry/api` and not a hand-rolled parser
 *
 * The propagation contract chosen for this hop (see the module comment in
 * `ai-client.ts`) is the W3C standard specifically because OpenTelemetry's
 * own SDKs speak it natively in both Node and Python. Using
 * `propagation.extract` / `propagation.inject` here means the actual header
 * grammar — version byte, 32-hex trace id, 16-hex parent id, flags, and the
 * "reject an all-zero id" rule — is the library's problem, not a regex this
 * file has to get right and keep in sync with the spec. `tracing.ts`
 * registers the real `W3CTraceContextPropagator` globally when
 * `startTracing()` runs; both functions below call it defensively on entry
 * so they are correct even if that boot hook was skipped (a test runner, a
 * script), matching `ai-client.ts`'s own "lazy so a missing thing fails at
 * first use, not at import" style.
 *
 * ## Why `injectTraceparent` still has a hand-written fallback line
 *
 * `TenantContext.traceId` (`tenancy/tenant-context.ts`) is typed as a plain
 * `string`, deliberately: domain and application code must not know it is a
 * W3C id. Sourced through this module's own `extractTraceId` or the auth
 * middleware's `newTraceId` fallback, it always *is* one — but a value built
 * directly (a test, or future code that has not gone through the
 * middleware) might not be. `W3CTraceContextPropagator.inject` silently
 * skips writing a header when it is handed an invalid span context, which is
 * correct for a propagator but wrong for a client we need to always carry
 * *some* trace id — a request with no `traceparent` at all is worse than one
 * whose id was coerced into shape. So this file normalises first and only
 * falls back to writing the header by hand for the case the library
 * deliberately refuses: see `toSpanContext` and its use below.
 */

import {
  ROOT_CONTEXT,
  TraceFlags,
  isSpanContextValid,
  propagation,
  trace,
} from "@opentelemetry/api";
import type { SpanContext } from "@opentelemetry/api";
import { startTracing } from "./tracing.js";

/**
 * Read a trace id from inbound headers via the registered `traceparent`
 * propagator.
 *
 * Returns `undefined` — never throws, never fabricates — when there is no
 * header, or when what is present fails W3C validation (wrong shape, an
 * all-zero trace or span id, an unsupported version byte with trailing
 * data). Both cases mean the same thing to the caller: this request starts a
 * new trace here, so mint a root id instead.
 */
export function extractTraceId(
  headers: Readonly<Record<string, string | undefined>>,
): string | undefined {
  startTracing();

  const spanContext = trace.getSpanContext(propagation.extract(ROOT_CONTEXT, headers));
  return spanContext && isSpanContextValid(spanContext) ? spanContext.traceId : undefined;
}

/**
 * Write `traceId` onto `carrier` as a `traceparent` header, so the receiving
 * service continues this trace instead of starting its own.
 *
 * `carrier` is mutated in place (the shape `propagation.inject` expects for
 * a plain headers object) rather than returned, so callers building a larger
 * headers object can call this alongside their other `carrier[key] = value`
 * assignments without restructuring around a return value.
 */
export function injectTraceparent(traceId: string, carrier: Record<string, string>): void {
  startTracing();

  const spanContext = toSpanContext(traceId);
  if (!isSpanContextValid(spanContext)) {
    // See the module docstring: the library will not emit a header for an
    // invalid context, and an untraced hop is a worse outcome than an
    // all-zero placeholder id. This is the one line in this file that knows
    // the wire format, and it exists only for that narrow, defensive case.
    carrier.traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-01`;
    return;
  }

  propagation.inject(trace.setSpanContext(ROOT_CONTEXT, spanContext), carrier);
}

/**
 * Coerce an arbitrary string into a valid-shaped `SpanContext`.
 *
 * Strips everything but hex digits and pads or truncates to the required
 * lengths, so a trace id sourced from somewhere that never promised W3C
 * shape (a ULID, say) still produces a well-formed `traceparent` rather than
 * a malformed one — some collectors drop a header they cannot parse
 * silently, which would be a harder failure to notice than a coerced id.
 * The span id is derived from the same hex material rather than randomly
 * generated: this client does not track a real span hierarchy, only a trace
 * id, so a stable derivation is preferable to inventing a parent span that
 * corresponds to nothing.
 */
function toSpanContext(traceId: string): SpanContext {
  const hex = traceId.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return {
    traceId: hex.padEnd(32, "0").slice(0, 32),
    spanId: hex.slice(-16).padStart(16, "0"),
    traceFlags: TraceFlags.SAMPLED,
  };
}
