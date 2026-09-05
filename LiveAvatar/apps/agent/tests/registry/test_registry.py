"""Unit tests for the provider registry (LLD §7.3)."""

from __future__ import annotations

from uuid import UUID

import pytest

from avatar_agent.contracts.runtime_config import AgentRuntimeConfig, LlmLeg
from avatar_agent.registry.errors import FactoryLoadError
from avatar_agent.registry.registry import (
    EmbeddingRequestConfig,
    LlmLegRequestConfig,
    resolve_avatar,
    resolve_embedding,
    resolve_llm,
    resolve_llm_standalone,
    resolve_stt,
    resolve_tts,
)


class FakeSecretStore:
    def __init__(self, values: dict[str, str] | None = None) -> None:
        self._values = values or {}

    def resolve(self, credential_ref: str) -> str:
        from avatar_agent.ports.secrets import SecretNotFoundError

        if credential_ref not in self._values:
            raise SecretNotFoundError(credential_ref)
        return self._values[credential_ref]


def make_cfg(**overrides: object) -> AgentRuntimeConfig:
    base = {
        "version": 1,
        "deployment": {"tenant_id": str(UUID(int=1)), "name": "t"},
        "transport": {"provider": "livekit", "room_namespace": "acme"},
        "stt": {"provider": "deepgram", "credential_ref": "secrets/deepgram", "language": "en-US"},
        "reasoning": {
            "entry_node_id": "llm-1",
            "background_entry_node_ids": [],
            "turn_budget_ms": 3000,
            "graph": [
                {
                    "id": "llm-1",
                    "type": "llm",
                    "name": "Answer",
                    "lane": "foreground",
                    "on_error": {"action": "degrade"},
                    "on_deadline": {"action": "degrade"},
                    "provider": "openai",
                    "credential_ref": "secrets/openai",
                    "model": "gpt-4o",
                    "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
                    "next_node_id": None,
                }
            ],
        },
        "tts": {"provider": "fish-speech", "credential_ref": "secrets/fish-speech", "voice_id": "v1"},
        "avatar": {"provider": "bithuman", "credential_ref": "secrets/bithuman", "avatar_id": "a1"},
        "agent": {
            "runtime": "langgraph",
            "system_prompt": "hi",
            "tools": [],
            "memory": {"enabled": True, "window_turns": 16},
        },
        "knowledge": {
            "pipeline": {
                "rewrite": {"enabled": True, "context_turns": 3, "budget_ms": 150},
                "hybrid_search": {"vector_weight": 0.6, "keyword_weight": 0.4, "candidates": 20, "budget_ms": 100},
                "metadata_filter": {"enabled": False, "budget_ms": 20},
                "rerank": {"enabled": False},
                "threshold": {"min_score": 0.5, "budget_ms": 10},
                "inject": {"token_cap": 1200, "citation_format": "numbered", "budget_ms": 30},
            }
        },
        "privacy": {"send_to_remote_llm": "prompt_text_only", "retain_transcripts_days": 90, "recordings_enabled": False},
        "alerts": {"degraded_mode_message": "hold on"},
        "session_id": str(UUID(int=2)),
        "room_name": "acme_s1",
        "endpoints": {
            "deepgram": "https://stt.example.com",
            "openai": "https://api.openai.com",
            "fish-speech": "https://tts.example.com",
        },
    }
    base.update(overrides)
    return AgentRuntimeConfig.model_validate(base)


SECRETS = FakeSecretStore(
    {
        "secrets/openai": "sk-key",
        "secrets/deepgram": "dg-key",
        "secrets/fish-speech": "fs-key",
        "secrets/anthropic": "an-key",
        "secrets/bithuman": "bh-key",
        "secrets/liveavatar": "la-key",
    }
)


def test_resolve_llm_returns_the_openai_adapter_for_a_primary_leg() -> None:
    leg = LlmLeg(provider="openai", credential_ref="secrets/openai", model="gpt-4o")
    adapter = resolve_llm(make_cfg(), leg, SECRETS)
    assert adapter.key == "openai"


def test_resolve_llm_resolves_an_explicit_fallback_leg_directly() -> None:
    """Phase 9 (BL-036): `resolve_llm` takes a resolved `LlmLeg` directly —
    the caller (`entrypoint._resolve_llm_nodes`) resolves one leg per
    `llm`-type graph node's `primary`/`fallback`, not a `(cfg, role)` pair.
    A fallback leg is just another `LlmLeg`, resolved the same way.
    """
    leg = LlmLeg(provider="anthropic", credential_ref="secrets/anthropic", model="claude-3-5-sonnet")
    adapter = resolve_llm(make_cfg(), leg, SECRETS)
    assert adapter.key == "anthropic"


def test_resolve_llm_raises_for_an_unresolvable_credential_ref() -> None:
    leg = LlmLeg(provider="openai", credential_ref="secrets/does-not-exist", model="gpt-4o")
    with pytest.raises(FactoryLoadError):
        resolve_llm(make_cfg(), leg, SECRETS)


def test_resolve_stt_returns_the_deepgram_adapter() -> None:
    adapter = resolve_stt(make_cfg(), SECRETS)
    assert adapter.key == "deepgram"


def test_resolve_tts_returns_the_fish_speech_adapter() -> None:
    adapter = resolve_tts(make_cfg(), SECRETS)
    assert adapter.key == "fish-speech"


def test_resolve_avatar_returns_the_bithuman_adapter() -> None:
    """BL-018: `bithuman` now has a real factory (Phase 4 only stubbed this)."""
    adapter = resolve_avatar(make_cfg(), SECRETS)
    assert adapter.key == "bithuman"


def test_resolve_avatar_raises_for_an_unresolvable_credential_ref() -> None:
    cfg = make_cfg()
    cfg.avatar.credential_ref = "secrets/does-not-exist"
    with pytest.raises(FactoryLoadError):
        resolve_avatar(cfg, SECRETS)


def test_resolve_avatar_returns_the_alibaba_liveavatar_adapter() -> None:
    """BL-019 (Phase 6): `alibaba-liveavatar` now has a real factory,
    proving `IAvatarProvider` generalizes beyond its first implementer
    (FR-AVATAR-2)."""
    cfg = make_cfg(
        avatar={"provider": "alibaba-liveavatar", "credential_ref": "secrets/liveavatar", "avatar_id": "a1"},
        endpoints={
            "deepgram": "https://stt.example.com",
            "openai": "https://api.openai.com",
            "fish-speech": "https://tts.example.com",
            "alibaba-liveavatar": "https://liveavatar.acme-corp.example",
        },
    )
    adapter = resolve_avatar(cfg, SECRETS)
    assert adapter.key == "alibaba-liveavatar"


# --- Standalone LLM resolution (Phase 12b, BL-045/047) ---------------------


def test_resolve_llm_standalone_returns_the_openai_adapter() -> None:
    cfg = LlmLegRequestConfig(provider="openai", model="gpt-4o-mini", credential_ref="secrets/openai")
    adapter = resolve_llm_standalone(cfg, SECRETS)
    assert adapter.key == "openai"


def test_resolve_llm_standalone_raises_for_an_unknown_provider() -> None:
    cfg = LlmLegRequestConfig(provider="does-not-exist", model="x")
    with pytest.raises(FactoryLoadError):
        resolve_llm_standalone(cfg, SECRETS)


def test_resolve_llm_standalone_raises_for_an_unresolvable_credential_ref() -> None:
    cfg = LlmLegRequestConfig(provider="openai", model="gpt-4o-mini", credential_ref="secrets/does-not-exist")
    with pytest.raises(FactoryLoadError):
        resolve_llm_standalone(cfg, SECRETS)


def test_resolve_llm_standalone_leaves_api_key_none_when_credential_ref_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env-fallback-unused-by-our-code")
    cfg = LlmLegRequestConfig(provider="openai", model="gpt-4o-mini", credential_ref=None)
    adapter = resolve_llm_standalone(cfg, SECRETS)
    assert adapter._runtime.api_key is None


# --- Embedding (Phase 12a, BL-044) -----------------------------------------


def test_resolve_embedding_raises_for_an_unknown_provider() -> None:
    cfg = EmbeddingRequestConfig(provider="does-not-exist", model="text-embedding-3-small")
    with pytest.raises(FactoryLoadError):
        resolve_embedding(cfg, SECRETS)


def test_resolve_embedding_returns_the_openai_adapter_with_a_resolved_credential() -> None:
    cfg = EmbeddingRequestConfig(provider="openai", model="text-embedding-3-small", credential_ref="secrets/openai")
    adapter = resolve_embedding(cfg, SECRETS)
    assert adapter.key == "openai"
    assert adapter._runtime.api_key == "sk-key"
    assert adapter._runtime.model == "text-embedding-3-small"


def test_resolve_embedding_leaves_api_key_none_when_credential_ref_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """`_resolve_secret` must pass `None` straight through into
    `ProviderRuntime.api_key` (never substituting a fallback of its own).

    `OPENAI_API_KEY` is set here only so the real `openai.AsyncOpenAI`
    client `OpenAiEmbeddingAdapter.__init__` constructs doesn't itself
    raise `OpenAIError` at construction time — the installed `openai` SDK
    (2.54.0, well past this project's `>=1.40` pin) now requires *some*
    credential (an explicit `api_key` or this env var) to be present at
    client-construction time, a pre-existing property of the vendor SDK
    version this environment has installed, reproducible identically
    against the existing `adapters/llm/openai.py::OpenAiLlmAdapter` and
    unrelated to this phase's registry code. `ProviderRuntime.api_key`
    (the value this test actually asserts on) is unaffected either way —
    it is set directly from what `resolve_embedding` resolved, not from
    whatever the SDK client's own internal fallback does with it.
    """
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env-fallback-unused-by-our-code")
    cfg = EmbeddingRequestConfig(provider="openai", model="text-embedding-3-small", credential_ref=None)
    adapter = resolve_embedding(cfg, SECRETS)
    assert adapter._runtime.api_key is None


def test_resolve_embedding_raises_for_an_unresolvable_credential_ref() -> None:
    cfg = EmbeddingRequestConfig(provider="openai", model="text-embedding-3-small", credential_ref="secrets/does-not-exist")
    with pytest.raises(FactoryLoadError):
        resolve_embedding(cfg, SECRETS)
