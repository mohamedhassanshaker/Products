"""structlog configuration (LLD §10.7) — JSON logs, one shared field set
(`request_id`, `tenant_id`, `session_id`, `actor_id`, `code`). Never logged
at any level: secret values, tokens, or raw STT/LLM text at `info`+
(FR-PRIV-4) — callers must pass only redacted/summary fields, never full
utterance text, to any log call.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, MutableMapping
from typing import Any

import structlog

_REDACT_KEYS = frozenset({"api_key", "credential_ref", "token", "authorization", "text", "transcript"})


def _redact_processor(_logger: Any, _method_name: str, event_dict: MutableMapping[str, Any]) -> Mapping[str, Any]:
    """Drops known-sensitive keys before a log line is emitted (FR-PRIV-4).

    Typed to match structlog's own `Processor` protocol exactly (params
    `Any`/`str`/`MutableMapping[str, Any]`, return `Mapping[str, Any]`) —
    the previous narrower `dict[str, object]` signature was structurally
    incompatible with `structlog.configure(processors=[...])`'s declared
    element type, which mypy correctly flagged.
    """
    for key in list(event_dict.keys()):
        if key.lower() in _REDACT_KEYS:
            event_dict[key] = "[redacted]"
    return event_dict


def configure_logging(level: int = logging.INFO) -> None:
    """Configures structlog for JSON output with redaction applied first."""
    structlog.configure(
        processors=[
            _redact_processor,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )
