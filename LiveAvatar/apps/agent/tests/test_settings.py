"""Unit tests for env settings (LLD §7.4)."""

from __future__ import annotations

from avatar_agent.settings import load_settings


def test_load_settings_applies_documented_defaults(monkeypatch) -> None:
    for var in [
        "AI_PROVIDER",
        "AI_MODEL_CONVERSATION",
        "CONTROL_PLANE_INTERNAL_URL",
        "INTERNAL_TOKEN",
        "LIVEKIT_URL",
        "AGENT_NAME",
    ]:
        monkeypatch.delenv(var, raising=False)
    settings = load_settings()
    assert settings.agent_name == "avatar-agent"
    assert settings.livekit_url.startswith("ws://")
    assert settings.max_concurrent_jobs > 0


def test_load_settings_reads_env_overrides(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_NAME", "custom-agent")
    monkeypatch.setenv("MAX_CONCURRENT_JOBS", "42")
    settings = load_settings()
    assert settings.agent_name == "custom-agent"
    assert settings.max_concurrent_jobs == 42
