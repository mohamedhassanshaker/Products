"""Process-wide OpenTelemetry SDK bootstrap and inbound instrumentation.

Why this exists
----------------
deployment.md §13.1: OpenTelemetry in both runtimes, W3C ``traceparent``
propagated end to end. On this side that means initialising a
``TracerProvider`` (with an OTLP exporter when one is configured) and
instrumenting the FastAPI app with ``opentelemetry-instrumentation-fastapi``,
which extracts an inbound ``traceparent`` automatically through
OpenTelemetry's own context propagation — no hand-rolled header parsing,
matching the web tier's use of ``@opentelemetry/api``'s propagation API
(``apps/web/src/modules/platform/observability/trace-context.ts``).

Why failures here are swallowed, not raised
--------------------------------------------
``SHJ3_OTEL_EXPORTER_OTLP_ENDPOINT`` is empty in ``.env.example`` — local
development runs with no collector — and even in a deployed environment an
unreachable collector must not become a citizen-facing incident. Tracing is
observability, never a request-path dependency: ``SHJ3_OTEL_EXPORTER_OTLP_
ENDPOINT`` is not among the variables deployment.md §4.1 requires the process
to refuse to boot over, so ``configure_tracing`` never raises. A
configuration problem is logged once and the process keeps serving traffic.
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.id_generator import RandomIdGenerator
from opentelemetry.semconv.resource import ResourceAttributes

if TYPE_CHECKING:
    from fastapi import FastAPI

logger = logging.getLogger(__name__)

_SERVICE_NAME = "shj3-ai"

# See the equivalent comment in the web tier's tracing.ts: deployment.md documents the
# unprefixed OTEL_EXPORTER_OTLP_ENDPOINT, but every process-configuration variable this
# codebase actually reads carries the SHJ3_ prefix (.env.example), which is the source of
# truth a developer's machine boots from.
_OTLP_ENDPOINT_VAR = "SHJ3_OTEL_EXPORTER_OTLP_ENDPOINT"

_configured = False


def configure_tracing() -> None:
    """Initialise the process-wide ``TracerProvider``.

    Idempotent and never raises — see the module docstring. Safe to call more
    than once (test setup, a future ``shj3_ai.entrypoint`` calling it
    alongside :func:`instrument_fastapi_app`): a second call is a no-op.
    """
    global _configured
    if _configured:
        return

    endpoint = os.environ.get(_OTLP_ENDPOINT_VAR, "").strip()

    # Everything, including exporter construction — not just registration — is inside
    # the try block. A malformed endpoint string rejected by the exporter's own
    # constructor is exactly the kind of configuration problem this function exists to
    # survive.
    try:
        resource = Resource.create(
            {
                ResourceAttributes.SERVICE_NAME: _SERVICE_NAME,
                ResourceAttributes.SERVICE_VERSION: os.environ.get("SHJ3_RELEASE_VERSION", "dev"),
                ResourceAttributes.DEPLOYMENT_ENVIRONMENT: os.environ.get(
                    "SHJ3_ENVIRONMENT", "development"
                ),
            }
        )
        provider = TracerProvider(resource=resource)

        if endpoint:
            # OTLPSpanExporter's `endpoint` is the whole request URL, not just the
            # collector host, so the signal-specific suffix is added here — the same
            # choice the web side makes in tracing.ts, for the same reason: deployment.md
            # documents the bare collector address.
            exporter = OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces")
            provider.add_span_processor(BatchSpanProcessor(exporter))
        else:
            logger.info(
                "%s is not set; spans are recorded but not exported. This is the expected "
                "development default (.env.example).",
                _OTLP_ENDPOINT_VAR,
            )

        trace.set_tracer_provider(provider)
    except Exception:
        # Deliberately broad — see the module docstring. A tracing-setup failure of any
        # kind must degrade to "no export", never take the process down with it.
        logger.exception(
            "shj3-ai: failed to start the OpenTelemetry SDK; continuing without tracing."
        )
        return

    _configured = True


def reset_tracing_for_testing() -> None:
    """Drop the "already configured" flag so a test can call ``configure_tracing`` again.

    Mirrors ``platform/config.ts``'s ``resetConfigForTesting`` on the web side. Production
    tracing is configure-once-per-process; this exists purely so different tests can
    exercise :func:`configure_tracing`'s full body (an unset endpoint, an unreachable one,
    …) instead of every test after the first hitting the idempotency guard. It does not
    reset OpenTelemetry's own global tracer-provider registration — a second
    ``set_tracer_provider`` call against an already-configured global is itself a safe,
    logged no-op, which is what makes that safe to leave alone.
    """
    global _configured
    _configured = False


def instrument_fastapi_app(app: FastAPI) -> None:
    """Instrument ``app`` so inbound ``traceparent`` headers are extracted automatically.

    ``FastAPIInstrumentor`` reads the ASGI scope's headers through
    ``opentelemetry.propagate`` — the globally registered propagator, W3C
    tracecontext by default — and starts a server span whose trace id is the
    propagated one when a valid ``traceparent`` is present, or a freshly
    generated root trace id otherwise. That extract-or-generate behaviour is
    deployment.md §13.1 rule 1, achieved with library code rather than a
    hand-rolled header parse.
    """
    FastAPIInstrumentor.instrument_app(app)


def current_trace_id() -> str:
    """The active span's trace id, as 32 lowercase hex characters.

    Falls back to a freshly generated, valid W3C trace id when there is no
    active span — called before :func:`instrument_fastapi_app` has run, or
    outside a request entirely (a worker job establishing its own trace, per
    deployment.md §13.1 rule 5). Never raises: this backs a FastAPI
    dependency on the request path (``adapters/inbound/trace_context.py``),
    and a tracing bug must not become a 500.
    """
    span_context = trace.get_current_span().get_span_context()
    if span_context.is_valid:
        return trace.format_trace_id(span_context.trace_id)
    return trace.format_trace_id(RandomIdGenerator().generate_trace_id())
