"""Unit tests for the structlog redaction processor (FR-PRIV-4)."""

from __future__ import annotations

from avatar_agent.telemetry.logging import _redact_processor, configure_logging


def test_redacts_known_sensitive_keys() -> None:
    event = {"event": "msg", "api_key": "sk-secret", "credential_ref": "secrets/openai", "text": "raw utterance"}
    result = _redact_processor(None, "info", event)
    assert result["api_key"] == "[redacted]"
    assert result["credential_ref"] == "[redacted]"
    assert result["text"] == "[redacted]"


def test_leaves_non_sensitive_keys_untouched() -> None:
    event = {"event": "msg", "session_id": "s1", "code": "STT_UNAVAILABLE"}
    result = _redact_processor(None, "info", event)
    assert result == event


def test_redaction_is_case_insensitive() -> None:
    event = {"Authorization": "Bearer abc"}
    result = _redact_processor(None, "info", event)
    assert result["Authorization"] == "[redacted]"


def test_configure_logging_does_not_raise() -> None:
    configure_logging()
