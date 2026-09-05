"""The AI provider registry (LLD §7.3) — the **only** module that imports
`avatar_agent.adapters`. Resolves a logical key + the session's
`AgentRuntimeConfig` into a ready-to-use port implementation, with every
adapter constructor input (`endpoint_url`, `api_key`, `model`, timeouts)
pre-resolved here so no adapter ever reads `os.environ` or the raw config
directly (`.importlinter`'s `vendor-sdk-isolation` contract also forbids
adapters from importing each other's vendor SDKs across categories).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from avatar_agent.contracts.runtime_config import AgentRuntimeConfig, LlmLeg
from avatar_agent.ports.avatar import IAvatarProvider
from avatar_agent.ports.embedding import IEmbeddingProvider
from avatar_agent.ports.llm import ILLMProvider
from avatar_agent.ports.runtime import ProviderRuntime, Timeouts
from avatar_agent.ports.secrets import SecretNotFoundError, SecretStorePort
from avatar_agent.ports.stt import ISTTProvider
from avatar_agent.ports.tts import ITTSProvider
from avatar_agent.registry.errors import FactoryLoadError
from avatar_agent.registry.keys import (
    AVATAR_PROVIDER_TO_LOGICAL_KEY,
    EMBEDDING_PROVIDER_TO_LOGICAL_KEY,
    LLM_PROVIDER_TO_LOGICAL_KEY,
    STT_PROVIDER_TO_LOGICAL_KEY,
    TTS_PROVIDER_TO_LOGICAL_KEY,
    LogicalProviderKey,
)

__all__ = [
    "ProviderRuntime",
    "Timeouts",
    "resolve_llm",
    "LlmLegRequestConfig",
    "resolve_llm_standalone",
    "resolve_stt",
    "resolve_tts",
    "resolve_avatar",
    "EmbeddingRequestConfig",
    "resolve_embedding",
]


def _resolve_secret(secrets: SecretStorePort, credential_ref: str | None) -> str | None:
    """Resolves a `credential_ref` to its secret value, or `None` if absent.
    A ref that fails to resolve is a `FactoryLoadError` at the call site,
    not a silent `None` — a configured-but-broken credential must not look
    identical to "no credential configured".
    """
    if credential_ref is None:
        return None
    try:
        return secrets.resolve(credential_ref)
    except SecretNotFoundError as err:
        raise FactoryLoadError(str(err), logical_key=credential_ref) from err


def _endpoint_for(cfg: AgentRuntimeConfig, provider_key: str) -> str | None:
    url = cfg.endpoints.get(provider_key)
    return str(url) if url is not None else None


# --- LLM ---------------------------------------------------------------

_LLM_FACTORIES: dict[LogicalProviderKey, Callable[[ProviderRuntime], ILLMProvider]] = {}


def _llm_factories() -> dict[LogicalProviderKey, Callable[[ProviderRuntime], ILLMProvider]]:
    # Imported lazily inside a function (rather than at module import time)
    # so the vendor-SDK-isolation contract's static analysis has a single,
    # obvious import site to check, and so importing `registry` in a test
    # that only exercises STT/TTS doesn't require every LLM vendor SDK to be
    # installed.
    if not _LLM_FACTORIES:
        from avatar_agent.adapters.llm._openai_compatible import OpenAiCompatibleLlmAdapter
        from avatar_agent.adapters.llm.anthropic import AnthropicLlmAdapter
        from avatar_agent.adapters.llm.google import GoogleLlmAdapter
        from avatar_agent.adapters.llm.openai import OpenAiLlmAdapter

        _LLM_FACTORIES.update(
            {
                LogicalProviderKey.LLM_OPENAI: OpenAiLlmAdapter,
                LogicalProviderKey.LLM_ANTHROPIC: AnthropicLlmAdapter,
                LogicalProviderKey.LLM_GOOGLE: GoogleLlmAdapter,
                LogicalProviderKey.LLM_OPENAI_COMPATIBLE: OpenAiCompatibleLlmAdapter,
            }
        )
    return _LLM_FACTORIES


def resolve_llm(cfg: AgentRuntimeConfig, leg: LlmLeg, secrets: SecretStorePort) -> ILLMProvider:
    """Resolves the LLM adapter for one `LlmLeg` (FR-LLM-1).

    Phase 9 (BL-036): takes a resolved `LlmLeg` directly instead of a
    `(cfg, role)` pair — the caller (`entrypoint.build_pipeline`) resolves
    one leg per `llm`-type `reasoning.graph[]` node's `primary`/`fallback`,
    not a single top-level `llm.primary`/`llm.fallback` pair.
    """
    logical_key = LLM_PROVIDER_TO_LOGICAL_KEY.get(leg.provider)
    if logical_key is None:
        raise FactoryLoadError(f"unknown LLM provider '{leg.provider}'", logical_key=leg.provider)

    factory = _llm_factories().get(logical_key)
    if factory is None:
        raise FactoryLoadError(f"no factory registered for {logical_key}", logical_key=logical_key.value)

    runtime = ProviderRuntime(
        logical_key=logical_key,
        endpoint_url=_endpoint_for(cfg, leg.provider),
        api_key=_resolve_secret(secrets, leg.credential_ref),
        model=leg.model,
    )
    return factory(runtime)


# Phase 12b (BL-045/047): `services/ai_service.py`'s `/retrieve-preview`
# rewrite stage needs one standalone LLM leg (the request body's `llm`
# field), with no `AgentRuntimeConfig`/session to read `cfg.endpoints`
# from — the exact reason `EmbeddingRequestConfig`/`resolve_embedding` got
# their own standalone-context shape in Phase 12a instead of reusing
# `resolve_llm`'s `cfg`-taking signature. Mirrors that precedent directly
# rather than either (a) constructing a throwaway `AgentRuntimeConfig` just
# to satisfy `resolve_llm`'s type, which would need every other required
# top-level block filled in for a value nothing else uses, or (b) reaching
# into `adapters.llm.*` factories directly from `services/ai_service.py`,
# which would duplicate `_llm_factories()`'s vendor-key dispatch outside the
# registry. This reuses that exact same factory map with zero new
# vendor-SDK-touching surface.


@dataclass(frozen=True)
class LlmLegRequestConfig:
    """Resolved input for one standalone LLM call outside a session context
    (Phase 12b) — analogous to `EmbeddingRequestConfig` above."""

    provider: str
    model: str
    credential_ref: str | None = None
    endpoint_url: str | None = None


def resolve_llm_standalone(cfg: LlmLegRequestConfig, secrets: SecretStorePort) -> ILLMProvider:
    """Resolves one LLM leg for a standalone call outside a session
    (Phase 12b) — same factory map `resolve_llm` uses, just built from a
    bare provider/model/credential_ref triple instead of a `LlmLeg` sitting
    inside a resolved `AgentRuntimeConfig`."""
    logical_key = LLM_PROVIDER_TO_LOGICAL_KEY.get(cfg.provider)
    if logical_key is None:
        raise FactoryLoadError(f"unknown LLM provider '{cfg.provider}'", logical_key=cfg.provider)

    factory = _llm_factories().get(logical_key)
    if factory is None:
        raise FactoryLoadError(f"no factory registered for {logical_key}", logical_key=logical_key.value)

    runtime = ProviderRuntime(
        logical_key=logical_key,
        endpoint_url=cfg.endpoint_url,
        api_key=_resolve_secret(secrets, cfg.credential_ref),
        model=cfg.model,
    )
    return factory(runtime)


# --- STT -----------------------------------------------------------------

_STT_FACTORIES: dict[LogicalProviderKey, Callable[[ProviderRuntime], ISTTProvider]] = {}


def _stt_factories() -> dict[LogicalProviderKey, Callable[[ProviderRuntime], ISTTProvider]]:
    if not _STT_FACTORIES:
        from avatar_agent.adapters.stt.deepgram import DeepgramSttAdapter
        from avatar_agent.adapters.stt.faster_whisper import FasterWhisperSttAdapter

        _STT_FACTORIES.update(
            {
                LogicalProviderKey.STT_DEEPGRAM: DeepgramSttAdapter,
                LogicalProviderKey.STT_FASTER_WHISPER: FasterWhisperSttAdapter,
            }
        )
    return _STT_FACTORIES


def resolve_stt(cfg: AgentRuntimeConfig, secrets: SecretStorePort) -> ISTTProvider:
    """Resolves the STT adapter (FR-STT-1/2)."""
    logical_key = STT_PROVIDER_TO_LOGICAL_KEY.get(cfg.stt.provider)
    if logical_key is None:
        raise FactoryLoadError(f"unknown STT provider '{cfg.stt.provider}'", logical_key=cfg.stt.provider)
    factory = _stt_factories().get(logical_key)
    if factory is None:
        raise FactoryLoadError(f"no factory registered for {logical_key}", logical_key=logical_key.value)
    runtime = ProviderRuntime(
        logical_key=logical_key,
        endpoint_url=_endpoint_for(cfg, cfg.stt.provider),
        api_key=_resolve_secret(secrets, cfg.stt.credential_ref),
        model=cfg.stt.model,
        extra={"language": cfg.stt.language},
    )
    return factory(runtime)


# --- TTS -----------------------------------------------------------------

_TTS_FACTORIES: dict[LogicalProviderKey, Callable[[ProviderRuntime], ITTSProvider]] = {}


def _tts_factories() -> dict[LogicalProviderKey, Callable[[ProviderRuntime], ITTSProvider]]:
    if not _TTS_FACTORIES:
        from avatar_agent.adapters.tts.elevenlabs import ElevenLabsTtsAdapter
        from avatar_agent.adapters.tts.fish_speech import FishSpeechTtsAdapter

        _TTS_FACTORIES.update(
            {
                LogicalProviderKey.TTS_FISH_SPEECH: FishSpeechTtsAdapter,
                LogicalProviderKey.TTS_ELEVENLABS: ElevenLabsTtsAdapter,
            }
        )
    return _TTS_FACTORIES


def resolve_tts(cfg: AgentRuntimeConfig, secrets: SecretStorePort) -> ITTSProvider:
    """Resolves the TTS adapter (FR-TTS-1/2)."""
    logical_key = TTS_PROVIDER_TO_LOGICAL_KEY.get(cfg.tts.provider)
    if logical_key is None:
        raise FactoryLoadError(f"unknown TTS provider '{cfg.tts.provider}'", logical_key=cfg.tts.provider)
    factory = _tts_factories().get(logical_key)
    if factory is None:
        raise FactoryLoadError(f"no factory registered for {logical_key}", logical_key=logical_key.value)
    runtime = ProviderRuntime(
        logical_key=logical_key,
        endpoint_url=_endpoint_for(cfg, cfg.tts.provider),
        api_key=_resolve_secret(secrets, cfg.tts.credential_ref),
        model=None,
        extra={"voice_id": cfg.tts.voice_id},
    )
    return factory(runtime)


# --- Avatar ----------------------------------------------------------------
# `bithuman` (Phase 5/BL-018) and `alibaba-liveavatar` (Phase 6/BL-019) both
# have real factories now — the second adapter is what actually proves
# `IAvatarProvider` generalizes beyond its first implementer (FR-AVATAR-2).

_AVATAR_FACTORIES: dict[LogicalProviderKey, Callable[[ProviderRuntime], IAvatarProvider]] = {}


def _avatar_factories() -> dict[LogicalProviderKey, Callable[[ProviderRuntime], IAvatarProvider]]:
    if not _AVATAR_FACTORIES:
        from avatar_agent.adapters.avatar.alibaba_liveavatar import AlibabaLiveAvatarAdapter
        from avatar_agent.adapters.avatar.bithuman import BithumanAvatarAdapter

        _AVATAR_FACTORIES.update(
            {
                LogicalProviderKey.AVATAR_BITHUMAN: BithumanAvatarAdapter,
                LogicalProviderKey.AVATAR_ALIBABA: AlibabaLiveAvatarAdapter,
            }
        )
    return _AVATAR_FACTORIES


def resolve_avatar(cfg: AgentRuntimeConfig, secrets: SecretStorePort) -> IAvatarProvider:
    """Resolves the avatar adapter (FR-AVATAR-1/2).

    `avatar.avatar_id` is threaded through as `extra["avatar_id"]` rather
    than a `ProviderRuntime.model` — `model` is reserved for the LLM/STT
    role-resolved concrete id concept (LLD §7.2/§7.3); an avatar catalog
    asset id is a different kind of identifier (a self-hosted asset
    reference, not a vendor model name), so it goes through the same
    `extra` mapping `resolve_stt`/`resolve_tts` already use for their own
    provider-specific extras (`language`, `voice_id`).
    """
    logical_key = AVATAR_PROVIDER_TO_LOGICAL_KEY.get(cfg.avatar.provider)
    if logical_key is None:
        raise FactoryLoadError(f"unknown avatar provider '{cfg.avatar.provider}'", logical_key=cfg.avatar.provider)
    factory = _avatar_factories().get(logical_key)
    if factory is None:
        raise FactoryLoadError(f"no factory registered for {logical_key}", logical_key=logical_key.value)
    runtime = ProviderRuntime(
        logical_key=logical_key,
        endpoint_url=_endpoint_for(cfg, cfg.avatar.provider),
        api_key=_resolve_secret(secrets, cfg.avatar.credential_ref),
        model=None,
        extra={"avatar_id": cfg.avatar.avatar_id},
    )
    return factory(runtime)


# --- Embedding -------------------------------------------------------------
# Phase 12a (BL-044): resolved for one standalone `/embed` call, not a
# session's `AgentRuntimeConfig` -- `services/ai_service.py` has no session
# context, so this takes an `EmbeddingRequestConfig` instead of `(cfg, ...)`.


@dataclass(frozen=True)
class EmbeddingRequestConfig:
    """Resolved input for one `/embed` call — analogous to `LlmLeg` but for
    a standalone request rather than a session's published config (this
    service has no `AgentRuntimeConfig`/session context)."""

    provider: str
    model: str
    credential_ref: str | None = None
    endpoint_url: str | None = None


_EMBEDDING_FACTORIES: dict[LogicalProviderKey, Callable[[ProviderRuntime], IEmbeddingProvider]] = {}


def _embedding_factories() -> dict[LogicalProviderKey, Callable[[ProviderRuntime], IEmbeddingProvider]]:
    if not _EMBEDDING_FACTORIES:
        from avatar_agent.adapters.embedding.openai import OpenAiEmbeddingAdapter

        _EMBEDDING_FACTORIES.update({LogicalProviderKey.EMBEDDING_OPENAI: OpenAiEmbeddingAdapter})
    return _EMBEDDING_FACTORIES


def resolve_embedding(cfg: EmbeddingRequestConfig, secrets: SecretStorePort) -> IEmbeddingProvider:
    """Resolves the embedding adapter for one `/embed` call (BL-044)."""
    logical_key = EMBEDDING_PROVIDER_TO_LOGICAL_KEY.get(cfg.provider)
    if logical_key is None:
        raise FactoryLoadError(f"unknown embedding provider '{cfg.provider}'", logical_key=cfg.provider)
    factory = _embedding_factories().get(logical_key)
    if factory is None:
        raise FactoryLoadError(f"no factory registered for {logical_key}", logical_key=logical_key.value)
    runtime = ProviderRuntime(
        logical_key=logical_key,
        endpoint_url=cfg.endpoint_url,
        api_key=_resolve_secret(secrets, cfg.credential_ref),
        model=cfg.model,
    )
    return factory(runtime)
