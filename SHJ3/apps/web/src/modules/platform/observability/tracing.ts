/**
 * OpenTelemetry SDK bootstrap for `shj3-web`.
 *
 * architecture.md §10: "One trace id spans web → ai → tool call, which is
 * what makes B14 tab 3 real rather than decorative." deployment.md §13.1
 * makes the mechanism a contract rather than a hope: OpenTelemetry in both
 * runtimes, W3C `traceparent` propagated end to end.
 *
 * This module owns every vendor import the tracing story needs on this side
 * — `@opentelemetry/sdk-node`, its OTLP exporter, and the resource helpers.
 * Everything downstream (`trace-context.ts`'s inbound extraction and
 * outbound injection, in turn used by the auth middleware and the AI client)
 * talks to `@opentelemetry/api` only — the same thin surface both runtimes'
 * SDKs speak — so neither hand-parses the other's header (deployment.md
 * §13.1 rule 1: propagation lives in one place, not per call site).
 *
 * ## Why this can never be a request-path dependency
 *
 * `SHJ3_OTEL_EXPORTER_OTLP_ENDPOINT` is deliberately empty in `.env.example`
 * — local development has no collector running — and even in a deployed
 * environment the collector can be unreachable without that being a citizen
 * -facing incident. `startTracing()` therefore never throws: a configuration
 * or export problem is logged once and the process keeps serving traffic
 * without spans leaving the building, rather than refusing to boot the way
 * `platform/config.ts` refuses to boot over a missing *required* secret.
 * Observability is a nice-to-have on the request path; it is not on the list
 * of things deployment.md §4.1 requires the process to die for.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import type { NodeSDKConfiguration } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

/** Matches `OTEL_RESOURCE_ATTRIBUTES`'s `service.name` in deployment.md §4.2 #68. */
const SERVICE_NAME = "shj3-web";

/**
 * deployment.md documents the OTLP endpoint as the unprefixed
 * `OTEL_EXPORTER_OTLP_ENDPOINT` (#67), but `.env.example` and every other
 * process-configuration variable in this codebase carries the `SHJ3_` prefix
 * (`SHJ3_SQL_URL`, `SHJ3_AI_BASE_URL`, …) rather than relying on a vendor
 * SDK's own auto-detected names. This module follows the codebase's actual
 * convention — `.env.example` is the source of truth for what a developer's
 * machine reads — over the doc's naming, which is the one place the two
 * disagree.
 */
const OTLP_ENDPOINT_VAR = "SHJ3_OTEL_EXPORTER_OTLP_ENDPOINT";

/**
 * `deployment.environment` (deployment.md §4.2 #68's `OTEL_RESOURCE_ATTRIBUTES`
 * example). This is an OpenTelemetry *experimental* resource semantic
 * convention, so it is not re-exported from `@opentelemetry/semantic-
 * conventions`'s stable entry point the way `ATTR_SERVICE_NAME` is — hence
 * the literal here rather than a second, incubating import.
 */
const ATTR_DEPLOYMENT_ENVIRONMENT = "deployment.environment";

let sdk: NodeSDK | null = null;

/**
 * Start the process-wide `TracerProvider` and register the W3C propagator.
 *
 * Idempotent and safe to call from more than one place: Next.js can load
 * this module several times per process (route handlers, middleware, the
 * `instrumentation.ts` boot hook, and `trace-context.ts`'s own lazy
 * self-heal on first use), and a second `NodeSDK.start()` would otherwise
 * try to re-register a global tracer provider and propagator, which the API
 * tolerates but logs a warning for on every call.
 */
export function startTracing(): void {
  if (sdk !== null) return;

  const endpoint = process.env[OTLP_ENDPOINT_VAR]?.trim();

  // Everything, including construction — not just `start()` — is inside the try block.
  // An exporter or SDK constructor rejecting a malformed endpoint string is exactly the
  // kind of configuration problem this function exists to survive (module docstring).
  try {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: process.env.SHJ3_RELEASE_VERSION ?? "dev",
      [ATTR_DEPLOYMENT_ENVIRONMENT]: process.env.SHJ3_ENVIRONMENT ?? "development",
    });

    const configuration: Partial<NodeSDKConfiguration> = { resource };
    if (endpoint) {
      // The exporter's `url` option is the *whole* request URL, not just the collector
      // host — unlike the auto env-detected path, which appends the signal-specific
      // suffix itself. deployment.md documents the bare collector address
      // (`http://otel-collector…:4317`), so that suffix is added here to keep the
      // documented variable meaning "collector address" rather than "full traces
      // endpoint".
      configuration.traceExporter = new OTLPTraceExporter({
        url: `${endpoint.replace(/\/+$/, "")}/v1/traces`,
      });
    }

    const candidate = new NodeSDK(configuration);
    candidate.start();
    sdk = candidate;
  } catch (error) {
    // Never throw out of here — see the module docstring. A failed start leaves no
    // propagator registered, which degrades `trace-context.ts` to "every request starts
    // a fresh trace" rather than crashing anything.
    console.error(
      `[observability] failed to start the OpenTelemetry SDK for ${SERVICE_NAME}; ` +
        "continuing without tracing.",
      error,
    );
    return;
  }

  if (!endpoint) {
    console.info(
      `[observability] ${OTLP_ENDPOINT_VAR} is not set; spans are recorded but not exported. ` +
        "This is the expected development default (.env.example).",
    );
  }
}

/**
 * Flush buffered spans and stop the SDK.
 *
 * Best-effort: a failed flush on shutdown must not turn a clean process exit
 * into a crashed one, so the error is logged and swallowed rather than
 * propagated.
 */
export async function shutdownTracing(): Promise<void> {
  const active = sdk;
  sdk = null;
  if (!active) return;

  try {
    await active.shutdown();
  } catch (error) {
    console.error("[observability] failed to flush spans on shutdown", error);
  }
}

/**
 * Drop the cached SDK handle so a test can call `startTracing()` again.
 *
 * Mirrors `platform/config.ts`'s `resetConfigForTesting` — production tracing is
 * start-once-per-process, and this exists purely so different tests can exercise
 * `startTracing()`'s full body (an unset endpoint, an unreachable one, …) instead of every
 * test after the first hitting the idempotency guard. It does not unregister the global
 * OpenTelemetry API state, only this module's own "already started" flag; re-calling
 * `NodeSDK.start()` against an already-registered global provider is itself a safe no-op
 * (a swallowed diagnostic, not a throw), which is what makes that safe to leave alone.
 */
export function resetTracingForTesting(): void {
  sdk = null;
}
