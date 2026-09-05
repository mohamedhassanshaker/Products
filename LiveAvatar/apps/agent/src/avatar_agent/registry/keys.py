"""Logical provider keys and model roles (LLD §7.2).

No vendor model id appears anywhere in code — code asks for a *role*; the
concrete id comes from the tenant's published config or an `AI_MODEL_*` env
default. A vendor model literal (e.g. `"gpt-4o"`) outside a test fixture is
a defect (`nexus-qa` greps for this).
"""

from __future__ import annotations

from enum import StrEnum


class LogicalProviderKey(StrEnum):
    """One entry per adapter factory (LLD §7.2/§7.3)."""

    TRANSPORT_LIVEKIT = "transport.livekit"
    STT_DEEPGRAM = "stt.deepgram"
    STT_FASTER_WHISPER = "stt.faster-whisper"
    LLM_OPENAI = "llm.openai"
    LLM_ANTHROPIC = "llm.anthropic"
    LLM_GOOGLE = "llm.google"
    LLM_OPENAI_COMPATIBLE = "llm.openai-compatible"
    TTS_FISH_SPEECH = "tts.fish-speech"
    TTS_ELEVENLABS = "tts.elevenlabs"
    AVATAR_BITHUMAN = "avatar.bithuman"
    AVATAR_ALIBABA = "avatar.alibaba-liveavatar"
    EMBEDDING_OPENAI = "embedding.openai"


class LogicalModelRole(StrEnum):
    """LLM call-site roles — never a concrete model id (LLD §7.2)."""

    CONVERSATION_PRIMARY = "conversation.primary"
    CONVERSATION_FALLBACK = "conversation.fallback"
    SUMMARY = "summary"


# Maps the canonical YAML's `provider` string literal to its logical key.
# `openai-compatible` has no YAML literal in v1 (LLD §7.3's on-prem escape
# hatch is env-selected only via `AI_BASE_URL`, not a catalog entry — spec
# §7.2 defers an on-prem LLM *catalog entry*).
LLM_PROVIDER_TO_LOGICAL_KEY: dict[str, LogicalProviderKey] = {
    "openai": LogicalProviderKey.LLM_OPENAI,
    "anthropic": LogicalProviderKey.LLM_ANTHROPIC,
    "google": LogicalProviderKey.LLM_GOOGLE,
}
STT_PROVIDER_TO_LOGICAL_KEY: dict[str, LogicalProviderKey] = {
    "deepgram": LogicalProviderKey.STT_DEEPGRAM,
    "faster-whisper": LogicalProviderKey.STT_FASTER_WHISPER,
}
TTS_PROVIDER_TO_LOGICAL_KEY: dict[str, LogicalProviderKey] = {
    "fish-speech": LogicalProviderKey.TTS_FISH_SPEECH,
    "elevenlabs": LogicalProviderKey.TTS_ELEVENLABS,
}
AVATAR_PROVIDER_TO_LOGICAL_KEY: dict[str, LogicalProviderKey] = {
    "bithuman": LogicalProviderKey.AVATAR_BITHUMAN,
    "alibaba-liveavatar": LogicalProviderKey.AVATAR_ALIBABA,
}
EMBEDDING_PROVIDER_TO_LOGICAL_KEY: dict[str, LogicalProviderKey] = {
    "openai": LogicalProviderKey.EMBEDDING_OPENAI,
}
