"""Process environment for the agent worker (LLD §7.4), validated at boot via
`pydantic-settings` (ADR-001 §7 — Pydantic is the Python schema library).
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env-driven configuration. Never logged in full (secrets included)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Dev/preview-only defaults when a tenant config is absent — production
    # concrete model ids always come from the tenant's published config
    # (LLD §7.2's "no vendor model id appears anywhere in code" rule).
    ai_provider: str = "openai"
    ai_model_conversation: str = "gpt-4o-mini"
    ai_model_summary: str = "gpt-4o-mini"
    ai_base_url: str | None = None
    ai_api_key: str | None = None
    ai_request_timeout_ms: int = 15000
    ai_connect_timeout_ms: int = 5000

    control_plane_internal_url: str = "http://localhost:8081"
    internal_token: str = "change-me-internal-token"
    secrets_dir: str = "./secrets"

    livekit_url: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "devsecretdevsecretdevsecret"
    agent_name: str = "avatar-agent"
    max_concurrent_jobs: int = 10


def load_settings() -> Settings:
    """Loads and validates the process environment once at boot."""
    return Settings()
