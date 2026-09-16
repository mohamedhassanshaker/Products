"""OpenTelemetry wiring for shj3-ai.

architecture.md §10 and deployment.md §13.1: one trace id spans web -> ai ->
tool call. This package is the only place in the Python codebase that imports
``opentelemetry.*`` for the SDK and instrumentation surface — the ``domain``
and ``application`` layers stay vendor-free (the swap test,
``pyproject.toml``'s import-linter "forbidden" contract), and
``shj3_ai.domain.tenancy.TenantContext.trace_id`` keeps receiving a trace id
as a plain string rather than importing OpenTelemetry itself.
"""
